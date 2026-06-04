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
        $departments = Group::where('organization_id', $organizationId)
            ->where('is_active', true)
            ->get()
            ->map(function ($dept) use ($organizationId, $monthYear) {
                // Count users in this department via group_user pivot table
                $employeeCount = DB::table('group_user')
                    ->join('users', 'group_user.user_id', '=', 'users.id')
                    ->where('group_user.group_id', $dept->id)
                    ->whereIn('users.role', ['employee', 'manager', 'admin'])
                    ->where('users.organization_id', $organizationId)
                    ->count();

                // Get payroll stats for this department
                $payrollStats = PayrollItem::where('organization_id', $organizationId)
                    ->where('department_id', $dept->id)
                    ->whereHas('payrollRun', function ($q) use ($monthYear) {
                        $q->where('month_year', $monthYear);
                    })
                    ->select(
                        DB::raw('COUNT(*) as processed_count'),
                        DB::raw('SUM(net_pay) as total_net_pay'),
                        DB::raw("SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_count")
                    )
                    ->first();

                return [
                    'id' => $dept->id,
                    'name' => $dept->name,
                    'employee_count' => $employeeCount,
                    'processed_count' => $payrollStats->processed_count ?? 0,
                    'paid_count' => $payrollStats->paid_count ?? 0,
                    'total_net_pay' => $payrollStats->total_net_pay ?? 0,
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

        $employees = $query->get()->map(function ($user) use ($monthYear, $organizationId) {
            // Get time tracking data for the month
            $timeData = $this->getTimeTrackingData($user->id, $monthYear);

            // Get payroll data for the month
            $payrollItem = PayrollItem::where('user_id', $user->id)
                ->whereHas('payrollRun', function ($q) use ($monthYear) {
                    $q->where('month_year', $monthYear);
                })
                ->first();

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
                ]
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

        // Calculate payroll
        $calculation = $this->calculator->calculatePayroll(
            annualCtc: (float) $request->annual_ctc,
            stateCode: $template->pt_state ?? 'maharashtra',
            isMetroCity: $template->is_metro_city,
            taxRegime: $template->tax_regime,
            customConfig: [
                'basic_percentage' => $template->basic_percentage / 100,
                'hra_percentage_of_basic' => $template->hra_percentage / 100,
                'conveyance_allowance' => $template->conveyance_allowance,
            ]
        );

        // Apply deductions based on template settings
        $pfAmount = $template->pf_enabled ? $calculation['components']['deductions']['pf_employee'] : 0;
        $esiAmount = $template->esi_enabled ? $calculation['components']['deductions']['esi_employee'] : 0;
        $ptAmount = $template->pt_enabled ? $calculation['components']['deductions']['pt'] : 0;
        $tdsAmount = $template->tds_enabled ? $calculation['components']['deductions']['tds'] : 0;

        // Calculate LOP deduction
        $lOPDays = $request->lOP_days ?? 0;
        $lOPDeduction = ($calculation['monthly']['gross'] / $request->working_days) * $lOPDays;

        // Calculate overtime pay (assuming 2x rate)
        $overtimeHours = $request->overtime_hours ?? 0;
        $hourlyRate = $calculation['monthly']['gross'] / ($request->working_days * 8);
        $overtimePay = $overtimeHours * $hourlyRate * 2;

        // Get time tracking data
        $timeData = $this->getTimeTrackingData($userId, $request->month_year);

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
                'days_absent' => $request->working_days - $request->days_present - $lOPDays,
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
                'gross_salary' => $calculation['monthly']['gross'] + $overtimePay,
                'pf_employee' => $pfAmount,
                'esi_employee' => $esiAmount,
                'pt' => $ptAmount,
                'tds' => $tdsAmount,
                'lOP_deduction' => $lOPDeduction,
                'total_deductions' => $pfAmount + $esiAmount + $ptAmount + $tdsAmount + $lOPDeduction,
                'pf_employer' => $template->pf_enabled ? $calculation['components']['employer_contributions']['pf_employer'] : 0,
                'eps' => $template->pf_enabled ? $calculation['components']['employer_contributions']['eps'] : 0,
                'epf' => $template->pf_enabled ? $calculation['components']['employer_contributions']['epf'] : 0,
                'esi_employer' => $template->esi_enabled ? $calculation['components']['employer_contributions']['esi_employer'] : 0,
                'gratuity' => $calculation['components']['employer_contributions']['gratuity'],
                'total_employer_contributions' => ($template->pf_enabled ? $calculation['components']['employer_contributions']['pf_employer'] : 0)
                    + ($template->esi_enabled ? $calculation['components']['employer_contributions']['esi_employer'] : 0)
                    + $calculation['components']['employer_contributions']['gratuity'],
                'net_pay' => $calculation['monthly']['gross'] + $overtimePay - ($pfAmount + $esiAmount + $ptAmount + $tdsAmount + $lOPDeduction),
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
     * Get time tracking data for an employee
     */
    private function getTimeTrackingData(int $userId, string $monthYear): array
    {
        $dates = explode('-', $monthYear);
        $year = $dates[0];
        $month = $dates[1];

        $startDate = Carbon::create($year, $month, 1)->startOfMonth();
        $endDate = $startDate->copy()->endOfMonth();

        // Get time entries
        $timeEntries = TimeEntry::where('user_id', $userId)
            ->whereBetween('start_time', [$startDate, $endDate])
            ->get();

        $totalWorkedSeconds = $timeEntries->sum('duration');
        
        // Get activity data if available
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
}
