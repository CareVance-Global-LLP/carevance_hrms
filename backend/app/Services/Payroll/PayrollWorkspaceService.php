<?php

namespace App\Services\Payroll;

use App\Models\AttendanceRecord;
use App\Models\AttendanceTimeEditRequest;
use App\Models\EmployeeSalaryAssignment;
use App\Models\LeaveRequest;
use App\Models\PayRun;
use App\Models\PayRunItem;
use App\Models\Payroll;
use App\Models\PayrollAdjustment;
use App\Models\PayrollAuditLog;
use App\Models\PayrollProfile;
use App\Models\PayrollSetting;
use App\Models\PayrollTaxDeclaration;
use App\Models\Payslip;
use App\Models\ReportGroup;
use App\Models\Reimbursement;
use App\Models\SalaryComponent;
use App\Models\SalaryTemplate;
use App\Models\SalaryTemplateComponent;
use App\Models\TimeEntry;
use App\Models\User;
use Carbon\Carbon;
use Illuminate\Support\Collection;

class PayrollWorkspaceService
{
    public function __construct(
        private readonly PayRunApprovalService $payRunApprovalService,
        private readonly PayrollComplianceService $payrollComplianceService,
        private readonly PayrollDomainService $payrollDomainService,
        private readonly PayrollTaxDeclarationService $payrollTaxDeclarationService,
    ) {
    }

    public function syncPayRunForMonth(int $organizationId, string $payrollMonth, ?int $actorUserId = null): ?PayRun
    {
        $this->ensureDefaultSetup($organizationId);

        $records = Payroll::query()
            ->with(['user', 'transactions'])
            ->where('organization_id', $organizationId)
            ->where('payroll_month', $payrollMonth)
            ->orderBy('user_id')
            ->get();

        if ($records->isEmpty()) {
            return null;
        }

        $run = PayRun::query()->updateOrCreate(
            ['organization_id' => $organizationId, 'run_code' => $this->runCode($payrollMonth)],
            [
                'payroll_month' => $payrollMonth,
                'status' => $this->deriveRunStatus($records),
                'currency' => (string) config('payroll.default_currency', 'INR'),
                'generated_by' => $actorUserId,
                'generated_at' => now(),
                'approval_config' => $this->payRunApprovalService->defaultWorkflow(),
            ]
        );
        $this->payRunApprovalService->syncDefaults($run, $run->approval_config ?: []);

        foreach ($records as $record) {
            $profile = PayrollProfile::query()
                ->where('organization_id', $organizationId)
                ->where('user_id', $record->user_id)
                ->first();
            $attendance = $this->attendanceSummary($organizationId, (int) $record->user_id, $payrollMonth);
            $warnings = $this->employeeWarnings($record->user, $profile, $attendance);

            PayRunItem::query()->updateOrCreate(
                ['pay_run_id' => $run->id, 'user_id' => $record->user_id],
                [
                    'organization_id' => $organizationId,
                    'payroll_id' => $record->id,
                    'payroll_profile_id' => $profile?->id,
                    'payable_days' => (float) $attendance['payable_days'],
                    'worked_seconds' => (int) $attendance['worked_seconds'],
                    'overtime_seconds' => (int) $attendance['overtime_seconds'],
                    'approved_leave_days' => (float) $attendance['approved_leave_days'],
                    'approved_time_edit_seconds' => (int) $attendance['approved_time_edit_seconds'],
                    'gross_pay' => round((float) ($record->gross_salary ?: ((float) $record->basic_salary + (float) $record->allowances + (float) $record->bonus)), 2),
                    'total_deductions' => round((float) $record->deductions + (float) $record->tax, 2),
                    'net_pay' => (float) $record->net_salary,
                    'status' => (string) $record->payroll_status,
                    'payout_status' => (string) $record->payout_status,
                    'salary_breakdown' => $record->salary_breakdown ?: [
                        'basic_salary' => (float) $record->basic_salary,
                        'allowances' => (float) $record->allowances,
                        'bonus' => (float) $record->bonus,
                        'deductions' => (float) $record->deductions,
                        'tax' => (float) $record->tax,
                    ],
                    'adjustment_breakdown' => $record->adjustment_breakdown,
                    'compliance_breakdown' => $record->compliance_breakdown,
                    'attendance_summary' => $record->attendance_summary ?: $attendance,
                    'warnings' => array_values(array_unique(array_merge($warnings, $record->warnings ?: []))),
                ]
            );
        }

        $items = $run->items()->get();
        $run->summary = [
            'gross_payroll' => round($items->sum('gross_pay'), 2),
            'net_payroll' => round($items->sum('net_pay'), 2),
            'employees_count' => $items->count(),
            'paid_count' => $items->where('status', 'paid')->count(),
            'failed_payouts' => $items->where('payout_status', 'failed')->count(),
            'pending_payouts' => $items->where('payout_status', 'pending')->count(),
            'overtime_seconds' => (int) $items->sum('overtime_seconds'),
        ];
        $run->warnings = $items
            ->filter(fn (PayRunItem $item) => !empty($item->warnings))
            ->map(fn (PayRunItem $item) => ['user_id' => $item->user_id, 'warnings' => $item->warnings])
            ->values()
            ->all();
        $run->status = $this->deriveRunStatus($records);
        $run->approval_summary = [
            'timeline' => $this->payRunApprovalService->timeline($run),
        ];
        $run->save();

        return $run->fresh(['items.user', 'items.payroll.transactions', 'approvals.actor', 'generatedBy', 'approvedBy']);
    }

