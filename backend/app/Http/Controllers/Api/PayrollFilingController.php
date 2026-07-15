<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayGroup;
use App\Models\PayrollFiling;
use App\Models\PayrollItem;
use App\Models\PayrollMonthlyRun;
use App\Models\User;
use App\Services\PayrollFilingService;
use App\Services\PayrollRegisterService;
use App\Services\BankIntegrationService;
use App\Services\TaxSimulatorService;
use App\Services\SalaryRevisionService;
use App\Services\ArrearCalculatorService;
use App\Services\VariablePayEngine;
use App\Services\PayrollChecklistService;
use App\Services\FbpService;
use App\Services\PerquisiteCalculator;
use App\Services\SalaryFormulaEngine;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Storage;

class PayrollFilingController extends Controller
{
    public function generatePfEcr(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $filing = $filingService->generatePfEcr($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateEsiChallan(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $filing = $filingService->generateEsiChallan($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateForm24Q(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $filing = $filingService->generateForm24Q($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateForm16(Request $request, PayrollFilingService $filingService)
    {
        $data = $request->validate([
            'user_id' => 'required|exists:users,id',
            'financial_year' => 'required|string|regex:/^\d{4}-\d{4}$/',
        ]);

        try {
            $filing = $filingService->generateForm16(
                $data['user_id'],
                $data['financial_year'],
                auth()->user()->organization_id,
                auth()->id()
            );
            return response()->json($filing);
        } catch (\RuntimeException $e) {
            // Return a user-friendly error when no payroll data exists
            if (strpos($e->getMessage(), 'No payroll items found') !== false) {
                return response()->json([
                    'success' => false,
                    'message' => 'No payroll data found for this financial year. Please process payroll before generating Form 16.',
                    'error_code' => 'NO_PAYROLL_DATA'
                ], 422);
            }
            // Re-throw other runtime exceptions
            throw $e;
        }
    }

    public function generateForm12BA(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $filing = $filingService->generateForm12BA($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generatePtReturn(Request $request, PayrollFilingService $filingService)
    {
        $request->validate([
            'payroll_run_id' => 'required|exists:payroll_monthly_runs,id',
            'state' => 'required|string',
        ]);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $filing = $filingService->generatePtReturn($run, $request->state, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateLwfReturn(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $filing = $filingService->generateLwfReturn($run, auth()->user()->organization_id, auth()->id());
        return response()->json($filing);
    }

    public function generateAllFilings(Request $request, PayrollFilingService $filingService)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $filings = $filingService->generateAllFilings($run, auth()->user()->organization_id, auth()->id());
        return response()->json(['filings' => $filings, 'count' => count($filings)]);
    }

    public function listFilings(Request $request)
    {
        $query = PayrollFiling::where('organization_id', auth()->user()->organization_id);

        if ($request->type) $query->where('type', $request->type);
        if ($request->status) $query->where('status', $request->status);
        if ($request->period_year) $query->where('period_year', $request->period_year);

        return response()->json($query->orderBy('created_at', 'desc')->paginate(20));
    }

    public function downloadFiling(int $id)
    {
        $filing = PayrollFiling::where('id', $id)
            ->where('organization_id', auth()->user()->organization_id)
            ->firstOrFail();

        if (!$filing->file_path || !Storage::disk('local')->exists($filing->file_path)) {
            return response()->json(['error' => 'File not found'], 404);
        }

        return Storage::disk('local')->download($filing->file_path, $filing->original_filename);
    }

    public function getFiling(int $id)
    {
        $filing = PayrollFiling::with(['generatedBy', 'filedBy'])
            ->where('organization_id', auth()->user()->organization_id)
            ->findOrFail($id);
        return response()->json($filing);
    }

    // FBP
    public function getFbpComponents(FbpService $fbp)
    {
        return response()->json($fbp->getAllocateComponent(auth()->user()->organization_id));
    }

    public function getFbpAllocation(FbpService $fbp, int $userId)
    {
        return response()->json($fbp->getAllocationForUser($userId, auth()->user()->organization_id));
    }

    public function allocateFbp(Request $request, FbpService $fbp)
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'fbp_component_id' => 'required|exists:fbp_components,id',
            'amount' => 'required|numeric|min:0',
        ]);
        $allocation = $fbp->allocateOrUpdate(
            $request->user_id, auth()->user()->organization_id,
            $request->fbp_component_id, $request->amount
        );
        return response()->json($allocation);
    }

    public function submitFbpClaim(Request $request, FbpService $fbp)
    {
        $request->validate([
            'fbp_allocation_id' => 'required|exists:fbp_allocations,id',
            'fbp_component_id' => 'required|exists:fbp_components,id',
            'claimed_amount' => 'required|numeric|min:0',
            'user_id' => 'required|exists:users,id',
            'bill_number' => 'nullable|string',
            'bill_date' => 'nullable|date',
            'description' => 'nullable|string',
        ]);
        $claim = $fbp->submitClaim(array_merge($request->all(), [
            'organization_id' => auth()->user()->organization_id,
        ]));
        return response()->json($claim, 201);
    }

    public function approveFbpClaim(Request $request, FbpService $fbp, int $id)
    {
        $request->validate(['approved_amount' => 'required|numeric|min:0']);
        $claim = $fbp->approveClaim($id, auth()->id(), $request->approved_amount, $request->month_year);
        return response()->json($claim);
    }

    public function rejectFbpClaim(Request $request, FbpService $fbp, int $id)
    {
        $request->validate(['reason' => 'required|string']);
        $claim = $fbp->rejectClaim($id, auth()->id(), $request->reason);
        return response()->json($claim);
    }

    // Perquisites
    public function createPerquisite(Request $request, PerquisiteCalculator $calc)
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'type' => 'required|string|in:car,accommodation,esop,sweeper,gardener,domestic_help,gas_electricity,free_food,education,others',
            'monthly_value' => 'required|numeric|min:0',
            'details' => 'nullable|array',
        ]);
        $record = $calc->createPerquisiteRecord(
            $request->user_id, auth()->user()->organization_id,
            $request->type, $request->monthly_value, $request->details ?? []
        );
        return response()->json($record, 201);
    }

    public function getUserPerquisites(PerquisiteCalculator $calc, int $userId)
    {
        return response()->json($calc->calculateAllPerquisites($userId, auth()->user()->organization_id));
    }

    // Tax Simulator
    public function compareTaxRegimes(Request $request, TaxSimulatorService $simulator)
    {
        $request->validate(['annual_ctc' => 'required|numeric|min:0']);
        return response()->json($simulator->compareRegimes(
            $request->annual_ctc,
            $request->exemptions ?? [],
            $request->is_metro ?? true,
        ));
    }

    public function taxWhatIf(Request $request, TaxSimulatorService $simulator)
    {
        $request->validate([
            'current_ctc' => 'required|numeric|min:0',
            'scenarios' => 'required|array',
        ]);
        return response()->json($simulator->whatIfScenario($request->current_ctc, $request->scenarios));
    }

    public function calculateMonthlyTakeHome(Request $request, TaxSimulatorService $simulator)
    {
        $request->validate(['annual_ctc' => 'required|numeric|min:0']);
        return response()->json($simulator->calculateMonthlyTakeHome(
            $request->annual_ctc, $request->regime ?? 'new', $request->exemptions ?? []
        ));
    }

    // Salary Revision
    public function generateRevisionLetter(Request $request, SalaryRevisionService $service)
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'new_ctc' => 'required|numeric|min:0',
            'revision_type' => 'required|in:annual_increment,promotion,correction,other',
            'reason' => 'required|string',
        ]);
        $letter = $service->generateLetter(
            $request->user_id, auth()->user()->organization_id,
            $request->new_ctc, $request->revision_type, $request->reason, auth()->id()
        );
        return response()->json($letter);
    }

