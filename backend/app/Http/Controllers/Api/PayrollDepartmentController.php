<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\EmployeePayrollTemplate;
use App\Models\Group;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\TimeEntry;
use App\Models\User;
use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayrollDepartmentController extends Controller
{
    protected PayrollCalculatorService $calculator;

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
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

        // Handle unassigned employees (departmentId = 0)
        if ($departmentId === 0) {
            // Get users NOT in any group
            $assignedUserIds = DB::table('group_user')
                ->join('groups', 'group_user.group_id', '=', 'groups.id')
                ->where('groups.organization_id', $organizationId)
                ->pluck('group_user.user_id');

            $query = User::where('organization_id', $organizationId)
                ->whereIn('role', ['employee', 'manager', 'admin'])
                ->whereNotIn('id', $assignedUserIds)
                ->with(['employeeProfile', 'employeeWorkInfo', 'employeeBankAccounts']);
        } else {
            // Get employees from specific department
            $query = User::where('organization_id', $organizationId)
                ->whereIn('role', ['employee', 'manager', 'admin'])
                ->whereExists(function ($query) use ($departmentId) {
                    $query->select(DB::raw(1))
                        ->from('group_user')
                        ->whereColumn('group_user.user_id', 'users.id')
                        ->where('group_user.group_id', $departmentId);
                })
                ->with(['employeeProfile', 'employeeWorkInfo', 'employeeBankAccounts']);
        }

        if ($search) {
            $query->where(function ($q) use ($search) {
                $q->where('name', 'like', "%{$search}%")
                    ->orWhere('email', 'like', "%{$search}%");
            });
        }

        $employees = $query->get();

        // Eager load payroll items for all employees in one query (fix N+1)
        $userIds = $employees->pluck('id');
        $payrollItems = PayrollItem::whereIn('user_id', $userIds)
            ->whereHas('payrollRun', function ($q) use ($monthYear) {
                $q->where('month_year', $monthYear);
            })
            ->get()
            ->keyBy('user_id');

        $employees = $employees->map(function ($user) use ($monthYear, $organizationId, $payrollItems) {
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

            return [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
                'role' => $user->role,
                'avatar' => $user->avatar,
                'employee_code' => $user->employeeWorkInfo?->employee_code,
                'designation' => $user->employeeWorkInfo?->designation,
                'joining_date' => $user->employeeWorkInfo?->joining_date,
                
                // Time Tracking Data
                'time_tracking' => $timeData,
                
                // Payroll Status
                'payroll_status' => $payrollItem ? [
                    'is_processed' => true,
                    'net_pay' => $payrollItem->net_pay,
                    'payment_status' => $payrollItem->payment_status,
                    'gross_salary' => $payrollItem->gross_salary,
                    'total_deductions' => $payrollItem->total_deductions,
                ] : [
                    'is_processed' => false,
                    'net_pay' => 0,
                    'payment_status' => 'pending',
                    'gross_salary' => 0,
                    'total_deductions' => 0,
                ],
                
                // Template Info
                'has_template' => true,
                'template_id' => $template->id,
                'annual_ctc' => $template->annual_ctc ?? 0,
                'basic_percentage' => $template->basic_percentage,
                'hra_percentage' => $template->hra_percentage,
                'conveyance_allowance' => $template->conveyance_allowance,
                'pf_enabled' => $template->pf_enabled,
                'esi_enabled' => $template->esi_enabled,
                'pt_enabled' => $template->pt_enabled,
                'tds_enabled' => $template->tds_enabled,
            ];
        });

        return response()->json([
            'department_id' => $departmentId,
            'department_name' => $departmentId === 0 ? 'Unassigned' : null,
            'employees' => $employees,
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

        // Get time tracking data
        $timeData = $this->getTimeTrackingData($userId, $monthYear);

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
            'template' => $template,
            'existing_payroll' => $payrollItem,
            'payroll_preview' => $payrollPreview,
            'month_year' => $monthYear,
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
            'month_year' => 'required|string',
            'annual_ctc' => 'required|numeric|min:0',
            'working_days' => 'required|integer|min:1',
            'days_present' => 'required|integer|min:0',
            'lOP_days' => 'nullable|numeric|min:0',
            'overtime_hours' => 'nullable|numeric|min:0',
        ]);

        $organizationId = $request->user()->organization_id;

        $user = User::where('organization_id', $organizationId)
            ->where('id', $userId)
            ->firstOrFail();

        $template = EmployeePayrollTemplate::getOrCreateForUser($userId, $organizationId);

        // Save annual_ctc to template for future use
        $template->update(['annual_ctc' => $request->annual_ctc]);

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
        $lOPDays = $request->lOP_days ?? 0;
        $lOPDeduction = $calculation['monthly']['gross'] > 0 && $request->working_days > 0
            ? ($calculation['monthly']['gross'] / $request->working_days) * $lOPDays
            : 0;

        // Calculate overtime pay (assuming 2x rate)
        $overtimeHours = $request->overtime_hours ?? 0;
        $hourlyRate = $request->working_days > 0
            ? $calculation['monthly']['gross'] / ($request->working_days * 8)
            : 0;
        $overtimePay = $overtimeHours * $hourlyRate * 2;

        // Get time tracking data (merge main TimeEntry + PayrollTimeEntry)
        $timeData = $this->getTimeTrackingData($userId, $request->month_year);

        // Prevent negative days
        $daysAbsent = max(0, $request->working_days - $request->days_present - $lOPDays);

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
                'organization_id' => $organizationId,
                'department_id' => $departmentId,
                'total_working_days' => $request->working_days,
                'days_present' => $request->days_present,
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
                'custom_deductions' => $customDeductions,
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

        return response()->json([
            'success' => true,
            'message' => 'Payroll processed successfully',
            'payroll_item' => $payrollItem->fresh(),
        ]);
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

        $totalWorkedSeconds = $timeEntries->sum('duration');
        
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

        foreach ($items as $item) {
            $bankAccount = $item->user->employeeBankAccounts->first();
            if (!$bankAccount || !$bankAccount->account_number || !$bankAccount->ifsc_swift) {
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