    public function overview(User $user, string $payrollMonth): array
    {
        $run = $this->syncPayRunForMonth((int) $user->organization_id, $payrollMonth, $user->id);
        $records = Payroll::query()
            ->with('user')
            ->where('organization_id', $user->organization_id)
            ->where('payroll_month', $payrollMonth)
            ->get();

        $pendingActions = [
            'leave_requests' => LeaveRequest::query()->where('organization_id', $user->organization_id)->where('status', 'pending')->count(),
            'attendance_time_edits' => AttendanceTimeEditRequest::query()->where('organization_id', $user->organization_id)->where('status', 'pending')->count(),
            'payroll_adjustments' => PayrollAdjustment::query()->where('organization_id', $user->organization_id)->where('status', 'pending_approval')->count(),
        ];

        return [
            'month' => $payrollMonth,
            'summary' => [
                'gross_payroll' => round($records->sum(fn (Payroll $row) => (float) $row->basic_salary + (float) $row->allowances + (float) $row->bonus), 2),
                'net_payroll' => round($records->sum('net_salary'), 2),
                'employees_in_current_run' => $records->count(),
                'pending_approvals' => array_sum($pendingActions),
                'paid_count' => $records->where('payroll_status', 'paid')->count(),
                'failed_or_pending_payouts' => $records->filter(fn (Payroll $row) => $row->payout_status !== 'success')->count(),
                'total_overtime_value' => 0,
                'reimbursements_pending' => Reimbursement::query()->where('organization_id', $user->organization_id)->whereIn('status', ['draft', 'pending_approval'])->count(),
            ],
            'current_pay_run' => $run,
            'missing_profiles' => $this->workspaceWarnings((int) $user->organization_id, $payrollMonth),
            'recent_transactions' => $this->recentTransactions((int) $user->organization_id, $payrollMonth),
            'pending_actions' => $pendingActions,
            'status_distribution' => [
                'draft' => $records->where('payroll_status', 'draft')->count(),
                'validated' => $records->where('payroll_status', 'validated')->count(),
                'manager_approved' => $records->where('payroll_status', 'manager_approved')->count(),
                'finance_approved' => $records->where('payroll_status', 'finance_approved')->count(),
                'processed' => $records->where('payroll_status', 'processed')->count(),
                'paid' => $records->where('payroll_status', 'paid')->count(),
                'payout_pending' => $records->where('payout_status', 'pending')->count(),
                'payout_failed' => $records->where('payout_status', 'failed')->count(),
                'payout_success' => $records->where('payout_status', 'success')->count(),
            ],
            'quick_links' => [
                'profiles' => PayrollProfile::query()->where('organization_id', $user->organization_id)->count(),
                'templates' => SalaryTemplate::query()->where('organization_id', $user->organization_id)->count(),
                'adjustments' => PayrollAdjustment::query()->where('organization_id', $user->organization_id)->count(),
                'payslips' => Payslip::query()->where('organization_id', $user->organization_id)->where('period_month', $payrollMonth)->count(),
            ],
            'readiness_warnings' => $this->workspaceWarnings((int) $user->organization_id, $payrollMonth),
        ];
    }

    public function runList(User $user, ?string $payrollMonth = null): array
    {
        if ($payrollMonth) {
            $this->syncPayRunForMonth((int) $user->organization_id, $payrollMonth, $user->id);
        }

        return PayRun::query()
            ->withCount('items')
            ->where('organization_id', $user->organization_id)
            ->when($payrollMonth, fn ($query) => $query->where('payroll_month', $payrollMonth))
            ->latest('payroll_month')
            ->latest('id')
            ->get()
            ->map(function (PayRun $run) {
                $summary = $run->summary ?: [];
                return [
                    'id' => $run->id,
                    'run_code' => $run->run_code,
                    'payroll_month' => $run->payroll_month,
                    'status' => $run->status,
                    'currency' => $run->currency,
                    'items_count' => $run->items_count,
                    'gross_payroll' => (float) ($summary['gross_payroll'] ?? 0),
                    'net_payroll' => (float) ($summary['net_payroll'] ?? 0),
                    'paid_count' => (int) ($summary['paid_count'] ?? 0),
                    'failed_payouts' => (int) ($summary['failed_payouts'] ?? 0),
                    'warnings_count' => count($run->warnings ?: []),
                    'generated_at' => optional($run->generated_at)->toIso8601String(),
                    'locked_at' => optional($run->locked_at)->toIso8601String(),
                    'approval_summary' => $run->approval_summary ?: [],
                ];
            })
            ->values()
            ->all();
    }

