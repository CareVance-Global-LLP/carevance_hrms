<?php

namespace App\Services;

use App\Models\AiChatLog;
use App\Models\User;
use App\Services\Ai\AiToolRegistry;
use App\Support\RoleLabel;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

class AiChatService
{
    public function __construct(private readonly AiToolRegistry $tools)
    {
    }

    /**
     * @return array{reply: string, sources: list<array{label: string, route: string}>}
     */
    public function chat(string $message, array $history, ?User $user = null, ?string $context = null): array
    {
        $providers = $this->providers();
        if (empty($providers)) {
            return $this->plainReply('The AI assistant is not configured yet. Please ask your administrator to add an AI API key, or check the Help section (Settings → Help).');
        }

        // The landing/sales bot serves public visitors: use a marketing-focused prompt and no data tools.
        if ($context === 'landing') {
            $systemPrompt = $this->landingSystemPrompt();
            $tools = [];
        } else {
            $systemPrompt = $this->systemPrompt($user);
            $tools = $this->tools->definitionsFor($user);
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

                $result = $this->attemptModel($baseUrl, $apiKey, $model, $baseMessages, $tools, $user, $message, (int) floor($remaining));
                if ($result !== null) {
                    return $result;
                }
            }
        }

        return $this->plainReply('I am having trouble reaching the AI service right now. Please try again later, or check the Help section (Settings → Help).');
    }

    /**
     * A reply with nothing behind it: no tool ran, so there is no record to
     * cite. Never fabricate a source to fill the gap — an uncitable answer the
     * reader knows is uncitable is the honest outcome.
     *
     * @return array{reply: string, sources: list<array{label: string, route: string}>}
     */
    private function plainReply(string $reply): array
    {
        return ['reply' => $reply, 'sources' => []];
    }

    /**
     * Attempt a single model on a single provider.
     *
     * @return array{reply: string, sources: list<array{label: string, route: string}>}|null  null on failure
     */
    private function attemptModel(string $baseUrl, string $apiKey, string $model, array $baseMessages, array $tools, ?User $user, string $message, int $timeout = 15): ?array
    {
        $messages = $baseMessages;
        $toolCallsUsed = [];
        $sources = [];

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

                        $toolResult = $this->tools->execute($fnName, $fnArgs, $user);
                        $sources = $this->mergeSources($sources, $toolResult->sources);

                        $messages[] = [
                            'role' => 'tool',
                            'tool_call_id' => data_get($tc, 'id', ''),
                            'content' => $toolResult->toJson(),
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
                            return ['reply' => $reply, 'sources' => $sources];
                        }
                    }
                }

                $content = data_get($choice, 'content');
                if (is_string($content) && trim($content) !== '') {
                    $reply = trim($content);
                    $this->logConversation($user, $message, $reply, $toolCallsUsed);
                    return ['reply' => $reply, 'sources' => $sources];
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
     * Append sources, keeping first-seen order and dropping repeats.
     *
     * The model routinely calls the same tool twice in one turn, and several
     * tools legitimately point at the same screen. Either way the reader should
     * see one chip per destination.
     *
     * @param  list<array{label: string, route: string}>  $existing
     * @param  list<array{label: string, route: string}>  $incoming
     * @return list<array{label: string, route: string}>
     */
    private function mergeSources(array $existing, array $incoming): array
    {
        $seen = array_column($existing, 'route');

        foreach ($incoming as $source) {
            if (! in_array($source['route'], $seen, true)) {
                $existing[] = $source;
                $seen[] = $source['route'];
            }
        }

        return $existing;
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

    /**
     * The prose half of the assistant, and the one sentence it must never say.
     *
     * Asked 'give me all detail of kajal', this replied "I do not have access
     * to individual employee records." The product holds those records, the
     * asker is an admin of the organisation that owns them, and they are on
     * screen at /employees. What actually happened is that the data path
     * declined the phrasing and fell through to here — a missing TOOL — and
     * the prompt then told the user it was a missing FEATURE.
     *
     * The licence was one clause: 'say what you do not have rather than
     * guessing'. It was written to stop invented figures, and it does, but to a
     * model 'what you do not have' reads as the product's capabilities rather
     * than this turn's tool list. Those are different claims and only one of
     * them is checkable from in here, so the prompt now separates them
     * explicitly and routes an unanswerable question to the screen instead.
     *
     * If you reword this prompt, keep both halves: no invented numbers, and no
     * assertion about what CareVance cannot do. ProseCapabilityClaimsTest
     * asserts against the returned string and needs no model call.
     *
     * Two later corrections, both about precedence between those bullets.
     *
     * The withheld-identifier bullet claimed it "outranks the two above it".
     * Counted from where it sits, the two above are the never-say-the-product-
     * cannot rule and the named-person rule — while the rule it exists to beat,
     * "answer with a route", is three above and was left standing. It names both
     * rules it overrides now, because a precedence written as a line count is
     * wrong the moment somebody inserts a bullet above it.
     *
     * And 'give me all detail of kajal' arguably asks for a PAN among everything
     * else, which put the named-person bullet and the withheld bullet in conflict
     * on the exact sentence this prompt was rewritten for. Resolved the withheld
     * way, it returns the original defect: a refusal with no screen on it, for a
     * person who is sitting at /employees. Withholding a FIELD is not withholding
     * the PERSON — only a question whose subject IS the identifier is refused.
     */
    private function systemPrompt(?User $user): string
    {
        $roleContext = '';
        if ($user) {
            $roleLabel = RoleLabel::for($user->role, 'User');
            $roleContext = "\n\nThe user is logged in as: {$roleLabel}.";
        }

        return "You are CareVance Assistant, the administrator's assistant inside the CareVance HRMS (Human Resource Management System) web and desktop app. "
            . "Everyone you talk to is an admin or super admin of their own organisation. "
            . "Your goal is to solve their problem on the first reply.\n\n"
            . "USING YOUR TOOLS (this is what makes you useful):\n"
            . "- When the question is about a real figure — approvals waiting, who is in or out today, headcount, payroll progress, who cannot be paid — CALL THE TOOL. Do not answer from memory and do not tell them which screen to go and count it on.\n"
            . "- NEVER invent, estimate or round a number you did not get from a tool. A figure you did not read out of a tool result does not belong in your reply at all.\n"
            . "- State the figure plainly and briefly. Do NOT append a 'source' or a link yourself — the app attaches the record links to your reply automatically, so writing your own duplicates them.\n"
            . "- Tools read the caller's own organisation only. You cannot see any other company's data.\n\n"
            . "WHEN NO TOOL COVERS THE QUESTION (read this twice):\n"
            . "- Your tool list is short. The product is not. Anything you cannot pull is a limit of THIS conversation, never a limit of CareVance — you cannot see what the app holds, only its screens can.\n"
            . "- So say you could not pull it here, then send them to the screen that holds it, from the route map below. 'I can't pull that here — it's on Employees (/employees)' is the shape. Two lines, no apology.\n"
            . "- NEVER say the product cannot do something, does not have a feature, does not store a record, or that you 'do not have access to' a kind of record. Each of those is a claim about the product that you have no way to check, and the person reading it is the admin who owns that data.\n"
            . "- A question about ONE NAMED PERSON always has an answer here. No tool returns a whole employee record, but every one of them is in the app: send them to Employees (/employees), search the name and open the row for profile, job and contact details. Never reply that individual employee records are unavailable.\n"
            . "- The one thing you do withhold is statutory and banking identifiers — PAN, UAN, ESI, Aadhaar, account and IFSC numbers. When one of those is what was asked for, this bullet overrides both the 'send them to the screen' rule and the named-person rule above: do not state the number and do not name a screen to read it off. Say it is not available through this assistant, which is a limit of you, not of the product.\n"
            . "- Withholding a FIELD is not withholding the PERSON. 'Give me all the details of Kajal' is a question about somebody, not a request for a PAN, so it is answered the normal way: send them to Employees (/employees) and leave the identifiers out of the reply. Only a question whose subject IS the identifier — 'what is her PAN', 'everyone's account numbers' — reaches the bullet above.\n\n"
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
     * Public-facing sales/marketing prompt for the landing-page chat bubble
     * (unauthenticated visitors), and the reason it is honest in BOTH directions.
     *
     * The capability bullets summarise a much larger product, so a model reading
     * them as exhaustive told prospects CareVance had no recruitment. The first
     * repair closed that hole by opening its mirror: it asserted "recruitment,
     * rostering, statutory filings ... are all built" and then forbade the model
     * from ever admitting a gap. Seven filing generators are reference_only with
     * nothing submitting to a portal, and recruitment has no public careers page,
     * so "does it file our PF return to EPFO?" would have been answered yes — to
     * somebody deciding whether to buy.
     *
     * A false no and a false yes are the same defect. CLAUDE.md's Known gaps
     * section opens by recording what the first one cost: a stale list "cost real
     * marks in a customer evaluation for features that already shipped". The yes
     * costs more, because it is found out after the contract. So the rule is
     * ACCURACY, not optimism: the list is evidence of neither presence nor
     * absence, and anything not written in it gets "I'll get you a firm answer"
     * whichever way the visitor is hoping.
     *
     * Deliberately no gap list of its own. That would be a second copy of
     * CLAUDE.md's to keep honest, and it would go stale exactly as the one it
     * copied did.
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
            . "That list is a summary, not the whole product, and not a warranty — it is evidence of neither presence nor absence for anything not written in it:\n"
            . "- Recruitment, rostering, statutory filings, asset tracking and single sign-on are all in the product and none of them is written above, so its silence is not a gap. NEVER tell a visitor CareVance does not do something, and never call anything a limitation: you cannot see the feature set from here.\n"
            . "- NEVER tell a visitor it DOES something that is not written above either, and never say how complete, certified or automated any of it is — no 'yes, that is fully covered', no 'it files that for you automatically'. Depth varies by area and you cannot read it from here. A guess in the flattering direction is still a guess, and it is the one they sign a contract on.\n"
            . "- Both get the same reply: say you will get them a firm answer, and offer a demo or support@carevance.com.\n\n"
            . "WHY IT'S DIFFERENT: One platform for HR + payroll + productivity (no juggling multiple tools), fast setup, and a modern easy-to-use interface.\n\n"
            . "NEXT STEPS you can suggest: 'Start a free trial', 'See Pricing', or 'Book a demo'. "
            . "If they want to talk to a human: support@carevance.com or +91 800-123-4567 (Mon-Fri, 9 AM-6 PM IST).";
    }
}
