<?php

namespace App\Services\Ai;

use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\EmployeeWorkInfo;
use App\Models\LeaveRequest;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\Resignation;
use App\Models\User;
use App\Services\Leave\LeavePolicyService;
use App\Services\Lifecycle\PayrollReadinessService;
use Illuminate\Support\Carbon;

/**
 * The data tools the in-app assistant may call, and the routes that back them.
 *
 * Split out of AiChatService, which was doing provider orchestration and
 * organisation reporting in one 561-line file. Keeping them apart means the
 * numbers can be tested without an LLM in the loop — see AiChatToolTest.
 *
 * Two rules hold for everything in here:
 *
 *  1. Never compute a figure a domain service already owns. LeavePolicyService
 *     owns leave balances; PayrollReadinessService owns payroll blockers. A
 *     second implementation drifts, and the assistant states the drifted one
 *     with total confidence.
 *
 *  2. Every tool returns at least one source route. An admin who is told "6
 *     approvals are pending" must be one click from the six records.
 */
class AiToolRegistry
{
    /**
     * Mirrors AiChatController::ASSISTANT_MAX_HIERARCHY_LEVEL. Duplicated
     * deliberately: the controller gate is the front door, this one means a
     * future caller that bypasses the controller still cannot read org-wide
     * data through a tool.
     */
    private const MAX_HIERARCHY_LEVEL = 10;

    /**
     * Names shown to admins. Order is the order the model sees them in.
     */
    private const TOOLS = [
        'getPendingApprovals' => 'Count of leave and attendance time-edit requests currently awaiting approval across the organisation.',
        'getTodayAttendanceSummary' => "Today's attendance across the organisation: how many people are clocked in, late, absent, and the active headcount.",
        'getWhoIsOutToday' => 'The people on approved leave today, by name and leave category.',
        'getHeadcountSummary' => 'Active headcount, people who joined this month, and people currently serving notice.',
        'getPayrollCycleStatus' => "This month's payroll run: its status, how many payroll items are paid, and how far through the active headcount it is.",
        'getPayrollBlockers' => 'Employees who cannot be paid yet because of missing PAN, bank details, salary structure, joining date or UAN.',
        'getLeaveBalance' => 'Leave balance by category for one employee. Pass employee_id, or omit it for the caller.',
    ];

    public function __construct(
        private readonly LeavePolicyService $leavePolicyService,
        private readonly PayrollReadinessService $payrollReadinessService,
    ) {
    }

    /**
     * OpenAI-style function schemas for the tools this user may call.
     *
     * @return list<array<string, mixed>>
     */
    public function definitionsFor(?User $user): array
    {
        if (! $this->mayUseTools($user)) {
            return [];
        }

        $definitions = [];
        foreach (self::TOOLS as $name => $description) {
            $definitions[] = $this->definition($name, $description, $this->parametersFor($name));
        }

        return $definitions;
    }

    public function execute(string $name, array $args, ?User $user): AiToolResult
    {
        if (! $this->mayUseTools($user)) {
            return AiToolResult::error('This assistant is available to administrators only.');
        }

        if (! array_key_exists($name, self::TOOLS)) {
            return AiToolResult::error("Unknown tool: {$name}.");
        }

        $organizationId = (int) $user->organization_id;
        if ($organizationId <= 0) {
            return AiToolResult::error('No organisation is attached to your account.');
        }

        return match ($name) {
            'getPendingApprovals' => $this->pendingApprovals($organizationId),
            'getTodayAttendanceSummary' => $this->todayAttendanceSummary($organizationId),
            'getWhoIsOutToday' => $this->whoIsOutToday($organizationId),
            'getHeadcountSummary' => $this->headcountSummary($organizationId),
            'getPayrollCycleStatus' => $this->payrollCycleStatus($organizationId),
            'getPayrollBlockers' => $this->payrollBlockers($organizationId),
            'getLeaveBalance' => $this->leaveBalance($args, $user, $organizationId),
        };
    }

    private function mayUseTools(?User $user): bool
    {
        return $user !== null && $user->getHierarchyLevel() <= self::MAX_HIERARCHY_LEVEL;
    }

    // -----------------------------------------------------------------
    // Tools
    // -----------------------------------------------------------------