    public function runDetail(User $user, int $runId): ?array
    {
        $run = PayRun::query()
            ->with(['items.user', 'items.payroll.transactions', 'items.payrollProfile.salaryTemplate.components.component', 'approvals.actor', 'generatedBy', 'approvedBy'])
            ->where('organization_id', $user->organization_id)
            ->find($runId);

        if (!$run) {
            return null;
        }

        return [
            'run' => $run,
            'summary' => $run->summary ?: [],
            'warnings' => $run->warnings ?: [],
            'approval_timeline' => $this->payRunApprovalService->timeline($run),
        ];
    }

    public function attendanceSummary(int $organizationId, int $userId, string $payrollMonth): array
    {
        [$start, $end] = $this->monthWindow($payrollMonth);
        $shiftTarget = max(1, (int) env('ATTENDANCE_SHIFT_SECONDS', 8 * 3600));
        $setting = PayrollSetting::query()->where('organization_id', $organizationId)->first();
        $approvedLeaveCountsAsPayable = (bool) data_get($setting?->leave_mapping, 'approved_leave_counts_as_payable_day', true);
        $overtimeEnabled = (bool) data_get($setting?->overtime_rules, 'enabled', true);

        $records = AttendanceRecord::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->whereDate('attendance_date', '>=', $start->toDateString())
            ->whereDate('attendance_date', '<=', $end->toDateString())
            ->get();

        $approvedLeaves = LeaveRequest::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->whereDate('start_date', '<=', $end->toDateString())
            ->whereDate('end_date', '>=', $start->toDateString())
            ->get(['start_date', 'end_date', 'leave_type']);

        $approvedLeaveDays = (float) $approvedLeaves
            ->sum(fn (LeaveRequest $leave) => $leave->effectiveUnitsInRange($start, $end));

        $approvedTimeEditSeconds = (int) AttendanceTimeEditRequest::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('status', 'approved')
            ->whereDate('attendance_date', '>=', $start->toDateString())
            ->whereDate('attendance_date', '<=', $end->toDateString())
            ->sum('extra_seconds');

        $workedSeconds = (int) $records->sum(fn (AttendanceRecord $record) => (int) ($record->worked_seconds ?? 0) + (int) ($record->manual_adjustment_seconds ?? 0));
        if ($workedSeconds <= 0) {
            $workedSeconds = (int) TimeEntry::query()
                ->where('user_id', $userId)
                ->whereBetween('start_time', [$start->toDateTimeString(), $end->copy()->endOfDay()->toDateTimeString()])
                ->sum('duration');
        }
        $overtimeSeconds = (int) $records->sum(
            fn (AttendanceRecord $record) => max(0, ((int) ($record->worked_seconds ?? 0) + (int) ($record->manual_adjustment_seconds ?? 0)) - $shiftTarget)
        );

        return [
            'period_start' => $start->toDateString(),
            'period_end' => $end->toDateString(),
            'present_days' => $records->filter(fn (AttendanceRecord $record) => !empty($record->check_in_at))->count(),
            'approved_leave_days' => $approvedLeaveDays,
            'approved_time_edit_seconds' => $approvedTimeEditSeconds,
            'payable_days' => round(
                $records->filter(fn (AttendanceRecord $record) => !empty($record->check_in_at))->count()
                + ($approvedLeaveCountsAsPayable ? $approvedLeaveDays : 0),
                2
            ),
            'worked_seconds' => $workedSeconds,
            'overtime_seconds' => $overtimeEnabled ? $overtimeSeconds : 0,
            'attendance_records_count' => $records->count(),
            'has_attendance_summary' => $records->isNotEmpty() || $workedSeconds > 0,
        ];
    }