    public function getRevisionLetters(Request $request, SalaryRevisionService $service, ?int $userId = null)
    {
        $uid = $userId ?? auth()->id();
        return response()->json($service->getLetterHistory($uid, auth()->user()->organization_id));
    }

    public function acceptRevisionLetter(SalaryRevisionService $service, int $id)
    {
        return response()->json($service->acceptLetter($id, auth()->id()));
    }

    public function rejectRevisionLetter(SalaryRevisionService $service, int $id)
    {
        return response()->json($service->rejectLetter($id, auth()->id()));
    }

    // Checklist
    public function runPayrollValidation(Request $request, PayrollChecklistService $service)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        return response()->json($service->runFullValidation(
            $request->payroll_run_id, auth()->user()->organization_id, auth()->id()
        ));
    }

    public function getChecklistStatus(PayrollChecklistService $service, int $runId)
    {
        return response()->json($service->getRunChecklistStatus($runId));
    }

    public function resolveCheck(Request $request, PayrollChecklistService $service)
    {
        $request->validate([
            'check_id' => 'required|exists:payroll_run_checklists,id',
            'resolution' => 'required|string',
        ]);
        return response()->json($service->resolveCheck($request->check_id, $request->resolution, auth()->id()));
    }

    // Arrears
    public function detectCtcArrears(Request $request, ArrearCalculatorService $service, int $userId)
    {
        $request->validate(['current_month_year' => 'required|string']);
        return response()->json($service->detectCtcChanges(
            $userId, auth()->user()->organization_id, $request->current_month_year
        ));
    }

    public function calculateArrear(Request $request, ArrearCalculatorService $service)
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'month_year' => 'required|string',
            'amount' => 'required|numeric|min:0',
            'reason' => 'required|string',
        ]);
        $arrear = $service->calculateArrear(
            $request->user_id, auth()->user()->organization_id,
            $request->month_year, $request->amount, $request->reason
        );
        return response()->json($arrear);
    }

    // Variable Pay
    public function calculateVariablePay(Request $request, VariablePayEngine $engine)
    {
        $request->validate([
            'user_id' => 'required|exists:users,id',
            'payroll_item_id' => 'required|exists:payroll_items,id',
        ]);
        $item = \App\Models\PayrollItem::findOrFail($request->payroll_item_id);
        $amount = $engine->calculateVariablePay(
            $request->user_id, auth()->user()->organization_id, $item
        );
        return response()->json(['variable_pay' => $amount]);
    }

    // Payroll Register
    public function getPayrollRegister(Request $request, PayrollRegisterService $service)
    {
        $request->validate(['month_year' => 'required|string']);
        return response()->json($service->getPayrollRegister(
            auth()->user()->organization_id, $request->month_year, $request->filters ?? []
        ));
    }

    public function getStatutoryRegister(Request $request, PayrollRegisterService $service)
    {
        $request->validate([
            'month_year' => 'required|string',
            'type' => 'required|in:pf,esi,pt,tds',
        ]);
        return response()->json($service->getStatutoryRegister(
            auth()->user()->organization_id, $request->month_year, $request->type
        ));
    }

    public function getBankReconciliation(Request $request, PayrollRegisterService $service)
    {
        $request->validate(['month_year' => 'required|string']);
        return response()->json($service->getBankReconciliation(
            auth()->user()->organization_id, $request->month_year
        ));
    }

    // Bank Integration
    public function createTransferBatch(Request $request, BankIntegrationService $service)
    {
        $request->validate(['payroll_run_id' => 'required|exists:payroll_monthly_runs,id']);
        $run = PayrollMonthlyRun::findOrFail($request->payroll_run_id);
        $batch = $service->createTransferBatch($run, auth()->user()->organization_id, auth()->id(), $request->bank_name);
        return response()->json($batch);
    }

    public function processBatch(Request $request, BankIntegrationService $service, int $batchId)
    {
        $batch = \App\Models\BankTransferBatch::where('organization_id', auth()->user()->organization_id)
            ->findOrFail($batchId);
        return response()->json($service->processBatchTransfer($batch));
    }

    public function generateBankFile(Request $request, BankIntegrationService $service, int $batchId)
    {
        $batch = \App\Models\BankTransferBatch::where('organization_id', auth()->user()->organization_id)
            ->findOrFail($batchId);
        $path = $service->generateBankFile($batch, $request->format ?? 'csv');
        return response()->json(['file_path' => $path, 'download_url' => Storage::disk('local')->url($path)]);
    }

    public function initiatePaymentReversal(Request $request, BankIntegrationService $service)
    {
        $request->validate([
            'payroll_item_id' => 'required|exists:payroll_items,id',
            'reason' => 'required|string',
        ]);
        $reversal = $service->initiatePaymentReversal($request->payroll_item_id, $request->reason, auth()->id());
        return response()->json($reversal);
    }

    // Formula Engine
    public function evaluateFormula(Request $request, SalaryFormulaEngine $engine)
    {
        $request->validate(['expression' => 'required|string']);
        $result = $engine->setVariables($request->variables ?? [])->evaluate($request->expression);
        return response()->json(['expression' => $request->expression, 'result' => $result]);
    }

    public function validateFormula(Request $request, SalaryFormulaEngine $engine)
    {
        $request->validate(['expression' => 'required|string']);
        return response()->json(['valid' => $engine->validateFormula($request->expression)]);
    }

    // Pay Groups
    public function storePayGroup(Request $request)
    {
        $data = $request->validate([
            'name' => 'required|string',
            'code' => 'required|string|unique:pay_groups,code',
            'description' => 'nullable|string',
            'pay_frequency' => 'required|in:monthly,weekly,biweekly,daily',
            'pay_day' => 'nullable|integer|min:1|max:31',
            'pay_day_type' => 'required|in:specific,last_working_day,last_day',
            'salary_template_id' => 'nullable|exists:salary_templates,id',
        ]);
        $data['organization_id'] = auth()->user()->organization_id;
        return response()->json(\App\Models\PayGroup::create($data), 201);
    }

    /**
     * List all active pay groups in the caller's organization with
     * per-group payroll aggregates for the requested month.
     *
     * The response shape mirrors `getDepartments` so the dashboard
     * can render Pay Group cards in the same structure as
     * Department cards:
     *   { pay_groups: [{
     *       id, name, code, pay_frequency,
     *       employee_count, processed_count, paid_count, total_net_pay
     *   }] }
     *
     * The totals are computed in two batched queries per group to
     * avoid N+1 — one to load active assignments, and one to sum
     * payroll items for the month. Both run in O(1) queries per
     * group thanks to eager loading of the assignments relation.
     */
    public function listPayGroups(Request $request)
    {
        $orgId = auth()->user()->organization_id;
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        $payGroups = PayGroup::where('organization_id', $orgId)
            ->where('is_active', true)
            ->with(['assignments' => function ($q) {
                $q->where('is_active', true);
            }])
            ->get()
            ->map(function ($group) use ($monthYear) {
                $userIds = $group->assignments->pluck('user_id')->all();

                $items = empty($userIds)
                    ? collect()
                    : PayrollItem::whereIn('user_id', $userIds)
                        ->where('month_year', $monthYear)
                        ->get();

                $processedCount = $items
                    ->where('payment_status', '!=', 'pending')
                    ->count();
                $paidCount = $items
                    ->where('payment_status', 'paid')
                    ->count();
                $totalNetPay = (float) $items
                    ->where('payment_status', 'paid')
                    ->sum('net_pay');

                return [
                    'id' => $group->id,
                    'name' => $group->name,
                    'code' => $group->code,
                    'pay_frequency' => $group->pay_frequency,
                    'employee_count' => (int) $userIds ? count($userIds) : 0,
                    'processed_count' => $processedCount,
                    'paid_count' => $paidCount,
                    'total_net_pay' => $totalNetPay,
                ];
            })
            ->values();

        return response()->json(['pay_groups' => $payGroups]);
    }

    /**
     * Get the active employees in a pay group along with their
     * per-month payroll status, so the PayGroupEmployees view can
     * render the same kind of list as DepartmentEmployees.
     *
     * The response shape mirrors PayrollDepartmentEmployee so the
     * EmployeeCard component can be shared between the two views:
     *   {
     *     pay_group: { id, name, code, pay_frequency },
     *     employees: [{ id, name, email, role, employee_code,
     *                   designation, department, annual_ctc,
     *                   net_pay, payment_status, is_processed,
     *                   is_paid, avatar }]
     *   }
     *
     * Authorization: the pay group must belong to the caller's
     * organization; otherwise firstOrFail throws a 404.
     */
    public function getPayGroupEmployees(int $id, Request $request)
    {
        $monthYear = $request->get('month_year', now()->format('Y-m'));

        $payGroup = PayGroup::where('id', $id)
            ->where('organization_id', $request->user()->organization_id)
            ->firstOrFail();

        $userIds = $payGroup->assignments()
            ->where('is_active', true)
            ->pluck('user_id')
            ->all();

        if (empty($userIds)) {
            $employees = collect();
        } else {
            // BULK fetch all users with relations (1 query)
            $users = User::whereIn('id', $userIds)
                ->with(['employeeProfile', 'employeeWorkInfo', 'groups'])
                ->get()
                ->keyBy('id');

            // BULK fetch all payroll items for this month (1 query — fixes N+1)
            $payrollItems = PayrollItem::whereIn('user_id', $userIds)
                ->where('month_year', $monthYear)
                ->get()
                ->keyBy('user_id');

            // BULK fetch all templates (1 query — fixes N+1)
            $templates = \App\Models\EmployeePayrollTemplate::where('organization_id', $request->user()->organization_id)
                ->whereIn('user_id', $userIds)
                ->get()
                ->keyBy('user_id');

            $employees = collect($userIds)->map(function ($uid) use ($users, $payrollItems, $templates, $monthYear) {
                $u = $users->get($uid);
                if (!$u) return null;

                $item = $payrollItems->get($uid);
                $template = $templates->get($uid);
                $group = $u->groups->first();

                return [
                    'id' => $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'role' => $u->role,
                    'avatar' => $u->avatar,
                    'employee_code' => $u->employeeWorkInfo?->employee_code,
                    'designation' => $u->employeeWorkInfo?->designation,
                    'department' => $group?->name,
                    'annual_ctc' => (float) ($template?->annual_ctc ?? 0),
                    'steps_completed' => [
                        'step1' => $template && $template->steps_month_year === $monthYear ? (bool) $template->step1_completed : false,
                        'step2' => $template && $template->steps_month_year === $monthYear ? (bool) $template->step2_completed : false,
                        'step3' => $template && $template->steps_month_year === $monthYear ? (bool) $template->step3_completed : false,
                        'step4' => $template && $template->steps_month_year === $monthYear ? (bool) $template->step4_completed : false,
                        'step5' => $template && $template->steps_month_year === $monthYear ? (bool) $template->step5_completed : false,
                        'step6' => $template && $template->steps_month_year === $monthYear ? (bool) $template->step6_completed : false,
                    ],
                    'current_step' => $template && $template->steps_month_year === $monthYear ? (int) ($template->current_step ?? 1) : 1,
                    'payroll_status' => [
                        // A PayrollItem is only ever created once payroll is
                        // processed for an employee+month, so item existence
                        // (not payment_status) is the correct "processed"
                        // signal. Items stay 'pending' until disbursed, which
                        // is what the disbursement queries filter on.
                        'is_processed' => $item !== null,
                        'net_pay' => $item ? (float) $item->net_pay : 0,
                        'payment_status' => $item?->payment_status ?? 'pending',
                        'gross_salary' => $item ? (float) $item->gross_salary : 0,
                        'total_deductions' => $item ? (float) $item->total_deductions : 0,
                    ],
                ];
            })->filter()->values();
        }

        return response()->json([
            'pay_group' => [
                'id' => $payGroup->id,
                'name' => $payGroup->name,
                'code' => $payGroup->code,
                'pay_frequency' => $payGroup->pay_frequency,
            ],
            'employees' => $employees,
        ]);
    }

    /**
     * Mark a single wizard step as complete for the given employees
     * in a pay group. Used by the Bulk Payroll Matrix view.
     *
     * Body: { step: 1..6, user_ids: number[] }
     */
    public function completeStep(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|integer|min:1|max:6',
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
            'month_year' => 'required|string|max:7',
        ]);

        $organizationId = $request->user()->organization_id;

        // Verify the pay group belongs to the caller's org.
        $payGroup = \App\Models\PayGroup::where('id', $id)
            ->where('organization_id', $organizationId)
            ->first();
        if (!$payGroup) {
            return response()->json(['success' => false, 'message' => 'Pay group not found'], 404);
        }

        // Verify all submitted user_ids are current active members of
        // this pay group (prevents arbitrary users from being marked).
        $userIds = array_values(array_unique(array_map('intval', $data['user_ids'])));
        $validUserIds = \App\Models\PayGroupAssignment::where('pay_group_id', $id)
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->whereIn('user_id', $userIds)
            ->pluck('user_id')
            ->all();

        if (count($validUserIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'No valid members found in this pay group',
            ], 422);
        }

        $column = "step{$data['step']}_completed";
        $monthYear = $data['month_year'];

        // BULK ensure templates exist (1 query to find existing, 1 query to create missing)
        $existing = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->pluck('user_id')
            ->toArray();

        $missing = array_diff($validUserIds, $existing);
        if (!empty($missing)) {
            foreach ($missing as $uid) {
                \App\Models\EmployeePayrollTemplate::getOrCreateForUser($uid, $organizationId);
            }
        }

        // Reset stale completions when crossing into a NEW payroll month.
        // A single shared `steps_month_year` column gates all six cumulative
        // `stepN_completed` booleans. If an employee still carries
        // step2..6_completed = true from a previous month, completing a step
        // for the new month would otherwise flip `steps_month_year` and reveal
        // those stale flags as "done". Start the new month fresh so only the
        // step actually being completed is marked.
        \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->where(function ($q) use ($monthYear) {
                $q->where('steps_month_year', '!=', $monthYear)
                  ->orWhereNull('steps_month_year');
            })
            ->update([
                'step1_completed' => false,
                'step2_completed' => false,
                'step3_completed' => false,
                'step4_completed' => false,
                'step5_completed' => false,
                'step6_completed' => false,
                'current_step' => 1,
            ]);

        $updated = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $validUserIds)
            ->update([$column => true, 'steps_month_year' => $monthYear]);

        return response()->json([
            'success' => true,
            'step' => $data['step'],
            'updated_count' => $updated,
        ]);
    }

    /**
     * Mark a single wizard step as complete for every active member
     * of a pay group in one shot. Used by the Bulk Payroll Matrix's
     * "Done All for Step N" button.
     *
     * Body: { step: 1..6 }
     */
    public function completeAllSteps(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $data = $request->validate([
            'step' => 'required|integer|min:1|max:6',
            'month_year' => 'required|string|max:7',
        ]);

        $organizationId = $request->user()->organization_id;

        $payGroup = \App\Models\PayGroup::where('id', $id)
            ->where('organization_id', $organizationId)
            ->first();
        if (!$payGroup) {
            return response()->json(['success' => false, 'message' => 'Pay group not found'], 404);
        }

        $userIds = \App\Models\PayGroupAssignment::where('pay_group_id', $id)
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->pluck('user_id')
            ->all();

        if (count($userIds) === 0) {
            return response()->json([
                'success' => false,
                'message' => 'No active members in this pay group',
            ], 422);
        }

        $column = "step{$data['step']}_completed";
        $monthYear = $data['month_year'];

        // BULK ensure templates exist (1 query to find existing, 1 query to create missing)
        $existing = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->pluck('user_id')
            ->toArray();

        $missing = array_diff($userIds, $existing);
        if (!empty($missing)) {
            foreach ($missing as $uid) {
                \App\Models\EmployeePayrollTemplate::getOrCreateForUser($uid, $organizationId);
            }
        }

        // Reset stale completions when crossing into a NEW payroll month.
        // See completeStep() for the full rationale. A single shared
        // `steps_month_year` gates all six cumulative booleans, so we must
        // start the new month fresh before marking the requested step.
        \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->where(function ($q) use ($monthYear) {
                $q->where('steps_month_year', '!=', $monthYear)
                  ->orWhereNull('steps_month_year');
            })
            ->update([
                'step1_completed' => false,
                'step2_completed' => false,
                'step3_completed' => false,
                'step4_completed' => false,
                'step5_completed' => false,
                'step6_completed' => false,
                'current_step' => 1,
            ]);

        // BULK update all in 1 query
        $updated = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->update([$column => true, 'steps_month_year' => $monthYear]);

        return response()->json([
            'success' => true,
            'step' => $data['step'],
            'updated_count' => $updated,
            'total_members' => count($userIds),
        ]);
    }

    /**
     * Get the per-step completion count for a pay group. Returns the
     * number of members who have completed each step. Used by the
     * Bulk Payroll Matrix footer to show "X of Y employees on this
     * step".
     */
    public function getStepStatus(Request $request, int $id): \Illuminate\Http\JsonResponse
    {
        $monthYear = $request->get('month_year', now()->format('Y-m'));
        $organizationId = $request->user()->organization_id;

        $payGroup = \App\Models\PayGroup::where('id', $id)
            ->where('organization_id', $organizationId)
            ->first();
        if (!$payGroup) {
            return response()->json(['success' => false, 'message' => 'Pay group not found'], 404);
        }

        $userIds = \App\Models\PayGroupAssignment::where('pay_group_id', $id)
            ->where('organization_id', $organizationId)
            ->where('is_active', true)
            ->pluck('user_id')
            ->all();

        $totalMembers = count($userIds);

        if ($totalMembers === 0) {
            return response()->json([
                'pay_group_id' => $id,
                'total_members' => 0,
                'steps' => array_fill(1, 6, ['completed_count' => 0, 'pending_count' => 0]),
            ]);
        }

        $rows = \App\Models\EmployeePayrollTemplate::where('organization_id', $organizationId)
            ->whereIn('user_id', $userIds)
            ->get(['user_id', 'step1_completed', 'step2_completed', 'step3_completed', 'step4_completed', 'step5_completed', 'step6_completed', 'steps_month_year']);

        // Filter rows to only count completions for the requested month
        $filteredRows = $rows->where('steps_month_year', $monthYear);

        $steps = [];
        for ($n = 1; $n <= 6; $n++) {
            $col = "step{$n}_completed";
            $completed = $filteredRows->where($col, true)->count();
            $steps[$n] = [
                'completed_count' => $completed,
                'pending_count' => $totalMembers - $completed,
            ];
        }

        return response()->json([
            'pay_group_id' => $id,
            'total_members' => $totalMembers,
            'steps' => $steps,
        ]);
    }

    // Daily Wage & CTC Bands
    public function listDailyWageStructures()
    {
        return response()->json(\App\Models\DailyWageStructure::where('organization_id', auth()->user()->organization_id)->get());
    }

    public function listCtcBands()
    {
        return response()->json(\App\Models\CtcRangeBand::where('organization_id', auth()->user()->organization_id)->get());
    }

    public function findCtcBand(Request $request)
    {
        $request->validate(['annual_ctc' => 'required|numeric|min:0']);
        $band = \App\Models\CtcRangeBand::findBandForCtc(auth()->user()->organization_id, $request->annual_ctc);
        return response()->json($band ?? ['message' => 'No matching band found']);
    }
}
