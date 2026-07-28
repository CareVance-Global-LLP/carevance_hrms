<?php

namespace App\Services;

use App\Models\PayrollMonthlyRun;
use App\Models\PayrollItem;
use App\Models\EmployeePayrollTemplate;
use App\Models\PayGroupAssignment;
use App\Models\StopPaymentFlag;
use App\Models\PayrollRunChecklist;
use App\Models\Reimbursement;
use App\Models\ReimbursementPayrollLink;
use App\Models\LeaveEncashment;
use App\Models\ArrearPayment;
use App\Models\FbpClaim;
use App\Services\FbpService;
use App\Models\PerquisiteRecord;
use App\Models\VariablePayAssignment;
use App\Models\User;
use App\Services\Attendance\AttendanceService;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class PayrollAutoProcessService
{
    protected PayrollCalculatorService $calculator;
    protected PayrollValidationService $validation;
    protected PayrollFilingService $filings;
    protected PayrollChecklistService $checklist;
    protected AttendanceService $attendance;
    protected FbpService $fbp;

    public function __construct(
        PayrollCalculatorService $calculator,
        PayrollValidationService $validation,
        PayrollFilingService $filings,
        PayrollChecklistService $checklist,
        AttendanceService $attendance,
        FbpService $fbp,
    ) {
        $this->calculator = $calculator;
        $this->validation = $validation;
        $this->filings = $filings;
        $this->checklist = $checklist;
        $this->attendance = $attendance;
        $this->fbp = $fbp;
    }

    public function quickProcess(int $orgId, string $monthYear, int $userId): array
    {
        return $this->processForUsers($orgId, $monthYear, null, $userId);
    }

    /**
     * Single source of truth for the full payroll run.
     *
     * Every payroll path routes through here:
     *   - single employee     -> processForUsers($orgId, $m, [$userId], $actor)
     *   - department run      -> processForUsers($orgId, $m, $dept->users()->pluck('id')->all(), $actor)
     *   - whole-org run       -> processForUsers($orgId, $m, null, $actor)
     *
     * This guarantees that bulk and individual produce identical net pay
     * (per master guide §3: "Single source of truth — no duplicate
     * calculation engines").
     */
    public function processForUsers(int $orgId, string $monthYear, ?array $userIds, int $actorUserId): \App\Models\PayrollMonthlyRun
    {
        return DB::transaction(function () use ($orgId, $monthYear, $userIds, $actorUserId) {
            $run = $this->createOrGetRun($orgId, $monthYear, $actorUserId);
            $this->autoSyncEmployees($run, $orgId, $userIds);
            $this->autoSyncAttendance($run);
            $this->autoSyncLeaves($run);
            $this->autoSyncReimbursements($run);
            $this->autoSyncFbp($run);
            $this->autoSyncVariablePay($run);
            $this->autoSyncPerquisites($run);
            $this->autoApplyHolds($run);
            $this->calculateAllItems($run);
            $this->validateRun($run, $orgId, $actorUserId);

            return $run->fresh()->load('items.user.employeeProfile');
        });
    }

    public function processWithChecklist(int $orgId, string $monthYear, int $userId): array
    {
        return DB::transaction(function () use ($orgId, $monthYear, $userId) {
            $run = $this->createOrGetRun($orgId, $monthYear, $userId);
            $validation = $this->checklist->runFullValidation($run->id, $orgId, $userId);

            if ($validation['can_process']) {
                return $this->quickProcess($orgId, $monthYear, $userId);
            }

            return [
                'run' => $run,
                'validation' => $validation,
                'blocked' => true,
                'message' => 'Checklist items must be resolved before processing',
            ];
        });
    }

    private function createOrGetRun(int $orgId, string $monthYear, int $userId): PayrollMonthlyRun
    {
        // Look up ANY existing run for this org + month. Filtering by
        // status here previously caused a duplicate-key insert: when a run
        // already existed in a non-draft/processing state (e.g. processed,
        // paid, locked) the lookup returned nothing and we tried to
        // create a second row, violating payroll_runs_org_month_unique.
        $run = PayrollMonthlyRun::where('organization_id', $orgId)
            ->where('month_year', $monthYear)
            ->first();

        if (!$run) {
            $run = PayrollMonthlyRun::create([
                'organization_id' => $orgId,
                'month_year' => $monthYear,
                'status' => 'processing',
                'pay_date' => Carbon::parse($monthYear . '-01')->endOfMonth(),
                'created_by' => $userId,
            ]);
        } else {
            // Only rebuild (wipe items) while the run is still mutable.
            // Terminal states (locked/paid/released/disbursed) must keep
            // their items and status intact.
            if (in_array($run->status, ['draft', 'processing'], true)) {
                $run->items()->delete();
                $run->update(['status' => 'processing']);
            }
        }

        return $run;
    }

    private function autoSyncEmployees(PayrollMonthlyRun $run, int $orgId, ?array $userIds = null): void
    {
        $templates = EmployeePayrollTemplate::with([
            'user.employeeProfile',
            'user.employeeWorkInfo',
            'user.employeeBankAccounts',
        ])
            ->where('organization_id', $orgId)
            ->where('is_active', true)
            ->when($userIds !== null, fn ($q) => $q->whereIn('user_id', $userIds))
            ->get();

        foreach ($templates as $template) {
            $hold = StopPaymentFlag::where('user_id', $template->user_id)
                ->where('month_year', $run->month_year)
                ->where('is_active', true)
                ->first();

            if ($hold && $hold->hold_type === 'processing') continue;

            $userId = $template->user_id;

            $existingItem = PayrollItem::where('payroll_run_id', $run->id)
                ->where('user_id', $userId)
                ->first();

            if (!$existingItem) {
                PayrollItem::create([
                    'payroll_run_id' => $run->id,
                    'organization_id' => $orgId,
                    'user_id' => $userId,
                    'department_id' => $template->user->employeeWorkInfo->department_id ?? $template->user->group_id,
                    'total_working_days' => 26,
                    'template_snapshot' => $template->toArray(),
                    'is_payout_held' => $hold && $hold->hold_type === 'payout',
                ]);
            }
        }
    }

    /**
     * Real attendance sync, replacing the old hard-coded 26/26/0/0 stub.
     * Reads from AttendanceRecord/AttendancePunch/LeaveRequest/AttendanceHoliday
     * via AttendanceService::monthlyAttendanceSummary (single source of
     * truth for payroll attendance, per the master guide).
     *
     * Payroll is a CONSUMER of attendance — this method never writes back to
     * the attendance tables.
     * 
     * UPDATED: Now populates both legacy and simplified attendance fields.
     * The simplified fields use check-in existence instead of hours worked.
     */
    private function autoSyncAttendance(PayrollMonthlyRun $run): void
    {
        $items = PayrollItem::where('payroll_run_id', $run->id)->get();

        $userIds = $items->pluck('user_id')->unique()->values()->all();
        $usersByid = User::whereIn('id', $userIds)->get()->keyBy('id');

        foreach ($items as $item) {
            $user = $usersByid[$item->user_id] ?? null;
            if (!$user) {
                continue;
            }

            $summary = $this->attendance->monthlyAttendanceSummary($user, $run->month_year);

            // Prepare update data with both legacy and simplified fields
            $updateData = [
                // Legacy fields (keep for backward compatibility)
                'total_working_days' => (float) $summary['working_days'],
                'days_present' => (float) ($summary['legacy_present_days'] ?? $summary['present_days']),
                'days_absent' => (float) ($summary['legacy_lop_days'] ?? $summary['total_lop_days']),
                'days_leave' => (float) $summary['paid_leave_days'],
                'lOP_days' => (float) ($summary['legacy_lop_days'] ?? $summary['total_lop_days']),
                'total_worked_seconds' => (int) ($summary['total_worked_seconds'] ?? 0),
                'overtime_seconds' => (int) ($summary['overtime_seconds'] ?? 0),
                
                // New simplified attendance fields
                'present_days' => (float) $summary['present_days'],
                'paid_leave_days' => (float) $summary['paid_leave_days'],
                'unpaid_leave_days' => (float) $summary['unpaid_leave_days'],
                'half_day_present' => (float) $summary['half_day_present'],
                'half_day_absent' => (float) $summary['half_day_absent'],
                'absent_days' => (float) $summary['absent_days'],
                'total_payable_days' => (float) $summary['total_payable_days'],
                'total_lop_days' => (float) $summary['total_lop_days'],
                'attendance_calculation_mode' => $summary['calculation_mode'] ?? 'simplified',
            ];

            $item->update($updateData);

            // Log reconciliation data if there's a significant difference
            // between legacy and simplified calculations
            $legacyPresent = $summary['legacy_present_days'] ?? $summary['present_days'];
            $newPresent = $summary['present_days'];
            
            if (abs($legacyPresent - $newPresent) > 0.01) {
                \App\Models\PayrollReconciliation::create([
                    'payroll_item_id' => $item->id,
                    'old_present_days' => $legacyPresent,
                    'new_present_days' => $newPresent,
                    'difference' => $legacyPresent - $newPresent,
                    'month_year' => $run->month_year,
                    'debug_info' => [
                        'summary' => $summary,
                        'user_id' => $user->id,
                        'timestamp' => now()->toDateTimeString(),
                    ],
                ]);
            }
        }
    }

    private function autoSyncLeaves(PayrollMonthlyRun $run): void
    {
        $items = PayrollItem::where('payroll_run_id', $run->id)->get();
        foreach ($items as $item) {
            $encashments = LeaveEncashment::where('user_id', $item->user_id)
                ->where('status', 'approved')
                ->whereMonth('created_at', explode('-', $run->month_year)[1])
                ->whereYear('created_at', explode('-', $run->month_year)[0])
                ->sum('net_amount');

            if ($encashments > 0) {
                $currentTotal = (float) ($item->custom_earnings ?? 0);
                $item->update(['custom_earnings' => $currentTotal + (float) $encashments]);
            }
        }
    }

    private function autoSyncReimbursements(PayrollMonthlyRun $run): void
    {
        $items = PayrollItem::where('payroll_run_id', $run->id)->get();
        foreach ($items as $item) {
            $approvedReimbursements = Reimbursement::where('user_id', $item->user_id)
                ->where('status', 'approved')
                ->whereMonth('expense_date', explode('-', $run->month_year)[1])
                ->whereYear('expense_date', explode('-', $run->month_year)[0])
                ->get();

            foreach ($approvedReimbursements as $reimbursement) {
                $existingLink = ReimbursementPayrollLink::where('reimbursement_id', $reimbursement->id)
                    ->where('status', 'linked')
                    ->first();

                if (!$existingLink) {
                    ReimbursementPayrollLink::create([
                        'organization_id' => $run->organization_id,
                        'reimbursement_id' => $reimbursement->id,
                        'payroll_item_id' => $item->id,
                        'amount' => $reimbursement->amount,
                        'month_year' => $run->month_year,
                        'status' => 'linked',
                    ]);

                    $currentTotal = (float) ($item->custom_earnings ?? 0);
                    $item->update(['custom_earnings' => $currentTotal + (float) $reimbursement->amount]);
                }
            }
        }
    }

    private function autoSyncFbp(PayrollMonthlyRun $run): void
    {
        $monthYear = $run->month_year;
        $approvedClaims = FbpClaim::where('status', 'approved')
            ->where('month_year', $monthYear)
            ->get()
            ->groupBy('user_id');

        foreach ($approvedClaims as $userId => $claims) {
            $item = PayrollItem::where('payroll_run_id', $run->id)
                ->where('user_id', $userId)
                ->first();

            if (!$item) continue;

            $totalFbp = $claims->sum('approved_amount');
            if ($totalFbp > 0) {
                $currentTotal = (float) ($item->custom_earnings ?? 0);
                $item->update(['custom_earnings' => $currentTotal + (float) $totalFbp]);
            }
        }
    }

    private function autoSyncVariablePay(PayrollMonthlyRun $run): void
    {
        $assignments = VariablePayAssignment::with('rule')
            ->whereHas('rule', fn($q) => $q->where('is_active', true))
            ->where('is_active', true)
            ->get()
            ->groupBy('user_id');

        foreach ($assignments as $userId => $userAssignments) {
            $item = PayrollItem::where('payroll_run_id', $run->id)
                ->where('user_id', $userId)
                ->first();

            if (!$item) continue;

            $totalVarPay = 0;
            foreach ($userAssignments as $assignment) {
                $rule = $assignment->rule;
                if (!$rule) continue;

                $totalVarPay += match ($rule->calculation_type) {
                    'percentage' => (float) ($item->basic ?? 0) * (($assignment->percentage ?? $rule->default_percentage ?? 0) / 100),
                    'fixed' => (float) ($assignment->fixed_amount ?? 0),
                    default => 0,
                };
            }

            if ($totalVarPay > 0) {
                $item->update(['overtime_pay' => ($item->overtime_pay ?? 0) + $totalVarPay]);
            }
        }
    }

    private function autoSyncPerquisites(PayrollMonthlyRun $run): void
    {
        $perquisites = PerquisiteRecord::where('is_active', true)->get()->groupBy('user_id');

        foreach ($perquisites as $userId => $userPerks) {
            $item = PayrollItem::where('payroll_run_id', $run->id)
                ->where('user_id', $userId)
                ->first();

            if (!$item) continue;

            $totalPerkValue = $userPerks->sum('monthly_value');
            if ($totalPerkValue > 0) {
                $currentTotal = (float) ($item->custom_earnings ?? 0);
                $item->update(['custom_earnings' => $currentTotal + (float) $totalPerkValue]);
            }
        }
    }

    private function autoApplyHolds(PayrollMonthlyRun $run): void
    {
        $processingHolds = StopPaymentFlag::where('month_year', $run->month_year)
            ->where('is_active', true)
            ->where('hold_type', 'processing')
            ->pluck('user_id');

        PayrollItem::where('payroll_run_id', $run->id)
            ->whereIn('user_id', $processingHolds)
            ->delete();
    }

    private function calculateAllItems(PayrollMonthlyRun $run): void
    {
        $items = PayrollItem::with('user.employeePayrollTemplate')->where('payroll_run_id', $run->id)->get();
        $totals = [
            'total_gross' => 0, 'total_deductions' => 0, 'total_net_pay' => 0,
            'total_employer_contributions' => 0, 'total_pf_employee' => 0, 'total_pf_employer' => 0,
            'total_esi_employee' => 0, 'total_esi_employer' => 0, 'total_pt' => 0, 'total_tds' => 0,
        ];

        foreach ($items as $item) {
            $template = $item->user->employeePayrollTemplate;
            if (!$template) continue;

            $annualCtc = (float) ($template->annual_ctc ?? 0);
            $monthlyCtc = $annualCtc / 12;
            $lopDays = (float) ($item->lOP_days ?? 0);
            $totalDays = (float) ($item->total_working_days ?? 26);
            $basicPct = (float) ($template->basic_percentage ?? 40) / 100;
            $hraPct = (float) ($template->hra_percentage ?? 50) / 100;
            $isMetro = $template->is_metro_city ?? true;
            $state = $template->pt_state ?? 'maharashtra';
            $pfEnabled = $template->pf_enabled;
            $esiEnabled = $template->esi_enabled;

            $proRationFactor = $totalDays > 0 ? ($totalDays - $lopDays) / $totalDays : 1;
            $monthlyGross = $monthlyCtc * $proRationFactor;
            $basic = round($monthlyGross * $basicPct, 2);
            $hra = round($basic * $hraPct, 2);
            $conveyance = min((float) ($template->conveyance_allowance ?? 1600), $monthlyGross);
            $medical = min((float) ($template->medical_allowance ?? 0), $monthlyGross);
            $specialAllowance = round($monthlyGross - $basic - $hra - $conveyance - $medical, 2);

            $customEarningsTotal = (float) ($item->custom_earnings ?? 0);

            $gross = $basic + $hra + $conveyance + $medical + max($specialAllowance, 0) + $customEarningsTotal + (float) ($item->overtime_pay ?? 0);

            // LOP deduction must be computed BEFORE PF/ESI/PT — statutory
            // deductions apply to actual payable wages, not the full
            // month's gross. Otherwise an employee with heavy LOP ends
            // up with total_deductions > gross and net_pay = 0.
            //
            // Use $gross (not $monthlyCtc) as the basis so the LOP
            // deduction matches what already exists in the database
            // for previous runs: lOP_deduction = (gross / totalDays) × lopDays.
            $lopDeduction = $lopDays > 0 ? round($gross / $totalDays * $lopDays, 2) : 0;

            // Actual payable wages = gross minus LOP
            $payableGross = max(0, $gross - $lopDeduction);
            // For PF we pro-rate basic by the same factor that LOP took
            // off gross. When gross > 0 this is exact; if gross is 0 we
            // fall back to 0 to avoid a div-by-zero.
            $payableBasic = $gross > 0
                ? max(0, $basic - ($basic / $gross) * $lopDeduction)
                : 0;

            // PF on earned basic (pro-rated for days present, BEFORE LOP deduction).
            // PF applies to actual wages for days worked — LOP is unpaid absence
            // but the employee still earns PF on the days they were present.
            // If 1 out of 22 days was worked, PF = 1/22 of the monthly PF amount.
            $pfWages = min($basic, 15000);
            $pfEmployee = $pfEnabled ? round($pfWages * 0.12, 2) : 0;
            $eps = $pfEnabled ? round($pfWages * 0.0833, 2) : 0;
            $epf = $pfEnabled ? round($pfWages * 0.0367, 2) : 0;
            $pfEmployer = $pfEmployee;

            // ESI eligibility is based on gross wages (before LOP) per the
            // ESI Act. Contribution itself is computed on payable wages
            // (after LOP) so partial-month absences reduce the contribution
            // without invalidating coverage.
            $esiApplicable = $esiEnabled && $gross <= 21000;
            $esiEmployee = $esiApplicable ? round($payableGross * 0.0075, 2) : 0;
            $esiEmployer = $esiApplicable ? round($payableGross * 0.0325, 2) : 0;

            // PT on payable gross — applied to actual earned wages (after LOP)
            $pt = $this->calculator->calculatePT($payableGross, $state);

            $tds = 0;
            if ($template->tds_enabled) {
                $annualProjected = $payableGross * 12;
                // Net the FBP exemption out of the tax base so only the
                // portion of a taxable FBP component above its exemption
                // limit is taxed. Non-taxable FBP (e.g. food coupons) is
                // excluded entirely. Earnings (gross/net pay) are untouched.
                $annualProjected = max(0, $annualProjected - $this->fbp->getFbpTaxExclusion($item->user_id, $run->organization_id));
                // getApprovedTaxDeductions returns a flat float total; the
                // tax calculator wants a per-section array. Pass the full
                // declaration map (or empty for "no exemptions") — the
                // calculator handles both.
                $exemptionMap = $this->calculator->getApprovedTaxDeductionMap($item->user_id);
                $taxCalc = $template->tax_regime === 'new'
                    ? $this->calculator->calculateNewRegimeTax($annualProjected, $exemptionMap)
                    : $this->calculator->calculateOldRegimeTax($annualProjected, $exemptionMap);
                $tds = round(($taxCalc['total_tax'] ?? 0) / 12, 2);
            }

            $totalDeductions = $pfEmployee + $esiEmployee + $pt + $tds + $lopDeduction;
            $netPay = max(0, $gross - $totalDeductions);

            $gratuity = round($basic * 0.0481, 2);
            $totalEmployerContributions = $pfEmployer + $esiEmployer + $gratuity;

            $item->update([
                'basic' => $basic,
                'hra' => $hra,
                'conveyance' => $conveyance,
                'medical' => $medical,
                'special_allowance' => max($specialAllowance, 0),
                'gross_salary' => round($gross, 2),
                'pf_employee' => $pfEmployee,
                'esi_employee' => $esiEmployee,
                'pt' => $pt,
                'tds' => $tds,
                'lOP_deduction' => $lopDeduction,
                'total_deductions' => round($totalDeductions, 2),
                'pf_employer' => $pfEmployer,
                'eps' => $eps,
                'epf' => $epf,
                'esi_employer' => $esiEmployer,
                'gratuity' => $gratuity,
                'total_employer_contributions' => round($totalEmployerContributions, 2),
                'net_pay' => round($netPay, 2),
                'payment_status' => 'pending',
            ]);

            $totals['total_gross'] += $gross;
            $totals['total_deductions'] += $totalDeductions;
            $totals['total_net_pay'] += $netPay;
            $totals['total_employer_contributions'] += $totalEmployerContributions;
            $totals['total_pf_employee'] += $pfEmployee;
            $totals['total_pf_employer'] += $pfEmployer;
            $totals['total_esi_employee'] += $esiEmployee;
            $totals['total_esi_employer'] += $esiEmployer;
            $totals['total_pt'] += $pt;
            $totals['total_tds'] += $tds;
        }

        $run->update(array_merge($totals, [
            'total_employees' => $items->count(),
            'status' => 'locked',
        ]));
    }

    private function validateRun(PayrollMonthlyRun $run, int $orgId, int $userId): void
    {
        $validation = $this->validation->validatePayrollRun($run->id);
        $this->checklist->runPreValidations($run, $orgId, $userId);

        if (($validation['valid'] ?? false) && ($validation['passed'] ?? 0) > 0) {
            $this->autoGenerateFilings($run, $orgId, $userId);
        }
    }

    public function autoGenerateFilings(PayrollMonthlyRun $run, int $orgId, int $userId): array
    {
        $filings = [];

        try {
            $filings[] = $this->filings->generatePfEcr($run, $orgId, $userId);
        } catch (\Throwable $e) { report($e); }

        try {
            $filings[] = $this->filings->generateEsiChallan($run, $orgId, $userId);
        } catch (\Throwable $e) { report($e); }

        try {
            $filings[] = $this->filings->generateForm24Q($run, $orgId, $userId);
        } catch (\Throwable $e) { report($e); }

        try {
            $filings[] = $this->filings->generateForm12BA($run, $orgId, $userId);
        } catch (\Throwable $e) { report($e); }

        // LWF is state-specific; reuse the org's default state (same approach as PT below).
        $lwfState = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('lwf_enabled', true)
            ->select('pt_state')
            ->distinct()
            ->value('pt_state');
        if ($lwfState && isset(\App\Services\PayrollFilingService::LWF_STATE_CONFIG[$lwfState])) {
            try {
                $filings[] = $this->filings->generateLwfReturn($run, $lwfState, $orgId, $userId);
            } catch (\Throwable $e) { report($e); }
        }

        $state = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->whereNotNull('pt_state')
            ->value('pt_state');
        if ($state) {
            try {
                $filings[] = $this->filings->generatePtReturn($run, $state, $orgId, $userId);
            } catch (\Throwable $e) { report($e); }
        }

        return $filings;
    }

    public function getPayrollDiff(PayrollMonthlyRun $currentRun): array
    {
        [$year, $month] = explode('-', $currentRun->month_year);
        $prevMonth = Carbon::create((int)$year, (int)$month, 1)->subMonth()->format('Y-m');

        $prevRun = PayrollMonthlyRun::where('organization_id', $currentRun->organization_id)
            ->where('month_year', $prevMonth)
            ->whereIn('status', ['locked', 'approved', 'released', 'paid'])
            ->first();

        if (!$prevRun) {
            return ['has_prev' => false, 'message' => 'No previous month data'];
        }

        return [
            'has_prev' => true,
            'prev_month' => $prevMonth,
            'current_month' => $currentRun->month_year,
            'diff' => [
                'gross' => round($currentRun->total_gross - $prevRun->total_gross, 2),
                'deductions' => round($currentRun->total_deductions - $prevRun->total_deductions, 2),
                'net_pay' => round($currentRun->total_net_pay - $prevRun->total_net_pay, 2),
                'pf' => round($currentRun->total_pf_employee - $prevRun->total_pf_employee, 2),
                'esi' => round($currentRun->total_esi_employee - $prevRun->total_esi_employee, 2),
                'tds' => round($currentRun->total_tds - $prevRun->total_tds, 2),
                'employer_contributions' => round($currentRun->total_employer_contributions - $prevRun->total_employer_contributions, 2),
            ],
            'current' => [
                'total_gross' => $currentRun->total_gross,
                'total_deductions' => $currentRun->total_deductions,
                'total_net_pay' => $currentRun->total_net_pay,
                'total_employees' => $currentRun->total_employees,
            ],
            'previous' => [
                'total_gross' => $prevRun->total_gross,
                'total_deductions' => $prevRun->total_deductions,
                'total_net_pay' => $prevRun->total_net_pay,
                'total_employees' => $prevRun->total_employees,
            ],
        ];
    }

    public function detectChanges(int $orgId, string $monthYear): array
    {
        $changes = [];

        $previousMonth = Carbon::parse($monthYear . '-01')->subMonth()->format('Y-m');

        $prevRun = PayrollMonthlyRun::where('organization_id', $orgId)
            ->where('month_year', $previousMonth)
            ->whereIn('status', ['locked', 'approved', 'released', 'paid'])
            ->first();

        $prevEmployeeIds = $prevRun
            ? PayrollItem::where('payroll_run_id', $prevRun->id)->pluck('user_id')->toArray()
            : [];

        $currentTemplates = EmployeePayrollTemplate::where('organization_id', $orgId)
            ->where('is_active', true)
            ->get();

        $currentEmployeeIds = $currentTemplates->pluck('user_id')->toArray();

        // New joiners
        $newJoiners = array_diff($currentEmployeeIds, $prevEmployeeIds);
        if (!empty($newJoiners)) {
            $changes['new_joiners'] = User::whereIn('id', $newJoiners)->pluck('name')->toArray();
        }

        // Exited employees
        $exits = array_diff($prevEmployeeIds, $currentEmployeeIds);
        if (!empty($exits)) {
            $changes['exits'] = User::whereIn('id', $exits)->pluck('name')->toArray();
        }

        // CTC revisions
        $ctcChanges = [];
        if ($prevRun) {
            $prevItems = PayrollItem::where('payroll_run_id', $prevRun->id)->get()->keyBy('user_id');
            foreach ($currentTemplates as $template) {
                $prevItem = $prevItems->get($template->user_id);
                if ($prevItem) {
                    $prevCtc = (float) ($prevItem->template_snapshot['annual_ctc'] ?? 0);
                    $currentCtc = (float) ($template->annual_ctc ?? 0);
                    if ($prevCtc > 0 && abs($currentCtc - $prevCtc) > 0.01) {
                        $ctcChanges[] = [
                            'name' => $template->user->name ?? "User #{$template->user_id}",
                            'old_ctc' => $prevCtc,
                            'new_ctc' => $currentCtc,
                            'change_pct' => round(($currentCtc - $prevCtc) / $prevCtc * 100, 2),
                        ];
                    }
                }
            }
        }
        if (!empty($ctcChanges)) {
            $changes['ctc_revisions'] = $ctcChanges;
        }

        return $changes;
    }
}