    public function workspaceWarnings(int $organizationId, string $payrollMonth): array
    {
        return User::query()
            ->where('organization_id', $organizationId)
            ->where('role', 'employee')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'organization_id'])
            ->map(function (User $employee) use ($organizationId, $payrollMonth) {
                $profile = PayrollProfile::query()
                    ->where('organization_id', $organizationId)
                    ->where('user_id', $employee->id)
                    ->first();
                $attendance = $this->attendanceSummary($organizationId, (int) $employee->id, $payrollMonth);

                return [
                    'user_id' => $employee->id,
                    'name' => $employee->name,
                    'email' => $employee->email,
                    'warnings' => $this->employeeWarnings($employee, $profile, $attendance),
                ];
            })
            ->filter(fn (array $item) => count($item['warnings']) > 0)
            ->values()
            ->all();
    }

    public function employeeWarningsForUser(int $organizationId, User $employee, string $payrollMonth): array
    {
        $profile = PayrollProfile::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $employee->id)
            ->first();
        $attendance = $this->attendanceSummary($organizationId, (int) $employee->id, $payrollMonth);

        return $this->employeeWarnings($employee, $profile, $attendance);
    }

    public function reports(User $user, string $payrollMonth): array
    {
        $run = $this->syncPayRunForMonth((int) $user->organization_id, $payrollMonth, $user->id);
        $items = $run?->items()->with('user')->get() ?? collect();

        return [
            'monthly_summary' => $run?->summary ?: [],
            'monthly_trend' => $this->reportMonthlyTrend((int) $user->organization_id),
            'employee_payroll_sheet' => $items->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'payable_days' => (float) $item->payable_days,
                'worked_seconds' => (int) $item->worked_seconds,
                'overtime_seconds' => (int) $item->overtime_seconds,
                'gross_pay' => (float) $item->gross_pay,
                'total_deductions' => (float) $item->total_deductions,
                'net_pay' => (float) $item->net_pay,
                'status' => $item->status,
                'payout_status' => $item->payout_status,
            ])->values(),
            'department_payroll_cost' => ReportGroup::query()
                ->with('users:id,name')
                ->where('organization_id', $user->organization_id)
                ->get()
                ->map(function (ReportGroup $group) use ($items) {
                    $groupItems = $items->whereIn('user_id', $group->users->pluck('id')->all());
                    return [
                        'id' => $group->id,
                        'name' => $group->name,
                        'employee_count' => $groupItems->count(),
                        'gross_pay' => round($groupItems->sum('gross_pay'), 2),
                        'net_pay' => round($groupItems->sum('net_pay'), 2),
                    ];
                })
                ->values(),
            'deductions_report' => $items->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'deductions' => (float) ($item->salary_breakdown['deductions'] ?? 0),
                'tax' => (float) ($item->salary_breakdown['tax'] ?? 0),
                'tds' => (float) data_get($item->compliance_breakdown, 'totals.tds', 0),
                'pf_employee' => (float) data_get(collect(data_get($item->compliance_breakdown, 'employee', []))->firstWhere('code', 'PF_EMPLOYEE'), 'amount', 0),
                'esi_employee' => (float) data_get(collect(data_get($item->compliance_breakdown, 'employee', []))->firstWhere('code', 'ESI_EMPLOYEE'), 'amount', 0),
                'total_deductions' => (float) $item->total_deductions,
            ])->values(),
            'tax_report' => $items->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'tax_regime' => data_get($item->compliance_breakdown, 'tax_estimate.tax_regime'),
                'monthly_tds' => (float) data_get($item->compliance_breakdown, 'totals.tds', 0),
                'annual_tax' => (float) data_get($item->compliance_breakdown, 'tax_estimate.annual_tax', 0),
            ])->values(),
            'compliance_report' => $items->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'employee_deductions' => (float) data_get($item->compliance_breakdown, 'totals.employee_deductions', 0),
                'employer_contributions' => (float) data_get($item->compliance_breakdown, 'totals.employer_contributions', 0),
                'tds' => (float) data_get($item->compliance_breakdown, 'totals.tds', 0),
            ])->values(),
            'payout_status_report' => $items->groupBy('payout_status')->map(fn (Collection $group, string $status) => [
                'status' => $status,
                'count' => $group->count(),
                'amount' => round($group->sum('net_pay'), 2),
            ])->values(),
            'payout_bank_advice' => $items->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'net_pay' => (float) $item->net_pay,
                'payout_status' => $item->payout_status,
                'payment_reference' => $item->payroll?->payment_reference,
            ])->values(),
            'attendance_vs_payable_days' => $items->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'payable_days' => (float) $item->payable_days,
                'attendance_present_days' => (int) ($item->attendance_summary['present_days'] ?? 0),
                'approved_leave_days' => (int) ($item->attendance_summary['approved_leave_days'] ?? 0),
                'worked_seconds' => (int) $item->worked_seconds,
                'difference' => round((float) $item->payable_days - ((int) ($item->attendance_summary['present_days'] ?? 0) + (int) ($item->attendance_summary['approved_leave_days'] ?? 0)), 2),
            ])->values(),
            'overtime_summary' => $items->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'overtime_seconds' => (int) $item->overtime_seconds,
            ])->values(),
            'component_totals' => $this->reportComponentTotals($items),
            'payout_history' => $this->reportPayoutHistory((int) $user->organization_id, $payrollMonth),
            'failed_payout_report' => $this->reportFailedPayouts($items),
        ];
    }

    public function settingsForOrganization(int $organizationId): PayrollSetting
    {
        $this->ensureDefaultSetup($organizationId);

        $setting = PayrollSetting::query()->firstOrCreate(
            ['organization_id' => $organizationId],
            $this->defaultPayrollSettings()
        );

        foreach ($this->defaultPayrollSettings() as $key => $value) {
            if (empty($setting->{$key})) {
                $setting->{$key} = $value;
            }
        }
        $setting->save();

        return $setting->fresh();
    }

    public function applyTemplateAssignment(int $organizationId, int $userId, int $salaryTemplateId, string $effectiveFrom): EmployeeSalaryAssignment
    {
        EmployeeSalaryAssignment::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('is_active', true)
            ->update([
                'is_active' => false,
                'effective_to' => Carbon::parse($effectiveFrom)->copy()->subDay()->toDateString(),
            ]);

        return EmployeeSalaryAssignment::query()->create([
            'organization_id' => $organizationId,
            'user_id' => $userId,
            'salary_template_id' => $salaryTemplateId,
            'effective_from' => $effectiveFrom,
            'effective_to' => null,
            'is_active' => true,
        ]);
    }

    public function resolveSalarySource(int $organizationId, int $userId, string $payrollMonth): array
    {
        $periodStart = $this->periodStart($payrollMonth);
        $assignment = EmployeeSalaryAssignment::query()
            ->with('salaryTemplate.components.component')
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $periodStart->toDateString())
            ->where(function ($query) use ($periodStart) {
                $query->whereNull('effective_to')->orWhereDate('effective_to', '>=', $periodStart->toDateString());
            })
            ->latest('effective_from')
            ->first();

        if ($assignment?->salaryTemplate) {
            return ['source' => 'salary_template', 'template_id' => $assignment->salaryTemplate->id];
        }

        $structure = $this->payrollDomainService->resolvePayrollStructure($organizationId, $userId, $periodStart, null);
        return ['source' => $structure ? 'legacy_structure' : 'none', 'structure_id' => $structure?->id];
    }

    public function compensationSnapshot(int $organizationId, int $userId, string $payrollMonth): array
    {
        $periodStart = $this->periodStart($payrollMonth);
        $assignment = EmployeeSalaryAssignment::query()
            ->with('salaryTemplate.components.component')
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->where('is_active', true)
            ->whereDate('effective_from', '<=', $periodStart->toDateString())
            ->where(function ($query) use ($periodStart) {
                $query->whereNull('effective_to')->orWhereDate('effective_to', '>=', $periodStart->toDateString());
            })
            ->latest('effective_from')
            ->first();

        if ($assignment?->salaryTemplate) {
            return [
                'source' => 'salary_template',
                'snapshot' => $this->salaryTemplateSnapshot($assignment->salaryTemplate),
            ];
        }

        $structure = $this->payrollDomainService->resolvePayrollStructure($organizationId, $userId, $periodStart, null);
        if ($structure) {
            [$allowanceRows, $allowanceTotal] = $this->payrollDomainService->computeComponents($structure->allowances->toArray(), (float) $structure->basic_salary);
            [$deductionRows, $deductionTotal] = $this->payrollDomainService->computeComponents($structure->deductions->toArray(), (float) $structure->basic_salary);
            $netSalary = round((float) $structure->basic_salary + (float) $allowanceTotal - (float) $deductionTotal, 2);

            return [
                'source' => 'legacy_structure',
                'structure' => $structure,
                'snapshot' => [
                    'basic_salary' => round((float) $structure->basic_salary, 2),
                    'allowances' => round((float) $allowanceTotal, 2),
                    'deductions' => round((float) $deductionTotal, 2),
                    'bonus' => 0.0,
                    'tax' => 0.0,
                    'net_salary' => $netSalary,
                    'earnings_components' => $allowanceRows,
                    'deduction_components' => $deductionRows,
                ],
            ];
        }

        return [
            'source' => 'none',
            'snapshot' => [
                'basic_salary' => 0.0,
                'allowances' => 0.0,
                'deductions' => 0.0,
                'bonus' => 0.0,
                'tax' => 0.0,
                'net_salary' => 0.0,
                'earnings_components' => [],
                'deduction_components' => [],
            ],
        ];
    }

    public function logWorkspaceAudit(int $organizationId, ?int $userId, string $action, mixed $target = null, ?array $payload = null): void
    {
        PayrollAuditLog::query()->create([
            'organization_id' => $organizationId,
            'user_id' => $userId,
            'action' => $action,
            'target_type' => is_object($target) ? class_basename($target) : (is_string($target) ? $target : null),
            'target_id' => is_object($target) && property_exists($target, 'id') ? $target->id : null,
            'payload' => $payload,
        ]);
    }

    private function monthWindow(string $payrollMonth): array
    {
        $start = $this->periodStart($payrollMonth);
        return [$start, $start->copy()->endOfMonth()];
    }

    private function periodStart(string $payrollMonth): Carbon
    {
        $normalized = preg_match('/^\d{4}-\d{2}$/', $payrollMonth) ? sprintf('%s-01', $payrollMonth) : $payrollMonth;

        return Carbon::parse($normalized)->startOfMonth();
    }

    private function runCode(string $payrollMonth): string
    {
        return 'RUN-'.str_replace('-', '', $payrollMonth);
    }

    private function deriveRunStatus(Collection $records): string
    {
        if ($records->every(fn (Payroll $record) => $this->payRunApprovalService->mappedStatus((string) $record->payroll_status) === 'paid')) {
            return 'paid';
        }

        if ($records->every(fn (Payroll $record) => in_array($this->payRunApprovalService->mappedStatus((string) $record->payroll_status), ['processed', 'paid'], true))) {
            return 'processed';
        }

        if ($records->every(fn (Payroll $record) => in_array($this->payRunApprovalService->mappedStatus((string) $record->payroll_status), ['finance_approved', 'processed', 'paid'], true))) {
            return 'finance_approved';
        }

        if ($records->every(fn (Payroll $record) => in_array($this->payRunApprovalService->mappedStatus((string) $record->payroll_status), ['manager_approved', 'finance_approved', 'processed', 'paid'], true))) {
            return 'manager_approved';
        }

        if ($records->every(fn (Payroll $record) => in_array($this->payRunApprovalService->mappedStatus((string) $record->payroll_status), ['validated', 'manager_approved', 'finance_approved', 'processed', 'paid'], true))) {
            return 'validated';
        }

        if ($records->every(fn (Payroll $record) => $record->payroll_status === 'paid')) {
            return 'paid';
        }

        if ($records->every(fn (Payroll $record) => in_array($record->payroll_status, ['processed', 'paid'], true))) {
            return 'processed';
        }

        return 'draft';
    }

    private function recentTransactions(int $organizationId, string $payrollMonth): array
    {
        return \App\Models\PayrollTransaction::query()
            ->with('payroll.user')
            ->whereHas('payroll', function ($query) use ($organizationId, $payrollMonth) {
                $query->where('organization_id', $organizationId)
                    ->where('payroll_month', $payrollMonth);
            })
            ->latest()
            ->limit(8)
            ->get()
            ->map(fn ($transaction) => [
                'id' => $transaction->id,
                'provider' => $transaction->provider,
                'status' => $transaction->status,
                'amount' => (float) $transaction->amount,
                'currency' => $transaction->currency,
                'created_at' => optional($transaction->created_at)->toIso8601String(),
                'employee' => $transaction->payroll?->user?->only(['id', 'name', 'email']),
            ])
            ->values()
            ->all();
    }

    private function reportComponentTotals(Collection $items): array
    {
        return collect([
            [
                'component' => 'Basic Salary',
                'category' => 'basic',
                'amount' => round($items->sum(fn (PayRunItem $item) => (float) ($item->salary_breakdown['basic_salary'] ?? 0)), 2),
            ],
            [
                'component' => 'Allowances',
                'category' => 'allowance',
                'amount' => round($items->sum(fn (PayRunItem $item) => (float) ($item->salary_breakdown['allowances'] ?? 0)), 2),
            ],
            [
                'component' => 'Bonus',
                'category' => 'bonus',
                'amount' => round($items->sum(fn (PayRunItem $item) => (float) ($item->salary_breakdown['bonus'] ?? 0)), 2),
            ],
            [
                'component' => 'Deductions',
                'category' => 'deduction',
                'amount' => round($items->sum(fn (PayRunItem $item) => (float) ($item->salary_breakdown['deductions'] ?? 0)), 2),
            ],
            [
                'component' => 'Tax',
                'category' => 'tax',
                'amount' => round($items->sum(fn (PayRunItem $item) => (float) ($item->salary_breakdown['tax'] ?? 0)), 2),
            ],
            [
                'component' => 'Compliance Deductions',
                'category' => 'compliance',
                'amount' => round($items->sum(fn (PayRunItem $item) => (float) data_get($item->compliance_breakdown, 'totals.employee_deductions', 0)), 2),
            ],
            [
                'component' => 'Employer Contributions',
                'category' => 'employer_contribution',
                'amount' => round($items->sum(fn (PayRunItem $item) => (float) data_get($item->compliance_breakdown, 'totals.employer_contributions', 0)), 2),
            ],
        ])
            ->filter(fn (array $row) => $row['amount'] > 0)
            ->values()
            ->all();
    }

    private function reportPayoutHistory(int $organizationId, string $payrollMonth): array
    {
        return \App\Models\PayrollTransaction::query()
            ->with('payroll.user')
            ->whereHas('payroll', function ($query) use ($organizationId, $payrollMonth) {
                $query->where('organization_id', $organizationId)
                    ->where('payroll_month', $payrollMonth);
            })
            ->latest()
            ->limit(25)
            ->get()
            ->map(fn (\App\Models\PayrollTransaction $transaction) => [
                'id' => $transaction->id,
                'user' => $transaction->payroll?->user?->only(['id', 'name', 'email']),
                'provider' => $transaction->provider,
                'transaction_id' => $transaction->transaction_id,
                'created_at' => optional($transaction->created_at)->toIso8601String(),
                'status' => $transaction->status,
                'amount' => (float) $transaction->amount,
                'currency' => $transaction->currency,
            ])
            ->values()
            ->all();
    }

    private function reportFailedPayouts(Collection $items): array
    {
        return $items
            ->filter(fn (PayRunItem $item) => $item->payout_status === 'failed')
            ->map(fn (PayRunItem $item) => [
                'id' => $item->id,
                'user' => $item->user?->only(['id', 'name', 'email']),
                'net_pay' => (float) $item->net_pay,
                'payout_status' => $item->payout_status,
                'warnings' => $item->warnings ?: [],
            ])
            ->values()
            ->all();
    }

    private function reportMonthlyTrend(int $organizationId): array
    {
        return PayRun::query()
            ->where('organization_id', $organizationId)
            ->latest('payroll_month')
            ->latest('id')
            ->limit(6)
            ->get()
            ->map(function (PayRun $run) {
                $summary = $run->summary ?: [];

                return [
                    'month' => $run->payroll_month,
                    'gross_payroll' => (float) ($summary['gross_payroll'] ?? 0),
                    'net_payroll' => (float) ($summary['net_payroll'] ?? 0),
                    'employees_count' => (int) ($summary['employees_count'] ?? 0),
                    'paid_count' => (int) ($summary['paid_count'] ?? 0),
                    'failed_payouts' => (int) ($summary['failed_payouts'] ?? 0),
                ];
            })
            ->values()
            ->all();
    }

    private function employeeWarnings(?User $employee, ?PayrollProfile $profile, array $attendance): array
    {
        $warnings = [];
        $payrollMonth = Carbon::parse($attendance['period_start'])->format('Y-m');
        $salarySource = $employee ? $this->resolveSalarySource((int) $employee->organization_id, (int) $employee->id, $payrollMonth) : ['source' => 'none'];

        if (!$profile) {
            $warnings[] = 'Missing payroll profile';
        }
        if ($profile && empty($profile->payout_method)) {
            $warnings[] = 'Missing payout method';
        }
        if ($profile && empty($profile->pay_group)) {
            $warnings[] = 'Missing pay group';
        }
        if ($profile && empty($profile->payroll_code)) {
            $warnings[] = 'Missing payroll code';
        }
        if ($profile && in_array((string) $profile->payout_method, ['bank_transfer', 'stripe'], true) && empty($profile->bank_account_number) && empty($profile->payment_email)) {
            $warnings[] = 'Missing bank or payment destination details';
        }
        if ($profile && empty($profile->bank_verification_status)) {
            $warnings[] = 'Missing bank verification status';
        }
        if (!($attendance['has_attendance_summary'] ?? false)) {
            $warnings[] = 'Missing attendance summary';
        }
        if (($salarySource['source'] ?? 'none') === 'none') {
            $warnings[] = 'Missing salary structure or template';
        }

        if ($profile && $employee) {
            $settings = $this->settingsForOrganization((int) $employee->organization_id);
            $declaration = PayrollTaxDeclaration::query()
                ->where('organization_id', $employee->organization_id)
                ->where('user_id', $employee->id)
                ->where('financial_year', $this->payrollTaxDeclarationService->financialYearForMonth($payrollMonth))
                ->first();

            $warnings = array_merge(
                $warnings,
                $this->payrollComplianceService->readiness($profile, $settings->compliance_settings ?: [], $declaration)['warnings']
            );
        }

        return array_values(array_unique($warnings));
    }

    private function salaryTemplateSnapshot(SalaryTemplate $template): array
    {
        $template->loadMissing('components.component');

        $basicComponent = $template->components->first(fn (SalaryTemplateComponent $item) => $item->component?->category === 'basic');
        $basicSalary = (float) ($basicComponent?->value ?? $basicComponent?->component?->default_value ?? 0);
        $allowances = 0.0;
        $deductions = 0.0;
        $bonus = 0.0;
        $tax = 0.0;
        $earnings = [];
        $deductionRows = [];

        foreach ($template->components as $item) {
          if (!$item->is_enabled || !$item->component) {
              continue;
          }

          $category = (string) $item->component->category;
          if ($category === 'basic') {
              continue;
          }

          $basis = (string) ($item->component->calculation_basis ?: 'basic');
          $baseAmount = $basis === 'gross'
              ? max($basicSalary + $allowances + $bonus, $basicSalary)
              : $basicSalary;
          $computed = $item->value_type === 'percentage'
              ? round(($baseAmount * (float) $item->value) / 100, 2)
              : round((float) $item->value, 2);
          $impact = (string) ($item->component->impact ?: 'earning');

          $row = [
              'salary_component_id' => $item->salary_component_id,
              'name' => $item->component->name,
              'category' => $category,
              'impact' => $impact,
              'calculation_basis' => $basis,
              'calculation_type' => $item->value_type,
              'value_type' => $item->value_type,
              'value' => (float) $item->value,
              'computed_amount' => $computed,
          ];

          if ($category === 'bonus') {
              $bonus += $computed;
              $earnings[] = $row;
              continue;
          }
          if ($category === 'tax' || $impact === 'tax') {
              $tax += $computed;
              $deductionRows[] = $row;
              continue;
          }
          if (in_array($category, ['deduction', 'penalty'], true) || $impact === 'deduction') {
              $deductions += $computed;
              $deductionRows[] = $row;
              continue;
          }
          if (in_array($impact, ['earning', 'reimbursement'], true) || in_array($category, ['allowance', 'overtime', 'reimbursement', 'other', 'earning'], true)) {
              $allowances += $computed;
              $earnings[] = $row;
              continue;
          }
          $deductions += $computed;
          $deductionRows[] = $row;
        }

        return [
            'basic_salary' => round($basicSalary, 2),
            'allowances' => round($allowances, 2),
            'deductions' => round($deductions, 2),
            'bonus' => round($bonus, 2),
            'tax' => round($tax, 2),
            'net_salary' => round($basicSalary + $allowances + $bonus - $deductions - $tax, 2),
            'earnings_components' => $earnings,
            'deduction_components' => $deductionRows,
        ];
    }

    private function ensureDefaultSetup(int $organizationId): void
    {
        PayrollSetting::query()->firstOrCreate(
            ['organization_id' => $organizationId],
            $this->defaultPayrollSettings()
        );

        foreach ($this->defaultSalaryComponents() as $component) {
            SalaryComponent::query()->firstOrCreate(
                [
                    'organization_id' => $organizationId,
                    'code' => $component['code'],
                ],
                $component
            );
        }
    }

    private function defaultPayrollSettings(): array
    {
        $currency = (string) config('payroll.default_currency', 'INR');

        return [
            'payroll_calendar' => ['cutoff_day' => 30, 'payment_day' => 1],
            'default_payout_method' => ['method' => 'mock', 'currency' => $currency],
            'overtime_rules' => ['enabled' => true, 'rate_multiplier' => 1.5],
            'late_deduction_rules' => ['enabled' => false, 'deduction_per_late_day' => 0],
            'leave_mapping' => ['approved_leave_counts_as_payable_day' => true],
            'adjustment_rules' => ['approval_required' => true, 'auto_apply_approved_adjustments' => true],
            'approval_workflow' => array_merge($this->payRunApprovalService->defaultWorkflow(), [
                'adjustments_require_approval' => true,
                'pay_run_requires_finalization' => true,
            ]),
            'compliance_settings' => $this->payrollComplianceService->defaultSettings($currency),
            'tax_settings' => [
                'default_regime' => 'new',
                'rebate_limits' => ['old' => 500000, 'new' => 1200000],
            ],
            'payslip_branding' => ['company_name' => 'CareVance', 'accent_color' => '#0f172a'],
            'payslip_issue_rules' => ['publish_after_payment' => true, 'track_viewed_at' => true],
            'payout_workflow' => ['allow_bank_transfer_batch' => true, 'retry_failed_payouts' => true],
        ];
    }

    private function defaultSalaryComponents(): array
    {
        return [
            ['name' => 'Basic', 'code' => 'BASIC', 'category' => 'basic', 'impact' => 'earning', 'value_type' => 'fixed', 'calculation_basis' => 'basic', 'default_value' => 0, 'is_taxable' => true, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'HRA', 'code' => 'HRA', 'category' => 'allowance', 'impact' => 'earning', 'value_type' => 'percentage', 'calculation_basis' => 'basic', 'default_value' => 40, 'is_taxable' => true, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'Special Allowance', 'code' => 'SPECIAL_ALLOWANCE', 'category' => 'allowance', 'impact' => 'earning', 'value_type' => 'fixed', 'calculation_basis' => 'basic', 'default_value' => 0, 'is_taxable' => true, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'Conveyance', 'code' => 'CONVEYANCE', 'category' => 'allowance', 'impact' => 'earning', 'value_type' => 'fixed', 'calculation_basis' => 'basic', 'default_value' => 0, 'is_taxable' => true, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'Bonus', 'code' => 'BONUS', 'category' => 'bonus', 'impact' => 'earning', 'value_type' => 'fixed', 'calculation_basis' => 'basic', 'default_value' => 0, 'is_taxable' => true, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'Reimbursement', 'code' => 'REIMBURSEMENT', 'category' => 'reimbursement', 'impact' => 'reimbursement', 'value_type' => 'fixed', 'calculation_basis' => 'basic', 'default_value' => 0, 'is_taxable' => false, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'Overtime', 'code' => 'OVERTIME', 'category' => 'overtime', 'impact' => 'earning', 'value_type' => 'fixed', 'calculation_basis' => 'gross', 'default_value' => 0, 'is_taxable' => true, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'Manual Deduction', 'code' => 'MANUAL_DEDUCTION', 'category' => 'deduction', 'impact' => 'deduction', 'value_type' => 'fixed', 'calculation_basis' => 'basic', 'default_value' => 0, 'is_taxable' => false, 'is_compliance_component' => false, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'PF Employee', 'code' => 'PF_EMPLOYEE', 'category' => 'deduction', 'impact' => 'deduction', 'value_type' => 'percentage', 'calculation_basis' => 'basic', 'default_value' => 12, 'is_taxable' => false, 'is_compliance_component' => true, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'PF Employer', 'code' => 'PF_EMPLOYER', 'category' => 'other', 'impact' => 'employer_contribution', 'value_type' => 'percentage', 'calculation_basis' => 'basic', 'default_value' => 12, 'is_taxable' => false, 'is_compliance_component' => true, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'ESI Employee', 'code' => 'ESI_EMPLOYEE', 'category' => 'deduction', 'impact' => 'deduction', 'value_type' => 'percentage', 'calculation_basis' => 'gross', 'default_value' => 0.75, 'is_taxable' => false, 'is_compliance_component' => true, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'ESI Employer', 'code' => 'ESI_EMPLOYER', 'category' => 'other', 'impact' => 'employer_contribution', 'value_type' => 'percentage', 'calculation_basis' => 'gross', 'default_value' => 3.25, 'is_taxable' => false, 'is_compliance_component' => true, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'Professional Tax', 'code' => 'PROFESSIONAL_TAX', 'category' => 'deduction', 'impact' => 'deduction', 'value_type' => 'fixed', 'calculation_basis' => 'basic', 'default_value' => 200, 'is_taxable' => false, 'is_compliance_component' => true, 'is_system_default' => true, 'is_active' => true],
            ['name' => 'TDS', 'code' => 'TDS', 'category' => 'tax', 'impact' => 'tax', 'value_type' => 'fixed', 'calculation_basis' => 'gross', 'default_value' => 0, 'is_taxable' => false, 'is_compliance_component' => true, 'is_system_default' => true, 'is_active' => true],
        ];
    }
}