    private function pendingApprovals(int $organizationId): AiToolResult
    {
        $leave = LeaveRequest::forOrganization($organizationId)
            ->where('status', 'pending')
            ->count();

        /*
         * Time-edit requests have always been named in this tool's description
         * and never counted. An admin reading "3 pending" would clear three
         * leave requests and believe the inbox was empty.
         */
        $timeEdits = AttendanceTimeEditRequest::forOrganization($organizationId)
            ->where('status', 'pending')
            ->count();

        return new AiToolResult(
            [
                'pending_leave_requests' => $leave,
                'pending_time_edit_requests' => $timeEdits,
                'total' => $leave + $timeEdits,
            ],
            [['label' => 'Approval Inbox', 'route' => '/approval-inbox']],
        );
    }

    private function todayAttendanceSummary(int $organizationId): AiToolResult
    {
        $today = Carbon::now()->toDateString();

        $records = AttendanceRecord::forOrganization($organizationId)
            ->where('attendance_date', $today)
            ->get();

        return new AiToolResult(
            [
                'date' => $today,
                'total_employees' => $this->activeHeadcount($organizationId),
                'clocked_in' => $records->where('status', '!=', 'absent')->count(),
                'late' => $records->where('late_minutes', '>', 0)->count(),
                'absent' => $records->where('status', 'absent')->count(),
            ],
            [['label' => 'Attendance', 'route' => '/attendance']],
        );
    }

    private function whoIsOutToday(int $organizationId): AiToolResult
    {
        $today = Carbon::now()->toDateString();

        $leaves = LeaveRequest::forOrganization($organizationId)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $today)
            ->whereDate('end_date', '>=', $today)
            ->get(['user_id', 'leave_category']);

        $names = User::query()
            ->where('organization_id', $organizationId)
            ->whereIn('id', $leaves->pluck('user_id')->unique())
            ->pluck('name', 'id');

        $people = $leaves
            ->map(fn ($leave) => [
                'name' => (string) ($names[$leave->user_id] ?? "User #{$leave->user_id}"),
                'category' => (string) ($leave->leave_category ?? 'paid'),
            ])
            ->sortBy('name')
            ->values()
            ->all();

