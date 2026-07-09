<?php

namespace App\Services;

use App\Models\AiChatLog;
use App\Models\AttendanceRecord;
use App\Models\EmployeeWorkInfo;
use App\Models\LeaveRequest;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AiChatService
{
    public function chat(string $message, array $history, ?User $user = null): string
    {
        $apiKey = (string) config('services.ai.api_key');
        if ($apiKey === '') {
            return 'The AI assistant is not configured yet. Please ask your administrator to add an AI API key, or check the Help section (Settings → Help).';
        }

        $systemPrompt = $this->systemPrompt($user);

        // Build available tools based on user role
        $tools = $this->availableTools($user);

        $messages = [['role' => 'system', 'content' => $systemPrompt]];
        foreach ($history as $entry) {
            if (isset($entry['role'], $entry['content']) && is_string($entry['content'])) {
                $messages[] = ['role' => $entry['role'], 'content' => $entry['content']];
            }
        }
        $messages[] = ['role' => 'user', 'content' => $message];

        $models = array_values(array_unique(array_filter(array_merge(
            [(string) config('services.ai.model', 'deepseek/deepseek-chat:free')],
            explode(',', (string) config('services.ai.fallback_models', ''))
        ))));

        $lastError = null;
        $baseUrl = rtrim((string) config('services.ai.base_url', 'https://opencode.ai/zen/v1'), '/');
        $toolCallsUsed = [];

        foreach ($models as $model) {
            try {
                $payload = [
                    'model' => $model,
                    'messages' => $messages,
                    'temperature' => 0.7,
                    'max_tokens' => 500,
                ];

                if (! empty($tools)) {
                    $payload['tools'] = $tools;
                    $payload['tool_choice'] = 'auto';
                }

                $response = Http::withToken($apiKey)
                    ->timeout(30)
                    ->post($baseUrl . '/chat/completions', $payload);

                if ($response->successful()) {
                    $json = $response->json();
                    $choice = data_get($json, 'choices.0.message', []);

                    // Handle tool calls if the model wants them
                    if (! empty($choice['tool_calls'])) {
                        $messages[] = $choice;

                        foreach ($choice['tool_calls'] as $tc) {
                            $fnName = data_get($tc, 'function.name', '');
                            $fnArgs = json_decode(data_get($tc, 'function.arguments', '{}'), true) ?? [];
                            $toolCallsUsed[] = $fnName;

                            $toolResult = $this->executeTool($fnName, $fnArgs, $user);

                            $messages[] = [
                                'role' => 'tool',
                                'tool_call_id' => data_get($tc, 'id', ''),
                                'content' => $toolResult,
                            ];
                        }

                        // Re-call the model with tool results
                        $followUp = Http::withToken($apiKey)
                            ->timeout(30)
                            ->post($baseUrl . '/chat/completions', [
                                'model' => $model,
                                'messages' => $messages,
                                'temperature' => 0.7,
                                'max_tokens' => 500,
                            ]);

                        if ($followUp->successful()) {
                            $followContent = data_get($followUp->json(), 'choices.0.message.content');
                            if (is_string($followContent) && trim($followContent) !== '') {
                                $reply = trim($followContent);
                                $this->logConversation($user, $message, $reply, $toolCallsUsed);
                                return $reply;
                            }
                        }
                    }

                    $content = data_get($choice, 'content');
                    if (is_string($content) && trim($content) !== '') {
                        $reply = trim($content);
                        $this->logConversation($user, $message, $reply, $toolCallsUsed);
                        return $reply;
                    }
                }

                $lastError = $response->status() . ' ' . $response->body();
                Log::warning('AiChatService: model failed', [
                    'model' => $model,
                    'status' => $response->status(),
                    'body' => $response->body(),
                ]);
            } catch (\Throwable $e) {
                $lastError = $e->getMessage();
                Log::warning('AiChatService: request threw', [
                    'model' => $model,
                    'error' => $e->getMessage(),
                ]);
            }
        }

        return 'I am having trouble reaching the AI service right now. Please try again later, or check the Help section (Settings → Help).';
    }

    /**
     * Build the list of function tools the model can call, scoped to the user's role.
     */
    private function availableTools(?User $user): array
    {
        if (! $user) {
            return [];
        }

        $tools = [];
        $role = $user->role;

        // All authenticated users can check their own leave balance
        $tools[] = $this->toolDef('getLeaveBalance', 'Get the logged-in employee\'s leave balance by category (paid, sick, birthday, unpaid).', []);

        // Managers and admins can see pending approvals and team status
        if (in_array($role, ['admin', 'super_admin', 'manager'], true)) {
            $tools[] = $this->toolDef('getPendingApprovalsCount', 'Count of leave and time-edit requests pending this reviewer\'s approval.', []);
            $tools[] = $this->toolDef('getMyTeamStatus', 'Today\'s attendance and leave status for the manager\'s direct reports.', []);
        }

        // Admins and super_admins can see org-wide data
        if (in_array($role, ['admin', 'super_admin'], true)) {
            $tools[] = $this->toolDef('getTodayAttendanceSummary', 'Summary of who is clocked in, late, or absent across the organisation today.', []);
            $tools[] = $this->toolDef('getPayrollCycleStatus', 'Current payroll cycle status — percentage processed and any blockers.', []);
        }

        return $tools;
    }

    private function toolDef(string $name, string $description, array $parameters): array
    {
        return [
            'type' => 'function',
            'function' => [
                'name' => $name,
                'description' => $description,
                'parameters' => [
                    'type' => 'object',
                    'properties' => $parameters,
                    'required' => array_keys(array_filter($parameters, fn ($p) => $p['required'] ?? false)),
                ],
            ],
        ];
    }

    /**
     * Execute a tool call. Each tool runs its own authorization check.
     */
    private function executeTool(string $name, array $args, ?User $user): string
    {
        if (! $user) {
            return 'User not authenticated.';
        }

        return match ($name) {
            'getLeaveBalance' => $this->getLeaveBalance($user),
            'getPendingApprovalsCount' => $this->getPendingApprovalsCount($user),
            'getTodayAttendanceSummary' => $this->getTodayAttendanceSummary($user),
            'getPayrollCycleStatus' => $this->getPayrollCycleStatus($user),
            'getMyTeamStatus' => $this->getMyTeamStatus($user),
            default => 'Unknown function.',
        };
    }

    private function getLeaveBalance(User $user): string
    {
        $orgId = $user->organization_id;
        if (! $orgId) {
            return 'No organisation found for your account.';
        }

        $categories = ['paid', 'sick', 'birthday', 'unpaid'];
        $balance = [];

        foreach ($categories as $cat) {
            $approved = LeaveRequest::where('user_id', $user->id)
                ->where('organization_id', $orgId)
                ->where('leave_category', $cat)
                ->where('status', 'approved')
                ->count();
            $balance[$cat] = ['approved_requests' => $approved];
        }

        return json_encode($balance);
    }

    private function getPendingApprovalsCount(User $user): string
    {
        $role = $user->role;
        if (! in_array($role, ['admin', 'super_admin', 'manager'], true)) {
            return 'You do not have access to approval data. This is something your admin or manager can check.';
        }

        $orgId = $user->organization_id;
        if (! $orgId) {
            return 'No organisation found.';
        }

        $leavePending = LeaveRequest::where('organization_id', $orgId)
            ->where('status', 'pending')
            ->when($role === 'manager', function ($q) use ($user) {
                $directReports = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
                    ->pluck('user_id');
                $q->whereIn('user_id', $directReports->push($user->id));
            })
            ->count();

        return json_encode(['pending_leave_requests' => $leavePending]);
    }

    private function getTodayAttendanceSummary(User $user): string
    {
        if (! in_array($user->role, ['admin', 'super_admin'], true)) {
            return 'You do not have access to organisation-wide attendance data. This is something your admin can check.';
        }

        $orgId = $user->organization_id;
        if (! $orgId) {
            return 'No organisation found.';
        }

        $today = now()->toDateString();
        $records = AttendanceRecord::where('organization_id', $orgId)
            ->where('attendance_date', $today)
            ->get();

        $clockedIn = $records->where('status', '!=', 'absent')->count();
        $late = $records->where('late_minutes', '>', 0)->count();
        $absent = $records->where('status', 'absent')->count();
        $totalEmployees = DB::table('users')
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->count();

        return json_encode([
            'total_employees' => $totalEmployees,
            'clocked_in' => $clockedIn,
            'late' => $late,
            'absent' => $absent,
        ]);
    }

    private function getPayrollCycleStatus(User $user): string
    {
        if (! in_array($user->role, ['admin', 'super_admin'], true)) {
            return 'You do not have access to payroll data. This is something your admin can check.';
        }

        $orgId = $user->organization_id;
        if (! $orgId) {
            return 'No organisation found.';
        }

        $currentMonth = now()->format('Y-m');
        $run = PayrollMonthlyRun::where('organization_id', $orgId)
            ->where('month_year', $currentMonth)
            ->first();

        if (! $run) {
            return json_encode(['status' => 'no_run', 'message' => 'No payroll run found for this month.']);
        }

        $totalEmployees = DB::table('users')
            ->where('organization_id', $orgId)
            ->whereNull('deleted_at')
            ->count();

        $processed = PayrollItem::where('payroll_run_id', $run->id)
            ->where('payment_status', 'paid')
            ->count();

        $percentage = $totalEmployees > 0 ? round(($processed / $totalEmployees) * 100) : 0;

        return json_encode([
            'status' => $run->status,
            'month' => $currentMonth,
            'percentage_processed' => $percentage,
            'processed' => $processed,
            'total_employees' => $totalEmployees,
        ]);
    }

    private function getMyTeamStatus(User $user): string
    {
        if (! in_array($user->role, ['admin', 'super_admin', 'manager'], true)) {
            return 'You do not have access to team data. This is something your manager or admin can check.';
        }

        $orgId = $user->organization_id;
        if (! $orgId) {
            return 'No organisation found.';
        }

        $directReports = EmployeeWorkInfo::where('reporting_manager_id', $user->id)
            ->pluck('user_id');

        if ($directReports->isEmpty()) {
            return json_encode(['message' => 'You have no direct reports.']);
        }

        $today = now()->toDateString();

        $attendance = AttendanceRecord::where('organization_id', $orgId)
            ->where('attendance_date', $today)
            ->whereIn('user_id', $directReports)
            ->get()
            ->keyBy('user_id');

        $todayLeaves = LeaveRequest::where('organization_id', $orgId)
            ->where('start_date', '<=', $today)
            ->where('end_date', '>=', $today)
            ->where('status', 'approved')
            ->whereIn('user_id', $directReports)
            ->pluck('user_id', 'user_id')
            ->toArray();

        $result = [];
        $reportNames = User::whereIn('id', $directReports)->pluck('name', 'id');

        foreach ($directReports as $empId) {
            $att = $attendance->get($empId);
            $result[] = [
                'name' => $reportNames[$empId] ?? "User #{$empId}",
                'status' => in_array($empId, $todayLeaves)
                    ? 'on_leave'
                    : ($att ? ($att->status === 'absent' ? 'absent' : 'present') : 'no_record'),
            ];
        }

        return json_encode($result);
    }

    private function logConversation(?User $user, string $message, string $reply, array $toolCallsUsed): void
    {
        if (! $user) {
            return;
        }

        try {
            AiChatLog::create([
                'user_id' => $user->id,
                'organization_id' => $user->organization_id,
                'message' => $message,
                'reply' => $reply,
                'tool_calls_used' => $toolCallsUsed ?: null,
            ]);
        } catch (\Throwable $e) {
            Log::warning('AiChatService: failed to log conversation', ['error' => $e->getMessage()]);
        }
    }

    private function systemPrompt(?User $user): string
    {
        $roleContext = '';
        if ($user) {
            $roleLabel = match ($user->role) {
                'super_admin' => 'Super Admin',
                'admin' => 'Admin',
                'manager' => 'Manager',
                'employee' => 'Employee',
                default => 'User',
            };
            $roleContext = "\n\nThe user is logged in as: {$roleLabel}.";
        }

        return "You are CareVance Assistant, a friendly and knowledgeable AI guide for the CareVance HRMS (Human Resource Management System) web and desktop app. "
            . "Your goal is to help users solve their problems on the first interaction. Be clear, concise, and action-oriented. "
            . "Always provide step-by-step guidance with exact navigation paths. If you don't know a specific org setting, give the most likely path and tell them where to look.\n\n"
            . "ALWAYS explain things in simple, everyday language — avoid jargon and technical terms. If the user asks about a feature, policy, or piece of data, first give the direct answer in one or two plain sentences, then offer more detail only if asked. Prefer short sentences over long ones.\n\n"
            . "IMPORTANT: If you cannot fully resolve the user's query, provide them with support contact information:\n"
            . "- Email: support@carevance.com\n"
            . "- Phone: +91 800-123-4567\n"
            . "- Hours: Mon-Fri, 9:00 AM - 6:00 PM IST\n\n"
            . "APP NAVIGATION (route => what it is, access):\n"
            . "- Dashboard (/dashboard): org overview and today's stats.\n"
            . "- Organization (/organization-tree, admin): company hierarchy.\n"
            . "- People: Employees (/employees, admin), New Hires (/new-hires, admin), Resignations (/resignations, admin), Departments (/employees/teams, admin), Roles & Permissions (/employees/roles, admin), Announcements (/notifications, admin), My Team (/my-team, employee), Chat (/chat).\n"
            . "- Attendance: Attendance (/attendance), Leave (/leave), Approval Inbox (/approval-inbox, admin — approve leave & time edits), Overtime (/edit-time), Breaks (/breaks), Monitoring (/monitoring/productive-time, admin), Screenshots (/monitoring/screenshots, admin), Selfies Map (/attendance/selfies-map, admin), Attendance Report (/reports/attendance, admin).\n"
            . "- Performance: Performance Reviews (/performance), Goals (/performance-goals).\n"
            . "- Expenses: My Expenses (/expenses).\n"
            . "- Work: Timesheets (/reports/hours-tracked, admin), Projects (/projects), Tasks (/tasks), Time Reports (/tasks/time-reports, admin).\n"
            . "- Reports (admin): Reports (/reports), Analytics (/analytics), Timeline (/reports/timeline), Web & App Usage (/reports/web-app-usage).\n"
            . "- Settings (admin): Settings (/settings), Audit Logs (/audit-logs), Geofence Zones (/settings/geofence), Roles (/settings/roles).\n"
            . "- Payroll (plan feature): My Payroll (/my-payroll), Payroll Dashboard (/payroll, strict admin), Tax Declarations (/tax-declarations), Tax Proofs Review (/tax-proofs, strict admin), Tax Simulator (/tax-simulator), Salary Revisions (/salary-revisions, strict admin), FBP (/fbp, strict admin), Reimbursements (/reimbursements), Loans & Advances (/loans, strict admin), Pre-Payroll Checklist (/pre-payroll-checklist, strict admin), Arrears (/arrears, strict admin), Leave Encashment (/leave-encashment, strict admin), F&F Settlements (/fnf-settlements, strict admin), Payroll Reports (/payroll-reports, strict admin), Advanced Payroll (/filings, strict admin).\n"
            . "- Resignation: Submit Resignation (/resignation, employee/manager), My Resignation (/resignation/status).\n\n"
            . "COMMON WORKFLOWS (provide step-by-step):\n"
            . "1. Submit leave: Go to Attendance → Leave (/leave) → Pick dates → Choose leave category (Paid/Sick/Birthday/Unpaid) → Choose full day or half day → Add reason → Submit. Managers/admins see it in Approval Inbox (/approval-inbox) and can Approve/Reject.\n"
            . "2. Approve requests: Go to Approval Inbox (/approval-inbox) → Review pending leave/time-edit → Click Approve or Reject.\n"
            . "3. Track time: Use the desktop app timer (or /attendance) to start/stop tracking. Breaks via /breaks. Overtime requests via /edit-time.\n"
            . "4. Expenses: Go to Expenses → My Expenses (/expenses) → Submit expense → Track status.\n"
            . "5. Announcements: Admins publish from Notifications (/notifications). Employees see them in the notification bell.\n"
            . "6. View payslip: Go to My Payroll (/my-payroll) → View current month → Download payslip.\n"
            . "7. Update profile: Go to Settings → Profile → Edit personal information.\n\n"
            . "HR POLICY BASICS:\n"
            . "- Leave types: Paid, Sick, Birthday, Unpaid. Leave balance is per category per cycle.\n"
            . "- Half-day leave is only for a single date, not a range.\n"
            . "- Attendance is marked late after 10:30 AM. Standard shift is 8 hours (28800 seconds).\n"
            . "- Employees see their own requests; managers/admins get the Approval Inbox.\n"
            . "- Super admins get a strict-admin view for plans, billing, and global config.\n\n"
            . "PAYROLL SPECIFICS:\n"
            . "- Payroll is processed monthly. Admins can process via Payroll Dashboard.\n"
            . "- Tax declarations are submitted by employees and reviewed by admins.\n"
            . "- Salary structure includes: Basic, HRA, Conveyance, Special Allowance, and other components.\n"
            . "- Reimbursements, loans, and advances are managed in the Payroll section.\n\n"
            . "Tone: Friendly, professional, and helpful. Use simple language. Prefer 'Go to /leave and…' style guidance. "
            . "If the user seems frustrated, acknowledge their concern and offer to connect them with support. "
            . "Never invent API keys or credentials. Never share sensitive data like passwords or tokens."
            . $roleContext;
    }
}
