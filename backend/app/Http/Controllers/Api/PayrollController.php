<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Http\Requests\Api\Payroll\GeneratePayrollRecordsRequest;
use App\Http\Requests\Api\Payroll\GeneratePayslipRequest;
use App\Http\Requests\Api\Payroll\PayPayslipsRequest;
use App\Http\Requests\Api\Payroll\PayrollRecordsIndexRequest;
use App\Http\Requests\Api\Payroll\PayoutPayrollRecordRequest;
use App\Http\Requests\Api\Payroll\PayslipsIndexRequest;
use App\Http\Requests\Api\Payroll\SavePayrollStructureRequest;
use App\Http\Requests\Api\Payroll\SyncStripeCheckoutRequest;
use App\Http\Requests\Api\Payroll\UpdatePayrollRecordRequest;
use App\Http\Requests\Api\Payroll\UpdatePayrollRecordStatusRequest;
use App\Models\PayrollAllowance;
use App\Models\PayrollDeduction;
use App\Models\Payroll;
use App\Models\PayrollAdjustment;
use App\Models\PayrollProfile;
use App\Models\PayrollSetting;
use App\Models\PayrollTaxDeclaration;
use App\Models\PayrollTransaction;
use App\Models\PayrollStructure;
use App\Models\PayRun;
use App\Models\Payslip;
use App\Models\User;
use App\Services\AppNotificationService;
use App\Services\Audit\AuditLogService;
use App\Services\Payroll\PayRunApprovalService;
use App\Services\Payroll\PayrollCalculatorService;
use App\Services\Payroll\PayrollComplianceService;
use App\Services\Payroll\PayrollDomainService;
use App\Services\Payroll\PayrollPayoutManager;
use App\Services\Payroll\PayrollTaxDeclarationService;
use App\Services\Payroll\PayrollWorkspaceService;
use App\Services\Payroll\StripePayrollPayoutService;
use Carbon\Carbon;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\View;

class PayrollController extends Controller
{
    public function __construct(
        private readonly AppNotificationService $notificationService,
        private readonly AuditLogService $auditLogService,
        private readonly PayRunApprovalService $payRunApprovalService,
        private readonly PayrollCalculatorService $payrollCalculatorService,
        private readonly PayrollComplianceService $payrollComplianceService,
        private readonly PayrollDomainService $payrollDomainService,
        private readonly PayrollPayoutManager $payrollPayoutManager,
        private readonly PayrollTaxDeclarationService $payrollTaxDeclarationService,
        private readonly PayrollWorkspaceService $payrollWorkspaceService,
        private readonly StripePayrollPayoutService $stripePayrollPayoutService,
    ) {
    }

