<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeePayrollTemplate;
use App\Models\Group;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
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
            'conveyance_allowance' => 'nullable|numeric|min:0',
            'pf_enabled' => 'nullable|boolean',
            'esi_enabled' => 'nullable|boolean',
            'pt_enabled' => 'nullable|boolean',
            'tds_enabled' => 'nullable|boolean',
            'lwf_enabled' => 'nullable|boolean',
            'pf_above_cap' => 'nullable|boolean',
            'pt_state' => 'nullable|string',
            'tax_regime' => 'nullable|in:new,old',
            'is_metro_city' => 'nullable|boolean',
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
                'conveyance_allowance',
                'pf_enabled',
                'esi_enabled',
                'pt_enabled',
                'tds_enabled',
                'lwf_enabled',
                'pf_above_cap',
                'pt_state',
                'tax_regime',
                'is_metro_city',
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

        // Immutability: reject if the run is already paid or released.
        $existingRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $request->month_year)
            ->first();
        if ($existingRun && in_array($existingRun->status, ['paid', 'released'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot process payroll — run for {$request->month_year} is already {$existingRun->status} and immutable.",
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

        // Apply deductions based on template settings (use custom percentages from template)
        // PF: calculateEmployeePF already applies the rate, so don't multiply again
        $pfAmount = $template->pf_enabled 
            ? $this->calculator->calculateEmployeePF($template->pf_above_cap ? PHP_FLOAT_MAX : $calculation['components']['earnings']['basic']) 
            : 0;
        $esiAmount = $template->esi_enabled && $calculation['monthly']['gross'] <= ($template->esi_threshold ?? 21000) 
            ? $calculation['monthly']['gross'] * ($template->esi_employee_percentage / 100) 
            : 0;
        $ptAmount = $template->pt_enabled 
            ? \App\Services\PTStateService::calculate($template->pt_state ?? 'maharashtra', $calculation['monthly']['gross']) 
            : 0;
        $tdsAmount = $template->tds_enabled 
            ? $calculation['components']['deductions']['tds'] 
            : 0;

        // Calculate LOP deduction
        $lOPDeduction = $calculation['monthly']['gross'] > 0 && $workingDays > 0
            ? ($calculation['monthly']['gross'] / $workingDays) * $lOPDays
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
        $grossWithOT = $calculation['monthly']['gross'] + $overtimePay;
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

        // Early check: if the run is paid/released, abort the whole batch
        $existingRun = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $data['month_year'])
            ->first();
        if ($existingRun && in_array($existingRun->status, ['paid', 'released'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot process payroll — run for {$data['month_year']} is already {$existingRun->status} and immutable.",
            ], 422);
        }

        $succeeded = [];
        $failed = [];
        $lOPDays = $data['lOP_days'] ?? 0;
        $overtimeHours = $data['overtime_hours'] ?? 0;

        foreach ($validUserIds as $uid) {
            $template = EmployeePayrollTemplate::getOrCreateForUser($uid, $organizationId);
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
     * Lock a payroll run (prevents further edits)
     */
    public function lockPayrollRun(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if (!in_array($run->status, ['draft', 'processing'])) {
            return response()->json([
                'success' => false,
                'message' => "Cannot lock run in '{$run->status}' status",
            ], 422);
        }

        $run->update([
            'status' => 'locked',
            'notes' => $request->get('notes', $run->notes),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payroll run locked successfully',
            'run' => $run->fresh(),
        ]);
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

        return response()->json([
            'success' => true,
            'message' => 'Payroll run approved successfully',
            'run' => $run->fresh(),
        ]);
    }

    /**
     * Release a payroll run (generates payslips, ready for payment)
     */
    public function releasePayrollRun(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if (!in_array($run->status, ['approved', 'locked'])) {
            return response()->json([
                'success' => false,
                'message' => "Cannot release run in '{$run->status}' status. Must be 'approved' first.",
            ], 422);
        }

        // Check for employees missing bank details
        $employeesMissingBankDetails = PayrollItem::where('payroll_run_id', $run->id)
            ->whereHas('user', function ($q) {
                $q->whereDoesntHave('employeeBankAccounts', function ($q2) {
                    $q2->whereNotNull('account_number')
                        ->whereNotNull('ifsc_swift');
                });
            })
            ->with(['user:id,name'])
            ->get();

        if ($employeesMissingBankDetails->count() > 0) {
            $employeeNames = $employeesMissingBankDetails->pluck('user.name')->implode(', ');
            return response()->json([
                'success' => false,
                'message' => "Cannot release payroll. {$employeesMissingBankDetails->count()} employee(s) missing bank details: {$employeeNames}",
                'employees_missing_bank_details' => $employeesMissingBankDetails->map(fn($item) => [
                    'id' => $item->user_id,
                    'name' => $item->user->name,
                ]),
            ], 422);
        }

        $run->update([
            'status' => 'released',
            'notes' => $request->get('notes', $run->notes),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payroll run released successfully',
            'run' => $run->fresh(),
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
     * Process payment for a payroll run (marks all items as paid)
     */
    public function processRunPayment(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

        if (!in_array($run->status, ['released', 'approved'])) {
            return response()->json([
                'success' => false,
                'message' => "Cannot process payment for run in '{$run->status}' status. Release it first.",
            ], 422);
        }

        $paymentMethod = $request->get('payment_method', 'bank_transfer');

        // Update all pending items to paid
        PayrollItem::where('payroll_run_id', $run->id)
            ->where('payment_status', 'pending')
            ->update([
                'payment_status' => 'paid',
                'payment_method' => $paymentMethod,
                'payment_reference' => DB::raw("CONCAT('PAY-', UPPER(SUBSTRING(MD5(RAND()), 1, 8)))"),
                'paid_at' => now(),
            ]);

        $run->update([
            'status' => 'paid',
            'pay_date' => $request->get('pay_date', now()),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Payment processed for all employees',
            'run' => $run->fresh(),
        ]);
    }

    /**
     * Generate bank file (NEFT/RTGS format)
     */
    public function generateBankFile(Request $request, int $runId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('id', $runId)
            ->firstOrFail();

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
}
