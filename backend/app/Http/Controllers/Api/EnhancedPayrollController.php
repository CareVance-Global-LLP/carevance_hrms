<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\ArrearPayment;
use App\Models\EmployeeLoan;
use App\Models\EmployeePayrollTemplate;
use App\Models\FullAndFinalSettlement;
use App\Models\LeaveEncashment;
use App\Models\Organization;
use App\Models\PayrollItem;
use App\Models\EmployeeTaxDeclaration;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollCalculatorService;
use App\Services\PTStateService;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EnhancedPayrollController extends Controller
{
    protected PayrollCalculatorService $calculator;

    public function __construct(PayrollCalculatorService $calculator)
    {
        $this->calculator = $calculator;
    }

    /**
     * Read the org's `settings.payroll` block with the same defaults that
     * PayrollSettingsController exposes. Falls back to statutory defaults if
     * the org has nothing configured yet.
     */
    private function getPayrollConfig(int $orgId): array
    {
        $defaults = [
            'defaultBasicPercentage' => 40,
            'defaultHraPercentage' => 50,
            'defaultConveyance' => 1600,
            /*
             * No default professional-tax state. The key is kept, with null,
             * only because every reader here goes through `?? ''`;
             * PayrollSettingsController drops the key entirely because its
             * response has to distinguish "unanswered" from "answered: none".
             *
             * This one reached money. createArrear() below resolves
             * `$user->employeeProfile?->pt_state ?? $config['defaultState']`
             * and writes the result's slab into ArrearPayment.pt_on_arrear,
             * which is a stored, payable deduction — so an organisation that
             * had never named a state had Maharashtra's ₹200 slab differenced
             * onto every arrear it raised, for employees who may owe no
             * professional tax at all. null falls through to '' there, and
             * PTStateService prices '' at ₹0.
             */
            'defaultState' => null,
            'defaultTaxRegime' => 'new',
            'pfWageCap' => 15000,
            'esiThreshold' => 21000,
            'workingDaysPerMonth' => 26,
            'pfEmployeePercentage' => 12,
            'pfEmployerPercentage' => 12,
            'esiEmployeePercentage' => 0.75,
            'esiEmployerPercentage' => 3.25,
        ];
        $org = Organization::find($orgId);
        $orgSettings = $org?->settings['payroll'] ?? [];
        return array_merge($defaults, $orgSettings);
    }

    /**
     * Returns ['start' => 'YYYY-MM', 'end' => 'YYYY-MM', 'label' => 'YYYY-YYYY']
     * for the financial year containing the given month_year (YYYY-MM).
     * FY in India runs Apr-Mar.
     */
    private function getFinancialYearFromMonth(string $monthYear): array
    {
        [$y, $m] = array_map('intval', explode('-', $monthYear));
        if ($m >= 4) {
            return [
                'start' => sprintf('%d-04', $y),
                'end' => sprintf('%d-03', $y + 1),
                'label' => $y . '-' . ($y + 1),
            ];
        }
        return [
            'start' => sprintf('%d-04', $y - 1),
            'end' => sprintf('%d-03', $y),
            'label' => ($y - 1) . '-' . $y,
        ];
    }

    public function calculatePayroll(Request $request): JsonResponse
    {
        $request->validate([
            'annual_ctc' => 'required|numeric|min:0',
            'state_code' => 'nullable|string',
            'is_metro_city' => 'boolean',
            'tax_regime' => 'in:new,old',
        ]);

        try {
            $result = $this->calculator->calculatePayroll(
                annualCtc: $request->annual_ctc,
                // A caller that names no state gets no professional tax, not
                // somebody else's. This preview persists nothing, but it is
                // the number an admin quotes in an offer.
                stateCode: $request->state_code ?: '',
                isMetroCity: $request->is_metro_city ?? true,
                taxRegime: $request->tax_regime ?? 'new'
            );

            return response()->json([
                'success' => true,
                'data' => $result,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error calculating payroll: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function getCTCBreakdown(Request $request, int $userId): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $user = User::where('organization_id', $organizationId)
            ->where('id', $userId)
            ->firstOrFail();

        $template = EmployeePayrollTemplate::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->first();

        if (!$template) {
            return response()->json([
                'success' => false,
                'message' => 'Payroll template not found',
            ], 404);
        }

        $annualCtc = $template->annual_ctc ?? 0;

        if ($annualCtc <= 0) {
            return response()->json([
                'success' => false,
                'message' => 'CTC not configured for this employee',
            ], 400);
        }

        $result = $this->calculator->calculatePayroll(annualCtc: $annualCtc);

        return response()->json([
            'success' => true,
            'employee' => [
                'id' => $user->id,
                'name' => $user->name,
                'email' => $user->email,
            ],
            'ctc_breakdown' => [
                'annual_ctc' => $annualCtc,
                'monthly_ctc' => $annualCtc / 12,
                'monthly_details' => $result['monthly'],
                'annual_details' => $result['annual'],
                'components' => $result['components'],
                'breakdown' => $result['breakdown'],
            ],
        ]);
    }

    public function requestLeaveEncashment(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'leave_type' => 'required|in:earned,casual,sick,compensatory',
            'encashed_days' => 'required|integer|min:1',
            'eligible_days' => 'required|integer|min:1',
            'month_year' => 'required|string|size:7',
            'notes' => 'nullable|string',
        ]);

        $organizationId = $request->user()->organization_id;

        // Reject if a non-rejected encashment for this employee already exists for the same FY.
        $fy = $this->getFinancialYearFromMonth($request->month_year);
        $existingApproved = LeaveEncashment::where('organization_id', $organizationId)
            ->where('user_id', $request->user_id)
            ->where('status', 'approved')
            ->where('month_year', '>=', $fy['start'])
            ->where('month_year', '<=', $fy['end'])
            ->exists();
        if ($existingApproved) {
            return response()->json([
                'success' => false,
                'message' => "An approved leave encashment for FY {$fy['label']} already exists for this employee. Refunds/additional encashments must be raised as a separate F&F adjustment.",
            ], 422);
        }

        try {
            $user = User::where('organization_id', $organizationId)
                ->findOrFail($request->user_id);

            $template = EmployeePayrollTemplate::getOrCreateForUser($user->id, $organizationId);
            $config = $this->getPayrollConfig($organizationId);
            $annualCtc = $template->annual_ctc ?? 0;
            $workingDays = (int) ($config['workingDaysPerMonth'] ?? 26);

            if ($annualCtc <= 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot encash leave — employee has no annual_ctc set on their template.',
                ], 422);
            }

            if ($request->encashed_days > $request->eligible_days) {
                return response()->json([
                    'success' => false,
                    'message' => "Encashed days ({$request->encashed_days}) cannot exceed eligible balance ({$request->eligible_days}).",
                ], 422);
            }

            $monthlyGross = $annualCtc / 12;
            $ratePerDay = $monthlyGross / $workingDays;
            $totalAmount = $ratePerDay * $request->encashed_days;

            $pfDeduction = $template->pf_enabled
                ? $this->calculator->calculateEmployeePF(
                    $monthlyGross,
                    0,
                    (bool) $template->pf_above_cap
                )
                : 0;
            $taxDeduction = 0;

            $encashment = LeaveEncashment::create([
                'organization_id' => $organizationId,
                'user_id' => $user->id,
                'leave_type' => $request->leave_type,
                'eligible_days' => $request->eligible_days,
                'encashed_days' => $request->encashed_days,
                'balance_days' => $request->eligible_days - $request->encashed_days,
                'rate_per_day' => $ratePerDay,
                'total_amount' => $totalAmount,
                'pf_deduction' => $pfDeduction,
                'tax_deduction' => $taxDeduction,
                'net_amount' => $totalAmount - $pfDeduction - $taxDeduction,
                'status' => 'draft',
                'month_year' => $request->month_year,
                'requested_by' => auth()->id(),
                'notes' => $request->notes,
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Leave encashment request created',
                'data' => $encashment,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error creating leave encashment: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function listLeaveEncashments(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $query = LeaveEncashment::where('organization_id', $organizationId)
            ->with(['user:id,name,email', 'requester:id,name', 'approver:id,name'])
            ->orderBy('created_at', 'desc');

        if ($request->has('user_id') && $request->user_id) {
            $query->where('user_id', $request->user_id);
        }
        if ($request->has('status') && $request->status) {
            $query->where('status', $request->status);
        }

        $encashments = $query->get();

        return response()->json([
            'success' => true,
            'data' => $encashments,
        ]);
    }

    public function approveLeaveEncashment(Request $request, int $id): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $encashment = LeaveEncashment::where('organization_id', $organizationId)
            ->findOrFail($id);

        if ($encashment->status !== 'draft') {
            return response()->json([
                'success' => false,
                'message' => 'Leave encashment is not in draft status',
            ], 422);
        }

        // Immutability: cannot approve against a run that's already locked/approved/disbursed.
        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $encashment->month_year)
            ->first();
        if ($run && !in_array($run->status, ['draft', 'processing'], true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot approve — payroll run for {$encashment->month_year} is already {$run->status} and immutable.",
            ], 422);
        }

        $encashment->update([
            'status' => 'approved',
            'approved_by' => auth()->id(),
            'approved_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Leave encashment approved',
            'data' => $encashment->fresh(),
        ]);
    }

    public function rejectLeaveEncashment(Request $request, int $id): JsonResponse
    {
        $request->validate(['reason' => 'required|string']);

        $organizationId = $request->user()->organization_id;

        $encashment = LeaveEncashment::where('organization_id', $organizationId)
            ->findOrFail($id);

        $encashment->update([
            'status' => 'rejected',
            'rejection_reason' => $request->reason,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Leave encashment rejected',
            'data' => $encashment->fresh(),
        ]);
    }

    public function createArrear(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'arrear_month' => 'required|string|size:7',
            'calculation_month' => 'required|string|size:7',
            'arrear_type' => 'required|in:salary,increment,promotion,retrospective,settlement',
            'original_basic' => 'required|numeric|min:0',
            'revised_basic' => 'required|numeric|min:0',
            'original_gross' => 'required|numeric|min:0',
            'revised_gross' => 'required|numeric|min:0',
            'reason' => 'nullable|string',
        ]);

        $organizationId = $request->user()->organization_id;

        try {
            $user = User::where('organization_id', $organizationId)
                ->findOrFail($request->user_id);

            $basicDifference = $request->revised_basic - $request->original_basic;
            $grossDifference = $request->revised_gross - $request->original_gross;

            $config = $this->getPayrollConfig($organizationId);
            $pfRate = ((float) ($config['pfEmployeePercentage'] ?? 12)) / 100;
            $esiEmployeeRate = ((float) ($config['esiEmployeePercentage'] ?? 0.75)) / 100;
            $esiThreshold = (float) ($config['esiThreshold'] ?? 21000);
            $pfOnArrear = $basicDifference * $pfRate;

            // ESI coverage follows the employee's monthly wage, not the size of
            // the arrear. Testing the difference against the ceiling inverted
            // the rule in practice: someone on ₹1.1L — not ESI-covered at all —
            // was charged ESI because their ₹10k arrear fell under ₹21k, while
            // a genuinely covered employee receiving a large arrear was charged
            // nothing.
            $isEsiCovered = (float) $request->revised_gross <= $esiThreshold;
            $esiOnArrear = $isEsiCovered ? $grossDifference * $esiEmployeeRate : 0;

            $taxRegime = $user->employeePayrollTemplate?->tax_regime ?? 'new';
            $exemptionMap = $this->calculator->getApprovedTaxDeductionMap($user->id);
            $revisedTdsResult = $taxRegime === 'new'
                ? $this->calculator->calculateNewRegimeTax($request->revised_gross * 12, $exemptionMap)
                : $this->calculator->calculateOldRegimeTax($request->revised_gross * 12, $exemptionMap);
            $originalTdsResult = $taxRegime === 'new'
                ? $this->calculator->calculateNewRegimeTax($request->original_gross * 12, $exemptionMap)
                : $this->calculator->calculateOldRegimeTax($request->original_gross * 12, $exemptionMap);
            $tdsOnArrear = round(max(0, ($revisedTdsResult['total_tax'] ?? 0) - ($originalTdsResult['total_tax'] ?? 0)) / 12, 2);
            // Professional tax is a slab on monthly gross, so the arrear owes
            // the difference between the slab at the revised wage and the slab
            // already charged at the original one — the same delta the TDS
            // calculation above takes. Running the slab against the arrear
            // amount alone charged a fresh, unrelated slab.
            $ptState = $user->employeeProfile?->pt_state ?? $config['defaultState'] ?? '';
            $ptOnArrear = max(0, round(
                PTStateService::calculate($ptState, (float) $request->revised_gross)
                - PTStateService::calculate($ptState, (float) $request->original_gross),
                2
            ));

            $netArrear = $grossDifference - $pfOnArrear - $esiOnArrear - $tdsOnArrear - $ptOnArrear;

            $arrear = ArrearPayment::create([
                'organization_id' => $organizationId,
                'user_id' => $user->id,
                'arrear_month' => $request->arrear_month,
                'calculation_month' => $request->calculation_month,
                'arrear_type' => $request->arrear_type,
                'original_basic' => $request->original_basic,
                'revised_basic' => $request->revised_basic,
                'basic_difference' => $basicDifference,
                'original_gross' => $request->original_gross,
                'revised_gross' => $request->revised_gross,
                'gross_difference' => $grossDifference,
                'pf_on_arrear' => $pfOnArrear,
                'esi_on_arrear' => $esiOnArrear,
                'tds_on_arrear' => $tdsOnArrear,
                'pt_on_arrear' => $ptOnArrear,
                'net_arrear_amount' => $netArrear,
                'status' => 'draft',
                'reason' => $request->reason,
                'requested_by' => auth()->id(),
            ]);

            return response()->json([
                'success' => true,
                'message' => 'Arrear payment created',
                'data' => $arrear,
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error creating arrear: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function listArrears(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $query = ArrearPayment::where('organization_id', $organizationId)
            ->with(['user:id,name,email'])
            ->orderBy('created_at', 'desc');

        if ($request->has('user_id') && $request->user_id) {
            $query->where('user_id', $request->user_id);
        }
        if ($request->has('status') && $request->status) {
            $query->where('status', $request->status);
        }

        $arrears = $query->get();

        return response()->json([
            'success' => true,
            'data' => $arrears,
        ]);
    }

    public function approveArrear(Request $request, int $id): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $arrear = ArrearPayment::where('organization_id', $organizationId)
            ->findOrFail($id);

        if ($arrear->status !== 'draft') {
            return response()->json([
                'success' => false,
                'message' => "Arrear is already in '{$arrear->status}' state and cannot be re-approved.",
            ], 422);
        }

        // The arrear's "calculation_month" tells us which payroll run it must be applied to.
        // We look up the run + item, and if the run is already paid/released, we reject —
        // arrears must be applied before the run is locked for the period.
        $run = PayrollMonthlyRun::where('organization_id', $organizationId)
            ->where('month_year', $arrear->calculation_month)
            ->first();
        if (!$run) {
            return response()->json([
                'success' => false,
                'message' => "Payroll run for calculation_month {$arrear->calculation_month} does not exist. Create it first, then approve the arrear.",
            ], 422);
        }
        // Was in_array($run->status, ['paid', 'released']). Nothing ever writes
        // 'paid' to a run -- the statuses are draft, processing, locked,
        // approved, released, disbursed -- so this guard passed for 'approved'
        // and 'disbursed' and money could be written onto a disbursed run.
        // CLOSED_STATUSES is what the comment above already describes.
        if (in_array($run->status, PayrollMonthlyRun::CLOSED_STATUSES, true)) {
            return response()->json([
                'success' => false,
                'message' => "Cannot approve arrear — run {$arrear->calculation_month} is already {$run->status} and immutable.",
            ], 422);
        }

        $item = PayrollItem::where('payroll_run_id', $run->id)
            ->where('user_id', $arrear->user_id)
            ->first();
        if (!$item) {
            return response()->json([
                'success' => false,
                'message' => "Employee has no payroll_item in run {$arrear->calculation_month}. Process payroll for the run first, then approve the arrear.",
            ], 422);
        }

        // Apply the arrear as a consistent adjustment across gross, deductions
        // and net.
        //
        // Previously only `arrears` and `net_pay` moved: gross_salary and the
        // statutory deduction columns were left alone, so the row no longer
        // satisfied net = gross - deductions. Run totals then reported
        // total_net_pay > total_gross - total_deductions, the PF ECR
        // under-reported arrear PF, and the bank file paid money the payroll
        // register did not show.
        \DB::transaction(function () use ($arrear, $item) {
            $grossDifference = (float) $arrear->gross_difference;
            $pfOnArrear = (float) $arrear->pf_on_arrear;
            $esiOnArrear = (float) $arrear->esi_on_arrear;
            $ptOnArrear = (float) $arrear->pt_on_arrear;
            $tdsOnArrear = (float) $arrear->tds_on_arrear;
            $arrearDeductions = $pfOnArrear + $esiOnArrear + $ptOnArrear + $tdsOnArrear;

            $item->update([
                'arrears' => (float) $item->arrears + $grossDifference,
                'arrears_pf' => (float) $item->arrears_pf + $pfOnArrear,

                'gross_salary' => (float) $item->gross_salary + $grossDifference,
                'pf_employee' => (float) $item->pf_employee + $pfOnArrear,
                'esi_employee' => (float) $item->esi_employee + $esiOnArrear,
                'pt' => (float) $item->pt + $ptOnArrear,
                'tds' => (float) $item->tds + $tdsOnArrear,
                'total_deductions' => (float) $item->total_deductions + $arrearDeductions,

                // Store the signed figure. Flooring at zero here hid the fact
                // that deductions had overtaken gross: the payslip read ₹0.00,
                // and the "no negative salaries" validation — which tests
                // net_pay < 0 — could never fire because the value it inspects
                // had already been clamped. Payroll validation is what should
                // stop a run like this, and it can only do that if it can see
                // the real number.
                'net_pay' => round((float) $item->net_pay + $grossDifference - $arrearDeductions, 2),
            ]);

            $arrear->update([
                'status' => 'approved',
                'approved_by' => auth()->id(),
                'approved_at' => now(),
                'payroll_run_id' => $item->payroll_run_id,
            ]);
        });

        // Recompute run-level aggregates (gross, deductions, net_pay, totals)
        $this->recomputePayrollRunTotals($run->fresh());

        return response()->json([
            'success' => true,
            'message' => 'Arrear approved and applied to payroll run ' . $arrear->calculation_month,
            'data' => $arrear->fresh(),
        ]);
    }

    /**
     * Recompute PayrollMonthlyRun aggregate columns from its items.
     * Safe to call after any payroll_item mutation (arrears, encashment, etc).
     */
    /**
     * Rewrite the run header from its items.
     *
     * Tier-aware, and the awareness is subtler than filtering. The header must
     * equal the sum of the rows it summarises — that identity is what makes the
     * run reconcile against the bank file and the ECR — so this deliberately
     * sums EVERY item, locked or not. Summing only the settled ones would
     * understate a run by however many employees were still under review, and
     * hand the payroll officer a total that reconciles against nothing.
     *
     * The risk the lock tiers introduce is therefore not that the total is
     * wrong, but that it is read as final while three of two hundred are still
     * moving. That is answered by reporting settlement alongside the total
     * rather than by distorting it: a caller that needs to know whether the
     * figure can still change asks how many are unsettled.
     *
     * Restating a closed month's totals is safe for the same reason: money on a
     * closed run can only move through ClosedRunWriteContext::permit(), and
     * after such a correction the header MUST be restated or it stops matching
     * its own items.
     *
     * @return array{settled: int, unsettled: int, published: int}
     */
    private function recomputePayrollRunTotals(PayrollMonthlyRun $run): array
    {
        $items = PayrollItem::where('payroll_run_id', $run->id)->get();
        $run->update([
            'total_employees' => $items->count(),
            'total_gross' => $items->sum('gross_salary'),
            'total_deductions' => $items->sum('total_deductions'),
            'total_net_pay' => $items->sum('net_pay'),
            'total_employer_contributions' => $items->sum('total_employer_contributions'),
            'total_pf_employee' => $items->sum('pf_employee'),
            'total_pf_employer' => $items->sum('pf_employer'),
            'total_esi_employee' => $items->sum('esi_employee'),
            'total_esi_employer' => $items->sum('esi_employer'),
            'total_pt' => $items->sum('pt'),
            'total_tds' => $items->sum('tds'),
            'total_arrears' => $items->sum('arrears'),
        ]);

        $settled = $items->whereNotNull('locked_at')->count();

        return [
            'settled' => $settled,
            // Greater than zero means the totals above are provisional: they
            // are the true sum today and can still move tomorrow.
            'unsettled' => $items->count() - $settled,
            'published' => $items->whereNotNull('payslip_published_at')->count(),
        ];
    }

    public function rejectArrear(Request $request, int $id): JsonResponse
    {
        $request->validate(['reason' => 'required|string']);

        $organizationId = $request->user()->organization_id;

        $arrear = ArrearPayment::where('organization_id', $organizationId)
            ->findOrFail($id);

        $arrear->update([
            'status' => 'rejected',
            'rejection_reason' => $request->reason,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'Arrear rejected',
            'data' => $arrear->fresh(),
        ]);
    }

    public function createFnFSettlement(Request $request): JsonResponse
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'resignation_date' => 'required|date',
            'last_working_date' => 'required|date|after_or_equal:resignation_date',
            'exit_type' => 'required|in:resignation,termination,retirement,death,layoff',
            'notice_period_days' => 'required|integer|min:0',
            'served_days' => 'required|integer|min:0',
            'earned_leave_balance' => 'required|integer|min:0',
            'years_of_service' => 'required|numeric|min:0',
            'is_gratuity_eligible' => 'boolean',
        ]);

        $organizationId = $request->user()->organization_id;

        // Status gate: a single employee can only have one F&F in a non-terminal state.
        // Once paid, the F&F is immutable — finance must reject the existing one before
        // a new one can be drafted (e.g. discovery of a missed loan recovery).
        $existingActive = FullAndFinalSettlement::where('organization_id', $organizationId)
            ->where('user_id', $request->user_id)
            ->whereNotIn('status', ['rejected'])
            ->first();
        if ($existingActive) {
            return response()->json([
                'success' => false,
                'message' => "Cannot create a new F&F — employee already has an F&F (id: {$existingActive->id}) in '{$existingActive->status}' state. Reject the existing one first if you need to start over.",
                'existing_settlement_id' => $existingActive->id,
                'existing_status' => $existingActive->status,
            ], 422);
        }

        try {
            $user = User::where('organization_id', $organizationId)
                ->findOrFail($request->user_id);

            $template = EmployeePayrollTemplate::getOrCreateForUser($user->id, $organizationId);
            $config = $this->getPayrollConfig($organizationId);
            $annualCtc = $template->annual_ctc ?? 0;
            $basicPercentage = ($template->basic_percentage ?? ($config['defaultBasicPercentage'] ?? 40)) / 100;
            $workingDays = (int) ($config['workingDaysPerMonth'] ?? 26);

            if ($annualCtc <= 0) {
                return response()->json([
                    'success' => false,
                    'message' => 'Cannot create F&F — employee has no annual_ctc set on their template.',
                ], 422);
            }

            $basicSalary = ($annualCtc * $basicPercentage) / 12;
            // Notice pay divisor: standard 30 days/month for notice-period pay recovery (Factories Act 1948 §25F)
            $noticeDivisor = 30;

            $shortfallDays = max(0, $request->notice_period_days - $request->served_days);
            $noticePayRecovery = $shortfallDays > 0 ? ($basicSalary / $noticeDivisor) * $shortfallDays : 0;

            $monthlyGross = $annualCtc / 12;
            $ratePerDay = $monthlyGross / $workingDays;
            $leaveEncashment = $ratePerDay * $request->earned_leave_balance;

            // calculateGratuityForSettlement applies both statutory rules — the
            // five-year minimum and the maximum payout ceiling. The raw
            // calculateGratuityOnExit applies neither, so an eligibility check
            // duplicated here still left the ceiling entirely unenforced.
            $gratuityAmount = $request->is_gratuity_eligible
                ? $this->calculator->calculateGratuityForSettlement($basicSalary, (float) $request->years_of_service)
                : 0;

            $lastWorkingDate = Carbon::parse($request->last_working_date);
            $daysInMonth = $lastWorkingDate->daysInMonth;
            $daysWorked = $lastWorkingDate->day;
            $currentMonthSalary = ($monthlyGross / $daysInMonth) * $daysWorked;

            $activeLoan = EmployeeLoan::where('user_id', $user->id)
                ->where('status', 'approved')
                ->where('remaining_amount', '>', 0)
                ->first();
            $loanRecovery = $activeLoan ? $activeLoan->remaining_amount : 0;

            $settlement = FullAndFinalSettlement::create([
                'organization_id' => $organizationId,
                'user_id' => $user->id,
                'resignation_date' => $request->resignation_date,
                'last_working_date' => $request->last_working_date,
                'settlement_date' => now(),
                'exit_type' => $request->exit_type,
                'notice_period_days' => $request->notice_period_days,
                'served_days' => $request->served_days,
                'shortfall_days' => $shortfallDays,
                'notice_pay_recovery' => $noticePayRecovery,
                'basic_salary' => $basicSalary,
                'current_month_salary' => $currentMonthSalary,
                'earned_leave_balance' => $request->earned_leave_balance,
                'leave_encashment' => $leaveEncashment,
                'years_of_service' => $request->years_of_service,
                'gratuity_amount' => $gratuityAmount,
                'is_gratuity_eligible' => $request->is_gratuity_eligible ?? false,
                'loan_recovery' => $loanRecovery,
                'status' => 'draft',
                'prepared_by' => auth()->id(),
            ]);

            $settlement->calculateNetSettlement();
            $settlement->save();

            return response()->json([
                'success' => true,
                'message' => 'F&F settlement created',
                'data' => $settlement->fresh(),
            ]);
        } catch (\Exception $e) {
            return response()->json([
                'success' => false,
                'message' => 'Error creating F&F settlement: ' . $e->getMessage(),
            ], 500);
        }
    }

    public function listFnFSettlements(Request $request): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $query = FullAndFinalSettlement::where('organization_id', $organizationId)
            ->with(['user:id,name,email', 'preparer:id,name', 'approver:id,name'])
            ->orderBy('created_at', 'desc');

        if ($request->has('user_id') && $request->user_id) {
            $query->where('user_id', $request->user_id);
        }
        if ($request->has('status') && $request->status) {
            $query->where('status', $request->status);
        }

        $settlements = $query->get();

        return response()->json([
            'success' => true,
            'data' => $settlements,
        ]);
    }

    public function getFnFSettlement(Request $request, int $id): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $settlement = FullAndFinalSettlement::where('organization_id', $organizationId)
            ->with(['user:id,name,email', 'preparer:id,name', 'approver:id,name'])
            ->findOrFail($id);

        return response()->json([
            'success' => true,
            'data' => $settlement,
        ]);
    }

    public function approveFnFSettlement(Request $request, int $id): JsonResponse
    {
        $organizationId = $request->user()->organization_id;

        $settlement = FullAndFinalSettlement::where('organization_id', $organizationId)
            ->findOrFail($id);

        if (!in_array($settlement->status, ['draft', 'pending'])) {
            return response()->json([
                'success' => false,
                'message' => 'Settlement cannot be approved in current status',
            ], 422);
        }

        $settlement->update([
            'status' => 'approved',
            'approved_by' => auth()->id(),
            'approved_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'F&F settlement approved',
            'data' => $settlement->fresh(),
        ]);
    }

    public function rejectFnFSettlement(Request $request, int $id): JsonResponse
    {
        $request->validate(['reason' => 'required|string']);

        $organizationId = $request->user()->organization_id;

        $settlement = FullAndFinalSettlement::where('organization_id', $organizationId)
            ->findOrFail($id);

        $settlement->update([
            'status' => 'rejected',
            'rejection_reason' => $request->reason,
        ]);

        return response()->json([
            'success' => true,
            'message' => 'F&F settlement rejected',
            'data' => $settlement->fresh(),
        ]);
    }

    public function processFnFPayment(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'payment_method' => 'required|in:bank_transfer,cash,cheque',
            'payment_reference' => 'nullable|string',
        ]);

        $organizationId = $request->user()->organization_id;

        $settlement = FullAndFinalSettlement::where('organization_id', $organizationId)
            ->findOrFail($id);

        if ($settlement->status !== 'approved') {
            return response()->json([
                'success' => false,
                'message' => 'Settlement must be approved before payment',
            ], 422);
        }

        $settlement->update([
            'status' => 'paid',
            'payment_method' => $request->payment_method,
            'payment_reference' => $request->payment_reference,
            'paid_at' => now(),
        ]);

        return response()->json([
            'success' => true,
            'message' => 'F&F payment processed',
            'data' => $settlement->fresh(),
        ]);
    }

    public function compareTaxRegimes(Request $request): JsonResponse
    {
        $request->validate([
            'annual_ctc' => 'required|numeric|min:0',
            'exemptions' => 'nullable|array',
            'is_metro' => 'boolean',
        ]);

        $calculator = app(PayrollCalculatorService::class);
        $annualCtc = $request->annual_ctc;
        $exemptions = $request->exemptions ?? [];
        $isMetro = $request->boolean('is_metro', true);

        $newRegime = $calculator->calculateNewRegimeTax($annualCtc, $exemptions);
        $oldRegime = $calculator->calculateOldRegimeTax($annualCtc, $exemptions);

        $standardDeductionOld = 50000;
        $standardDeductionNew = 75000;

        $taxableOld = max(0, $annualCtc - $standardDeductionOld);
        $taxableNew = max(0, $annualCtc - $standardDeductionNew);

        $oldTax = $oldRegime['total_tax'] ?? 0;
        $newTax = $newRegime['total_tax'] ?? 0;

        $savings = (float) $oldTax - (float) $newTax;
        $recommended = $savings > 0 ? 'new' : 'old';

        // `total_tax` from both engines ALREADY includes the 4% health &
        // education cess (and surcharge, and the 87A rebate). This block used
        // to multiply it by 1.04 again and synthesise `cess` as total x 0.04,
        // overstating both regimes by 4% — enough to flip the recommendation.
        // Read the engine's own breakdown instead of re-deriving it.
        return response()->json([
            'success' => true,
            'data' => [
                'new_regime' => [
                    'gross_income' => $annualCtc,
                    'standard_deduction' => $standardDeductionNew,
                    'taxable_income' => $newRegime['taxable_income'] ?? $taxableNew,
                    'tax' => $newRegime['tax_before_cess'] ?? 0,
                    'rebate_87a' => $newRegime['rebate_87a'] ?? 0,
                    'surcharge' => $newRegime['surcharge'] ?? 0,
                    'cess' => $newRegime['cess'] ?? 0,
                    'total_tax' => $newTax,
                    'take_home' => $annualCtc - $newTax,
                    'effective_rate' => $newRegime['effective_rate'] ?? 0,
                ],
                'old_regime' => [
                    'gross_income' => $annualCtc,
                    'standard_deduction' => $standardDeductionOld,
                    'taxable_income' => $oldRegime['taxable_income'] ?? $taxableOld,
                    'tax' => $oldRegime['tax_before_cess'] ?? 0,
                    'rebate_87a' => $oldRegime['rebate_87a'] ?? 0,
                    'surcharge' => $oldRegime['surcharge'] ?? 0,
                    'cess' => $oldRegime['cess'] ?? 0,
                    'total_tax' => $oldTax,
                    'take_home' => $annualCtc - $oldTax,
                    'effective_rate' => $oldRegime['effective_rate'] ?? 0,
                ],
                'recommended' => $recommended,
                'savings' => round(abs($savings), 2),
                'savings_pct' => $oldTax > 0 ? round(abs($savings) / $oldTax * 100, 1) : 0,
                'difference' => round($savings, 2),
            ],
        ]);
    }

    public function taxSavingsRecommendation(Request $request): JsonResponse
    {
        $request->validate([
            'financial_year' => 'nullable|string',
        ]);

        $userId = $request->user()->id;
        $financialYear = $request->input('financial_year', $this->getCurrentFinancialYear());

        $decl = EmployeeTaxDeclaration::with('items')
            ->where('user_id', $userId)
            ->where('financial_year', $financialYear)
            ->where('status', 'approved')
            ->first();

        $annualGross = (float) ($decl->projected_annual_gross ?? 0);
        if ($annualGross === 0) {
            $emp = \App\Models\Employee::where('user_id', $userId)->first();
            $annualGross = (float) ($emp->current_ctc ?? 0);
        }

        $calc = app(PayrollCalculatorService::class);
        $currentTax = $calc->calculateMonthlyTDS($annualGross, 'old', $this->flattenDeclarations($decl))['annual_tax']['total_tax'] ?? 0;
        $marginalRate = $this->marginalRateOldRegime($annualGross);

        $recommendations = [
            ['section' => '80C', 'cap' => 150000, 'remaining' => max(0, 150000 - (float) ($decl?->section_80c_total ?? 0)),
             'advice' => 'PPF, ELSS, LIC, Home Loan Principal, Tuition Fees', 'potential_saving' => min(150000 - (float) ($decl?->section_80c_total ?? 0), 150000) * $marginalRate],
            ['section' => '80CCD1B', 'cap' => 50000, 'remaining' => max(0, 50000 - (float) ($decl?->section_80ccd1b ?? 0)),
             'advice' => 'NPS Tier-1 additional contribution (over and above 80C)', 'potential_saving' => max(0, 50000 - (float) ($decl?->section_80ccd1b ?? 0)) * $marginalRate],
            ['section' => '80D', 'cap' => 25000, 'remaining' => max(0, 25000 - (float) ($decl?->section_80d ?? 0)),
             'advice' => 'Health insurance premium (self + family); ₹50,000 cap if parents are senior citizens', 'potential_saving' => max(0, 25000 - (float) ($decl?->section_80d ?? 0)) * $marginalRate],
            ['section' => '24B', 'cap' => 200000, 'remaining' => max(0, 200000 - (float) ($decl?->section_24b ?? 0)),
             'advice' => 'Home loan interest (let-out property)', 'potential_saving' => max(0, 200000 - (float) ($decl?->section_24b ?? 0)) * $marginalRate],
        ];

        usort($recommendations, fn($a, $b) => $b['potential_saving'] <=> $a['potential_saving']);

        return response()->json([
            'success' => true,
            'data' => [
                'current_tax' => round($currentTax, 2),
                'marginal_rate' => $marginalRate,
                'recommendations' => $recommendations,
                'total_potential_saving' => round(array_sum(array_column($recommendations, 'potential_saving')), 2),
            ],
        ]);
    }

    public function bulkUpdateTaxRegime(Request $request): JsonResponse
    {
        $request->validate([
            'user_ids' => 'required|array|min:1',
            'tax_regime' => 'required|in:new,old',
            'financial_year' => 'nullable|string',
        ]);

        $organizationId = $request->user()->organization_id;
        $taxRegime = $request->tax_regime;
        $financialYear = $request->input('financial_year', $this->getCurrentFinancialYear());

        $updated = 0;
        foreach ($request->user_ids as $userId) {
            $user = \App\Models\User::where('organization_id', $organizationId)->find($userId);
            if (!$user) continue;

            $profile = $user->employeePayrollTemplate;
            if ($profile) {
                $profile->update(['tax_regime' => $taxRegime]);
                $updated++;
            }
        }

        return response()->json([
            'success' => true,
            'message' => "Updated {$updated} employee(s) to {$taxRegime} regime",
            'updated_count' => $updated,
        ]);
    }

    public function hraOptimization(Request $request): JsonResponse
    {
        $request->validate([
            'basic_salary' => 'required|numeric|min:0',
            'hra_received' => 'required|numeric|min:0',
            'rent_paid' => 'required|numeric|min:0',
            'is_metro' => 'boolean',
        ]);

        $calculator = app(PayrollCalculatorService::class);
        $result = $calculator->calculateHraExemption(
            $request->hra_received,
            $request->basic_salary,
            $request->rent_paid,
            $request->boolean('is_metro', true)
        );

        return response()->json([
            'success' => true,
            'data' => [
                'hra_received' => $request->hra_received,
                'basic_salary' => $request->basic_salary,
                'rent_paid' => $request->rent_paid,
                'is_metro' => $request->boolean('is_metro', true),
                'hra_exemption' => $result,
                'tax_saving' => $result * 0.30,
            ],
        ]);
    }

    protected function getCurrentFinancialYear(): string
    {
        $now = now();
        $year = $now->month >= 4 ? $now->year : $now->year - 1;
        return "{$year}-" . ($year + 1);
    }

    protected function flattenDeclarations(?\App\Models\EmployeeTaxDeclaration $decl): array
    {
        if (!$decl) return [];
        $items = $decl->items ?? [];
        $flat = [];
        foreach ($items as $item) {
            $section = $item->section ?? 'other';
            $flat[$section] = (float) ($item->approved_amount ?? $item->declared_amount ?? 0);
        }
        return $flat;
    }

    protected function marginalRateOldRegime(float $annualGross): float
    {
        if ($annualGross <= 250000) return 0;
        if ($annualGross <= 500000) return 0.05;
        if ($annualGross <= 1000000) return 0.20;
        return 0.30;
    }
}