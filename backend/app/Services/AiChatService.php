<?php

namespace App\Services;

use App\Models\AiChatLog;
use App\Models\AttendanceRecord;
use App\Models\EmployeeWorkInfo;
use App\Models\LeaveRequest;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Support\RoleLabel;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AiChatService
{
    public function chat(string $message, array $history, ?User $user = null, ?string $context = null): string
    {
        $providers = $this->providers();
        if (empty($providers)) {
            return 'The AI assistant is not configured yet. Please ask your administrator to add an AI API key, or check the Help section (Settings → Help).';
        }

        // The landing/sales bot serves public visitors: use a marketing-focused prompt and no data tools.
        if ($context === 'landing') {
            $systemPrompt = $this->landingSystemPrompt();
            $tools = [];
        } else {
            $systemPrompt = $this->systemPrompt($user);
            // Build available tools based on user role
            $tools = $this->availableTools($user);
        }

        $baseMessages = [['role' => 'system', 'content' => $systemPrompt]];
        foreach ($history as $entry) {
            if (isset($entry['role'], $entry['content']) && is_string($entry['content'])) {
                $baseMessages[] = ['role' => $entry['role'], 'content' => $entry['content']];
            }
        }
        $baseMessages[] = ['role' => 'user', 'content' => $message];

        // Overall time budget (seconds) so we always return before PHP's max_execution_time,
        // even if some providers are slow to respond. Leaves headroom to send the response.
        $budget = (float) config('services.ai.total_timeout', 24);
        $deadline = microtime(true) + $budget;

        // Try each provider, and each model within a provider, until one succeeds.
        foreach ($providers as $provider) {
            $baseUrl = rtrim($provider['base_url'], '/');
            $apiKey = $provider['api_key'];

            foreach ($provider['models'] as $model) {
                $remaining = $deadline - microtime(true);
                if ($remaining < 3) {
                    break 2; // Not enough time left for another attempt.
                }

                $reply = $this->attemptModel($baseUrl, $apiKey, $model, $baseMessages, $tools, $user, $message, (int) floor($remaining));
                if ($reply !== null) {
                    return $reply;
                }
            }
        }

        return 'I am having trouble reaching the AI service right now. Please try again later, or check the Help section (Settings → Help).';
    }

    /**
     * Attempt a single model on a single provider. Returns the reply string on success, or null on failure.
     */
    private function attemptModel(string $baseUrl, string $apiKey, string $model, array $baseMessages, array $tools, ?User $user, string $message, int $timeout = 15): ?string
    {
        $messages = $baseMessages;
        $toolCallsUsed = [];

        try {
            $payload = [
                'model' => $model,
                'messages' => $messages,
                'temperature' => 0.7,
                'max_tokens' => 2048,
            ];

            if (! empty($tools)) {
                $payload['tools'] = $tools;
                $payload['tool_choice'] = 'auto';
            }

            $response = $this->request($baseUrl, $apiKey, $timeout)->post($baseUrl . '/chat/completions', $payload);

            if ($response->successful()) {
                $choice = data_get($response->json(), 'choices.0.message', []);

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
                    $followUp = $this->request($baseUrl, $apiKey, $timeout)->post($baseUrl . '/chat/completions', [
                        'model' => $model,
                        'messages' => $messages,
                        'temperature' => 0.7,
                        'max_tokens' => 2048,
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

            Log::warning('AiChatService: model failed', [
                'base_url' => $baseUrl,
                'model' => $model,
                'status' => $response->status(),
                'body' => $response->body(),
            ]);
        } catch (\Throwable $e) {
            Log::warning('AiChatService: request threw', [
                'base_url' => $baseUrl,
                'model' => $model,
                'error' => $e->getMessage(),
            ]);
        }

        return null;
    }

    /**
     * Build a pending HTTP request with shared headers/settings for a provider.
     */
    private function request(string $baseUrl, string $apiKey, int $timeout = 15)
    {
        return Http::withoutVerifying()
            ->withToken($apiKey)
            ->withHeaders([
                'HTTP-Referer' => (string) config('services.ai.site_url', 'https://carevance.com'),
                'X-Title' => (string) config('services.ai.app_name', 'CareVance HRMS'),
            ])
            ->connectTimeout(8)
            ->timeout(max(5, $timeout));
    }

    /**
     * Build the ordered list of providers to try, each with its own base_url, api_key and models.
     * A provider is skipped if it has no API key configured.
     */
    private function providers(): array
    {
        $providers = [];

        // Primary provider
        $primaryKey = (string) config('services.ai.api_key');
        if ($primaryKey !== '') {
            $models = array_values(array_unique(array_filter(array_merge(
                [(string) config('services.ai.model')],
                explode(',', (string) config('services.ai.fallback_models', ''))
            ))));

            if (! empty($models)) {
                $providers[] = [
                    'base_url' => (string) config('services.ai.base_url', 'https://openrouter.ai/api/v1'),
                    'api_key' => $primaryKey,
                    'models' => $models,
                ];
            }
        }

        // Secondary / backup provider (optional)
        $secondaryKey = (string) config('services.ai.secondary_api_key');
        if ($secondaryKey !== '') {
            $models = array_values(array_unique(array_filter(
                explode(',', (string) config('services.ai.secondary_models', ''))
            )));

            if (! empty($models)) {
                $providers[] = [
                    'base_url' => (string) config('services.ai.secondary_base_url', 'https://opencode.ai/zen/v1'),
                    'api_key' => $secondaryKey,
                    'models' => $models,
                ];
            }
        }

        return $providers;
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
                    // Force an object ({}) instead of an array ([]) when there are no properties,
                    // otherwise strict providers (e.g. Gemini) reject the schema.
                    'properties' => empty($parameters) ? new \stdClass() : $parameters,
                    'required' => array_values(array_keys(array_filter($parameters, fn ($p) => $p['required'] ?? false))),
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
            $roleLabel = RoleLabel::for($user->role, 'User');
            $roleContext = "\n\nThe user is logged in as: {$roleLabel}.";
        }

        return "You are CareVance Assistant, a friendly and knowledgeable AI guide for the CareVance HRMS (Human Resource Management System) web and desktop app. "
            . "Your goal is to solve the user's problem on the first reply.\n\n"
            . "RESPONSE STYLE (follow strictly):\n"
            . "- Be SHORT. Aim for 2-5 lines. Lead with the direct answer, then only the exact steps needed.\n"
            . "- For a 'how do I…' question, give a single compact numbered list with the exact path (e.g. 'Settings → Organization'). No filler sentences.\n"
            . "- Do NOT hedge or list multiple 'maybe' locations. Give the ONE correct path. Only mention plan/permission caveats if the user reports the option is missing.\n"
            . "- Use plain, everyday language. No jargon. Short sentences.\n"
            . "- End WITHOUT a generic 'Is there anything else…' closer unless it fits naturally.\n"
            . "- Only include the support contact block when you genuinely cannot help or the user is blocked/frustrated — never by default.\n\n"
            . "SUPPORT (share only when truly needed):\n"
            . "- Email: support@carevance.com | Phone: +91 800-123-4567 | Hours: Mon-Fri, 9:00 AM - 6:00 PM IST\n\n"
            . "SETTINGS & ADMIN TASKS (exact paths):\n"
            . "- Change company/organization name, logo, timezone, address: Settings (/settings) → Organization tab → edit → Save. (Organization tab is visible to owners/strict admins only.)\n"
            . "- Update your own name, photo, personal info: Settings (/settings) → Profile tab.\n"
            . "- Notification preferences: Settings → Notifications tab. Security/password: Settings → Security tab.\n"
            . "- Billing & plan: Settings → Billing tab (owner/strict admin). Integrations: Settings → Integrations tab.\n"
            . "- Help & support: Settings → Help tab.\n\n"
            . "APP NAVIGATION (route => what it is, access):\n"
            . "- Dashboard (/dashboard): org overview and today's stats.\n"
            . "- Organization (/organization-tree, everyone): company hierarchy.\n"
            . "- People: Employees (/employees, admin), New Hires (/new-hires, admin), Resignations (/resignations, admin), My Team (/my-team, employee).\n"
            . "- Roles & Permissions (admin): Roles (/employees/roles), Department (/employees/teams).\n"
            . "- Attendance: Attendance (/attendance), Leave (/leave), Approval Inbox (/approval-inbox, admin — approve leave & time edits), Overtime (/edit-time), Breaks (/breaks), Shifts (/shifts).\n"
            . "- Monitoring (admin): Monitoring (/monitoring/productive-time), Screenshots (/monitoring/screenshots), Selfies Map (/attendance/selfies-map), Timeline (/reports/timeline), Web & App Usage (/reports/web-app-usage).\n"
            . "- Communication: Announcements (/notifications, admin), Chat (/chat).\n"
            . "- Assets: Assets (/assets).\n"
            . "- Performance: Performance Reviews (/performance), Goals (/performance-goals).\n"
            . "- Expenses: My Expenses (/expenses).\n"
            . "- Work: Timesheets (/reports/hours-tracked, admin), Projects (/projects), Tasks (/tasks), Time Reports (/tasks/time-reports, admin).\n"
            . "- Reports (admin): Reports (/reports), Analytics (/analytics), Attendance Report (/reports/attendance).\n"
            . "- Settings (admin): Settings (/settings), Audit Logs (/audit-logs), Geofence Zones (/settings/geofence).\n"
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
            . "Tone: Friendly, professional, concise. Prefer 'Go to Settings → Organization…' style guidance. "
            . "If the user seems frustrated, briefly acknowledge it and offer the support contact. "
            . "Never invent API keys or credentials. Never share sensitive data like passwords or tokens."
            . $roleContext;
    }

    /**
     * Public-facing sales/marketing prompt for the landing-page chat bubble (unauthenticated visitors).
     */
    private function landingSystemPrompt(): string
    {
        return "You are CareVance Assistant, the friendly sales guide on the CareVance website. "
            . "You talk to potential customers (business owners, HR leaders, founders) who are evaluating CareVance — an all-in-one HR & payroll platform. "
            . "You are NOT a logged-in support tool: never reference internal app menus, routes, or private data.\n\n"
            . "GOAL: Answer their question clearly and nudge them toward starting a free trial or booking a demo.\n\n"
            . "RESPONSE STYLE (follow strictly):\n"
            . "- Be SHORT and warm. 2-4 lines. Lead with the answer, then one gentle next step.\n"
            . "- Sound human and confident, not robotic. No walls of text, no long bullet dumps.\n"
            . "- When cost/pricing/value comes up, give a helpful overview and invite them to start a free trial or see the Pricing page.\n"
            . "- Never invent exact prices, discounts, or contractual promises. If unsure on specifics, point them to Pricing or to book a demo.\n\n"
            . "WHAT CAREVANCE OFFERS:\n"
            . "- Attendance & time tracking (web + desktop app with timer, breaks, screenshots, geofencing).\n"
            . "- Leave management with approval workflows.\n"
            . "- Full payroll: salary structures, tax declarations, payslips, reimbursements, loans, F&F settlements.\n"
            . "- Employee management, org hierarchy, performance reviews & goals, projects & tasks.\n"
            . "- Reports, analytics, productivity monitoring, and role-based access.\n"
            . "- Built-in team chat and announcements.\n\n"
            . "WHY IT'S DIFFERENT: One platform for HR + payroll + productivity (no juggling multiple tools), fast setup, and a modern easy-to-use interface.\n\n"
            . "NEXT STEPS you can suggest: 'Start a free trial', 'See Pricing', or 'Book a demo'. "
            . "If they want to talk to a human: support@carevance.com or +91 800-123-4567 (Mon-Fri, 9 AM-6 PM IST).";
    }
}
