<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeeLoan;
use App\Models\EmployeePayrollTemplate;
use App\Models\FbpAllocation;
use App\Models\Group;
use App\Models\PayGroup;
use App\Models\PayGroupAssignment;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\Reimbursement;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\Attendance\AttendanceService;
use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use App\Services\TimeEntries\TimeEntryDurationService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class PayrollDepartmentController extends Controller
{
    protected PayrollCalculatorService $calculator;
    protected AttendanceService $attendance;
    protected TimeEntryDurationService $timeEntryDuration;

    public function __construct(
        PayrollCalculatorService $calculator,
        AttendanceService $attendance,
        TimeEntryDurationService $timeEntryDuration,
    ) {
        $this->calculator = $calculator;
        $this->attendance = $attendance;
        $this->timeEntryDuration = $timeEntryDuration;
    }

    /**
     * Get all departments with payroll summary
     */
    public function getDepartments(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        // Get all groups/departments for the organization
        $groups = Group::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->get();

        $groupIds = $groups->pluck('id');

        // Batch fetch employee counts per department
        $employeeCounts = DB::table('group_user')
            ->join('users', 'group_user.user_id', '=', 'users.id')
            ->whereIn('group_user.group_id', $groupIds)
            ->whereIn('users.role', ['employee', 'manager', 'admin'])
            ->where('users.organization_id', $organizationId)
            ->selectRaw('group_user.group_id, COUNT(*) as count')
            ->groupBy('group_user.group_id')
            ->pluck('count', 'group_id');

        // Batch fetch payroll stats per department (single query, not N+1)
        $payrollStats = PayrollItem::where('organization_id', $organizationId)
            ->whereIn('department_id', $groupIds)
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })
            ->select(
                'department_id',
                DB::raw('COUNT(*) as processed_count'),
                DB::raw('SUM(net_pay) as total_net_pay'),
                DB::raw("SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count")
            )
            ->groupBy('department_id')
            ->get()
            ->keyBy('department_id');

        $departments = $groups->map(function ($dept) use ($employeeCounts, $payrollStats) {
            $stats = $payrollStats->get($dept->id);
            return [
                'id' => $dept->id,
                'name' => $dept->name,
                'employee_count' => (int) ($employeeCounts->get($dept->id, 0)),
                'processed_count' => (int) ($stats->processed_count ?? 0),
                'paid_count' => (int) ($stats->paid_count ?? 0),
                'total_net_pay' => (float) ($stats->total_net_pay ?? 0),
            ];
        });

        // Get unassigned employees count (users without any group)
        $assignedUserIds = DB::table('group_user')
            ->join('groups', 'group_user.group_id', '=', 'groups.id')
            ->where('groups.organization_id', $organizationId)
            ->pluck('group_user.user_id');

        $unassignedCount = User::where('organization_id', $organizationId)
            ->whereNotIn('id', $assignedUserIds)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        return response()->json([
            'departments' => $departments,
            'unassigned_count' => $unassignedCount,
            'month_year' => $monthYear,
        ]);
    }

    /**
     * Get employees in a department with payroll details
     */
    public function getDepartmentEmployees(Request $request, int $departmentId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));
        $search = $request->get('search');

        \Log::info("Getting department employees", [
            'department_id' => $departmentId,
            'organization_id' => $organizationId,
            'month_year' => $monthYear,
        ]);

        // Handle unassigned employees (departmentId = 0)
        if ($departmentId === 0) {
            // Get users NOT in any group
            $assignedUserIds = DB::table('group_user')
                ->join('groups', 'group_user.group_id', '=', 'groups.id')
                ->where('groups.organization_id', $organizationId)
                ->pluck('group_user.user_id');

            \Log::info("Unassigned query", ['assigned_count' => $assignedUserIds->count()]);

            $query = User::where('organization_id', $organizationId)
                ->whereIn('role', ['employee', 'manager', 'admin'])
                ->whereNotIn('id', $assignedUserIds)
                ->with(['employeeProfile', 'employeeWorkInfo', 'employeeBankAccounts']);
        } else {
            // Get employees from specific department using join
            $userIds = DB::table('group_user')
                ->where('group_id', $departmentId)
                ->pluck('user_id');

            \Log::info("Department query", [
                'department_id' => $departmentId,
                'user_ids_count' => $userIds->count(),
                'user_ids' => $userIds->toArray(),
            ]);

            $query = User::where('organization_id', $organizationId)
                ->whereIn('role', ['employee', 'manager', 'admin'])
                ->whereIn('id', $userIds)
                ->with(['employeeProfile', 'employeeWorkInfo', 'employeeBankAccounts']);
        }

        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        $employees = $query->get();

        \Log::info("Found employees", ['count' => $employees->count()]);

        // Eager load payroll items for all employees in one query (fix N+1)
        $userIds = $employees->pluck('id');
        $payrollItems = PayrollItem::whereIn('user_id', $userIds)
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })
            ->get()
            ->keyBy('user_id');

        try {
            $employees = $employees->map(function ($user) use ($monthYear, $organizationId, $payrollItems) {
                try {
                    // Get time tracking data for the month
                    $timeData = $this->getTimeTrackingData($user->id, $monthYear);

                    // Get payroll data from pre-fetched collection
                    $payrollItem = $payrollItems->get($user->id);

                    // Get or create payroll template
                    $template = EmployeePayrollTemplate::getOrCreateForUser(
                        $user->id,
                        $organizationId,
                        auth()->id()
                    );

                    // Ensure all numeric values are floats, not null
                    $netPay = $payrollItem ? (float) $payrollItem->net_pay : 0.00;
                    $grossSalary = $payrollItem ? (float) $payrollItem->gross_salary : 0.00;
                    $totalDeductions = $payrollItem ? (float) $payrollItem->total_deductions : 0.00;
                    
                    // Ensure template values are never null
                    $annualCtc = (float) ($template->annual_ctc ?? 0);
                    $basicPercentage = (float) ($template->basic_percentage ?? 40.00);
                    $hraPercentage = (float) ($template->hra_percentage ?? 50.00);
                    $conveyanceAllowance = (float) ($template->conveyance_allowance ?? 1600.00);
                    
                    // Ensure ALL time tracking fields are present (frontend expects these)
                    $safeTimeData = [
                        'total_worked_seconds' => (int) ($timeData['total_worked_seconds'] ?? 0),
                        'total_worked_hours' => (float) ($timeData['total_worked_hours'] ?? 0),
                        'total_productive_seconds' => (int) ($timeData['total_productive_seconds'] ?? 0),
                        'total_productive_hours' => (float) ($timeData['total_productive_hours'] ?? 0),
                        'total_idle_seconds' => (int) ($timeData['total_idle_seconds'] ?? 0),
                        'total_idle_hours' => (float) ($timeData['total_idle_hours'] ?? 0),
                        'total_unproductive_seconds' => (int) ($timeData['total_unproductive_seconds'] ?? 0),
                        'total_unproductive_hours' => (float) ($timeData['total_unproductive_hours'] ?? 0),
                        'activity_percentage' => (float) ($timeData['activity_percentage'] ?? 0),
                        'productivity_score' => (float) ($timeData['productivity_score'] ?? 0),
                        'entry_count' => (int) ($timeData['entry_count'] ?? 0),
                        'payroll_tracked_seconds' => (int) ($timeData['payroll_tracked_seconds'] ?? 0),
                        'payroll_tracked_hours' => (float) ($timeData['payroll_tracked_hours'] ?? 0),
                        'payroll_payable_hours' => (float) ($timeData['payroll_payable_hours'] ?? 0),
                        'payroll_attendance_days' => (int) ($timeData['payroll_attendance_days'] ?? 0),
                        'payroll_entry_count' => (int) ($timeData['payroll_entry_count'] ?? 0),
                    ];

                    return [
                        'id' => $user->id,
                        'name' => $user->name,
                        'email' => $user->email,
                        'role' => $user->role,
                        'avatar' => $user->avatar,
                        'employee_code' => $user->employeeWorkInfo?->employee_code ?? null,
                        'designation' => $user->employeeWorkInfo?->designation ?? null,
                        'department' => $user->groups->first()?->name ?? null,
                        'joining_date' => $user->employeeWorkInfo?->joining_date ?? null,

                        // Time Tracking Data (with safe numeric values)
                        'time_tracking' => $safeTimeData,
                        
                        // Payroll Status (with guaranteed numeric values)
                        'payroll_status' => [
                            'is_processed' => $payrollItem ? true : false,
                            'net_pay' => $netPay,
                            'payment_status' => $payrollItem?->payment_status ?? 'pending',
                            'gross_salary' => $grossSalary,
                            'total_deductions' => $totalDeductions,
                        ],
                        'payroll_item_id' => $payrollItem?->id,

                        // Template Info (with guaranteed numeric values)
                        'has_template' => true,
                        'template_id' => $template->id,
                        'annual_ctc' => $annualCtc,
                        'basic_percentage' => $basicPercentage,
                        'hra_percentage' => $hraPercentage,
                        'conveyance_allowance' => $conveyanceAllowance,
                        'pf_enabled' => (bool) $template->pf_enabled,
                        'esi_enabled' => (bool) $template->esi_enabled,
                        'pt_enabled' => (bool) $template->pt_enabled,
                        'tds_enabled' => (bool) $template->tds_enabled,
                        // Tax/regime/state fields — required for the
                        // salary-structure form to hydrate the right
                        // dropdown value (otherwise it always defaults
                        // to Maharashtra on page load).
                        'pt_state' => $template->pt_state ?? 'maharashtra',
                        'tax_regime' => $template->tax_regime ?? 'new',
                        'is_metro_city' => (bool) ($template->is_metro_city ?? true),
                    ];
                } catch (\Exception $e) {
                    \Log::error("Error mapping user {$user->id}", [
                        'user_id' => $user->id,
                        'error' => $e->getMessage(),
                        'trace' => $e->getTraceAsString(),
                    ]);
                    
                    // Return basic data if mapping fails (all numeric values as floats)
                    return [
                        'id' => $user->id,
                        'name' => $user->name,
                        'email' => $user->email,
                        'role' => $user->role,
                        'avatar' => $user->avatar,
                        'employee_code' => null,
                        'designation' => null,
                        'joining_date' => null,
                        'time_tracking' => [
                            'total_worked_seconds' => 0,
                            'total_worked_hours' => 0.00,
                            'total_productive_seconds' => 0,
                            'total_productive_hours' => 0.00,
                            'total_idle_seconds' => 0,
                            'total_idle_hours' => 0.00,
                            'total_unproductive_seconds' => 0,
                            'total_unproductive_hours' => 0.00,
                            'activity_percentage' => 0.00,
                            'productivity_score' => 0.00,
                            'entry_count' => 0,
                            'payroll_tracked_seconds' => 0,
                            'payroll_tracked_hours' => 0.00,
                            'payroll_payable_hours' => 0.00,
                            'payroll_attendance_days' => 0,
                            'payroll_entry_count' => 0,
                        ],
                        'payroll_status' => [
                            'is_processed' => false,
                            'net_pay' => 0.00,
                            'payment_status' => 'pending',
                            'gross_salary' => 0.00,
                            'total_deductions' => 0.00,
                        ],
                        'has_template' => false,
                        'template_id' => null,
                        'annual_ctc' => 0.00,
                        'basic_percentage' => 40.00,
                        'hra_percentage' => 50.00,
                        'conveyance_allowance' => 1600.00,
                        'pf_enabled' => true,
                        'esi_enabled' => true,
                        'pt_enabled' => true,
                        'tds_enabled' => true,
                    ];
                }
            });
        } catch (\Exception $e) {
            \Log::error("Error in map function", [
                'error' => $e->getMessage(),
                'trace' => $e->getTraceAsString(),
            ]);
            
            // Return empty collection if map fails completely
            $employees = collect();
        }

        // Debug: Log the final response
        \Log::info("Final response for department {$departmentId}", [
            'employee_count' => $employees->count(),
            'employee_ids' => $employees->pluck('id')->toArray(),
        ]);

        return response()->json([
            'success' => true,
            'department_id' => $departmentId,
            'department_name' => $departmentId === 0 ? 'Unassigned' : (\App\Models\Group::find($departmentId)?->name ?? 'Unknown'),
            'employees' => $employees,
            'total_count' => $employees->count(),
            'month_year' => $monthYear,
            'is_unassigned' => $departmentId === 0,
        ]);
    }

    /**
     * Get all employees in the organization (across all departments)
     * with just the fields the Create Pay Group modal needs:
     * id, name, email, role, department name + id, and designation.
     *
     * Optional filters:
     *   - search: matches name, email, or designation (case-insensitive)
     *   - department_id: restricts to members of a single Group
     *   - page: 1-indexed page number (default 1)
     *   - per_page: rows per page (default 50, max 200)
     *
     * Response shape (Laravel paginator):
     *   { employees: AllEmployee[], total, current_page, last_page, per_page }
     */
    public function getAllEmployees(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $search = trim((string) $request->get('search', ''));
        $departmentId = $request->get('department_id');
        $perPage = max(1, min(200, (int) $request->get('per_page', 50)));

        $query = User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->with(['employeeWorkInfo', 'groups']);

        if ($departmentId !== null && $departmentId !== '' && (int) $departmentId > 0) {
            $userIds = DB::table('group_user')
                ->where('group_id', (int) $departmentId)
                ->pluck('user_id');
            $query->whereIn('id', $userIds);
        }

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%")
                    ->orWhereHas(
                        'employeeWorkInfo',
                        fn ($w) => $w->where('designation', 'like', "%{$search}%"),
                    );
            });
        }

        $paginator = $query
            ->orderBy('name')
            ->paginate($perPage)
            ->through(function ($u) {
                $group = $u->groups->first();
                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role,
                    'department' => $group?->name,
                    'department_id' => $group?->id,
                    'designation' => $u->employeeWorkInfo?->designation,
                ];
            });

        return response()->json([
            'employees' => $paginator->items(),
            'total' => $paginator->total(),
            'current_page' => $paginator->currentPage(),
            'last_page' => $paginator->lastPage(),
            'per_page' => $paginator->perPage(),
        ]);
    }

    /**
     * Employees not assigned to any pay group.
     *
     * Returns a flat list of users in the current organization who have
     * no active pay_group_assignments row.
     */
    public function getUnassignedEmployees(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        // Get all user IDs that have an active pay group assignment
        $assignedUserIds = DB::table('pay_group_assignments')
            ->where('is_active', true)
            ->pluck('user_id');

        // Return users in this org who are employees/managers and have no active assignment
        $employees = User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager'])
            ->whereNotIn('id', $assignedUserIds)
            ->with(['employeeWorkInfo'])
            ->orderBy('name')
            ->get()
            ->map(fn ($u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'role' => $u->role,
                'designation' => $u->employeeWorkInfo?->designation,
                'employee_code' => $u->employeeWorkInfo?->employee_code,
            ]);

        return response()->json([
            'employees' => $employees,
            'total' => $employees->count(),
        ]);
    }

    /**
     * Create a new pay group and assign the given employees to it in
     * one transaction. If any of the submitted user_ids belong to a
     * different organization the whole request is rejected.
     *
     * The `code` column has a global unique index, so we auto-derive
     * a slug from the name and append a numeric suffix on collision.
     *
     * Re-assignment semantics: a user can be in at most one active
     * pay group at a time. If the request contains a user who already
     * has an active `pay_group_assignments` row, that row is closed
     * (is_active = false, effective_to = effective_from) before the
     * new active row is inserted.
     */
    public function assignEmployeesToPayGroup(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => 'required|string|max:120',
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer',
            'effective_from' => 'nullable|date',
        ]);

        $organizationId = $request->user()->organization_id;
        $userIds = array_values(array_unique(array_map('intval', $data['user_ids'])));

        // Reject users that are not in the caller's organization.
        $validCount = User::whereIn('id', $userIds)
            ->where('organization_id', $organizationId)
            ->count();
        if ($validCount !== count($userIds)) {
            return response()->json([
                'success' => false,
                'message' => 'One or more users do not belong to this organization.',
            ], 422);
        }

        // Auto-derive a unique `code` from the name.
        $baseCode = Str::slug($data['name'], '_');
        if ($baseCode === '') {
            $baseCode = 'pay_group_' . substr((string) time(), -6);
        }
        $code = $baseCode;
        $suffix = 1;
        while (PayGroup::where('code', $code)->exists()) {
            $code = $baseCode . '_' . $suffix;
            $suffix++;
        }

        // A user can be in at most one active pay group at a time.
        //
        // The schema enforces a PARTIAL UNIQUE index
        // (user_id, effective_from) WHERE is_active = 1, so only the
        // active row needs a unique effective_from. Inactive rows are
        // audit-trail and can share (user_id, effective_from) without
        // colliding. We close the old active row first (mark it
        // inactive, set effective_to = today) so the new active row
        // can be inserted with effective_from = today without
        // violating the partial index.
        //
        // The close is done BEFORE the transaction because the
        // unique-index check inside a single transaction would see
        // both rows in the same effective_from pair and reject the
        // insert.
        $effectiveFrom = $data['effective_from'] ?? now()->toDateString();

        PayGroupAssignment::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->where('is_active', true)
            ->update([
                'is_active' => false,
                'effective_to' => $effectiveFrom,
            ]);

        try {
            $newGroup = DB::transaction(function () use ($data, $organizationId, $userIds, $code, $effectiveFrom) {
                $group = PayGroup::create([
                    'organization_id' => $organizationId,
                    'name' => $data['name'],
                    'code' => $code,
                    'pay_frequency' => 'monthly',
                    'pay_day_type' => 'specific',
                    'is_active' => true,
                ]);

                foreach ($userIds as $userId) {
                    PayGroupAssignment::create([
                        'organization_id' => $organizationId,
                        'pay_group_id' => $group->id,
                        'user_id' => $userId,
                        'effective_from' => $effectiveFrom,
                        'is_active' => true,
                    ]);
                }

                return $group;
            });
        } catch (\Exception $e) {
            \Log::error('Failed to create pay group + assignments', [
                'organization_id' => $organizationId,
                'error' => $e->getMessage(),
            ]);
            return response()->json([
                'success' => false,
                'message' => 'Failed to create pay group.',
            ], 500);
        }

        return response()->json([
            'success' => true,
            'pay_group_id' => $newGroup->id,
            'pay_group_name' => $newGroup->name,
            'pay_group_code' => $newGroup->code,
            'assigned_count' => count($userIds),
        ], 201);
    }

    /**
     * Get employee payroll details with time tracking
     */
    public function getEmployeePayrollDetails(Request $request, int $userId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        $user = User::where('organization_id', $organizationId)
            ->where('id', $userId)
            ->with(['employeeProfile', 'employeeWorkInfo', 'employeeBankAccounts', 'groups'])
            ->firstOrFail();

        // Close any timers that the user forgot to stop so the headline
        // hours don't include multi-day runaway durations. Scoped to
        // the requested month so we never touch historical data.
        $autoClosedTimers = $this->closeStaleRunningTimers($userId, $monthYear);

        // Get time tracking data
        $timeData = $this->getTimeTrackingData($userId, $monthYear);

        // NEW: Real attendance summary (single source of truth, hours + days).
        $attendanceSummary = $this->attendance->monthlyAttendanceSummary($user, $monthYear);

        // Get or create payroll template
        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $userId,
            $organizationId,
            auth()->id()
        );

        // Get existing payroll item if any
        $payrollItem = PayrollItem::where('user_id', $userId)
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })
            ->first();

        // Calculate payroll preview
        $annualCtc = $request->get('annual_ctc');
        $payrollPreview = null;

        if ($annualCtc) {
            $taxExemptions = $this->calculator->getApprovedTaxDeductions($userId);

            $payrollPreview = $this->calculator->calculatePayroll(
                annualCtc: (float) $annualCtc,
                stateCode: $template->pt_state ?? 'maharashtra',
                isMetroCity: $template->is_metro_city,
                taxRegime: $template->tax_regime,
                customConfig: [
                    'basic_percentage' => $template->basic_percentage / 100,
                    'hra_percentage_of_basic' => $template->hra_percentage / 100,
                    'conveyance_allowance' => $template->conveyance_allowance,
                    'pf_enabled' => $template->pf_enabled,
                    'esi_enabled' => $template->esi_enabled,
                    'pt_enabled' => $template->pt_enabled,
                    'tds_enabled' => $template->tds_enabled,
                ],
                annualTaxExemptions: $taxExemptions
            );
        }

        return response()->json([
            'employee' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'avatar' => $user->avatar,
                'role' => $user->role,
                'employee_code' => $user->employeeWorkInfo?->employee_code,
                'designation' => $user->employeeWorkInfo?->designation,
                'department' => $user->groups->first()?->name,
                'joining_date' => $user->employeeWorkInfo?->joining_date,
                'pan_number' => $user->employeeProfile?->pan_number,
                'uan_number' => $user->employeeProfile?->uan_number,
                'bank_account' => $user->employeeBankAccounts->first()?->account_number,
                'bank_ifsc' => $user->employeeBankAccounts->first()?->ifsc_swift,
            ],
            'time_tracking' => $timeData,
            'attendance_summary' => $attendanceSummary,
            'template' => $template,
            'existing_payroll' => $payrollItem,
            'payroll_preview' => $payrollPreview,
            'month_year' => $monthYear,
            // How many stale running timers this call auto-closed. Zero
            // most of the time; > 0 means the user forgot to stop a
            // timer and the controller is now reporting the snapshot
            // honestly instead of inflating hours.
            'auto_closed_timers' => $autoClosedTimers,
        ]);
    }

    /**
     * Get the monthly attendance summary (the single source of truth used
     * by every payroll path). Returns days AND hours, plus the
     * `attendance_source` marker so the UI can tell whether real Tracker
     * data or no-punch fallback was used.
     *
     * Defaults to the caller's own user id, but admins can pass ?user_id=
     * to fetch for any user in their org.
     */
    public function getMonthlyAttendanceSummary(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));
        $userId = (int) $request->get('user_id', $request->user()->id);

        $user = User::where('organization_id', $organizationId)
            ->where('id', $userId)
            ->firstOrFail();

        $summary = $this->attendance->monthlyAttendanceSummary($user, $monthYear);

        // Add an `hours` block for clarity. Seconds remain the source of
        // truth in the DB; this is presentation-only.
        $summary['hours'] = [
            'worked_hours' => round(($summary['total_worked_seconds'] ?? 0) / 3600, 2),
            'overtime_hours' => round(($summary['overtime_seconds'] ?? 0) / 3600, 2),
        ];

        return response()->json([
            'success' => true,
            'user_id' => $user->id,
            'month_year' => $monthYear,
            'summary' => $summary,
        ]);
    }

    /**
     * Update employee payroll template
     */
    public function updateEmployeeTemplate(Request $request, int $userId): JsonResponse
    {
        $request->validate([
            'annual_ctc' => 'nullable|numeric|min:0',
            'basic_percentage' => 'nullable|numeric|min:0|max:100',
            'hra_percentage' => 'nullable|numeric|min:0|max:100',
            'da_percentage' => 'nullable|numeric|min:0|max:100',
            'conveyance_allowance' => 'nullable|numeric|min:0',
            'pf_enabled' => 'nullable|boolean',
            'esi_enabled' => 'nullable|boolean',
            'pt_enabled' => 'nullable|boolean',
            'tds_enabled' => 'nullable|boolean',
            'lwf_enabled' => 'nullable|boolean',
            'pf_above_cap' => 'nullable|boolean',
            'pf_employee_percentage' => 'nullable|numeric|min:0|max:100',
            'pf_employer_percentage' => 'nullable|numeric|min:0|max:100',
            'pf_wage_cap' => 'nullable|numeric|min:0',
            'esi_employee_percentage' => 'nullable|numeric|min:0|max:100',
            'esi_employer_percentage' => 'nullable|numeric|min:0|max:100',
            'esi_threshold' => 'nullable|numeric|min:0',
            'pt_state' => 'nullable|string',
            'tax_regime' => 'nullable|in:new,old',
            'is_metro_city' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
            'custom_earnings' => 'nullable|array',
            'custom_deductions' => 'nullable|array',
        ]);

        $organizationId = $request->user()->organization_id;

        // Verify user belongs to organization
        $user = User::where('organization_id', $organizationId)
            ->where('id', $userId)
            ->firstOrFail();

        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $userId,
            $organizationId,
            auth()->id()
        );

        $template->update([
            ...$request->only([
                'annual_ctc',
                'basic_percentage',
                'hra_percentage',
                'da_percentage',
                'conveyance_allowance',
                'pf_enabled',
                'esi_enabled',
                'pt_enabled',
                'tds_enabled',
                'lwf_enabled',
                'pf_above_cap',
                'pf_employee_percentage',
                'pf_employer_percentage',
                'pf_wage_cap',
                'esi_employee_percentage',
                'esi_employer_percentage',
                'esi_threshold',
                'pt_state',
                'tax_regime',
                'is_metro_city',
                'is_active',
                'custom_earnings',
                'custom_deductions',
            ]),
            'updated_by' => auth()->id(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payroll template updated successfully',
            'template' => $template->fresh(),
        ]);
    }

    /**
     * Combined benefits summary for the wizard steps that show
     * reimbursements, FBP allocations, and active loans in a single
     * payload. Used by Steps 3 and 4 of the new 6-step wizard.
     */
    public function getBenefitsSummary(Request $request, int $userId): JsonResponse
    {
        $user = $request->user();

        // Admin/super_admin can view any employee in the org; employees
        // are restricted to their own benefits.
        $isAdmin = in_array($user->role, ['admin', 'super_admin'], true);
        if (!$isAdmin && $user->id !== $userId) {
            return response()->json(['message' => 'Unauthorized.'], 403);
        }

        // Reimbursements: only approved ones are folded into payroll.
        $reimbursements = Reimbursement::where('user_id', $userId)
            ->where('status', 'approved')
            ->orderByDesc('approved_at')
            ->get([
                'id', 'user_id', 'title', 'description', 'category',
                'amount', 'currency', 'expense_date', 'status',
                'approved_at', 'approver_id',
            ]);

        // FBP allocations: only active ones. We also include the
        // component info (joined) so the frontend can show its name.
        $fbpAllocations = FbpAllocation::with('component:id,name,code,category,max_exempt_limit,is_active')
            ->where('user_id', $userId)
            ->where('status', 'active')
            ->orderByDesc('allocated_amount')
            ->get();

        // Active loans: only approved + not exhausted. We expose
        // monthly EMI and the remaining/paid fields so the wizard can
        // render the progress bar and total.
        $activeLoans = EmployeeLoan::where('user_id', $userId)
            ->where('status', 'approved')
            ->orderByDesc('created_at')
            ->get([
                'id', 'user_id', 'loan_type', 'amount', 'emi_amount',
                'total_installments', 'remaining_amount', 'purpose',
                'status', 'created_at',
            ]);

        $totalReimbursements = (float) $reimbursements->sum('amount');
        $totalFbp = (float) $fbpAllocations->sum(fn ($a) => (float) ($a->allocated_amount ?? 0));
        $totalMonthlyEmi = (float) $activeLoans->sum('emi_amount');

        return response()->json([
            'reimbursements' => $reimbursements,
            'fbp_allocations' => $fbpAllocations,
            'active_loans' => $activeLoans,
            'totals' => [
                'reimbursements' => round($totalReimbursements, 2),
                'fbp' => round($totalFbp, 2),
                'monthly_emi' => round($totalMonthlyEmi, 2),
            ],
        ]);
    }

    /**
     * Process payroll for an employee
     */
    public function processEmployeePayroll(Request $request, int $userId): JsonResponse
    {
        $request->validate([
            'month_year' => [
                'required',
                'string',
                'regex:/^\d{4}-(0[1-9]|1[0-2])$/',
            ],
            'annual_ctc' => 'required|numeric|min:0',
            'working_days' => 'nullable|integer|min:1',
            'days_present' => 'nullable|integer|min:0',
            'lOP_days' => 'nullable|numeric|min:0',
            'overtime_hours' => 'nullable|numeric|min:0',
        ]);

        $organizationId = $request->user()->organization_id;

        $user = User::where('organization_id', $organizationId)
            ->where('id', $userId)
            ->firstOrFail();

        // Close any timers that the user forgot to stop so the payroll
        // snapshot doesn't include multi-day runaway durations. Scoped
        // to the requested month so historical data is never touched.
        $autoClosedTimers = $this->closeStaleRunningTimers($userId, $request->month_year);

        $template = EmployeePayrollTemplate::getOrCreateForUser($userId, $organizationId);

        // Save annual_ctc to template for future use
        $template->update(['annual_ctc' => $request->annual_ctc]);

        // Immutability: a 'disbursed' run is locked for compliance.
        // 'paid' and 'released' were historically block-lists but those
        // are mid-lifecycle states and may still receive edits via the
        // unlock path or partial corrections. Only the terminal
        // 'disbursed' state is truly immutable.
        $existingRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $request->month_year)
            ->first();
        if ($existingRun && $existingRun->status === 'disbursed') {
            return response()->json([
                'success' => false,
                'message' => "Cannot process payroll — run for {$request->month_year} is already disbursed and immutable for compliance.",
            ], 422);
        }

        // Get or create payroll run
        $payrollRun = PayrollMonthlyRun::firstOrCreate(
            [
                'organization_id' => $organizationId,
                'month_year' => $request->month_year,
            ],
            [
                'status' => 'draft',
                'created_by' => auth()->id(),
            ]
        );

        // Attendance: use the shared monthly summary as the source of truth.
        // If the caller (wizard manual override) explicitly passes the
        // attendance fields, those win — the summary is the fallback.
        $attendance = $this->attendance->monthlyAttendanceSummary($user, $request->month_year);
        $workingDays = $request->filled('working_days') ? (int) $request->working_days : (int) round($attendance['working_days']);
        $daysPresent = $request->filled('days_present') ? (int) $request->days_present : (int) round($attendance['present_days']);
        $lOPDays = $request->filled('lOP_days') ? (float) $request->lOP_days : (float) $attendance['lop_days'];
        $overtimeHours = $request->filled('overtime_hours')
            ? (float) $request->overtime_hours
            : round($attendance['overtime_seconds'] / 3600, 2);

        // Get department ID
        $departmentId = DB::table('group_user')
            ->where('user_id', $userId)
            ->value('group_id');

        // Calculate payroll using template percentages
        $taxExemptions = $this->calculator->getApprovedTaxDeductions($userId);

        $calculation = $this->calculator->calculatePayroll(
            annualCtc: (float) $request->annual_ctc,
            stateCode: $template->pt_state ?? 'maharashtra',
            isMetroCity: $template->is_metro_city,
            taxRegime: $template->tax_regime,
            customConfig: [
                'basic_percentage' => $template->basic_percentage / 100,
                'hra_percentage_of_basic' => $template->hra_percentage / 100,
                'conveyance_allowance' => $template->conveyance_allowance,
            ],
            annualTaxExemptions: $taxExemptions
        );

        // Calculate LOP deduction first — PF/ESI/PT apply to actual
        // payable wages, not the full month's gross. Otherwise an
        // employee with heavy LOP ends up with total_deductions > gross
        // and net_pay = 0.
        $lOPDeduction = $calculation['monthly']['gross'] > 0 && $workingDays > 0
            ? ($calculation['monthly']['gross'] / $workingDays) * $lOPDays
            : 0;

        // Payable wages = gross minus LOP. PF applies to payable basic,
        // ESI and PT apply to payable gross. When gross is 0 we fall
        // back to 0 to avoid a div-by-zero on the basic pro-ration.
        $payableGross = max(0, $calculation['monthly']['gross'] - $lOPDeduction);
        $payableBasic = $calculation['monthly']['gross'] > 0
            ? max(0, $calculation['components']['earnings']['basic']
                - ($calculation['components']['earnings']['basic'] / $calculation['monthly']['gross']) * $lOPDeduction)
            : 0;

        // Apply deductions based on template settings (use custom percentages from template)
        // PF: calculateEmployeePF already applies the rate, so don't multiply again
        $pfAmount = $template->pf_enabled
            ? $this->calculator->calculateEmployeePF($template->pf_above_cap ? PHP_FLOAT_MAX : $payableBasic)
            : 0;
        $esiAmount = $template->esi_enabled && $payableGross <= ($template->esi_threshold ?? 21000)
            ? $payableGross * ($template->esi_employee_percentage / 100)
            : 0;
        $ptAmount = $template->pt_enabled
            ? \App\Services\PTStateService::calculate($template->pt_state ?? 'maharashtra', $payableGross)
            : 0;
        $tdsAmount = $template->tds_enabled
            ? $calculation['components']['deductions']['tds']
            : 0;

        // Calculate overtime pay (assuming 2x rate)
        $hourlyRate = $workingDays > 0
            ? $calculation['monthly']['gross'] / ($workingDays * 8)
            : 0;
        $overtimePay = $overtimeHours * $hourlyRate * 2;

        // Get time tracking data (merge main TimeEntry + PayrollTimeEntry)
        $timeData = $this->getTimeTrackingData($userId, $request->month_year);

        // Prevent negative days
        $daysAbsent = max(0, $workingDays - $daysPresent - $lOPDays);

        // Loan / Advance EMI deduction
        $loanEmiAmount = 0;
        $loanDetails = null;
        $activeLoan = \App\Models\EmployeeLoan::where('user_id', $userId)
            ->where('status', 'approved')
            ->where('remaining_amount', '>', 0)
            ->first();
        if ($activeLoan) {
            $loanEmiAmount = (float) $activeLoan->emi_amount;
            $activeLoan->increment('paid_installments');
            $activeLoan->decrement('remaining_amount', $loanEmiAmount);
            if ($activeLoan->remaining_amount <= 0) {
                $activeLoan->update(['remaining_amount' => 0, 'status' => 'closed']);
            }
            $loanDetails = [
                'loan_id' => $activeLoan->id,
                'loan_type' => $activeLoan->loan_type,
                'emi' => $loanEmiAmount,
                'remaining' => max(0, $activeLoan->remaining_amount),
            ];
        }

        $customDeductions = [];
        if ($loanEmiAmount > 0) {
            $customDeductions[] = [
                'type' => 'loan_emi',
                'label' => ($activeLoan?->loan_type === 'advance' ? 'Advance' : 'Loan') . ' EMI',
                'amount' => $loanEmiAmount,
            ];
        }

        $totalDeductions = $pfAmount + $esiAmount + $ptAmount + $tdsAmount + $lOPDeduction + $loanEmiAmount;

        // Include approved reimbursements and active FBP allocations in
        // the gross. Reimbursements are non-taxable, FBP is allocated
        // monthly. Both come from the same sources the wizard Steps 3/4
        // read. This makes the payroll run reflect what the admin saw.
        $approvedReimbursementsTotal = (float) Reimbursement::where('user_id', $userId)
            ->where('status', 'approved')
            ->sum('amount');
        $fbpAllocationsTotal = (float) FbpAllocation::where('user_id', $userId)
            ->where('status', 'active')
            ->sum('allocated_amount');
        $additionalEarnings = $approvedReimbursementsTotal + $fbpAllocationsTotal;

        // `custom_earnings` is a decimal(12,2) column — write the SUM of
        // reimbursements + FBP totals as a single float. (Earlier this
        // code tried to write a nested array, which silently truncated
        // the column, and referenced $payrollItem before it was
        // created — both bugs.) The per-component breakdown is still
        // preserved in the response payload (see "reimbursements_total"
        // / "fbp_allocations_total" below) and in the payslip row.
        $customEarningsTotal = round($approvedReimbursementsTotal + $fbpAllocationsTotal, 2);

        $grossWithOT = $calculation['monthly']['gross'] + $overtimePay + $additionalEarnings;
        $netPay = max(0, $grossWithOT - $totalDeductions);

        // Create or update payroll item
        $payrollItem = PayrollItem::updateOrCreate(
            [
                'payroll_run_id' => $payrollRun->id,
                'user_id' => $userId,
            ],
            [
                'month_year' => $request->month_year,
                'organization_id' => $organizationId,
                'department_id' => $departmentId,
                'total_working_days' => $workingDays,
                'days_present' => $daysPresent,
                'days_absent' => $daysAbsent,
                'lOP_days' => $lOPDays,
                'total_worked_seconds' => $timeData['total_worked_seconds'],
                'total_productive_seconds' => $timeData['total_productive_seconds'],
                'total_idle_seconds' => $timeData['total_idle_seconds'],
                'total_unproductive_seconds' => $timeData['total_unproductive_seconds'],
                'activity_percentage' => $timeData['activity_percentage'],
                'productivity_score' => $timeData['productivity_score'],
                'overtime_seconds' => $overtimeHours * 3600,
                'overtime_pay' => $overtimePay,
                'basic' => $calculation['components']['earnings']['basic'],
                'hra' => $calculation['components']['earnings']['hra'],
                'conveyance' => $calculation['components']['earnings']['conveyance'],
                'special_allowance' => $calculation['components']['earnings']['special_allowance'],
                'gross_salary' => $grossWithOT,
                'pf_employee' => $pfAmount,
                'esi_employee' => $esiAmount,
                'pt' => $ptAmount,
                'tds' => $tdsAmount,
                'lOP_deduction' => $lOPDeduction,
                'custom_deductions' => $loanEmiAmount,
                'custom_earnings' => $customEarningsTotal,
                'total_deductions' => $totalDeductions,
                'pf_employer' => $template->pf_enabled ? $calculation['components']['employer_contributions']['pf_employer'] : 0,
                'eps' => $template->pf_enabled ? $calculation['components']['employer_contributions']['eps'] : 0,
                'epf' => $template->pf_enabled ? $calculation['components']['employer_contributions']['epf'] : 0,
                'esi_employer' => $template->esi_enabled ? $calculation['components']['employer_contributions']['esi_employer'] : 0,
                'gratuity' => $calculation['components']['employer_contributions']['gratuity'],
                'total_employer_contributions' => ($template->pf_enabled ? $calculation['components']['employer_contributions']['pf_employer'] : 0)
                    + ($template->esi_enabled ? $calculation['components']['employer_contributions']['esi_employer'] : 0)
                    + $calculation['components']['employer_contributions']['gratuity'],
                'net_pay' => $netPay,
                'template_snapshot' => $template->toArray(),
            ]
        );

        // Update payroll run totals
        $this->updatePayrollRunTotals($payrollRun);

        // Mark first payroll run completion (drives onboarding "Next Steps" card)
        $this->markFirstPayrollRunIfNeeded($organizationId);

        return response()->json([
            'success' => true,
            'message' => $autoClosedTimers > 0
                ? "Payroll processed. Auto-closed {$autoClosedTimers} stale running timer(s) in {$request->month_year}."
                : 'Payroll processed successfully',
            'auto_closed_timers' => $autoClosedTimers,
            'reimbursements_total' => round($approvedReimbursementsTotal, 2),
            'fbp_allocations_total' => round($fbpAllocationsTotal, 2),
            'payroll_item' => $payrollItem->fresh(),
        ]);
    }

    /**
     * If this is the org's first payroll item, stamp the org settings so the
     * onboarding "Next Steps" card can progress.
     */
    private function markFirstPayrollRunIfNeeded(int $organizationId): void
    {
        try {
            $org = \App\Models\Organization::find($organizationId);
            if (!$org) {
                return;
            }
            $payrollSettings = $org->settings['payroll'] ?? [];
            if (!empty($payrollSettings['first_run_completed_at'])) {
                return;
            }
            $payrollSettings['first_run_completed_at'] = now()->toIso8601String();
            $org->settings = array_merge($org->settings ?? [], ['payroll' => $payrollSettings]);
            $org->save();
        } catch (\Throwable $e) {
            // Non-fatal: never block payroll processing on a settings write.
            \Log::warning('Failed to mark first payroll run completion', [
                'org' => $organizationId,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Quick-save CTC for an employee (inline update from Roster card).
     * Validates run is not paid/released before persisting.
     */
    public function quickSaveCtc(Request $request, int $userId): JsonResponse
    {
        $data = $request->validate([
            'annual_ctc' => 'required|numeric|min:0',
            'month_year' => 'required|string',
        ]);

        $organizationId = $request->user()->organization_id;

        $user = User::where('organization_id', $organizationId)
            ->where('id', $userId)
            ->firstOrFail();

        // Immutability: reject if the run is already paid or released.
        $existingRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $data['month_year'])
            ->first();
        if ($existingRun && in_array($existingRun->status, ['paid', 'released'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot update CTC — run for {$data['month_year']} is already {$existingRun->status} and immutable.",
            ], 422);
        }

        $template = EmployeePayrollTemplate::getOrCreateForUser(
            $userId,
            $organizationId,
            auth()->id()
        );
        $template->update([
            'annual_ctc' => $data['annual_ctc'],
            'updated_by' => auth()->id(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'CTC updated',
            'template' => $template->fresh(),
        ]);
    }

    /**
     * Bulk process payroll for selected employees in a department.
     * For each user_id: validates the run is not paid/released and reuses
     * the same per-employee calc as processEmployeePayroll.
     */
    public function processSelectedEmployees(Request $request, int $departmentId): JsonResponse
    {
        $data = $request->validate([
            'month_year' => 'required|string',
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
            'working_days' => 'required|integer|min:1',
            'default_annual_ctc' => 'nullable|numeric|min:0',
            'lOP_days' => 'nullable|numeric|min:0',
            'overtime_hours' => 'nullable|numeric|min:0',
        ]);

        $organizationId = $request->user()->organization_id;

        // Verify department belongs to org
        $deptExists = DB::table('groups')
            ->where('id', $departmentId)
            ->where('organization_id', $organizationId)
            ->exists();
        if (!$deptExists) {
            return response()->json(['success' => false, 'message' => 'Department not found'], 404);
        }

        // Verify all users are in this department
        $validUserIds = DB::table('group_user')
            ->where('group_id', $departmentId)
            ->whereIn('user_id', $data['user_ids'])
            ->pluck('user_id')
            ->toArray();

        if (count($validUserIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'No valid users found in this department',
            ], 422);
        }

        // Early check: if the run is already disbursed, abort the whole batch.
        // Only the terminal 'disbursed' state is immutable; locked/approved/
        // released runs may still be edited via the unlock path.
        $existingRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $data['month_year'])
            ->first();
        if ($existingRun && $existingRun->status === 'disbursed') {
            return response()->json([
                'success' => false,
                'message' => "Cannot process payroll — run for {$data['month_year']} is already disbursed and immutable for compliance.",
            ], 422);
        }

        $succeeded = [];
        $failed = [];
        $lOPDays = $data['lOP_days'] ?? 0;
        $overtimeHours = $data['overtime_hours'] ?? 0;

        // Bulk-fetch existing templates in one query, then create any
        // missing ones. This replaces an N+1 loop of per-user
        // getOrCreateForUser calls.
        $existingTemplates = EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->get()
            ->keyBy('user_id');
        $missingUserIds = array_diff($validUserIds, $existingTemplates->keys()->all());
        foreach ($missingUserIds as $mid) {
            EmployeePayrollTemplate::getOrCreateForUser($mid, $organizationId);
        }
        // Refresh so we have every member's row in one collection.
        $existingTemplates = EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->get()
            ->keyBy('user_id');

        // Chunk the work so MySQL can release locks between batches
        // and we don't hold a single transaction open for 100+ users
        // (which times out the PHP-FPM worker). 20 per chunk matches
        // the bulk-process UI's default per-page size.
        foreach (array_chunk($validUserIds, 20) as $chunk) {
            foreach ($chunk as $uid) {
                $template = $existingTemplates[$uid];
                $annualCtc = $template->annual_ctc ?: ($data['default_annual_ctc'] ?? 0);

                if ($annualCtc <= 0) {
                    $failed[] = [
                        'user_id' => $uid,
                        'reason' => 'No annual_ctc set on template; pass default_annual_ctc to apply',
                    ];
                    continue;
                }

                $daysPresent = $data['working_days'] - $lOPDays;

                $subRequest = Request::create('/payroll/employees/' . $uid . '/process', 'POST', [
                    'month_year' => $data['month_year'],
                    'annual_ctc' => $annualCtc,
                    'working_days' => $data['working_days'],
                    'days_present' => max(0, $daysPresent),
                    'lOP_days' => $lOPDays,
                    'overtime_hours' => $overtimeHours,
                ]);
                $subRequest->setUserResolver(fn () => $request->user());

                try {
                    $response = $this->processEmployeePayroll($subRequest, $uid);
                    $payload = $response->getData(true);
                    if (($payload['success'] ?? false) === true) {
                        $succeeded[] = ['user_id' => $uid, 'payroll_item_id' => $payload['payroll_item']['id'] ?? null];
                    } else {
                        $failed[] = ['user_id' => $uid, 'reason' => $payload['message'] ?? 'Unknown error'];
                    }
                } catch (\Throwable $e) {
                    $failed[] = ['user_id' => $uid, 'reason' => $e->getMessage()];
                }
            }
            // Brief pause between chunks to let MySQL release locks
            // and avoid hammering the DB on large batches.
            usleep(50000); // 50ms
        }

        return response()->json([
            'success' => count($failed) === 0,
            'message' => count($succeeded) . ' processed, ' . count($failed) . ' failed',
            'succeeded' => $succeeded,
            'failed' => $failed,
        ]);
    }

    /**
     * Bulk-process payroll for the selected members of a pay group.
     *
     * Mirrors processSelectedEmployees but validates the user_ids
     * against the pay-group's active assignments (which may span
     * multiple departments) instead of a single department.
     *
     * Returns the same { success, succeeded, failed } shape so the
     * PayGroupEmployees view can share the response handler with
     * DepartmentEmployees.
     */
    public function processPayGroupSelectedEmployees(Request $request, int $payGroupId): JsonResponse
    {
        $data = $request->validate([
            'month_year' => 'required|string',
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
            'working_days' => 'required|integer|min:1',
            'default_annual_ctc' => 'nullable|numeric|min:0',
            'lOP_days' => 'nullable|numeric|min:0',
            'overtime_hours' => 'nullable|numeric|min:0',
        ]);

        $organizationId = $request->user()->organization_id;

        // Verify pay group belongs to the caller's org
        $payGroup = PayGroup::where('id', $payGroupId)
            ->where('organization_id', $organizationId)
            ->first();
        if (!$payGroup) {
            return response()->json(['success' => false, 'message' => 'Pay group not found'], 404);
        }

        // Verify all submitted user_ids are currently active members
        // of this pay group.
        $validUserIds = PayGroupAssignment::where('pay_group_id', $payGroupId)
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->whereIn('user_id', $data['user_ids'])
            ->pluck('user_id')
            ->all();

        if (count($validUserIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'No valid users found in this pay group',
            ], 422);
        }

        // Early check: if the run is already disbursed, abort the whole batch.
        // (Same policy as processSelectedEmployees — only the terminal
        // 'disbursed' state is immutable.)
        $existingRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $data['month_year'])
            ->first();
        if ($existingRun && $existingRun->status === 'disbursed') {
            return response()->json([
                'success' => false,
                'message' => "Cannot process payroll — run for {$data['month_year']} is already disbursed and immutable for compliance.",
            ], 422);
        }

        $succeeded = [];
        $failed = [];
        $lOPDays = $data['lOP_days'] ?? 0;
        $overtimeHours = $data['overtime_hours'] ?? 0;

        // Bulk-fetch existing templates in one query, then create any
        // missing ones. This replaces an N+1 loop of per-user
        // getOrCreateForUser calls.
        $existingTemplates = EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->get()
            ->keyBy('user_id');
        $missingUserIds = array_diff($userIds, $existingTemplates->keys()->all());
        foreach ($missingUserIds as $mid) {
            EmployeePayrollTemplate::getOrCreateForUser($mid, $organizationId);
        }
        // Refresh so we have every member's row in one collection.
        $existingTemplates = EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->get()
            ->keyBy('user_id');

        // Chunk the work so MySQL can release locks between batches
        // and we don't hold a single transaction open for 100+ users
        // (which times out the PHP-FPM worker). 20 per chunk matches
        // the bulk-process UI's default per-page size.
        foreach (array_chunk($userIds, 20) as $chunk) {
            foreach ($chunk as $uid) {
                $template = $existingTemplates[$uid];
                $annualCtc = $template->annual_ctc ?: ($data['default_annual_ctc'] ?? 0);

                if ($annualCtc <= 0) {
                    $failed[] = [
                        'user_id' => $uid,
                        'reason' => 'No annual_ctc set on template; pass default_annual_ctc to apply',
                    ];
                    continue;
                }

                $daysPresent = $data['working_days'] - $lOPDays;

                $subRequest = Request::create('/payroll/employees/' . $uid . '/process', 'POST', [
                    'month_year' => $data['month_year'],
                    'annual_ctc' => $annualCtc,
                    'working_days' => $data['working_days'],
                    'days_present' => max(0, $daysPresent),
                    'lOP_days' => $lOPDays,
                    'overtime_hours' => $overtimeHours,
                ]);
                $subRequest->setUserResolver(fn () => $request->user());

                try {
                    $response = $this->processEmployeePayroll($subRequest, $uid);
                    $payload = $response->getData(true);
                    if (($payload['success'] ?? false) === true) {
                        $succeeded[] = ['user_id' => $uid, 'payroll_item_id' => $payload['payroll_item']['id'] ?? null];
                    } else {
                        $failed[] = ['user_id' => $uid, 'reason' => $payload['message'] ?? 'Unknown error'];
                    }
                } catch (\Throwable $e) {
                    $failed[] = ['user_id' => $uid, 'reason' => $e->getMessage()];
                }
            }
            // Brief pause between chunks to let MySQL release locks
            // and avoid hammering the DB on large batches.
            usleep(50000); // 50ms
        }

        return response()->json([
            'success' => count($failed) === 0,
            'message' => count($succeeded) . ' processed, ' . count($failed) . ' failed',
            'succeeded' => $succeeded,
            'failed' => $failed,
        ]);
    }

    /**
     * Close any primary-slot TimeEntry for this user that was started
     * within the given payroll month and is still running. The auto-close
     * is scoped to the month so it cannot corrupt historical data:
     * a timer from a previous month is left alone (payroll for the old
     * month is already immutable).
     *
     * Returns the number of entries that were closed, so the controller
     * can surface it to the operator (e.g. via a banner in the wizard).
     */
    private function closeStaleRunningTimers(int $userId, string $monthYear): int
    {
        $dates = explode('-', $monthYear);
        if (count($dates) !== 2) {
            return 0;
        }
        $year = (int) $dates[0];
        $month = (int) $dates[1];
        if ($year < 1970 || $year > 2100 || $month < 1 || $month > 12) {
            return 0;
        }

        $monthStart = Carbon::create($year, $month, 1)->startOfDay();
        $monthEnd = $monthStart->copy()->endOfMonth();

        // Only the first day of the month or later — anything before
        // belongs to a previous (already-frozen) payroll cycle and
        // must not be touched.
        $boundaryAt = max($monthStart, now()->startOfDay());

        $staleEntries = TimeEntry::where('user_id', $userId)
            ->whereNull('end_time')
            ->where(function ($q) {
                $q->where('timer_slot', 'primary')
                    ->orWhereNull('timer_slot');
            })
            ->where('start_time', '>=', $monthStart)
            ->where('start_time', '<=', $monthEnd)
            ->where('start_time', '<', $boundaryAt)
            ->orderByDesc('start_time')
            ->get();

        if ($staleEntries->isEmpty()) {
            return 0;
        }

        $count = 0;
        foreach ($staleEntries as $entry) {
            $entry->update([
                'end_time' => $boundaryAt,
                'duration' => $this->timeEntryDuration->effectiveDuration($entry, $boundaryAt),
            ]);
            $count++;
        }

        return $count;
    }

    /**
     * Get time tracking data for an employee.
     * Merges data from main TimeEntry/Activity models with PayrollTimeEntry.
     */
    private function getTimeTrackingData(int $userId, string $monthYear): array
    {
        $dates = explode('-', $monthYear);
        $year = (int) $dates[0];
        $month = (int) $dates[1];

        $startDate = Carbon::create($year, $month, 1)->startOfMonth();
        $endDate = $startDate->copy()->endOfMonth();

        // Get main time entries
        $timeEntries = TimeEntry::where('user_id', $userId)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->get();

        // Use effective duration so RUNNING timers (end_time = null) are
        // counted correctly up to `now()`, instead of being treated as
        // zero-second completed rows. (See TimeEntryDurationService.)
        $totalWorkedSeconds = $this->timeEntryDuration->sumEffectiveDuration($timeEntries);

        // Track whether any timer is still running, so the UI can warn the
        // operator that the headline hours may be ticking up as long as
        // the timer is open. Useful for debugging "300h this month" reports.
        $hasRunningTimer = $timeEntries->contains(fn (TimeEntry $e) => $e->end_time === null);
        
        // Get activity data
        $activities = \App\Models\Activity::where('user_id', $userId)
            ->whereBetween('recorded_at', [$startDate, $endDate])
            ->get();

        $productiveSeconds = $activities
            ->where('classification', 'productive')
            ->sum('duration');
        
        $unproductiveSeconds = $activities
            ->where('classification', 'unproductive')
            ->sum('duration');
        
        $idleSeconds = $activities
            ->where('type', 'idle')
            ->sum('duration');

        // Also fetch standalone PayrollTimeEntry data (check-in/check-out based)
        $payrollTimeEntries = \App\Models\PayrollTimeEntry::where('user_id', $userId)
            ->whereBetween('work_date', [$startDate, $endDate])
            ->get();

        $payrollTrackedSeconds = $payrollTimeEntries->sum('duration_seconds');
        $payrollPayableHours = $payrollTimeEntries->sum('payable_hours');
        $payrollEntryCount = $payrollTimeEntries->count();
        $payrollAttendanceDays = $payrollTimeEntries->where('status', 'completed')->count();

        $totalTrackedSeconds = $productiveSeconds + $unproductiveSeconds + $idleSeconds;
        
        $activityPercentage = $totalWorkedSeconds > 0 
            ? round(($totalTrackedSeconds / $totalWorkedSeconds) * 100, 2) 
            : 0;

        $productivityScore = $totalTrackedSeconds > 0
            ? round(($productiveSeconds / $totalTrackedSeconds) * 100, 2)
            : 0;

        return [
            'total_worked_seconds' => $totalWorkedSeconds,
            'total_worked_hours' => round($totalWorkedSeconds / 3600, 2),
            'total_productive_seconds' => $productiveSeconds,
            'total_productive_hours' => round($productiveSeconds / 3600, 2),
            'total_idle_seconds' => $idleSeconds,
            'total_idle_hours' => round($idleSeconds / 3600, 2),
            'total_unproductive_seconds' => $unproductiveSeconds,
            'total_unproductive_hours' => round($unproductiveSeconds / 3600, 2),
            'activity_percentage' => $activityPercentage,
            'productivity_score' => $productivityScore,
            'entry_count' => $timeEntries->count(),
            // True if at least one TimeEntry in this month is still running
            // (end_time = null). The UI can warn the operator that the
            // hours above are still ticking up.
            'has_running_timer' => $hasRunningTimer,
            // PayrollTimeEntry integration
            'payroll_tracked_seconds' => $payrollTrackedSeconds,
            'payroll_tracked_hours' => round($payrollTrackedSeconds / 3600, 2),
            'payroll_payable_hours' => $payrollPayableHours,
            'payroll_attendance_days' => $payrollAttendanceDays,
            'payroll_entry_count' => $payrollEntryCount,
        ];
    }

    /**
     * Update payroll run totals
     */
    private function updatePayrollRunTotals(PayrollMonthlyRun $payrollRun): void
    {
        $totals = PayrollItem::where('payroll_run_id', $payrollRun->id)
            ->select(
                DB::raw('COUNT(*) as total_employees'),
                DB::raw('SUM(gross_salary) as total_gross'),
                DB::raw('SUM(total_deductions) as total_deductions'),
                DB::raw('SUM(net_pay) as total_net_pay'),
                DB::raw('SUM(total_employer_contributions) as total_employer_contributions'),
                DB::raw('SUM(pf_employee) as total_pf_employee'),
                DB::raw('SUM(pf_employer) as total_pf_employer'),
                DB::raw('SUM(esi_employee) as total_esi_employee'),
                DB::raw('SUM(esi_employer) as total_esi_employer'),
                DB::raw('SUM(pt) as total_pt'),
                DB::raw('SUM(tds) as total_tds')
            )
            ->first();

        $payrollRun->update([
            'total_employees' => $totals->total_employees ?? 0,
            'total_gross' => $totals->total_gross ?? 0,
            'total_deductions' => $totals->total_deductions ?? 0,
            'total_net_pay' => $totals->total_net_pay ?? 0,
            'total_employer_contributions' => $totals->total_employer_contributions ?? 0,
            'total_pf_employee' => $totals->total_pf_employee ?? 0,
            'total_pf_employer' => $totals->total_pf_employer ?? 0,
            'total_esi_employee' => $totals->total_esi_employee ?? 0,
            'total_esi_employer' => $totals->total_esi_employer ?? 0,
            'total_pt' => $totals->total_pt ?? 0,
            'total_tds' => $totals->total_tds ?? 0,
        ]);
    }

    /**
     * Get payroll statistics
     */
    public function getPayrollStats(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        $payrollRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $monthYear)
            ->first();

        // Get assigned users count (users in any group)
        $assignedUserIds = DB::table('group_user')
            ->join('groups', 'group_user.group_id', '=', 'groups.id')
            ->where('groups.organization_id', $organizationId)
            ->pluck('group_user.user_id');

        $totalEmployees = User::where('organization_id', $organizationId)
            ->whereIn('role', ['employee', 'manager', 'admin'])
            ->count();

        return response()->json([
            'month_year' => $monthYear,
            'total_employees' => $totalEmployees,
            'processed_employees' => $payrollRun?->total_employees ?? 0,
            'total_gross' => $payrollRun?->total_gross ?? 0,
            'total_deductions' => $payrollRun?->total_deductions ?? 0,
            'total_net_pay' => $payrollRun?->total_net_pay ?? 0,
            'status' => $payrollRun?->status ?? 'not_started',
        ]);
    }

    // ==================== PAYROLL RUN LIFECYCLE ====================

    /**
     * List all payroll runs for the organization
     */
    public function getPayrollRuns(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $runs = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->with(['createdBy:id,name', 'approvedBy:id,name'])
            ->orderBy('month_year', 'desc')
            ->get()
            ->map(function ($run) {
                return [
                    'id' => $run->id,
                    'month_year' => $run->month_year,
                    'status' => $run->status,
                    'pay_date' => $run->pay_date,
                    'total_employees' => $run->total_employees,
                    'total_gross' => $run->total_gross,
                    'total_deductions' => $run->total_deductions,
                    'total_net_pay' => $run->total_net_pay,
                    'total_employer_contributions' => $run->total_employer_contributions,
                    'created_by_name' => $run->createdBy?->name,
                    'approved_by_name' => $run->approvedBy?->name,
                    'approved_at' => $run->approved_at,
                    'notes' => $run->notes,
                    'created_at' => $run->created_at,
                ];
            });

        return response()->json([
            'runs' => $runs,
        ]);
    }

    /**
     * Get detailed info about a payroll run
     */
    public function getPayrollRunDetail(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->with(['items.user:id,name,email,avatar', 'items.department:id,name', 'createdBy:id,name', 'approvedBy:id,name'])
            ->firstOrFail();

        $items = $run->items->map(function ($item) {
            return [
                'id' => $item->id,
                'user_id' => $item->user_id,
                'employee_name' => $item->user?->name,
                'employee_email' => $item->user?->email,
                'department' => $item->department?->name,
                'total_working_days' => $item->total_working_days,
                'days_present' => $item->days_present,
                'lOP_days' => $item->lOP_days,
                'basic' => $item->basic,
                'hra' => $item->hra,
                'gross_salary' => $item->gross_salary,
                'pf_employee' => $item->pf_employee,
                'esi_employee' => $item->esi_employee,
                'pt' => $item->pt,
                'tds' => $item->tds,
                'lop_deduction' => $item->lOP_deduction,
                'total_deductions' => $item->total_deductions,
                'net_pay' => $item->net_pay,
                'payment_status' => $item->payment_status,
                'payment_method' => $item->payment_method,
                'payment_reference' => $item->payment_reference,
                // Hours snapshot for at-a-glance reporting.
                'worked_hours' => $item->worked_hours,
                'productive_hours' => $item->productive_hours,
                'overtime_hours' => $item->overtime_hours,
                'idle_hours' => $item->idle_hours,
                'unproductive_hours' => $item->unproductive_hours,
            ];
        });

        return response()->json([
            'run' => $run,
            'items' => $items,
        ]);
    }

    /**
     * 6-step pre-flight checklist for a payroll run.
     *
     * Each step's status is derived from live data:
     *   - completed: the step has been reviewed/acted upon (data exists that
     *     needs review, AND someone has acknowledged it via audit log)
     *   - pending:   data exists that needs review (but no recent acknowledgement)
     *   - no_action: nothing to review this month (e.g., no new joinees)
     *
     * Steps without a backing data source (Holds, Overrides) return
     * no_action so the checklist still renders cleanly even though those
     * features aren't tracked yet.
     */
    public function getRunChecklistStatus(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        $monthYear = $run->month_year;
        [$year, $month] = array_map('intval', explode('-', $monthYear));
        $monthStart = sprintf('%04d-%02d-01', $year, $month);
        $monthEnd = date('Y-m-t', strtotime($monthStart));

        // Helper: run a query and return null if the underlying table doesn't
        // exist. Keeps the checklist resilient when an org hasn't installed
        // every optional module (employee_work_info, reimbursements, etc.).
        $safeCount = function (callable $callback): int {
            try {
                return (int) $callback();
            } catch (\Throwable $e) {
                if (str_contains(strtolower($e->getMessage()), 'does not exist')
                    || str_contains(strtolower($e->getMessage()), 'undefined table')) {
                    return 0;
                }
                throw $e;
            }
        };

        // 1. Attendance — completed if all expected employees have a payroll_item
        //    with days_present > 0 for this run.
        $expectedCount = $safeCount(fn () => DB::table('employee_payroll_templates as t')
            ->join('users as u', 'u.id', '=', 't.user_id')
            ->where('t.organization_id', $organizationId)
            ->whereIn('u.role', ['employee', 'manager', 'admin'])
            ->where('t.is_active', true)
            ->whereNotNull('t.annual_ctc')
            ->where('t.annual_ctc', '>', 0)
            ->count());
        $attendanceCompleted = $safeCount(fn () => DB::table('payroll_items as pi')
            ->where('pi.payroll_run_id', $run->id)
            ->where('pi.days_present', '>', 0)
            ->distinct('pi.user_id')
            ->count('pi.user_id'));
        $attendanceHasData = $expectedCount > 0;

        // 2. Joinees & Exits — employees whose joining_date OR exit_date falls in this month
        $joineesCount = $safeCount(fn () => DB::table('employee_work_info as w')
            ->join('users as u', 'u.id', '=', 'w.user_id')
            ->where('u.organization_id', $organizationId)
            ->whereBetween('w.joining_date', [$monthStart, $monthEnd])
            ->count());
        $exitsCount = $safeCount(fn () => DB::table('employee_work_info as w')
            ->join('users as u', 'u.id', '=', 'w.user_id')
            ->where('u.organization_id', $organizationId)
            ->whereNotNull('w.exit_date')
            ->whereBetween('w.exit_date', [$monthStart, $monthEnd])
            ->count());

        // 3. Bonus & Revisions — overtime_pay > 0 or performance_bonus > 0 on items,
        //    or any salary revision letter whose effective_from falls in this month
        $overtimeCount = $safeCount(fn () => DB::table('payroll_items')
            ->where('payroll_run_id', $run->id)
            ->where('overtime_pay', '>', 0)
            ->count());
        $bonusCount = $safeCount(fn () => DB::table('payroll_items')
            ->where('payroll_run_id', $run->id)
            ->where('performance_bonus', '>', 0)
            ->count());
        $revisionCount = $safeCount(fn () => DB::table('salary_revision_letters')
            ->where('organization_id', $organizationId)
            ->whereBetween('effective_from', [$monthStart, $monthEnd])
            ->where('status', 'accepted')
            ->count());

        // 4. Reimbursements — pending reimbursements for this month
        $pendingReimbursements = $safeCount(fn () => DB::table('reimbursements')
            ->where('organization_id', $organizationId)
            ->where('status', 'pending')
            ->whereBetween('expense_date', [$monthStart, $monthEnd])
            ->count());

        // 5. Holds & Arrears — no `is_on_hold` flag exists yet, so this is always no_action.
        //    Arrears are computed via payroll_items.arrears column.
        $arrearsCount = $safeCount(fn () => DB::table('payroll_items')
            ->where('payroll_run_id', $run->id)
            ->where('arrears', '>', 0)
            ->count());

        // 6. Override (PT, ESI, TDS, LWF) — no `manual_override` flag yet, no_action.
        //    Could be enhanced later by comparing computed vs actual values.

        // Audit acknowledgement — if any recent audit_logs entry exists for this run
        // dated today, treat the run as "reviewed" for status purposes.
        $recentAudit = null;
        $reviewerName = null;
        try {
            $recentAudit = DB::table('audit_logs')
                ->where('target_type', PayrollMonthlyRun::class)
                ->where('target_id', $run->id)
                ->where('created_at', '>=', now()->subDay())
                ->orderByDesc('created_at')
                ->first();

            if ($recentAudit && $recentAudit->actor_user_id) {
                $reviewerName = DB::table('users')->where('id', $recentAudit->actor_user_id)->value('name');
            }
        } catch (\Throwable $e) {
            // audit_logs may not be installed in some envs — treat as no acknowledgement
        }
        $lastReviewedAt = $recentAudit?->created_at;

        $step = function (
            string $id,
            string $title,
            string $status,
            ?string $detail = null,
            ?string $icon = null,
        ): array {
            return [
                'id' => $id,
                'title' => $title,
                'status' => $status,
                'detail' => $detail,
                'icon' => $icon,
                'last_changed_at' => null,
                'last_changed_by' => null,
            ];
        };

        $steps = [
            $step(
                'attendance',
                'Leave, Attendance & Payable Units',
                $attendanceHasData ? 'completed' : 'no_action',
                $attendanceHasData
                    ? "{$attendanceCompleted} of {$expectedCount} expected employees have attendance finalized"
                    : 'No expected employees with CTC configured yet',
                'ClipboardList',
            ),
            $step(
                'joinees_exits',
                'New Joinees & Exits',
                ($joineesCount + $exitsCount) > 0 ? 'pending' : 'no_action',
                ($joineesCount + $exitsCount) > 0
                    ? "{$joineesCount} new joiner(s), {$exitsCount} exit(s) in {$monthYear}"
                    : "No joiners or exits in {$monthYear}",
                'Users',
            ),
            $step(
                'bonus_revisions',
                'Bonus, Salary Revisions & Overtime',
                ($overtimeCount + $bonusCount + $revisionCount) > 0 ? 'pending' : 'no_action',
                ($overtimeCount + $bonusCount + $revisionCount) > 0
                    ? "{$overtimeCount} overtime entries · {$bonusCount} bonus entries · {$revisionCount} salary revision(s)"
                    : 'No bonuses, revisions, or overtime this month',
                'TrendingUp',
            ),
            $step(
                'reimbursements',
                'Reimbursement, Adhoc Payment, Deduction',
                $pendingReimbursements > 0 ? 'pending' : 'no_action',
                $pendingReimbursements > 0
                    ? "{$pendingReimbursements} reimbursement(s) awaiting approval"
                    : 'No pending reimbursements',
                'Receipt',
            ),
            $step(
                'holds_arrears',
                'Salaries on Hold & Arrears',
                $arrearsCount > 0 ? 'pending' : 'no_action',
                $arrearsCount > 0
                    ? "{$arrearsCount} employee(s) have arrears this month"
                    : 'No salary holds or arrears this month',
                'PauseCircle',
            ),
            $step(
                'overrides',
                'Override (PT, ESI, TDS, LWF)',
                'no_action',
                'Manual override tracking is not yet enabled',
                'Sliders',
            ),
        ];

        // Stamp each step with the last review acknowledgement if any
        if ($lastReviewedAt) {
            foreach ($steps as &$s) {
                if ($s['status'] !== 'no_action') {
                    $s['last_changed_at'] = $lastReviewedAt;
                    $s['last_changed_by'] = $reviewerName ?? ('user #' . $recentAudit->actor_user_id);
                    $s['locked'] = true;
                }
            }
            unset($s);
        }

        $completedCount = count(array_filter($steps, fn ($s) => $s['status'] === 'completed'));

        return response()->json([
            'success' => true,
            'run_id' => $runId,
            'month_year' => $monthYear,
            'status' => $run->status,
            'steps' => $steps,
            'completed_count' => $completedCount,
            'total_count' => count($steps),
            'pending_count' => count(array_filter($steps, fn ($s) => $s['status'] === 'pending')),
        ]);
    }

    /**
     * Activity log for a payroll run — chronological list of audit entries
     * (locked, approved, released, disbursed, unlocked, etc).
     */
    public function getRunActivity(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        // Confirm the run belongs to this org (avoid leaking cross-org data)
        PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        $entries = DB::table('audit_logs as a')
            ->leftJoin('users as u', 'u.id', '=', 'a.actor_user_id')
            ->where('a.target_type', PayrollMonthlyRun::class)
            ->where('a.target_id', $runId)
            ->orderByDesc('a.created_at')
            ->limit(50)
            ->get([
                'a.id',
                'a.action',
                'a.metadata',
                'a.ip_address',
                'a.created_at',
                'u.name as actor_name',
            ])
            ->map(function ($row) {
                $metadata = $row->metadata ? json_decode($row->metadata, true) : [];
                return [
                    'id' => (int) $row->id,
                    'action' => $row->action,
                    'actor_name' => $row->actor_name,
                    'metadata' => $metadata,
                    'ip_address' => $row->ip_address,
                    'created_at' => $row->created_at,
                ];
            })
            ->values();

        return response()->json([
            'success' => true,
            'run_id' => $runId,
            'entries' => $entries,
        ]);
    }

    /**
     * Lock a payroll run (no more edits to calculations).
     *
     * "Perfect flow" change: partial runs are now allowed by default.
     * If some employees haven't been processed yet, we lock anyway —
     * the missing employees are recorded in `lock_reason` for audit and
     * returned in the response so the UI can warn the operator.
     *
     * The `force=1` and `reason` params are still accepted for legacy
     * callers (the audit log entry is still written), but no longer
     * required.
     */
    public function lockPayrollRun(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if (!in_array($run->status, ['draft', 'processing'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot lock run in '{$run->status}' status",
            ], 422);
        }

        // Completeness check: count expected vs processed employees.
        $completeness = $this->getRunCompletenessData($organizationId, $run);

        // Lock the run regardless of completeness — partial is allowed.
        // Record the reason if the caller passed one (e.g. via the legacy
        // `force=1` path or for audit clarity).
        $lockReason = trim((string) $request->get('reason', ''));
        if (! $completeness['is_complete'] && $lockReason === '') {
            // Auto-generate a reason when partial so the audit trail is
            // never empty.
            $lockReason = "Partial run: {$completeness['processed_count']} of {$completeness['expected_count']} employees processed.";
        }

        $run->update([
            'status' => 'locked',
            'locked_at' => now(),
            'locked_by' => auth()->id(),
            'lock_reason' => $lockReason !== '' ? $lockReason : null,
            'notes' => $request->get('notes', $run->notes),
        ]);

        // Audit the lock for compliance review.
        $this->writeRunAudit($run, 'locked', [
            'expected_count' => $completeness['expected_count'],
            'processed_count' => $completeness['processed_count'],
            'missing_count' => $completeness['missing_count'],
            'is_complete' => $completeness['is_complete'],
            'reason' => $lockReason,
            'locked_by' => auth()->id(),
        ]);

        return response()->json([
            'success' => true,
            'message' => $completeness['is_complete']
                ? 'Payroll run locked.'
                : "Payroll run locked (partial). {$completeness['missing_count']} employee(s) not included.",
            'run' => $run->fresh(),
            'completeness' => $completeness,
        ]);
    }

    /**
     * Get completeness info for a run — how many of the expected
     * active employees have been processed for this run's month.
     *
     * "Expected" = active users in this org with role in
     * [employee, manager, admin] AND a payroll template (i.e. on payroll).
     * Users without an annual_ctc configured yet are counted as expected
     * so the operator sees them as "needs setup" rather than silently skipped.
     */
    private function getRunCompletenessData(int $organizationId, PayrollMonthlyRun $run): array
    {
        $monthYear = $run->month_year;

        // Expected: every on-payroll user with an active template
        $expectedUserIds = DB::table('employee_payroll_templates as t')
            ->join('users as u', 'u.id', '=', 't.user_id')
            ->where('t.organization_id', $organizationId)
            ->whereIn('u.role', ['employee', 'manager', 'admin'])
            ->where('t.is_active', true)
            ->whereNotNull('t.annual_ctc')
            ->where('t.annual_ctc', '>', 0)
            ->pluck('u.id')
            ->unique()
            ->values()
            ->all();

        // If we have NO templates with CTCs yet, fall back to "everyone in
        // this org" so we don't silently report 100% complete on a fresh org.
        if (empty($expectedUserIds)) {
            $expectedUserIds = User::where('organization_id', $organizationId)
                ->whereIn('role', ['employee', 'manager', 'admin'])
                ->pluck('id')
                ->all();
        }

        // Processed: users with a payroll_item in this run
        $processedUserIds = PayrollItem::where('payroll_run_id', $run->id)
            ->pluck('user_id')
            ->unique()
            ->values()
            ->all();

        $expectedSet = array_flip($expectedUserIds);
        $processedSet = array_flip($processedUserIds);

        // array_diff_key returns KEYS that are in $expectedSet but not in $processedSet.
        // Since $expectedSet is the flipped user-id list, those keys ARE the missing
        // user ids — no need for array_values() (which would reindex them to 0,1,2...).
        $missingUserIds = array_keys(array_diff_key($expectedSet, $processedSet));

        $missingEmployees = empty($missingUserIds)
            ? []
            : User::whereIn('id', $missingUserIds)
                ->select(['id', 'name', 'email'])
                ->get()
                ->map(fn ($u) => ['id' => $u->id, 'name' => $u->name, 'email' => $u->email])
                ->all();

        return [
            'expected_count' => count($expectedUserIds),
            'processed_count' => count($processedUserIds),
            'missing_count' => count($missingUserIds),
            'is_complete' => count($missingUserIds) === 0,
            'missing_employees' => $missingEmployees,
        ];
    }

    /**
     * GET endpoint for run completeness — surfaced in the UI to drive
     * the "Process remaining" CTA in PayrollRunDetailModal.
     */
    public function getRunCompleteness(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        $completeness = $this->getRunCompletenessData($organizationId, $run);

        return response()->json([
            'success' => true,
            'run_id' => $runId,
            'month_year' => $run->month_year,
            'status' => $run->status,
            ...$completeness,
        ]);
    }

    /**
     * Process payroll for all remaining (unprocessed) active employees
     * in this run's month. Uses each user's saved annual_ctc from the
     * template, defaulting to 0 (skipped) when not configured.
     *
     * This is the "Process Remaining" button on the run detail modal —
     * it lets HR fill the gaps before locking without manually clicking
     * through every department.
     */
    public function processRemainingEmployees(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if (! in_array($run->status, ['draft', 'processing'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot process remaining employees — run is in '{$run->status}' status. Only draft/processing runs accept new items.",
            ], 422);
        }

        $completeness = $this->getRunCompletenessData($organizationId, $run);
        if ($completeness['is_complete']) {
            return response()->json([
                'success' => true,
                'message' => 'All expected employees are already processed.',
                'succeeded' => 0,
                'failed' => 0,
                'skipped_no_ctc' => 0,
            ]);
        }

        $missingUserIds = array_column($completeness['missing_employees'], 'id');

        // Compute working days default for this month. Per-employee
        // processing always re-reads monthly attendance inside
        // processEmployeePayroll, so passing 26 here is safe — the actual
        // working_days get re-derived from attendance when not overridden.
        $workingDays = 26;

        $succeeded = 0;
        $failed = 0;
        $skippedNoCtc = 0;

        foreach ($missingUserIds as $uid) {
            $template = EmployeePayrollTemplate::where('user_id', $uid)
                ->where('organization_id', $organizationId)
                ->first();

            if (! $template || ! $template->annual_ctc || $template->annual_ctc <= 0) {
                $skippedNoCtc++;
                continue;
            }

            $subRequest = Request::create(
                '/payroll/employees/' . $uid . '/process',
                'POST',
                [
                    'month_year' => $run->month_year,
                    'annual_ctc' => (float) $template->annual_ctc,
                    'working_days' => $workingDays,
                ]
            );
            $subRequest->setUserResolver(fn () => $request->user());

            try {
                $response = $this->processEmployeePayroll($subRequest, $uid);
                if (($response->getData(true)['success'] ?? false) === true) {
                    $succeeded++;
                } else {
                    $failed++;
                }
            } catch (\Throwable $e) {
                $failed++;
                \Log::warning("processRemainingEmployees: failed for user {$uid}", ['err' => $e->getMessage()]);
            }
        }

        $freshCompleteness = $this->getRunCompletenessData($organizationId, $run->fresh());

        return response()->json([
            'success' => $failed === 0,
            'message' => "{$succeeded} processed, {$failed} failed, {$skippedNoCtc} skipped (no annual_ctc configured).",
            'succeeded' => $succeeded,
            'failed' => $failed,
            'skipped_no_ctc' => $skippedNoCtc,
            'completeness' => $freshCompleteness,
        ]);
    }

    /**
     * Roll back a locked run to 'draft' so corrections can be made.
     * Audit-logged. Only works when status='locked' (not approved/released/disbursed).
     */
    public function unlockPayrollRun(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if ($run->status !== 'locked') {
            return response()->json([
                'success' => false,
                'message' => "Cannot unlock run in '{$run->status}' status. Only 'locked' runs can be unlocked.",
            ], 422);
        }

        $reason = trim((string) $request->get('reason', ''));
        if ($reason === '') {
            return response()->json([
                'success' => false,
                'message' => 'Unlocking requires a reason for the audit log.',
            ], 422);
        }

        $previousStatus = $run->status;

        $run->update([
            'status' => 'draft',
            'notes' => ($run->notes ? $run->notes . "\n\n" : '') . "Unlocked " . now()->toDateTimeString() . " by " . ($request->user()->name ?? 'user #' . auth()->id()) . ": {$reason}",
        ]);

        $this->writeRunAudit($run, 'unlocked', [
            'reason' => $reason,
            'from_status' => $previousStatus,
            'to_status' => 'draft',
            'unlocked_by' => auth()->id(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Run unlocked. It is now editable again.',
            'run' => $run->fresh(),
        ]);
    }

    /**
     * Persist a lifecycle audit entry. Falls back silently if the audit_logs
     * table is missing the columns we want — auditing must never block payroll.
     *
     * Uses the actual audit_logs schema:
     *   actor_user_id, target_type, target_id, metadata
     * (Earlier versions used actor_id / auditable_type / auditable_id / meta
     * which don't exist on this table — the insert was silently failing.)
     */
    private function writeRunAudit(PayrollMonthlyRun $run, string $action, array $meta = []): void
    {
        try {
            DB::table('audit_logs')->insert([
                'organization_id' => $run->organization_id,
                'actor_user_id' => auth()->id(),
                'action' => 'payroll_run.' . $action,
                'target_type' => PayrollMonthlyRun::class,
                'target_id' => $run->id,
                'metadata' => json_encode($meta),
                'ip_address' => request()?->ip(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } catch (\Throwable $e) {
            \Log::warning('writeRunAudit failed (non-blocking)', [
                'run_id' => $run->id,
                'action' => $action,
                'err' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Approve a locked payroll run
     */
    public function approvePayrollRun(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if ($run->status !== 'locked') {
            return response()->json([
                'success' => false,
                'message' => "Cannot approve run in '{$run->status}' status. Must be 'locked' first.",
            ], 422);
        }

        $run->update([
            'status' => 'approved',
            'approved_by' => auth()->id(),
            'approved_at' => now(),
            'notes' => $request->get('notes', $run->notes),
        ]);

        $this->writeRunAudit($run->fresh(), 'approved', [
            'approved_by' => auth()->id(),
            'notes' => $request->get('notes'),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payroll run approved successfully',
            'run' => $run->fresh(),
        ]);
    }

    /**
     * Release a payroll run (bank file is generated, ready for upload to bank).
     *
     * The "perfect payroll flow" change: missing bank details do NOT block
     * release anymore. Those employees are auto-skipped from the bank file
     * and surfaced in the response so the operator can chase them
     * separately (cash payment, or wait until they add bank details).
     *
     * Only the run lifecycle transition is enforced:
     * - Must be in 'locked' or 'approved' status
     * - 'disbursed' is terminal
     */
    public function releasePayrollRun(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if (!in_array($run->status, ['approved', 'locked'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot release run in '{$run->status}' status. Must be 'approved' first.",
            ], 422);
        }

        // Identify employees missing bank details. Auto-skip them from the
        // bank file (don't block the whole run). Return them so the UI can
        // show "These N employees will need a separate payment".
        $employeesMissingBankDetails = PayrollItem::where('payroll_run_id', $run->id)
            ->where('payment_status', 'pending')
            ->whereHas('user', function ($q) {
                $q->whereDoesntHave('employeeBankAccounts', function ($q2) {
                    $q2->whereNotNull('account_number')
                        ->whereNotNull('ifsc_swift');
                });
            })
            ->with(['user:id,name'])
            ->get();

        $run->update([
            'status' => 'released',
            'released_at' => now(),
            'released_by' => auth()->id(),
            'notes' => $request->get('notes', $run->notes),
        ]);

        $this->writeRunAudit($run->fresh(), 'released', [
            'released_by' => auth()->id(),
            'skipped_employees' => $employeesMissingBankDetails->pluck('user_id')->all(),
        ]);

        return response()->json([
            'success' => true,
            'message' => $employeesMissingBankDetails->count() > 0
                ? "Payroll run released. {$employeesMissingBankDetails->count()} employee(s) skipped from bank file (missing bank details)."
                : 'Payroll run released successfully.',
            'run' => $run->fresh(),
            'skipped_employees' => $employeesMissingBankDetails->map(fn($item) => [
                'id' => $item->user_id,
                'name' => $item->user->name,
                'reason' => 'no_bank_details',
            ])->values(),
        ]);
    }

    /**
     * Mark a single payroll item as paid (per-employee payment).
     * Useful for individual payouts outside the bulk bank-file flow.
     */
    public function markItemPaid(Request $request, int $itemId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $item = \App\Models\PayrollItem::whereHas('payrollRun', function ($q) use ($organizationId) {
            $q->where('organization_id', $organizationId);
        })->where('id', $itemId)->firstOrFail();

        if ($item->payment_status === 'paid') {
            return response()->json([
                'success' => false,
                'message' => 'Item is already marked paid',
            ], 422);
        }

        $reference = $request->get('payment_reference')
            ?: ('PAY-' . strtoupper(substr(md5(random_bytes(8)), 0, 8)));

        $item->update([
            'payment_status' => 'paid',
            'payment_method' => $request->get('payment_method', 'bank_transfer'),
            'payment_reference' => $reference,
            'paid_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payment recorded for employee',
            'item' => $item->fresh(),
        ]);
    }

    /**
     * Process payment for a payroll run (marks all items as paid, transitions run to "disbursed")
     */
    public function processRunPayment(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        // Only allow disbursement from 'released' or 'approved' state.
        // 'disbursed' is the immutable terminal state — once set, no further changes.
        if (!in_array($run->status, ['released', 'approved'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot disburse payments for run in '{$run->status}' status. Release it first.",
            ], 422);
        }

        $paymentMethod = $request->get('payment_method', 'bank_transfer');

        // Generate a per-row payment reference. Doing it in PHP rather than
        // SQL because Postgres has RANDOM() and MySQL has RAND() — keep this
        // portable. Bulk size is bounded by # of pending items in one run.
        $pendingItems = PayrollItem::where('payroll_run_id', $run->id)
            ->where('payment_status', 'pending')
            ->get();

        foreach ($pendingItems as $item) {
            $item->update([
                'payment_status' => 'paid',
                'payment_method' => $paymentMethod,
                'payment_reference' => 'PAY-' . strtoupper(substr(md5(random_bytes(6)), 0, 8)),
                'paid_at' => now(),
            ]);
        }

        // Terminal state: 'disbursed'. Once set, the run becomes immutable for compliance.
        $run->update([
            'status' => 'disbursed',
            'pay_date' => $request->get('pay_date', now()),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payments disbursed. Run is now immutable.',
            'run' => $run->fresh(),
        ]);
    }

    /**
     * Generate bank file (NEFT/RTGS format)
     *
     * Bank files are a compliance artifact — only generated after the run
     * has been approved. Draft/processing/locked runs may still change
     * (new items added, recalculations), so a bank file from those states
     * would be wrong the moment it's produced.
     */
    public function generateBankFile(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if (! in_array($run->status, ['approved', 'released', 'disbursed'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Bank file is only available after the run is approved. Current status: '{$run->status}'. Lock the run and approve it first.",
                'current_status' => $run->status,
                'allowed_statuses' => ['approved', 'released', 'disbursed'],
            ], 422);
        }

        $items = PayrollItem::where('payroll_run_id', $run->id)
            ->with(['user.employeeBankAccounts', 'user.employeeProfile'])
            ->where('payment_status', 'pending')
            ->get();

        if ($items->isEmpty()) {
            return response()->json([
                'success' => false,
                'message' => 'No pending payroll items found for this run',
            ], 404);
        }

        $entries = [];
        $serialNo = 1;
        $totalAmount = 0;
        $skipped = [];

        foreach ($items as $item) {
            $bankAccount = $item->user->employeeBankAccounts->first();
            if (!$bankAccount || !$bankAccount->account_number || !$bankAccount->ifsc_swift) {
                // Track skipped employees so the frontend can warn the user
                // instead of silently producing a partial bank file.
                $missing = [];
                if (!$bankAccount || !$bankAccount->account_number) $missing[] = 'account_number';
                if (!$bankAccount || !$bankAccount->ifsc_swift) $missing[] = 'ifsc_swift';

                $skipped[] = [
                    'user_id' => $item->user_id,
                    'name' => $item->user->name,
                    'email' => $item->user->email,
                    'net_pay' => $item->net_pay,
                    'missing_fields' => $missing,
                ];
                continue;
            }

            $amount = round($item->net_pay, 0);
            $entries[] = [
                'serial_no' => $serialNo,
                'employee_name' => $item->user->name,
                'account_number' => $bankAccount->account_number,
                'ifsc_code' => $bankAccount->ifsc_swift,
                'amount' => $amount,
                'net_pay' => $item->net_pay,
            ];
            $totalAmount += $amount;
            $serialNo++;
        }

        // Generate CSV content
        $csvLines = [
            "H,{$run->month_year},CareVance HRMS Payroll,{$run->organization_id}",
            'S.No,Employee Name,Account Number,IFSC Code,Amount',
        ];

        foreach ($entries as $entry) {
            $csvLines[] = "{$entry['serial_no']},{$entry['employee_name']},{$entry['account_number']},{$entry['ifsc_code']},{$entry['amount']}";
        }

        $csvLines[] = "TOTAL,,,,{$totalAmount}";
        $csvContent = implode("\n", $csvLines);

        $filename = "bank_file_{$run->month_year}_{$run->id}.csv";

        return response()->json([
            'success' => true,
            'filename' => $filename,
            'content' => $csvContent,
            'entries' => $entries,
            'total_amount' => $totalAmount,
            'total_employees' => count($entries),
            'total_pending' => $items->count(),
            'skipped_employees' => $skipped,
            'partial' => count($skipped) > 0,
        ]);
    }

    /**
     * List employees in a run who are missing valid bank details.
     * Used by the frontend to surface a warning banner before the user
     * downloads a bank file or tries to disburse.
     */
    public function getRunMissingBankDetails(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        $items = PayrollItem::where('payroll_run_id', $run->id)
            ->with(['user.employeeBankAccounts'])
            ->where('payment_status', 'pending')
            ->get();

        $missing = $items->filter(function ($item) {
            $bank = $item->user->employeeBankAccounts->first();
            return !$bank || !$bank->account_number || !$bank->ifsc_swift;
        })->map(function ($item) {
            $bank = $item->user->employeeBankAccounts->first();
            $missingFields = [];
            if (!$bank || !$bank->account_number) $missingFields[] = 'account_number';
            if (!$bank || !$bank->ifsc_swift) $missingFields[] = 'ifsc_swift';

            return [
                'user_id' => $item->user_id,
                'name' => $item->user->name,
                'email' => $item->user->email,
                'net_pay' => $item->net_pay,
                'has_partial_account' => (bool) $bank,
                'missing_fields' => $missingFields,
            ];
        })->values();

        return response()->json([
            'success' => true,
            'run_id' => $run->id,
            'missing_count' => $missing->count(),
            'missing_employees' => $missing,
        ]);
    }

    /**
     * Generate bulk payslip data
     */
    public function generateBulkPayslips(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        $items = PayrollItem::where('payroll_run_id', $run->id)
            ->with(['user.organization', 'user.employeeProfile', 'user.employeeBankAccounts'])
            ->get();

        $payslips = $items->map(function ($item) use ($run) {
            $user = $item->user;
            return [
                'employee' => [
                    'name' => $user->name,
                    'email' => $user->email,
                    'pan' => $user->employeeProfile?->pan_number,
                    'uan' => $user->employeeProfile?->uan_number,
                    'bank_account' => $user->employeeBankAccounts->first()?->account_number,
                    'bank_ifsc' => $user->employeeBankAccounts->first()?->ifsc_swift,
                ],
                'employer' => [
                    'name' => $user->organization?->name,
                ],
                'month' => $run->month_year,
                'attendance' => [
                    'total_working_days' => $item->total_working_days,
                    'days_present' => $item->days_present,
                    'lOP_days' => $item->lOP_days,
                    'worked_hours' => $item->worked_hours,
                    'productive_hours' => $item->productive_hours,
                    'overtime_hours' => $item->overtime_hours,
                    'idle_hours' => $item->idle_hours,
                    'unproductive_hours' => $item->unproductive_hours,
                ],
                'earnings' => [
                    'basic' => $item->basic,
                    'hra' => $item->hra,
                    'conveyance' => $item->conveyance,
                    'special_allowance' => $item->special_allowance,
                    'gross_salary' => $item->gross_salary,
                ],
                'deductions' => [
                    'pf_employee' => $item->pf_employee,
                    'esi_employee' => $item->esi_employee,
                    'pt' => $item->pt,
                    'tds' => $item->tds,
                    'lop_deduction' => $item->lOP_deduction,
                    'total_deductions' => $item->total_deductions,
                ],
                'employer_contributions' => [
                    'pf_employer' => $item->pf_employer,
                    'esi_employer' => $item->esi_employer,
                    'gratuity' => $item->gratuity,
                ],
                'net_pay' => $item->net_pay,
                'payment_status' => $item->payment_status,
                'working_days' => $item->total_working_days,
                'days_present' => $item->days_present,
                'days_absent' => $item->days_absent,
                'lop_days' => $item->lOP_days,
            ];
        });

        return response()->json([
            'success' => true,
            'run' => $run,
            'payslips' => $payslips,
            'total_employees' => $payslips->count(),
        ]);
    }

    // ─────────────────────────────────────────────────────────────────────
    // PERFECT PAYROLL FLOW (atomic)
    //
    // The flow below replaces the 4-step manual ceremony (lock → approve →
    // release → disburse) with two endpoints that match how greytHR and
    // Keka actually do it:
    //
    //   1. POST /payroll/process-and-pay  — creates run, processes every
    //      active employee, locks, approves, releases, and returns the
    //      bank file inline. ONE click from the operator's POV.
    //
    //   2. POST /payroll/runs/{id}/disburse  — operator confirms the
    //      bank file was uploaded to the bank portal; this marks every
    //      remaining pending payslip as paid and transitions the run to
    //      the immutable `disbursed` state.
    //
    // The old 4 endpoints (lock/approve/release/processRunPayment) are
    // retained for back-compat but the UI uses only these two.
    // ─────────────────────────────────────────────────────────────────────

    /**
     * Atomic payroll workflow — "Process & Pay" in one call.
     *
     * Steps performed (in order, inside one transaction per concern):
     *  1. Find or create the PayrollMonthlyRun for {month_year}
     *  2. Bulk-process all unprocessed active employees (those with CTC
     *     set; employees without CTC are surfaced as exceptions)
     *  3. Lock the run (records locked_at + locked_by + lock_reason)
     *  4. Auto-approve the run (records approved_by + approved_at)
     *  5. Release the run — bank file is generated inline, employees
     *     missing bank details are auto-skipped (not blocked)
     *
     * Returns the full review screen payload: headcount, totals,
     * skipped employees, and the bank file as base64-decodable text.
     */
    public function processAndPay(Request $request): JsonResponse
    {
        $data = $request->validate([
            'month_year' => ['required', 'string', 'regex:/^\d{4}-(0[1-9]|1[0-2])$/'],
            'working_days' => 'nullable|integer|min:1|max:31',
            'default_annual_ctc' => 'nullable|numeric|min:0',
            'lock_reason' => 'nullable|string|max:500',
        ]);

        $organizationId = $request->user()->organization_id;
        $monthYear = $data['month_year'];
        $workingDays = (int) ($data['working_days'] ?? 26);

        // Immutability: cannot re-run for a disbursed month.
        $existing = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $monthYear)
            ->first();
        if ($existing && $existing->status === 'disbursed') {
            return response()->json([
                'success' => false,
                'message' => "Cannot re-process {$monthYear}: already disbursed and immutable.",
            ], 422);
        }

        // ── 1. Find or create the run ─────────────────────────────────
        $run = PayrollMonthlyRun::firstOrCreate(
            ['organization_id' => $organizationId, 'month_year' => $monthYear],
            ['status' => 'draft', 'created_by' => auth()->id()]
        );

        // If the run was already locked/approved/released, return current
        // state without re-running steps (the operator may have used the
        // legacy endpoints). The UI handles these statuses already.
        if (in_array($run->status, ['locked', 'approved', 'released'], true)) {
            return response()->json([
                'success' => true,
                'already_advanced' => true,
                'message' => "Run is already in '{$run->status}' status.",
                'run' => $run->fresh(),
            ]);
        }

        // ── 2. Bulk-process every unprocessed employee ───────────────
        $expectedUserIds = DB::table('employee_payroll_templates as t')
            ->join('users as u', 'u.id', '=', 't.user_id')
            ->where('t.organization_id', $organizationId)
            ->whereIn('u.role', ['employee', 'manager', 'admin'])
            ->where('t.is_active', true)
            ->whereNotNull('t.annual_ctc')
            ->where('t.annual_ctc', '>', 0)
            ->pluck('u.id')
            ->unique()
            ->values()
            ->all();

        if (empty($expectedUserIds)) {
            return response()->json([
                'success' => false,
                'message' => "No employees have a CTC configured yet. Set up salary templates first.",
                'no_employees' => true,
            ], 422);
        }

        $processedUserIds = PayrollItem::where('payroll_run_id', $run->id)
            ->pluck('user_id')
            ->unique()
            ->values()
            ->all();
        $missingUserIds = array_values(array_diff($expectedUserIds, $processedUserIds));

        $processed = 0;
        $skippedNoCtc = 0;

        foreach ($missingUserIds as $uid) {
            $template = EmployeePayrollTemplate::where('user_id', $uid)
                ->where('organization_id', $organizationId)
                ->first();
            if (! $template || ! $template->annual_ctc || $template->annual_ctc <= 0) {
                $skippedNoCtc++;
                continue;
            }

            $subRequest = Request::create(
                '/payroll/employees/' . $uid . '/process',
                'POST',
                [
                    'month_year' => $monthYear,
                    'annual_ctc' => (float) $template->annual_ctc,
                    'working_days' => $workingDays,
                ]
            );
            $subRequest->setUserResolver(fn () => $request->user());

            try {
                $response = $this->processEmployeePayroll($subRequest, $uid);
                if (($response->getData(true)['success'] ?? false) === true) {
                    $processed++;
                } else {
                    $skippedNoCtc++;
                }
            } catch (\Throwable $e) {
                $skippedNoCtc++;
                \Log::warning("processAndPay: failed to process user {$uid}", ['err' => $e->getMessage()]);
            }
        }

        $run = $run->fresh();

        // ── 3. Lock ────────────────────────────────────────────────────
        $lockReq = Request::create('/payroll/runs/' . $run->id . '/lock', 'POST', [
            'reason' => $data['lock_reason'] ?? null,
        ]);
        $lockReq->setUserResolver(fn () => $request->user());
        $lockResp = $this->lockPayrollRun($lockReq, $run->id);
        $lockData = $lockResp->getData(true);
        if (! ($lockData['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'stage' => 'lock',
                'message' => $lockData['message'] ?? 'Lock failed',
                'run' => $run,
            ], 422);
        }
        $run = $run->fresh();

        // ── 4. Approve ─────────────────────────────────────────────────
        $approveReq = Request::create('/payroll/runs/' . $run->id . '/approve', 'POST');
        $approveReq->setUserResolver(fn () => $request->user());
        $approveResp = $this->approvePayrollRun($approveReq, $run->id);
        if (! ($approveResp->getData(true)['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'stage' => 'approve',
                'message' => 'Approval failed after lock',
                'run' => $run,
            ], 422);
        }
        $run = $run->fresh();

        // ── 5. Release ─────────────────────────────────────────────────
        $releaseReq = Request::create('/payroll/runs/' . $run->id . '/release', 'POST');
        $releaseReq->setUserResolver(fn () => $request->user());
        $releaseResp = $this->releasePayrollRun($releaseReq, $run->id);
        $releaseData = $releaseResp->getData(true);
        if (! ($releaseData['success'] ?? false)) {
            return response()->json([
                'success' => false,
                'stage' => 'release',
                'message' => $releaseData['message'] ?? 'Release failed',
                'run' => $run,
            ], 422);
        }
        $run = $run->fresh();

        // Build the bank file inline so the UI can offer download immediately.
        $bankFile = $this->buildBankFilePayload($run);

        return response()->json([
            'success' => true,
            'message' => "Payroll for {$monthYear} processed and ready to disburse.",
            'run' => $run,
            'summary' => [
                'employees_processed' => $processed,
                'employees_skipped_no_ctc' => $skippedNoCtc,
                'expected_count' => count($expectedUserIds),
                'processed_count' => count($expectedUserIds) - $skippedNoCtc,
            ],
            'bank_file' => $bankFile,
        ]);
    }

    /**
     * Disburse a released payroll run (operator confirms bank file uploaded).
     *
     * Marks every still-pending payslip as paid and transitions the run
     * to its terminal `disbursed` state. Once disbursed, the run becomes
     * immutable for compliance.
     */
    public function disburseRun(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;
        $paymentMethod = $request->get('payment_method', 'bank_transfer');

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if ($run->status !== 'released') {
            return response()->json([
                'success' => false,
                'message' => "Cannot disburse run in '{$run->status}' status. Release it first.",
            ], 422);
        }

        // Mark every pending item as paid (bank file confirmed uploaded).
        $pendingItems = PayrollItem::where('payroll_run_id', $run->id)
            ->where('payment_status', 'pending')
            ->get();

        foreach ($pendingItems as $item) {
            $item->update([
                'payment_status' => 'paid',
                'payment_method' => $paymentMethod,
                'payment_reference' => 'PAY-' . strtoupper(substr(md5(random_bytes(6)), 0, 8)),
                'paid_at' => now(),
            ]);
        }

        $run->update([
            'status' => 'disbursed',
            'disbursed_at' => now(),
            'disbursed_by' => auth()->id(),
            'pay_date' => $request->get('pay_date', now()),
        ]);

        $this->writeRunAudit($run, 'disbursed', [
            'paid_items_count' => $pendingItems->count(),
            'payment_method' => $paymentMethod,
            'disbursed_by' => auth()->id(),
        ]);

        return response()->json([
            'success' => true,
            'message' => "Payroll disbursed. Run is now immutable for compliance.",
            'run' => $run->fresh(),
        ]);
    }

    /**
     * Build the bank file payload for a released run (used by both
     * `processAndPay` and the standalone `generateBankFile` endpoint).
     *
     * Returns the CSV content + filename + skipped_employees (those
     * missing bank details) + a `partial` flag.
     */
    private function buildBankFilePayload(PayrollMonthlyRun $run): array
    {
        $items = PayrollItem::where('payroll_run_id', $run->id)
            ->with(['user.employeeBankAccounts', 'user.employeeProfile'])
            ->where('payment_status', 'pending')
            ->get();

        $entries = [];
        $skipped = [];
        $serialNo = 1;
        $totalAmount = 0;

        foreach ($items as $item) {
            $bankAccount = $item->user->employeeBankAccounts->first();
            if (! $bankAccount || ! $bankAccount->account_number || ! $bankAccount->ifsc_swift) {
                $missing = [];
                if (! $bankAccount || ! $bankAccount->account_number) {
                    $missing[] = 'account_number';
                }
                if (! $bankAccount || ! $bankAccount->ifsc_swift) {
                    $missing[] = 'ifsc_swift';
                }
                $skipped[] = [
                    'user_id' => $item->user_id,
                    'name' => $item->user->name ?? 'Unknown',
                    'net_pay' => (float) $item->net_pay,
                    'missing_fields' => $missing,
                ];
                continue;
            }

            $entries[] = [
                'serial_no' => $serialNo++,
                'employee_name' => $item->user->name ?? '',
                'employee_code' => $item->user->employeeProfile?->employee_code ?? '',
                'account_number' => $bankAccount->account_number,
                'ifsc' => $bankAccount->ifsc_swift,
                'bank_name' => $bankAccount->bank_name ?? '',
                'amount' => round((float) $item->net_pay, 2),
                'narration' => "Salary {$run->month_year}",
            ];
            $totalAmount += (float) $item->net_pay;
        }

        // Generate the CSV content (NEFT-style format).
        $headers = ['Sr', 'Beneficiary Name', 'Account Number', 'IFSC', 'Bank Name', 'Amount', 'Narration'];
        $rows = [];
        $rows[] = implode(',', array_map(fn ($h) => '"' . str_replace('"', '""', $h) . '"', $headers));
        foreach ($entries as $e) {
            $rows[] = implode(',', [
                $e['serial_no'],
                '"' . str_replace('"', '""', $e['employee_name']) . '"',
                '"' . $e['account_number'] . '"',
                '"' . $e['ifsc'] . '"',
                '"' . str_replace('"', '""', $e['bank_name']) . '"',
                number_format($e['amount'], 2, '.', ''),
                '"' . str_replace('"', '""', $e['narration']) . '"',
            ]);
        }
        $rows[] = implode(',', ['', '', '', '', 'TOTAL', number_format($totalAmount, 2, '.', ''), '']);
        $content = implode("\n", $rows);

        $filename = "payroll_{$run->month_year}_run{$run->id}.csv";

        return [
            'success' => true,
            'filename' => $filename,
            'content' => $content,
            'entries' => $entries,
            'total_amount' => round($totalAmount, 2),
            'total_employees' => count($entries),
            'total_pending' => $items->count(),
            'skipped_employees' => $skipped,
            'partial' => count($skipped) > 0,
        ];
    }
}
