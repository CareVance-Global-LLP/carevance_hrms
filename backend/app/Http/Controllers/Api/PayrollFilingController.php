<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayrollFiling;
use App\Models\PayrollMonthlyRun;
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
        $filing = $filingService->generateForm16(
            $data['user_id'],
            $data['financial_year'],
            auth()->user()->organization_id,
            auth()->id()
        );
        return response()->json($filing);
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

    public function listPayGroups()
    {
        return response()->json(\App\Models\PayGroup::where('organization_id', auth()->user()->organization_id)->get());
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
