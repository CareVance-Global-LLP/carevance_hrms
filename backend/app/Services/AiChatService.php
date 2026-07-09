<?php

namespace App\Services;

use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AiChatService
{
    public function chat(string $message, array $history): string
    {
        $apiKey = (string) config('services.ai.api_key');
        if ($apiKey === '') {
            return 'The AI assistant is not configured yet. Please ask your administrator to add an AI API key, or check the Help section (Settings → Help).';
        }

        $messages = [['role' => 'system', 'content' => $this->systemPrompt()]];
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

        foreach ($models as $model) {
            try {
                $response = Http::withToken($apiKey)
                    ->timeout(30)
                    ->withoutVerifying()
                    ->post($baseUrl . '/chat/completions', [
                        'model' => $model,
                        'messages' => $messages,
                        'temperature' => 0.7,
                        'max_tokens' => 500,
                    ]);

                if ($response->successful()) {
                    $content = data_get($response->json(), 'choices.0.message.content');
                    if (is_string($content) && trim($content) !== '') {
                        return trim($content);
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

    private function systemPrompt(): string
    {
        return "You are CareVance Assistant, a helpful AI guide for the CareVance HRMS (Human Resource Management System) web and desktop app. "
            . "Answer clearly and concisely. Help users navigate the app, use features, and understand HR policies. "
            . "If you don't know a specific org setting, give the most likely path and tell them where to look.\n\n"
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
            . "COMMON WORKFLOWS:\n"
            . "1. Submit leave: go to /leave, pick dates, choose a leave category (Paid/Sick/Birthday/Unpaid), choose full day or half day, add a reason, and submit. Managers/admins see it in /approval-inbox and can Approve/Reject. Half-day leave can only be for a single date.\n"
            . "2. Approve requests: admins/managers open /approval-inbox, review the pending leave or time-edit request, then click Approve or Reject.\n"
            . "3. Track time: use the desktop app timer (or /attendance) to start/stop tracking; breaks are logged via /breaks; overtime requests go through /edit-time.\n"
            . "4. Expenses/reimbursements: employees use /expenses; admins review reimbursements in the Payroll section.\n"
            . "5. Announcements/polls: admins publish from the Notifications Center (/notifications); employees see them in their notification bell.\n\n"
            . "HR POLICY BASICS:\n"
            . "- Leave types: Paid, Sick, Birthday, Unpaid. Leave balance is per category per cycle.\n"
            . "- Half-day leave is only allowed for a single date, not a range.\n"
            . "- Attendance is marked late after 10:30, standard shift is 28800 seconds (8 hours).\n"
            . "- Employees see their own requests; managers/admins additionally get the Approval Inbox to act on their team's requests.\n"
            . "- Super admins get a separate strict-admin view for plans, billing, and global config.\n\n"
            . "Tone: friendly, brief, and action-oriented. Prefer 'Go to /leave and…' style guidance. Never invent API keys or credentials.";
    }
}