    public function employees(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }
        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $users = User::where('organization_id', $currentUser->organization_id)
            ->where('role', 'employee')
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'role']);

        return response()->json(['data' => $users]);
    }

    public function records(PayrollRecordsIndexRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => [], 'mode' => $this->payrollPayoutManager->mode()]);
        }
        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $query = Payroll::with(['user', 'generatedBy', 'updatedBy'])
            ->where('organization_id', $currentUser->organization_id)
            ->orderByDesc('payroll_month')
            ->orderByDesc('created_at');

        if ($request->filled('user_id')) {
            $query->where('user_id', (int) $request->user_id);
        }
        if ($request->filled('payroll_month')) {
            $query->where('payroll_month', $request->payroll_month);
        }
        if ($request->filled('payroll_status')) {
            $query->where('payroll_status', $request->payroll_status);
        }
        if ($request->filled('payout_status')) {
            $query->where('payout_status', $request->payout_status);
        }
        if ($request->filled('payout_method')) {
            $query->where('payout_method', $request->payout_method);
        }

        return response()->json([
            'data' => $query->get(),
            'mode' => $this->payrollPayoutManager->mode(),
        ]);
    }

    public function generateRecords(GeneratePayrollRecordsRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }
        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $periodStart = Carbon::createFromFormat('Y-m', $request->payroll_month)->startOfMonth();
        $employees = User::where('organization_id', $currentUser->organization_id)
            ->where('role', 'employee')
            ->when($request->filled('user_id'), fn ($q) => $q->where('id', (int) $request->user_id))
            ->orderBy('name')
            ->get();

        if ($employees->isEmpty()) {
            return response()->json(['message' => 'No employees found for payroll generation.'], 404);
        }

        $allowOverwrite = (bool) $request->boolean('allow_overwrite', false);
        $workspaceSettings = $this->payrollWorkspaceService->settingsForOrganization((int) $currentUser->organization_id);
        $generated = [];
        $skipped = [];

        DB::transaction(function () use (
            $employees,
            $currentUser,
            $request,
            $periodStart,
            $allowOverwrite,
            $workspaceSettings,
            &$generated,
            &$skipped
        ) {
            foreach ($employees as $employee) {
                $compensation = $this->payrollWorkspaceService->compensationSnapshot((int) $currentUser->organization_id, (int) $employee->id, (string) $request->payroll_month);
                $profile = PayrollProfile::query()
                    ->where('organization_id', $currentUser->organization_id)
                    ->where('user_id', $employee->id)
                    ->first();
                $attendance = $this->payrollWorkspaceService->attendanceSummary((int) $currentUser->organization_id, (int) $employee->id, (string) $request->payroll_month);
                $settings = $workspaceSettings;
                $declaration = $this->payrollTaxDeclarationService->findForMonth((int) $currentUser->organization_id, (int) $employee->id, (string) $request->payroll_month);
                $adjustments = PayrollAdjustment::query()
                    ->where('organization_id', $currentUser->organization_id)
                    ->where('user_id', $employee->id)
                    ->where('effective_month', $request->payroll_month)
                    ->whereIn('status', ['approved', 'applied'])
                    ->orderBy('id')
                    ->get();

                $existing = Payroll::where('organization_id', $currentUser->organization_id)
                    ->where('user_id', $employee->id)
                    ->where('payroll_month', $request->payroll_month)
                    ->first();

                if ($existing && !$allowOverwrite) {
                    $skipped[] = [
                        'employee_id' => (int) $employee->id,
                        'reason' => 'Payroll already exists for this month',
                    ];
                    continue;
                }

                if (($compensation['source'] ?? 'none') !== 'none') {
                    $snapshot = $compensation['snapshot'] ?? [];
                    $baseBasicSalary = round((float) ($snapshot['basic_salary'] ?? 0), 2);
                    $baseAllowances = round((float) ($snapshot['allowances'] ?? 0), 2);
                    $baseDeductions = round((float) ($snapshot['deductions'] ?? 0), 2);
                    $baseBonus = round((float) ($snapshot['bonus'] ?? 0) + (float) ($profile?->bonus_amount ?? 0), 2);
                    $baseTax = round((float) ($snapshot['tax'] ?? 0), 2);
                } else {
                    // Fallback: generate a draft payroll even when structure is missing.
                    $lastPayroll = Payroll::where('organization_id', $currentUser->organization_id)
                        ->where('user_id', $employee->id)
                        ->orderByDesc('payroll_month')
                        ->orderByDesc('id')
                        ->first();

                    $baseBasicSalary = round((float) ($lastPayroll?->basic_salary ?? 0), 2);
                    $baseAllowances = round((float) ($lastPayroll?->allowances ?? 0), 2);
                    $baseDeductions = round((float) ($lastPayroll?->deductions ?? 0), 2);
                    $baseBonus = round((float) ($lastPayroll?->bonus ?? 0), 2);
                    $baseTax = round((float) ($lastPayroll?->tax ?? 0), 2);
                }

                $payableDays = max(1, (float) ($attendance['payable_days'] ?? 0));
                $daysInMonth = max(1, (int) $periodStart->copy()->endOfMonth()->day);
                $attendanceFactor = (bool) ($attendance['has_attendance_summary'] ?? false)
                    ? min(1, round($payableDays / $daysInMonth, 4))
                    : 1.0;

                $basicSalary = round($baseBasicSalary * $attendanceFactor, 2);
                $allowances = round($baseAllowances * $attendanceFactor, 2);
                $deductions = round($baseDeductions * $attendanceFactor, 2);
                $bonus = $baseBonus;
                $tax = $baseTax;

                $adjustmentBreakdown = $adjustments->map(function (PayrollAdjustment $adjustment) {
                    $category = in_array($adjustment->kind, ['manual_deduction', 'penalty'], true) ? 'deduction' : 'earning';

                    return [
                        'id' => $adjustment->id,
                        'title' => $adjustment->title,
                        'kind' => $adjustment->kind,
                        'source' => $adjustment->source,
                        'status' => $adjustment->status,
                        'amount' => (float) $adjustment->amount,
                        'category' => $category,
                    ];
                })->values()->all();

                $adjustmentEarnings = round(collect($adjustmentBreakdown)->where('category', 'earning')->sum('amount'), 2);
                $adjustmentDeductions = round(collect($adjustmentBreakdown)->where('category', 'deduction')->sum('amount'), 2);
                $bonus = round($bonus + $adjustmentEarnings, 2);
                $deductions = round($deductions + $adjustmentDeductions, 2);

                $overtimeAmount = 0.0;
                if ((bool) data_get($settings->overtime_rules, 'enabled', true)) {
                    $hours = round(((float) ($attendance['overtime_seconds'] ?? 0)) / 3600, 2);
                    $rateMultiplier = (float) data_get($settings->overtime_rules, 'rate_multiplier', 1.5);
                    $hourlyRate = $daysInMonth > 0 ? (($baseBasicSalary + $baseAllowances) / max(1, $daysInMonth * 8)) : 0;
                    $overtimeAmount = round($hours * $hourlyRate * $rateMultiplier, 2);
                    $allowances = round($allowances + $overtimeAmount, 2);
                }

                $grossSalary = round($basicSalary + $allowances + $bonus, 2);
                $compliance = $profile
                    ? $this->payrollComplianceService->calculate(
                        $basicSalary,
                        $grossSalary,
                        $profile,
                        [
                            'pf' => data_get($settings->compliance_settings, 'pf', []),
                            'esi' => data_get($settings->compliance_settings, 'esi', []),
                            'professional_tax' => data_get($settings->compliance_settings, 'professional_tax', []),
                            'tds' => array_replace_recursive(data_get($settings->compliance_settings, 'tds', []), $settings->tax_settings ?: []),
                        ],
                        $declaration,
                        (float) ($profile?->tax_amount ?? 0)
                    )
                    : ['employee' => [], 'employer' => [], 'totals' => ['employee_deductions' => 0, 'tds' => (float) ($profile?->tax_amount ?? 0), 'employer_contributions' => 0], 'tax_estimate' => []];

                $deductions = round($deductions + (float) data_get($compliance, 'totals.employee_deductions', 0), 2);
                $tax = round($tax + (float) data_get($compliance, 'totals.tds', (float) ($profile?->tax_amount ?? 0)), 2);
                $netSalary = $this->payrollCalculatorService->calculateNetSalary($basicSalary, $allowances, $bonus, $deductions, $tax);
                $payoutMethod = $this->payrollPayoutManager->normalizePayoutMethod(
                    (string) (
                        $request->payout_method
                        ?: $profile?->payout_method
                        ?: data_get($workspaceSettings->default_payout_method, 'method')
                    )
                );

                $payload = [
                    'basic_salary' => $basicSalary,
                    'allowances' => $allowances,
                    'deductions' => $deductions,
                    'bonus' => $bonus,
                    'tax' => $tax,
                    'gross_salary' => $grossSalary,
                    'net_salary' => $netSalary,
                    'payroll_status' => 'draft',
                    'payout_method' => $payoutMethod,
                    'payout_status' => 'pending',
                    'attendance_summary' => $attendance,
                    'salary_breakdown' => [
                        'basic_salary' => $basicSalary,
                        'allowances' => $allowances,
                        'bonus' => $bonus,
                        'deductions' => $deductions,
                        'tax' => $tax,
                        'attendance_factor' => $attendanceFactor,
                        'overtime_amount' => $overtimeAmount,
                    ],
                    'adjustment_breakdown' => [
                        'items' => $adjustmentBreakdown,
                        'earnings_total' => $adjustmentEarnings,
                        'deductions_total' => $adjustmentDeductions,
                    ],
                    'compliance_breakdown' => $compliance,
                    'tax_breakdown' => [
                        'declaration' => $declaration?->only(['id', 'financial_year', 'tax_regime', 'status']),
                        'estimate' => data_get($compliance, 'tax_estimate', []),
                        'fallback_tax_amount' => (float) ($profile?->tax_amount ?? 0),
                    ],
                    'warnings' => $this->payrollWorkspaceService->employeeWarningsForUser((int) $currentUser->organization_id, $employee, (string) $request->payroll_month),
                    'generated_by' => $currentUser->id,
                    'updated_by' => $currentUser->id,
                ];

                if ($existing) {
                    $existing->update($payload);
                    $generated[] = $existing->fresh();
                    continue;
                }

                $generated[] = Payroll::create(array_merge($payload, [
                    'organization_id' => $currentUser->organization_id,
                    'user_id' => $employee->id,
                    'payroll_month' => $request->payroll_month,
                ]));
            }
        });

        $this->auditLogService->log(
            action: 'payroll.generated',
            actor: $currentUser,
            target: 'PayrollBatch',
            metadata: [
                'payroll_month' => $request->payroll_month,
                'generated_count' => count($generated),
                'skipped_count' => count($skipped),
                'employee_ids' => collect($generated)->pluck('user_id')->values()->all(),
                'allow_overwrite' => $allowOverwrite,
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Payroll generation completed.',
            'generated_count' => count($generated),
            'skipped_count' => count($skipped),
            'generated' => collect($generated)->values(),
            'skipped' => $skipped,
        ]);
    }

    public function showRecord(Request $request, int $id)
    {
        $record = $this->payrollDomainService->findPayrollRecord($request, $id);
        if (!$record) {
            return response()->json(['message' => 'Payroll record not found'], 404);
        }

        return response()->json($record->load(['user', 'generatedBy', 'updatedBy', 'transactions']));
    }

    public function updateRecord(UpdatePayrollRecordRequest $request, int $id)
    {
        $record = $this->payrollDomainService->findPayrollRecord($request, $id);
        if (!$record) {
            return response()->json(['message' => 'Payroll record not found'], 404);
        }

        if ($record->payroll_status === 'paid') {
            return response()->json(['message' => 'Paid payroll cannot be edited.'], 422);
        }

        $currentUser = $request->user();
        $before = $record->only([
            'basic_salary',
            'allowances',
            'deductions',
            'bonus',
            'tax',
            'net_salary',
            'payroll_status',
            'payout_method',
        ]);
        $record->fill($request->only(['basic_salary', 'allowances', 'deductions', 'bonus', 'tax', 'payroll_status', 'payout_method']));
        $record->payout_method = $this->payrollPayoutManager->normalizePayoutMethod((string) $record->payout_method);
        $record->gross_salary = round((float) $record->basic_salary + (float) $record->allowances + (float) $record->bonus, 2);
        $record->net_salary = $this->payrollCalculatorService->calculateNetSalary(
            (float) $record->basic_salary,
            (float) $record->allowances,
            (float) $record->bonus,
            (float) $record->deductions,
            (float) $record->tax
        );
        $record->salary_breakdown = array_merge($record->salary_breakdown ?: [], [
            'basic_salary' => (float) $record->basic_salary,
            'allowances' => (float) $record->allowances,
            'bonus' => (float) $record->bonus,
            'deductions' => (float) $record->deductions,
            'tax' => (float) $record->tax,
        ]);
        $record->updated_by = $currentUser?->id;
        $record->save();

        $this->auditLogService->log(
            action: 'payroll.updated',
            actor: $currentUser,
            target: $record,
            metadata: [
                'user_id' => $record->user_id,
                'payroll_month' => $record->payroll_month,
                'before' => $before,
                'after' => $record->only([
                    'basic_salary',
                    'allowances',
                    'deductions',
                    'bonus',
                    'tax',
                    'net_salary',
                    'payroll_status',
                    'payout_method',
                ]),
            ],
            request: $request
        );

        return response()->json($record->fresh()->load(['user', 'generatedBy', 'updatedBy']));
    }

    public function updateRecordStatus(UpdatePayrollRecordStatusRequest $request, int $id)
    {
        $record = $this->payrollDomainService->findPayrollRecord($request, $id);
        if (!$record) {
            return response()->json(['message' => 'Payroll record not found'], 404);
        }

        $nextStatus = (string) $request->payroll_status;
        if ($nextStatus === 'paid' && $record->payout_status !== 'success') {
            return response()->json(['message' => 'Payroll can be marked paid only after successful payout.'], 422);
        }

        $record->payroll_status = $this->payRunApprovalService->mappedStatus($nextStatus);
        $record->processed_at = $nextStatus === 'processed' ? now() : $record->processed_at;
        $record->paid_at = $nextStatus === 'paid' ? now() : $record->paid_at;
        $record->updated_by = $request->user()?->id;
        $record->save();
        $this->payrollWorkspaceService->syncPayRunForMonth((int) $record->organization_id, (string) $record->payroll_month, $request->user()?->id);

        $this->auditLogService->log(
            action: $nextStatus === 'paid' ? 'payroll.marked_paid' : 'payroll.status_updated',
            actor: $request->user(),
            target: $record,
            metadata: [
                'user_id' => $record->user_id,
                'payroll_month' => $record->payroll_month,
                'payroll_status' => $record->payroll_status,
                'payout_status' => $record->payout_status,
            ],
            request: $request
        );

        return response()->json($record->fresh());
    }

    public function payoutRecord(PayoutPayrollRecordRequest $request, int $id)
    {
        $record = $this->payrollDomainService->findPayrollRecord($request, $id);
        if (!$record) {
            return response()->json(['message' => 'Payroll record not found'], 404);
        }

        if ($record->payroll_status === 'draft') {
            return response()->json(['message' => 'Process payroll before payout.'], 422);
        }
        if ((float) $record->net_salary <= 0) {
            return response()->json(['message' => 'Net salary must be greater than 0 before payout.'], 422);
        }

        $profile = PayrollProfile::query()
            ->where('organization_id', $record->organization_id)
            ->where('user_id', $record->user_id)
            ->first();
        $payoutWarnings = array_values(array_filter([
            in_array($record->payout_method, ['bank_transfer', 'stripe'], true) && !$profile ? 'Missing payroll profile' : null,
            $profile && $record->payout_method === 'bank_transfer' && empty($profile->bank_account_number) ? 'Missing bank account number' : null,
            $profile && $record->payout_method === 'bank_transfer' && empty($profile->bank_ifsc_swift) ? 'Missing IFSC or SWIFT code' : null,
            $profile && $record->payout_method === 'stripe' && empty($profile->payment_email) && empty($record->user?->email) ? 'Missing payment email' : null,
        ]));

        if (count($payoutWarnings) > 0) {
            $record->failure_reason = implode(' | ', $payoutWarnings);
            $record->save();

            return response()->json(['message' => $record->failure_reason], 422);
        }

        $currentUser = $request->user();
        $record->loadMissing('user');
        if ($request->filled('payout_method')) {
            $record->payout_method = $this->payrollPayoutManager->normalizePayoutMethod((string) $request->payout_method);
        }
        $record->payout_method = $this->payrollPayoutManager->normalizePayoutMethod((string) $record->payout_method);

        try {
            $service = $this->payrollPayoutManager->resolveForPayoutMethod((string) $record->payout_method);
            $result = $service->payout($record->loadMissing('user'), $request->get('simulate_status'));
        } catch (\Throwable $e) {
            Log::error('Payroll payout failed', [
                'payroll_id' => $record->id,
                'user_id' => $currentUser?->id,
                'message' => $e->getMessage(),
            ]);

            return response()->json([
                'message' => 'Payout failed: '.$e->getMessage(),
            ], 422);
        }

        $transaction = PayrollTransaction::create([
            'payroll_id' => $record->id,
            'provider' => $result['provider'],
            'transaction_id' => $result['transaction_id'] ?: null,
            'amount' => (float) $record->net_salary,
            'currency' => (string) config('payroll.default_currency', 'INR'),
            'status' => $result['status'],
            'raw_response' => $result['raw_response'],
        ]);

        $record->payout_status = $result['status'];
        $record->updated_by = $currentUser?->id;
        $record->failure_reason = $result['status'] === 'failed'
            ? ((string) data_get($result, 'raw_response.error', 'Payout failed'))
            : null;
        $record->payment_reference = (string) ($result['transaction_id'] ?: $record->payment_reference);
        if ($result['status'] === 'success') {
            $record->payroll_status = 'paid';
            $record->paid_at = now();
            $this->payrollDomainService->sendPayrollPaidNotification($record->fresh('user'), $currentUser?->id);
        } elseif (in_array($record->payroll_status, ['draft', 'validated', 'manager_approved', 'finance_approved'], true)) {
            $record->payroll_status = 'processed';
            $record->processed_at = now();
        }
        $record->save();
        $this->payrollWorkspaceService->syncPayRunForMonth((int) $record->organization_id, (string) $record->payroll_month, $currentUser?->id);

        $this->auditLogService->log(
            action: $result['status'] === 'success' ? 'payroll.marked_paid' : 'payroll.payout_processed',
            actor: $currentUser,
            target: $record,
            metadata: [
                'user_id' => $record->user_id,
                'payroll_month' => $record->payroll_month,
                'provider' => $result['provider'],
                'payout_method' => $record->payout_method,
                'payout_status' => $result['status'],
                'transaction_id' => $result['transaction_id'] ?: null,
            ],
            request: $request
        );

        return response()->json([
            'mode' => $this->payrollPayoutManager->mode(),
            'payroll' => $record->fresh()->load(['user', 'transactions']),
            'transaction' => $transaction,
            'checkout_url' => $result['checkout_url'] ?? null,
        ]);
    }

    public function recordTransactions(Request $request, int $id)
    {
        $record = $this->payrollDomainService->findPayrollRecord($request, $id);
        if (!$record) {
            return response()->json(['data' => []]);
        }

        return response()->json([
            'data' => $record->transactions()->latest()->get(),
        ]);
    }

    public function syncStripeCheckout(SyncStripeCheckoutRequest $request, int $id)
    {
        $record = $this->payrollDomainService->findPayrollRecord($request, $id);
        if (!$record) {
            return response()->json(['message' => 'Payroll record not found'], 404);
        }
        if ($record->payout_method !== 'stripe') {
            return response()->json(['message' => 'Payroll payout method is not Stripe.'], 422);
        }

        try {
            $session = $this->stripePayrollPayoutService->fetchCheckoutSession((string) $request->checkout_session_id);
        } catch (\Throwable $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $metaPayrollId = (string) ($session['metadata']['payroll_id'] ?? '');
        if ($metaPayrollId !== '' && (int) $metaPayrollId !== (int) $record->id) {
            return response()->json(['message' => 'Checkout session does not belong to this payroll record.'], 422);
        }

        $paymentStatus = (string) ($session['payment_status'] ?? '');
        $checkoutStatus = (string) ($session['status'] ?? '');
        $mappedStatus = match (true) {
            $paymentStatus === 'paid' => 'success',
            $checkoutStatus === 'expired' => 'failed',
            default => 'pending',
        };

        $transaction = PayrollTransaction::query()
            ->where('payroll_id', $record->id)
            ->where('provider', 'stripe')
            ->where('transaction_id', (string) $request->checkout_session_id)
            ->latest()
            ->first();

        if (!$transaction) {
            $transaction = PayrollTransaction::create([
                'payroll_id' => $record->id,
                'provider' => 'stripe',
                'transaction_id' => (string) $request->checkout_session_id,
                'amount' => (float) $record->net_salary,
                'currency' => (string) config('payroll.default_currency', 'INR'),
                'status' => $mappedStatus,
                'raw_response' => $session,
            ]);
        } else {
            $transaction->update([
                'status' => $mappedStatus,
                'raw_response' => $session,
            ]);
        }

        $previousPayoutStatus = (string) $record->payout_status;
        $record->payout_status = $mappedStatus;
        $record->payment_reference = (string) $request->checkout_session_id;
        $record->failure_reason = $mappedStatus === 'failed' ? 'Stripe checkout session failed or expired.' : null;
        if ($mappedStatus === 'success') {
            $record->payroll_status = 'paid';
            $record->paid_at = now();
        }
        $record->updated_by = $request->user()?->id;
        $record->save();
        $this->payrollWorkspaceService->syncPayRunForMonth((int) $record->organization_id, (string) $record->payroll_month, $request->user()?->id);

        if ($previousPayoutStatus !== 'success' && $mappedStatus === 'success') {
            $this->payrollDomainService->sendPayrollPaidNotification($record->fresh('user'), $request->user()?->id);
        }

        $this->auditLogService->log(
            action: $mappedStatus === 'success' ? 'payroll.marked_paid' : 'payroll.sync_updated',
            actor: $request->user(),
            target: $record,
            metadata: [
                'user_id' => $record->user_id,
                'payroll_month' => $record->payroll_month,
                'payout_method' => $record->payout_method,
                'payout_status' => $mappedStatus,
                'checkout_session_id' => (string) $request->checkout_session_id,
            ],
            request: $request
        );

        return response()->json([
            'mode' => $this->payrollPayoutManager->mode(),
            'payroll' => $record->fresh()->load(['user', 'transactions']),
            'transaction' => $transaction->fresh(),
            'status' => $mappedStatus,
        ]);
    }

    public function stripeWebhook(Request $request)
    {
        $mode = $this->payrollPayoutManager->mode();
        if (!in_array($mode, ['stripe_test', 'stripe_live'], true)) {
            return response()->json(['message' => 'Stripe webhook ignored in current payroll mode.'], 400);
        }

        $payload = $request->getContent();
        $signature = (string) $request->header('Stripe-Signature', '');
        if (!$this->stripePayrollPayoutService->verifyWebhookSignature($payload, $signature)) {
            return response()->json(['message' => 'Invalid webhook signature'], 400);
        }

        $event = json_decode($payload, true);
        if (!is_array($event)) {
            return response()->json(['message' => 'Invalid payload'], 400);
        }

        $type = (string) ($event['type'] ?? '');
        $eventData = $event['data']['object'] ?? null;
        if (!is_array($eventData)) {
            return response()->json(['received' => true]);
        }

        if (!in_array($type, [
            'payment_intent.succeeded',
            'payment_intent.processing',
            'payment_intent.payment_failed',
            'checkout.session.completed',
            'checkout.session.expired',
            'checkout.session.async_payment_failed',
        ], true)) {
            return response()->json(['received' => true]);
        }

        $transaction = null;
        $mappedStatus = 'pending';

        if (str_starts_with($type, 'payment_intent.')) {
            $paymentIntentId = (string) ($eventData['id'] ?? '');
            if ($paymentIntentId === '') {
                return response()->json(['received' => true]);
            }

            $transaction = PayrollTransaction::query()
                ->where('provider', 'stripe')
                ->where(function ($q) use ($paymentIntentId) {
                    $q->where('transaction_id', $paymentIntentId)
                        ->orWhere('raw_response->payment_intent', $paymentIntentId);
                })
                ->latest()
                ->first();

            $mappedStatus = $this->stripePayrollPayoutService->mapStripeStatusToPayoutStatus((string) ($eventData['status'] ?? ''));
        } elseif (str_starts_with($type, 'checkout.session.')) {
            $sessionId = (string) ($eventData['id'] ?? '');
            if ($sessionId === '') {
                return response()->json(['received' => true]);
            }

            $transaction = PayrollTransaction::query()
                ->where('provider', 'stripe')
                ->where('transaction_id', $sessionId)
                ->latest()
                ->first();

            $mappedStatus = match ($type) {
                'checkout.session.completed' => 'success',
                'checkout.session.expired', 'checkout.session.async_payment_failed' => 'failed',
                default => 'pending',
            };
        }

        if (!$transaction) {
            return response()->json(['received' => true]);
        }

        $wasSuccess = $transaction->status === 'success';
        $transaction->update([
            'status' => $mappedStatus,
            'raw_response' => $event,
        ]);

        $payroll = Payroll::find($transaction->payroll_id);
        if ($payroll) {
            $previousPayrollStatus = $payroll->payout_status;
            $payroll->payout_status = $mappedStatus;
            $payroll->payment_reference = (string) ($transaction->transaction_id ?: $payroll->payment_reference);
            $payroll->failure_reason = $mappedStatus === 'failed' ? 'Stripe webhook marked payout as failed.' : null;
            if ($mappedStatus === 'success') {
                $payroll->payroll_status = 'paid';
                $payroll->paid_at = now();
            }
            $payroll->save();
            $this->payrollWorkspaceService->syncPayRunForMonth((int) $payroll->organization_id, (string) $payroll->payroll_month);

            if (!$wasSuccess && $previousPayrollStatus !== 'success' && $mappedStatus === 'success') {
                $this->payrollDomainService->sendPayrollPaidNotification($payroll->loadMissing('user'));
            }
        }

        return response()->json(['received' => true]);
    }

    public function structures(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['users' => [], 'structures' => []]);
        }

        $users = User::where('organization_id', $currentUser->organization_id)
            ->when(!$this->payrollDomainService->canManagePayroll($currentUser), fn ($q) => $q->where('id', $currentUser->id))
            ->orderBy('name')
            ->get(['id', 'name', 'email', 'role']);

        $structureQuery = PayrollStructure::with(['allowances', 'deductions', 'user'])
            ->where('organization_id', $currentUser->organization_id)
            ->whereIn('user_id', $users->pluck('id'))
            ->where('is_active', true)
            ->orderByDesc('effective_from');

        if ($request->filled('user_id')) {
            $structureQuery->where('user_id', (int) $request->user_id);
        }

        return response()->json([
            'users' => $users,
            'structures' => $structureQuery->get(),
        ]);
    }

    public function upsertStructure(SavePayrollStructureRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $targetUser = User::where('organization_id', $currentUser->organization_id)
            ->where('id', (int) $request->user_id)
            ->first();

        if (!$targetUser) {
            return response()->json(['message' => 'User not found in your organization'], 404);
        }

        $structure = DB::transaction(function () use ($request, $currentUser, $targetUser) {
            PayrollStructure::where('organization_id', $currentUser->organization_id)
                ->where('user_id', $targetUser->id)
                ->where('is_active', true)
                ->update([
                    'is_active' => false,
                    'effective_to' => Carbon::parse($request->effective_from)->copy()->subDay()->toDateString(),
                    'updated_at' => now(),
                ]);

            $structure = PayrollStructure::create([
                'organization_id' => $currentUser->organization_id,
                'user_id' => $targetUser->id,
                'basic_salary' => (float) $request->basic_salary,
                'currency' => strtoupper((string) ($request->currency ?: 'INR')),
                'effective_from' => $request->effective_from,
                'effective_to' => null,
                'is_active' => true,
            ]);

            foreach (($request->allowances ?? []) as $item) {
                PayrollAllowance::create([
                    'payroll_structure_id' => $structure->id,
                    'name' => $item['name'],
                    'calculation_type' => $item['calculation_type'],
                    'amount' => (float) $item['amount'],
                ]);
            }

            foreach (($request->deductions ?? []) as $item) {
                PayrollDeduction::create([
                    'payroll_structure_id' => $structure->id,
                    'name' => $item['name'],
                    'calculation_type' => $item['calculation_type'],
                    'amount' => (float) $item['amount'],
                ]);
            }

            return $structure;
        });

        $this->auditLogService->log(
            action: 'payroll.structure_created',
            actor: $currentUser,
            target: $structure,
            metadata: [
                'user_id' => $targetUser->id,
                'currency' => $structure->currency,
                'effective_from' => $structure->effective_from,
            ],
            request: $request
        );

        return response()->json($structure->load(['allowances', 'deductions', 'user']), 201);
    }

    public function updateStructure(SavePayrollStructureRequest $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }
        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $structure = PayrollStructure::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$structure) {
            return response()->json(['message' => 'Payroll structure not found'], 404);
        }

        DB::transaction(function () use ($request, $structure) {
            $structure->update([
                'basic_salary' => (float) $request->basic_salary,
                'currency' => strtoupper((string) ($request->currency ?: 'INR')),
                'effective_from' => $request->effective_from,
            ]);

            $structure->allowances()->delete();
            foreach (($request->allowances ?? []) as $item) {
                PayrollAllowance::create([
                    'payroll_structure_id' => $structure->id,
                    'name' => $item['name'],
                    'calculation_type' => $item['calculation_type'],
                    'amount' => (float) $item['amount'],
                ]);
            }

            $structure->deductions()->delete();
            foreach (($request->deductions ?? []) as $item) {
                PayrollDeduction::create([
                    'payroll_structure_id' => $structure->id,
                    'name' => $item['name'],
                    'calculation_type' => $item['calculation_type'],
                    'amount' => (float) $item['amount'],
                ]);
            }
        });

        $this->auditLogService->log(
            action: 'payroll.structure_updated',
            actor: $currentUser,
            target: $structure,
            metadata: [
                'user_id' => $structure->user_id,
                'currency' => $structure->currency,
                'effective_from' => $structure->effective_from,
            ],
            request: $request
        );

        return response()->json($structure->fresh()->load(['allowances', 'deductions', 'user']));
    }

    public function deleteStructure(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }
        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $structure = PayrollStructure::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$structure) {
            return response()->json(['message' => 'Payroll structure not found'], 404);
        }

        $this->auditLogService->log(
            action: 'payroll.structure_deleted',
            actor: $currentUser,
            target: $structure,
            metadata: [
                'user_id' => $structure->user_id,
                'currency' => $structure->currency,
                'effective_from' => $structure->effective_from,
            ],
            request: $request
        );

        $structure->delete();

        return response()->json(['message' => 'Payroll structure deleted.']);
    }

    public function payslips(PayslipsIndexRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $query = Payslip::with(['user', 'generatedBy', 'payrollStructure', 'payroll', 'payRun'])
            ->where('organization_id', $currentUser->organization_id)
            ->orderByDesc('period_month')
            ->orderByDesc('generated_at');

        if ($request->filled('period_month')) {
            $query->where('period_month', $request->period_month);
        }

        if ($request->filled('user_id')) {
            $query->where('user_id', (int) $request->user_id);
        } elseif (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            $query->where('user_id', $currentUser->id);
        }

        return response()->json(['data' => $query->get()]);
    }

    public function generatePayslip(GeneratePayslipRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $targetUser = User::where('organization_id', $currentUser->organization_id)
            ->where('id', (int) $request->user_id)
            ->first();
        if (!$targetUser) {
            return response()->json(['message' => 'User not found in your organization'], 404);
        }

        $periodStart = Carbon::createFromFormat('Y-m', $request->period_month)->startOfMonth();
        $periodEnd = $periodStart->copy()->endOfMonth();

        $compensation = $this->payrollWorkspaceService->compensationSnapshot(
            (int) $currentUser->organization_id,
            (int) $targetUser->id,
            (string) $request->period_month
        );
        if (($compensation['source'] ?? 'none') === 'none') {
            return response()->json(['message' => 'No payroll structure or salary template found for selected period'], 422);
        }

        $structure = $compensation['structure'] ?? null;
        $snapshot = $compensation['snapshot'] ?? [];
        $profile = PayrollProfile::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $targetUser->id)
            ->first();
        $payroll = Payroll::query()
            ->where('organization_id', $currentUser->organization_id)
            ->where('user_id', $targetUser->id)
            ->where('payroll_month', $request->period_month)
            ->first();

        $basicSalary = (float) ($payroll?->basic_salary ?? $snapshot['basic_salary'] ?? 0);
        $allowances = $payroll?->salary_breakdown['earnings_components'] ?? $snapshot['earnings_components'] ?? [];
        $deductions = $payroll?->salary_breakdown['deduction_components'] ?? $snapshot['deduction_components'] ?? [];
        $allowanceTotal = (float) ($payroll?->allowances ?? ((float) ($snapshot['allowances'] ?? 0) + (float) ($snapshot['bonus'] ?? 0) + (float) ($profile?->bonus_amount ?? 0)));
        $deductionTotal = (float) ($payroll?->deductions ?? ((float) ($snapshot['deductions'] ?? 0) + (float) ($snapshot['tax'] ?? 0))) + (float) ($payroll?->tax ?? $profile?->tax_amount ?? 0);
        $net = (float) ($payroll?->net_salary ?? max(0, $basicSalary + $allowanceTotal - $deductionTotal));
        $publishAfterPayment = (bool) data_get($this->payrollWorkspaceService->settingsForOrganization((int) $currentUser->organization_id)->payslip_issue_rules, 'publish_after_payment', true);
        $publishStatus = $publishAfterPayment && ($payroll?->payroll_status !== 'paid') ? 'draft' : 'published';

        $payslip = Payslip::updateOrCreate(
            [
                'organization_id' => $currentUser->organization_id,
                'user_id' => $targetUser->id,
                'period_month' => $request->period_month,
            ],
            [
                'payroll_structure_id' => $structure?->id,
                'payroll_id' => $payroll?->id,
                'pay_run_id' => PayRun::query()
                    ->where('organization_id', $currentUser->organization_id)
                    ->where('payroll_month', $request->period_month)
                    ->value('id'),
                'currency' => $structure?->currency ?: (string) config('payroll.default_currency', 'INR'),
                'basic_salary' => round($basicSalary, 2),
                'total_allowances' => round($allowanceTotal, 2),
                'total_deductions' => round($deductionTotal, 2),
                'net_salary' => round($net, 2),
                'allowances' => $allowances,
                'deductions' => $deductions,
                'breakdown' => $payroll?->salary_breakdown ?: $snapshot,
                'compliance_breakdown' => $payroll?->compliance_breakdown,
                'generated_by' => $currentUser->id,
                'generated_at' => now(),
                'issued_at' => now(),
                'publish_status' => $publishStatus,
                'published_at' => $publishStatus === 'published' ? now() : null,
                'payment_status' => $payroll?->payroll_status === 'paid' ? 'paid' : 'pending',
                'paid_at' => $payroll?->paid_at,
                'paid_by' => $currentUser->id,
                'payment_reference' => $payroll?->payment_reference,
            ]
        );

        $this->auditLogService->log(
            action: 'payroll.payslip_generated',
            actor: $currentUser,
            target: $payslip,
            metadata: [
                'user_id' => $targetUser->id,
                'period_month' => $request->period_month,
                'net_salary' => (float) $payslip->net_salary,
            ],
            request: $request
        );

        return response()->json($payslip->load(['user', 'generatedBy', 'payrollStructure', 'payroll', 'payRun']), 201);
    }

    public function payNow(PayPayslipsRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }
        if (!$this->payrollDomainService->canManagePayroll($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $payslips = Payslip::where('organization_id', $currentUser->organization_id)
            ->whereIn('id', collect($request->payslip_ids)->map(fn ($id) => (int) $id)->values())
            ->get();
        if ($payslips->isEmpty()) {
            return response()->json(['message' => 'No valid payslips found for payment'], 404);
        }

        $toPay = $payslips->filter(fn (Payslip $payslip) => $payslip->payment_status !== 'paid')->values();
        if ($toPay->isEmpty()) {
            return response()->json([
                'message' => 'Selected payslips are already paid.',
                'paid_count' => 0,
            ]);
        }

        DB::transaction(function () use ($toPay, $currentUser) {
            foreach ($toPay as $payslip) {
                $payslip->update([
                    'payment_status' => 'paid',
                    'paid_at' => now(),
                    'paid_by' => $currentUser->id,
                    'published_at' => $payslip->published_at ?: now(),
                    'publish_status' => 'published',
                    'payment_reference' => $payslip->payment_reference ?: sprintf('PAYSLIP-%d-%s', $payslip->id, now()->format('YmdHis')),
                ]);

                if ($payslip->payroll) {
                    $payslip->payroll->update([
                        'payroll_status' => 'paid',
                        'paid_at' => now(),
                        'payment_reference' => $payslip->payment_reference ?: sprintf('PAYSLIP-%d-%s', $payslip->id, now()->format('YmdHis')),
                    ]);
                    $this->payrollWorkspaceService->syncPayRunForMonth((int) $payslip->organization_id, (string) $payslip->period_month, $currentUser->id);
                }
            }
        });

        $freshPayslips = Payslip::whereIn('id', $toPay->pluck('id'))->get();
        $userGroups = $freshPayslips->groupBy('user_id');
        foreach ($userGroups as $userId => $userPayslips) {
            $total = round((float) $userPayslips->sum('net_salary'), 2);
            $currency = (string) ($userPayslips->first()->currency ?: 'INR');
            $periods = $userPayslips->pluck('period_month')->unique()->sort()->values()->join(', ');

            $this->notificationService->sendToUsers(
                organizationId: (int) $currentUser->organization_id,
                userIds: collect([(int) $userId]),
                senderId: (int) $currentUser->id,
                type: 'salary_credited',
                title: 'Salary Credited',
                message: "Your salary has been credited for period(s): {$periods}.",
                meta: [
                    'currency' => $currency,
                    'total_amount' => $total,
                    'periods' => $userPayslips->pluck('period_month')->unique()->values()->all(),
                    'payslip_ids' => $userPayslips->pluck('id')->values()->all(),
                ]
            );
        }

        $this->auditLogService->log(
            action: 'payroll.payslips_marked_paid',
            actor: $currentUser,
            target: 'PayslipBatch',
            metadata: [
                'paid_count' => $freshPayslips->count(),
                'payslip_ids' => $freshPayslips->pluck('id')->values()->all(),
                'user_ids' => $freshPayslips->pluck('user_id')->unique()->values()->all(),
            ],
            request: $request
        );

        return response()->json([
            'message' => 'Payment processed and notifications sent.',
            'paid_count' => $freshPayslips->count(),
        ]);
    }

    public function showPayslip(Request $request, int $id)
    {
        $payslip = $this->payrollDomainService->findPayslip($request, $id);
        if (!$payslip) {
            return response()->json(['message' => 'Payslip not found'], 404);
        }

        if ($request->user()?->id === $payslip->user_id && !$this->payrollDomainService->canManagePayroll($request->user())) {
            $payslip->viewed_at = now();
            $payslip->save();
        }

        return response()->json($payslip->fresh()->load(['user', 'generatedBy', 'payrollStructure', 'payroll', 'payRun']));
    }

    public function downloadPayslipPdf(Request $request, int $id)
    {
        $payslip = $this->payrollDomainService->findPayslip($request, $id);
        if (!$payslip) {
            return response()->json(['message' => 'Payslip not found'], 404);
        }

        $payslip->load(['user', 'generatedBy', 'payroll']);
        $html = View::make('payslips.pdf', ['payslip' => $payslip])->render();

        $options = new Options();
        $options->set('isRemoteEnabled', true);

        $dompdf = new Dompdf($options);
        $dompdf->loadHtml($html);
        $dompdf->setPaper('A4', 'portrait');
        $dompdf->render();

        $fileName = 'payslip-'.$payslip->user->name.'-'.$payslip->period_month.'.pdf';

        return response($dompdf->output(), 200, [
            'Content-Type' => 'application/pdf',
            'Content-Disposition' => 'attachment; filename="'.$fileName.'"',
        ]);
    }
}
