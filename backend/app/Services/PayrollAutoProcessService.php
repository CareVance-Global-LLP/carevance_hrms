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
    protected \App\Services\Payroll\EsiContributionPeriodService $esiPeriods;
    protected \App\Services\Payroll\LwfCalculator $lwf;
    protected \App\Services\Payroll\PayrollDayBasisResolver $dayBasis;

    public function __construct(
        PayrollCalculatorService $calculator,
        PayrollValidationService $validation,
        PayrollFilingService $filings,
        PayrollChecklistService $checklist,
        AttendanceService $attendance,
        FbpService $fbp,
        \App\Services\Payroll\EsiContributionPeriodService $esiPeriods,
        \App\Services\Payroll\LwfCalculator $lwf,
        \App\Services\Payroll\PayrollDayBasisResolver $dayBasis,
    ) {
        $this->calculator = $calculator;
        $this->validation = $validation;
        $this->filings = $filings;
        $this->checklist = $checklist;
        $this->attendance = $attendance;
        $this->fbp = $fbp;
        $this->esiPeriods = $esiPeriods;
        $this->lwf = $lwf;
        $this->dayBasis = $dayBasis;
    }

    public function quickProcess(int $orgId, string $monthYear, int $userId): \App\Models\PayrollMonthlyRun
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
                // Iterated rather than $run->items()->delete(). A query-builder
                // mass delete fires no model events, so PayrollItemObserver --
                // the thing that makes a closed run immutable -- would never
                // see the one operation that destroys a whole run's money.
                // The status check above already makes this safe today; going
                // through the model is what keeps it safe if that check is
                // ever moved, weakened or forgotten.
                $run->items()->cursor()->each(fn (PayrollItem $item) => $item->delete());
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
                $item->update(['custom_earnings' => DB::raw('COALESCE(custom_earnings, 0) + ' . (float) $encashments)]);
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
                // The link must still point at a live payroll item to count as
                // already paid. Re-processing a draft run wipes its items but
                // leaves these rows behind, so a link orphaned by the previous
                // pass used to satisfy this check and the reimbursement was
                // silently dropped from the payslip — while the claim still
                // read "approved" to the employee. Re-processing a draft is the
                // normal flow, so this hit real people.
                $existingLink = ReimbursementPayrollLink::where('reimbursement_id', $reimbursement->id)
                    ->where('status', 'linked')
                    ->whereNotNull('payroll_item_id')
                    ->whereHas('payrollItem')
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

                    $item->update(['custom_earnings' => DB::raw('COALESCE(custom_earnings, 0) + ' . (float) $reimbursement->amount)]);
                }
            }
        }
    }

    private function autoSyncFbp(PayrollMonthlyRun $run): void
    {
        $monthYear = $run->month_year;
        // Org scope is mandatory: without it this pulls in every tenant's
        // approved claims and attaches them to whichever local user_id
        // happens to collide.
        $approvedClaims = FbpClaim::where('organization_id', $run->organization_id)
            ->where('status', 'approved')
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
                $item->update(['custom_earnings' => DB::raw('COALESCE(custom_earnings, 0) + ' . (float) $totalFbp)]);
            }
        }
    }

    private function autoSyncVariablePay(PayrollMonthlyRun $run): void
    {
        // Org scope is mandatory — see autoSyncFbp().
        $assignments = VariablePayAssignment::with('rule')
            ->where('organization_id', $run->organization_id)
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
        // Org scope is mandatory — see autoSyncFbp().
        $perquisites = PerquisiteRecord::where('organization_id', $run->organization_id)
            ->where('is_active', true)
            ->get()
            ->groupBy('user_id');

        foreach ($perquisites as $userId => $userPerks) {
            $item = PayrollItem::where('payroll_run_id', $run->id)
                ->where('user_id', $userId)
                ->first();

            if (!$item) continue;

            $totalPerkValue = $userPerks->sum('monthly_value');
            if ($totalPerkValue > 0) {
                $item->update(['custom_earnings' => DB::raw('COALESCE(custom_earnings, 0) + ' . (float) $totalPerkValue)]);
            }
        }
    }

    /**
     * Gross paid and TDS withheld for this employee earlier in the same
     * financial year, which is what the cumulative true-up credits against.
     *
     * The Indian FY runs April to March. month_year is stored as 'YYYY-MM',
     * which sorts lexicographically in calendar order, so a string range is a
     * correct range here and not a coincidence worth relying on silently.
     *
     * Deliberately excludes the month being processed: it is passed separately,
     * and including it would double-count on a re-process.
     *
     * @return array{gross: float, tds: float}
     */
    private function financialYearToDate(int $userId, int $organizationId, string $monthYear): array
    {
        [$year, $month] = array_map('intval', explode('-', $monthYear));
        $financialYearStart = sprintf('%04d-04', $month >= 4 ? $year : $year - 1);

        $totals = PayrollItem::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->where('month_year', '>=', $financialYearStart)
            ->where('month_year', '<', $monthYear)
            ->selectRaw('COALESCE(SUM(gross_salary), 0) as gross_total, COALESCE(SUM(tds), 0) as tds_total')
            ->first();

        return [
            'gross' => (float) ($totals->gross_total ?? 0),
            'tds' => (float) ($totals->tds_total ?? 0),
        ];
    }

    private function autoApplyHolds(PayrollMonthlyRun $run): void
    {
        // Org scope is mandatory — a hold flagged in another tenant must not
        // silently delete this run's payroll items.
        $processingHolds = StopPaymentFlag::where('organization_id', $run->organization_id)
            ->where('month_year', $run->month_year)
            ->where('is_active', true)
            ->where('hold_type', 'processing')
            ->pluck('user_id');

        // Iterated rather than a mass delete so PayrollItemObserver sees it.
        // A stop-payment hold reaching a closed run would otherwise erase that
        // employee's money with no event fired and nothing to refuse it.
        PayrollItem::where('payroll_run_id', $run->id)
            ->whereIn('user_id', $processingHolds)
            ->cursor()
            ->each(fn (PayrollItem $item) => $item->delete());
    }

    private function calculateAllItems(PayrollMonthlyRun $run): void
    {
        $items = PayrollItem::with('user.employeePayrollTemplate')->where('payroll_run_id', $run->id)->get();

        // Calendar month of the run, used for special-month PT instalments.
        $ptMonth = (int) (explode('-', $run->month_year)[1] ?? 0) ?: null;

        // Loaded once, outside the loop: the Code on Wages adoption date is a
        // per-organisation setting and re-reading it per employee would be a
        // query per row for a value that cannot change mid-run.
        // Organization is deliberately outside BelongsToOrganization — it IS
        // the tenant — so there is no scope to bypass here.
        $codeOnWagesAdoptedFrom = \App\Models\Organization::query()
            ->whereKey($run->organization_id)
            ->value('code_on_wages_effective_from');
        $codeOnWagesAdoptedFrom = $codeOnWagesAdoptedFrom
            ? \Carbon\Carbon::parse($codeOnWagesAdoptedFrom)->toDateString()
            : null;

        $totals = [
            'total_gross' => 0, 'total_deductions' => 0, 'total_net_pay' => 0,
            'total_employer_contributions' => 0, 'total_pf_employee' => 0, 'total_pf_employer' => 0,
            'total_esi_employee' => 0, 'total_esi_employer' => 0, 'total_pt' => 0, 'total_tds' => 0,
        ];

        /** @var list<string> $excluded Names of people this run could not compute. */
        $excluded = [];
        $calculated = 0;

        foreach ($items as $item) {
            $template = $item->user->employeePayrollTemplate;
            if (!$template) {
                $excluded[] = ($item->user->name ?? "User #{$item->user_id}").' (no payroll template)';
                $item->delete();
                continue;
            }

            /*
             * Resolved through the compensation timeline rather than read
             * straight off the template, which fixes two things at once.
             *
             * A revision effective mid-month used to pay the new rate for the
             * whole month, because effective_from was ignored entirely. And a
             * future-dated revision took effect the moment it was accepted,
             * because accepting overwrites annual_ctc immediately -- so a raise
             * agreed in June and effective in August was paid in June.
             *
             * The timeline splits the month at the revision date, rates each
             * segment, and blends them over the pay period's day count. A month
             * with no revision returns the template's rate unchanged, so this
             * costs nothing for the ordinary case.
             */
            $annualCtc = app(\App\Services\Payroll\CompensationTimeline::class)
                ->blendedAnnualCtcForMonth(
                    (int) $item->user_id,
                    (int) $run->organization_id,
                    (string) $run->month_year
                );

            // The timeline reads the template as its starting point, so a zero
            // here means the same thing it always did: no CTC configured.
            if ($annualCtc <= 0) {
                $annualCtc = (float) ($template->annual_ctc ?? 0);
            }

            /*
             * An employee with no annual CTC is not configured, and there is
             * no defensible figure to pay them.
             *
             * This used to fall straight through to $annualCtc / 12 == 0, so
             * every component computed to zero and the run recorded a ₹0
             * gross, ₹0 net and a ₹0 payslip as a successful result — while
             * SalaryCalculationService, computing the same person's payslip,
             * threw outright. On a live pay group 11 of 15 members were in
             * this state, which is where every ₹0 on the payroll dashboard
             * came from.
             *
             * They are excluded rather than paid zero, and named on the run
             * rather than dropped quietly. The item is removed so a ₹0 line
             * cannot reach a payslip or a bank file; the checklist's
             * missing_ctc check is what tells HR who to fix.
             */
            if ($annualCtc <= 0) {
                $excluded[] = ($item->user->name ?? "User #{$item->user_id}").' (no annual CTC)';
                $item->delete();
                continue;
            }

            $monthlyCtc = $annualCtc / 12;
            $lopDays = (float) ($item->lOP_days ?? 0);

            /*
             * The per-day divisor is the CALENDAR month by default, not the
             * working-day count. Payment of Wages Act s.9(2) caps a deduction
             * for absence at the proportion the absent period bears to the
             * wage period, and the wage period is the calendar month — so one
             * absent day may cost at most 1/30 of wages, never 1/22. It is
             * also what EPFO reconciles NCP days against, and what every
             * comparable product defaults to.
             */
            $dayBasis = $this->dayBasis->resolve(
                $run->organization,
                $run->month_year,
                (float) ($item->total_working_days ?? 0)
            );
            $totalDays = $dayBasis['days'];
            $basicPct = (float) ($template->basic_percentage ?? 40) / 100;
            $hraPct = (float) ($template->hra_percentage ?? 50) / 100;
            $isMetro = $template->is_metro_city ?? true;
            // No default state. Professional tax is levied by the state the
            // employee works in, and several — Delhi, Haryana, Uttar Pradesh —
            // do not levy it at all. Falling back to 'maharashtra' meant an
            // unconfigured organization deducted ₹200 a month from everyone,
            // including people who owe nothing. An empty state yields ₹0 from
            // PTStateService, so an unconfigured setup under-deducts (which is
            // correctable) rather than taking money that was never owed.
            $state = $template->pt_state ?: '';
            $pfEnabled = $template->pf_enabled;
            $esiEnabled = $template->esi_enabled;

            /*
             * Gross is the FULL month. Loss of pay is applied exactly once,
             * below, as an explicit lopDeduction line.
             *
             * This used to also pro-rate gross by (totalDays - lopDays)/totalDays
             * and then subtract a lopDeduction computed off that already-reduced
             * gross, charging every LOP day twice. Pro-rating here would also
             * turn lopDays > totalDays into a negative factor and cascade a
             * negative gross, basic and PF base through the whole calculation.
             */
            /*
             * One definition of gross, shared with every other engine.
             *
             * This used to set gross = monthly CTC, which pays the employer's
             * own PF contribution and gratuity provision to the employee as
             * special allowance: on a ₹6,00,000 CTC the employer spent the
             * whole ₹50,000 on wages and then funded ₹1,800 PF and ₹962
             * gratuity on top — ₹2,762 a month per head over the agreed cost.
             * Code on Wages s.2(y) excludes both from "wages".
             */
            $structureConfig = [
                'basic_percentage' => $basicPct,
                'hra_percentage_of_basic' => $hraPct,
                'conveyance_allowance' => (float) ($template->conveyance_allowance ?? 1600),
            ];

            $components = $this->calculator->calculateSalaryComponents($monthlyCtc, $structureConfig);

            /*
             * Approved overrides apply here, at process time — not when they
             * were saved.
             *
             * That timing is deliberate and follows Keka: "Perform Process
             * Payroll to update the override information in the system." An
             * override that moved a payslip the moment it was entered would
             * restate months that are already closed, defeating the
             * immutability this whole engine now rests on.
             *
             * Returns with computed_value and cascade_snapshot written back to
             * the override rows, so the register can say what the engine would
             * have produced and which derived components moved as a result.
             */
            $overrideResult = app(\App\Services\Payroll\OverrideApplicationService::class)->apply(
                $components,
                (int) $item->user_id,
                (int) $run->organization_id,
                (string) $run->month_year,
                $monthlyCtc,
                $structureConfig,
            );

            $components = $overrideResult['components'];

            $monthlyGross = (float) $components['gross'];
            $basic = round((float) $components['basic'], 2);
            $hra = round((float) $components['hra'], 2);
            $conveyance = min((float) $components['conveyance'], $monthlyGross);
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
            // Capped at gross: a data-entry error where lopDays exceeds the
            // month's working days must not invent earnings to claw back.
            $lopDeduction = ($lopDays > 0 && $totalDays > 0)
                ? min(round($gross / $totalDays * $lopDays, 2), round($gross, 2))
                : 0;

            // Actual payable wages = gross minus LOP
            $payableGross = max(0, $gross - $lopDeduction);
            // For PF we pro-rate basic by the same factor that LOP took
            // off gross. When gross > 0 this is exact; if gross is 0 we
            // fall back to 0 to avoid a div-by-zero.
            $payableBasic = $gross > 0
                ? max(0, $basic - ($basic / $gross) * $lopDeduction)
                : 0;

            // PF applies to the basic actually earned, so it is computed on
            // payableBasic (basic less this month's LOP share) and not on the
            // full-month basic. The statutory wage ceiling is applied after
            // that reduction, per the EPF wage definition.
            $pfWages = min($payableBasic, 15000);
            $pfEmployee = $pfEnabled ? round($pfWages * 0.12, 2) : 0;
            $eps = $pfEnabled ? round($pfWages * 0.0833, 2) : 0;
            $epf = $pfEnabled ? round($pfWages * 0.0367, 2) : 0;
            $pfEmployer = $pfEmployee;

            /*
             * ESI eligibility is based on gross wages (before LOP) per the
             * ESI Act. Contribution itself is computed on payable wages
             * (after LOP) so partial-month absences reduce the contribution
             * without invalidating coverage.
             *
             * Coverage is also fixed for the whole contribution period
             * (Apr-Sep, Oct-Mar): someone covered at the start stays covered
             * to the end of it even after a raise takes them over the ceiling,
             * so the ceiling test alone would drop them a period early.
             */
            $esiApplicable = $esiEnabled && $this->esiPeriods->isCovered(
                (int) $item->user_id,
                (int) $run->organization_id,
                $run->month_year,
                $gross,
                21000
            );
            $esiEmployee = $esiApplicable ? round($payableGross * 0.0075, 2) : 0;
            $esiEmployer = $esiApplicable ? round($payableGross * 0.0325, 2) : 0;

            // PT on payable gross — applied to actual earned wages (after LOP).
            // The month drives special-month instalments (e.g. Maharashtra
            // February); omitting it under-collects PT for the year.
            // Resolved against the month being computed, not against today.
            // The slab table carries a date range precisely so that recomputing
            // March uses March's rate; a "current rate" lookup would hand a
            // corrected month a rate it never paid, and no report could then
            // explain the difference.
            $pt = app(\App\Services\Payroll\StatutorySlabResolver::class)
                ->professionalTax((string) $state, $payableGross, (string) $run->month_year);

            $tds = 0;
            if ($template->tds_enabled) {
                /*
                 * Cumulative year-to-date true-up, replacing
                 * "this month x 12, then divide by 12".
                 *
                 * The old form annualised whatever this month happened to be,
                 * so a month with loss of pay restated the employee's whole
                 * projected year downwards. For a high earner that can drop the
                 * estimate under the new regime's ₹12,00,000 rebate limit, at
                 * which point s.87A zeroes the liability and the month deducts
                 * nothing at all — with no later month to correct it in,
                 * because nothing ever trued up.
                 *
                 * Now: tax the year actually earned so far plus what remains,
                 * credit what has already been withheld, and spread the balance
                 * over the months that are left. Corrections flow forward, so a
                 * finalized month is never restated — which is what keeps this
                 * compatible with closed-run immutability instead of fighting it.
                 */
                $ytd = $this->financialYearToDate(
                    (int) $item->user_id,
                    (int) $run->organization_id,
                    (string) $run->month_year
                );

                $calendarMonth = (int) explode('-', (string) $run->month_year)[1];
                $monthsRemaining = 13 - PayrollCalculatorService::financialYearMonthIndex($calendarMonth);
                $monthsAfterThis = max(0, $monthsRemaining - 1);

                // getApprovedTaxDeductions returns a flat float total; the
                // tax calculator wants a per-section array. Pass the full
                // declaration map (or empty for "no exemptions") — the
                // calculator handles both.
                $exemptionMap = $this->calculator->getApprovedTaxDeductionMap($item->user_id);

                $trueUp = $this->calculator->calculateCumulativeMonthlyTds(
                    ytdGrossPaid: $ytd['gross'],
                    thisMonthGross: $payableGross,
                    // The best available estimate of the rest of the year is
                    // this month repeated. It is only an estimate, and that is
                    // fine: next month's true-up corrects it.
                    projectedRemainingGross: $payableGross * $monthsAfterThis,
                    previousEmployerGross: 0,
                    tdsAlreadyDeducted: $ytd['tds'],
                    previousEmployerTds: 0,
                    monthsRemainingInFy: $monthsRemaining,
                    taxRegime: $template->tax_regime === 'new' ? 'new' : 'old',
                    exemptions: $exemptionMap,
                    // Net the FBP exemption out of the tax base so only the
                    // portion of a taxable FBP component above its exemption
                    // limit is taxed. Non-taxable FBP (e.g. food coupons) is
                    // excluded entirely. Earnings are untouched.
                    annualTaxFreeAllowance: $this->fbp->getFbpTaxExclusion($item->user_id, $run->organization_id),
                );

                $tds = $trueUp['monthly_tds'];
            }

            /*
             * Statutory overrides are TERMINAL: the stated figure wins and
             * nothing downstream recomputes from it. Same rule, same point in
             * the calculation, as the departmental engine — both substitute
             * after wages are LOP-adjusted, because a stated figure replaces
             * the result rather than the input.
             */
            $statutory = app(\App\Services\Payroll\OverrideApplicationService::class)->applyStatutory([
                'pf' => (float) $pfEmployee,
                'esi' => (float) $esiEmployee,
                'pt' => (float) $pt,
                'tds' => (float) $tds,
            ], (int) $item->user_id, (string) $run->month_year);

            $pfEmployee = $statutory['pf'];
            $esiEmployee = $statutory['esi'];
            $pt = $statutory['pt'];
            $tds = $statutory['tds'];

            /*
             * Labour Welfare Fund. This run generates an LWF return further
             * down, but nothing ever deducted the contribution the return
             * reports — so the filing claimed money that had been withheld
             * from nobody. Computed from the same state table the return is
             * built from; a state with no LWF Act yields ₹0.
             */
            $lwf = $template->lwf_enabled
                ? $this->lwf->forMonth((string) $state, $ptMonth)
                : 0.0;

            /*
             * Loss of pay is NOT a deduction. Payment of Wages Act s.7(2) is an
             * exhaustive list of permitted deductions and absence is dealt with
             * by s.9, which authorises a proportionate REDUCTION IN WAGES
             * PAYABLE — wages for a day not worked were never earned, so there
             * is nothing to deduct them from.
             *
             * It therefore comes out of earnings, not deductions. Every
             * statutory return this feeds (ECR gross wages, ESI monthly wages,
             * 24Q gross total income, Form 16) is an earned-wage return, and a
             * full-month gross beside a positive NCP day count contradicts
             * itself on the face of the filing. Keeping LOP in the deduction
             * block also pushed printed deductions past 50% of printed gross on
             * a heavy-LOP month, which reads to an inspector as a s.7(3) breach
             * that never actually occurred.
             *
             * Net pay is unchanged: full - (lop + rest) == (full - lop) - rest.
             */
            $totalDeductions = $pfEmployee + $esiEmployee + $pt + $tds + $lwf;

            // Earnings reduced to what the paid days actually earned.
            $proration = $gross > 0 ? max(0.0, $payableGross / $gross) : 0.0;
            $earnedBasic = round($basic * $proration, 2);
            $earnedHra = round($hra * $proration, 2);
            $earnedConveyance = round($conveyance * $proration, 2);
            $earnedMedical = round($medical * $proration, 2);
            $earnedSpecial = round(max($specialAllowance, 0) * $proration, 2);
            // Stored signed, deliberately. Clamping with max(0, …) hid the one
            // case that most needs to stop a run: deductions overrunning gross,
            // which happens with a large recovery or a full month of unpaid
            // leave. The validation that is supposed to halt the run can only
            // see the problem if the real number survives to be looked at, and
            // a silent 0 reads as "this person is owed nothing" rather than
            // "this figure is wrong".
            $netPay = round($payableGross - $totalDeductions, 2);

            $gratuity = round($basic * 0.0481, 2);
            $totalEmployerContributions = $pfEmployer + $esiEmployer + $gratuity;

            /*
             * Code on Wages: record the base PF and gratuity were computed on,
             * and the rule that produced it.
             *
             * Resolved against the month being processed rather than against
             * today, so recomputing a pre-adoption month reproduces the figure
             * that month actually paid. An organisation that has not set an
             * adoption date stays on the old rule — defaulting it to the
             * commencement date would silently restate every structure in every
             * tenant on the next run.
             *
             * Measured against gross, not CTC: employer PF and the gratuity
             * provision are the employer's cost and are not remuneration
             * "payable to" the employee, so including them would inflate the
             * floor and over-deduct.
             *
             * Computed on EARNED wages, not the contracted full month. PF here
             * already applies to payable basic rather than full basic — a loss
             * of pay day reduces the contribution — so a wage base derived from
             * the full month would not be the base the contributions were
             * actually taken on, which is the one thing this column exists to
             * record.
             */
            $codeOnWages = app(\App\Services\Payroll\CodeOnWagesService::class);
            $wageBaseRule = $codeOnWages->ruleFor($codeOnWagesAdoptedFrom, (string) $run->month_year);
            $statutoryWageBase = $codeOnWages->statutoryWageBase($earnedBasic, $payableGross, $wageBaseRule);

            $item->update([
                'statutory_wage_base' => round($statutoryWageBase, 2),
                'wage_base_rule' => $wageBaseRule,
                'basic' => $earnedBasic,
                'hra' => $earnedHra,
                'conveyance' => $earnedConveyance,
                'medical' => $earnedMedical,
                'special_allowance' => $earnedSpecial,
                // Earned wages. The contracted rate is kept alongside so the
                // payslip can show both and arrears have something to work from.
                'gross_salary' => round($payableGross, 2),
                'gross_full_month' => round($gross, 2),
                'pf_employee' => $pfEmployee,
                'esi_employee' => $esiEmployee,
                'pt' => $pt,
                'tds' => $tds,
                'lwf' => $lwf,
                'lOP_deduction' => $lopDeduction,
                // Frozen so this payslip can be reproduced after the setting
                // changes. Re-deriving would silently rewrite the arithmetic
                // of an already-paid month.
                'salary_day_basis' => $dayBasis['basis'],
                'salary_divisor_days' => $totalDays,
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

            // The EARNED wage, not the contracted one.
            //
            // This accumulated $gross, the full contracted month, while the
            // two lines under it accumulate the actual post-LOP figures. One
            // header then mixed two scales, so gross - deductions did not
            // equal net anywhere it was displayed. Production, 2 Sep 2026:
            // header gross 763,630.83 against line items summing 221,685.87,
            // out by 541,944.96 on the dashboard. It is also how a month came
            // to show deductions larger than the gross they were taken from.
            //
            // $gross is still written to the item as gross_full_month, which
            // is where arrears and the payslip read the contracted rate.
            $totals['total_gross'] += $payableGross;
            $totals['total_deductions'] += $totalDeductions;
            $totals['total_net_pay'] += $netPay;
            $totals['total_employer_contributions'] += $totalEmployerContributions;
            $totals['total_pf_employee'] += $pfEmployee;
            $totals['total_pf_employer'] += $pfEmployer;
            $totals['total_esi_employee'] += $esiEmployee;
            $totals['total_esi_employer'] += $esiEmployer;
            $totals['total_pt'] += $pt;
            $totals['total_tds'] += $tds;
            $calculated++;
        }

        // total_employees counts people this run actually paid, not people it
        // was asked about. Counting $items included the excluded rows and made
        // a run of 15 with 11 unconfigured look like a run of 15.
        $update = array_merge($totals, [
            'total_employees' => $calculated,
            'status' => 'locked',
        ]);

        if ($excluded !== []) {
            $update['processing_message'] = sprintf(
                '%d of %d employee(s) were excluded because they are not configured for payroll: %s',
                count($excluded),
                $items->count(),
                implode('; ', $excluded)
            );
        }

        $run->update($update);
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
            ->whereIn('status', PayrollMonthlyRun::CLOSED_STATUSES)
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
            ->whereIn('status', PayrollMonthlyRun::CLOSED_STATUSES)
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