        return new AiToolResult(
            ['date' => $today, 'count' => count($people), 'people' => $people],
            [['label' => 'Leave', 'route' => '/leave']],
        );
    }

    private function headcountSummary(int $organizationId): AiToolResult
    {
        $monthStart = Carbon::now()->startOfMonth()->toDateString();
        $monthEnd = Carbon::now()->endOfMonth()->toDateString();

        $joinedThisMonth = EmployeeWorkInfo::forOrganization($organizationId)
            ->whereBetween('joining_date', [$monthStart, $monthEnd])
            ->count();

        $servingNotice = Resignation::forOrganization($organizationId)
            ->where('status', 'approved')
            ->whereDate('last_working_date', '>=', Carbon::now()->toDateString())
            ->count();

        return new AiToolResult(
            [
                'active_headcount' => $this->activeHeadcount($organizationId),
                'joined_this_month' => $joinedThisMonth,
                'serving_notice' => $servingNotice,
            ],
            [
                ['label' => 'Employees', 'route' => '/employees'],
                ['label' => 'New Hires', 'route' => '/new-hires'],
                ['label' => 'Exits', 'route' => '/exits'],
            ],
        );
    }

    private function payrollCycleStatus(int $organizationId): AiToolResult
    {
        $currentMonth = Carbon::now()->format('Y-m');

        $run = PayrollMonthlyRun::forOrganization($organizationId)
            ->where('month_year', $currentMonth)
            ->first();

        $source = [['label' => 'Payroll', 'route' => '/payroll']];

        if (! $run) {
            return new AiToolResult(
                ['status' => 'no_run', 'month' => $currentMonth, 'message' => 'No payroll run exists for this month yet.'],
                $source,
            );
        }

        /*
         * The denominator is the active headcount, not every row in `users`.
         * Counting deactivated leavers made a fully-processed run read as 60%
         * done, which looks exactly like a stuck run.
         */
        $headcount = $this->activeHeadcount($organizationId);
        $paid = PayrollItem::forOrganization($organizationId)
            ->where('payroll_run_id', $run->id)
            ->where('payment_status', 'paid')
            ->count();

        return new AiToolResult(
            [
                'status' => $run->status,
                'month' => $currentMonth,
                'paid_items' => $paid,
                'active_headcount' => $headcount,
                'percentage_processed' => $headcount > 0 ? (int) round(($paid / $headcount) * 100) : 0,
            ],
            $source,
        );
    }

    /**
     * PayrollReadinessService evaluates one employee at a time, so this walks
     * the active roster. Capped: an admin needs to know how many are blocked
     * and a few names to chase, not a wall of every record.
     */
    private function payrollBlockers(int $organizationId): AiToolResult
    {
        $employees = User::query()
            ->where('organization_id', $organizationId)
            ->whereNull('deactivated_at')
            ->orderBy('name')
            ->limit(self::readinessScanLimit())
            ->get();

        $blocked = [];
        foreach ($employees as $employee) {
            $readiness = $this->payrollReadinessService->evaluate($employee);
            if (($readiness['blockers'] ?? 0) === 0) {
                continue;
            }

            $blocked[] = [
                'name' => $employee->name,
                'missing' => array_values(array_map(
                    fn (array $check) => (string) ($check['label'] ?? $check['key'] ?? 'unknown'),
                    array_filter(
                        $readiness['checks'] ?? [],
                        fn (array $check) => ! ($check['passed'] ?? true) && ($check['severity'] ?? '') === 'blocker',
                    ),
                )),
            ];
        }

        return new AiToolResult(
            [
                'scanned' => $employees->count(),
                'blocked_count' => count($blocked),
                'blocked' => array_slice($blocked, 0, 10),
                'truncated' => count($blocked) > 10,
            ],
            [['label' => 'Pre-Payroll Checklist', 'route' => '/pre-payroll-checklist']],
        );
    }

    private function leaveBalance(array $args, User $caller, int $organizationId): AiToolResult
    {
        $employeeId = (int) ($args['employee_id'] ?? 0);

        $subject = $employeeId > 0
            ? User::query()
                ->where('organization_id', $organizationId)
                ->find($employeeId)
            : $caller;

        if (! $subject) {
            return AiToolResult::error('No such employee in this organisation.');
        }

        $subject->loadMissing('organization');

        /*
         * LeavePolicyService owns this number. The previous implementation
         * counted approved leave REQUESTS and called the count a balance, so
         * two half-days and a fortnight both scored 1.
         */
        $snapshot = $this->leavePolicyService->buildBalanceSnapshotForUser(
            $subject,
            $this->leavePolicyService->resolvePolicyCategories($subject->organization),
        );

        return new AiToolResult(
            ['employee' => $subject->name] + $snapshot,
            [['label' => 'Leave', 'route' => '/leave']],
        );
    }

    // -----------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------

    /**
     * Active means not deactivated and not soft-deleted, matching
     * User::getIsActiveAttribute(). There is no `users.is_active` column —
     * `is_active` is an appended accessor over `deactivated_at`, so it cannot
     * be used in a WHERE clause.
     */
    private function activeHeadcount(int $organizationId): int
    {
        return User::query()
            ->where('organization_id', $organizationId)
            ->whereNull('deactivated_at')
            ->count();
    }

    private static function readinessScanLimit(): int
    {
        return (int) config('services.ai.readiness_scan_limit', 200);
    }

    private function parametersFor(string $name): array
    {
        return $name === 'getLeaveBalance'
            ? ['employee_id' => [
                'type' => 'integer',
                'description' => "The employee's numeric id. Omit to read your own balance.",
                'required' => false,
            ]]
            : [];
    }

    private function definition(string $name, string $description, array $parameters): array
    {
        $properties = [];
        foreach ($parameters as $key => $spec) {
            $properties[$key] = ['type' => $spec['type'], 'description' => $spec['description']];
        }

        return [
            'type' => 'function',
            'function' => [
                'name' => $name,
                'description' => $description,
                'parameters' => [
                    'type' => 'object',
                    // An object ({}), never an array ([]) — strict providers
                    // such as Gemini reject a schema whose properties is a list.
                    'properties' => $properties === [] ? new \stdClass() : $properties,
                    'required' => array_values(array_keys(array_filter(
                        $parameters,
                        fn (array $spec) => $spec['required'] ?? false,
                    ))),
                ],
            ],
        ];
    }
}
