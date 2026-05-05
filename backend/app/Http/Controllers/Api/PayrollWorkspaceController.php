<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\PayRun;
use App\Models\PayrollAdjustment;
use App\Models\PayrollProfile;
use App\Models\PayrollSetting;
use App\Models\PayrollTaxDeclaration;
use App\Models\Reimbursement;
use App\Models\SalaryComponent;
use App\Models\SalaryTemplate;
use App\Models\SalaryTemplateComponent;
use App\Models\User;
use App\Services\Payroll\PayRunApprovalService;
use App\Services\Payroll\PayrollDomainService;
use App\Services\Payroll\PayrollTaxDeclarationService;
use App\Services\Payroll\PayrollWorkspaceService;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class PayrollWorkspaceController extends Controller
{
    public function __construct(
        private readonly PayRunApprovalService $payRunApprovalService,
        private readonly PayrollDomainService $payrollDomainService,
        private readonly PayrollTaxDeclarationService $payrollTaxDeclarationService,
        private readonly PayrollWorkspaceService $payrollWorkspaceService,
    ) {
    }

    public function overview(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json(
            $this->payrollWorkspaceService->overview($user, $request->get('payroll_month', now()->format('Y-m')))
        );
    }

    public function payRuns(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json([
            'data' => $this->payrollWorkspaceService->runList($user, $request->get('payroll_month')),
        ]);
    }

    public function showPayRun(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $detail = $this->payrollWorkspaceService->runDetail($user, $id);
        if (!$detail) {
            return response()->json(['message' => 'Pay run not found'], 404);
        }

        return response()->json($detail);
    }

    public function updatePayRunStatus(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'status' => 'required|in:draft,validated,approved,manager_approved,finalized,locked,finance_approved,processed,paid',
            'comment' => 'nullable|string',
            'rejection_reason' => 'nullable|string',
        ]);

        $run = PayRun::query()
            ->where('organization_id', $user->organization_id)
            ->find($id);

        if (!$run) {
            return response()->json(['message' => 'Pay run not found'], 404);
        }

        $run = $this->payRunApprovalService->transition(
            $run,
            $user,
            (string) $data['status'],
            $data['comment'] ?? null,
            $data['rejection_reason'] ?? null
        );

        $this->payrollWorkspaceService->logWorkspaceAudit((int) $user->organization_id, $user->id, 'pay_run.status_updated', $run, [
            'status' => $run->status,
            'comment' => $data['comment'] ?? null,
            'rejection_reason' => $data['rejection_reason'] ?? null,
        ]);

        return response()->json($run->fresh(['items.user', 'items.payroll.transactions', 'approvals.actor']));
    }

    public function profiles(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $payrollMonth = (string) $request->get('payroll_month', now()->format('Y-m'));
        $revisionDates = DB::table('employee_salary_assignments')
            ->where('organization_id', $user->organization_id)
            ->select('user_id', DB::raw('MAX(effective_from) as last_revision_date'))
            ->groupBy('user_id')
            ->pluck('last_revision_date', 'user_id');

        $profiles = PayrollProfile::query()
            ->where('organization_id', $user->organization_id)
            ->with(['user', 'salaryTemplate.components.component', 'taxDeclarations' => fn ($query) => $query->latest('financial_year')->limit(1)])
            ->withCount([
                'adjustments as current_cycle_adjustments_count' => fn ($query) => $query->where('effective_month', $payrollMonth),
                'adjustments as pending_adjustments_count' => fn ($query) => $query
                    ->where('effective_month', $payrollMonth)
                    ->whereIn('status', ['draft', 'pending_approval', 'approved']),
            ])
            ->withSum([
                'adjustments as current_cycle_adjustments_total' => fn ($query) => $query->where('effective_month', $payrollMonth),
            ], 'amount')
            ->orderByDesc('id')
            ->get()
            ->map(function (PayrollProfile $profile) use ($revisionDates) {
                $profile->setAttribute(
                    'last_revision_date',
                    $revisionDates[$profile->user_id] ?? optional($profile->updated_at)->toDateString()
                );
                $latestDeclaration = $profile->taxDeclarations->first();
                $profile->setAttribute('latest_tax_declaration', $latestDeclaration);
                $profile->setAttribute('setup_readiness', [
                    'payout' => (bool) ($profile->payout_method && ($profile->bank_account_number || $profile->payment_email)),
                    'compliance' => $profile->compliance_readiness_status,
                    'declaration' => $latestDeclaration?->status ?: $profile->declaration_status,
                ]);

                return $profile;
            })
            ->values();

        return response()->json([
            'employees' => User::query()
                ->where('organization_id', $user->organization_id)
                ->where('role', 'employee')
                ->orderBy('name')
                ->get(['id', 'name', 'email', 'role']),
            'templates' => SalaryTemplate::query()
                ->where('organization_id', $user->organization_id)
                ->with('components.component')
                ->orderBy('name')
                ->get(),
            'profiles' => $profiles,
        ]);
    }

    public function storeProfile(Request $request)
    {
        return $this->saveProfile($request);
    }

    public function updateProfile(Request $request, int $id)
    {
        return $this->saveProfile($request, $id);
    }

    public function components(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json([
            'data' => SalaryComponent::query()
                ->where('organization_id', $user->organization_id)
                ->withCount('templateComponents')
                ->orderBy('category')
                ->orderBy('name')
                ->get(),
        ]);
    }

    public function storeComponent(Request $request)
    {
        return $this->saveComponent($request);
    }

    public function updateComponent(Request $request, int $id)
    {
        return $this->saveComponent($request, $id);
    }

    public function deleteComponent(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $component = SalaryComponent::query()
            ->where('organization_id', $user->organization_id)
            ->find($id);

        if (!$component) {
            return response()->json(['message' => 'Salary component not found'], 404);
        }

        $component->delete();
        return response()->json(['message' => 'Salary component deleted.']);
    }

    public function templates(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json([
            'components' => SalaryComponent::query()
                ->where('organization_id', $user->organization_id)
                ->withCount('templateComponents')
                ->orderBy('category')
                ->orderBy('name')
                ->get(),
            'data' => SalaryTemplate::query()
                ->where('organization_id', $user->organization_id)
                ->with('components.component')
                ->withCount('assignments')
                ->withMax('assignments', 'effective_from')
                ->orderBy('name')
                ->get(),
        ]);
    }

    public function storeTemplate(Request $request)
    {
        return $this->saveTemplate($request);
    }

    public function updateTemplate(Request $request, int $id)
    {
        return $this->saveTemplate($request, $id);
    }

    public function deleteTemplate(Request $request, int $id)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $template = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->find($id);

        if (!$template) {
            return response()->json(['message' => 'Salary template not found'], 404);
        }

        $template->delete();
        return response()->json(['message' => 'Salary template deleted.']);
    }

    public function adjustments(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json([
            'employees' => User::query()->where('organization_id', $user->organization_id)->where('role', 'employee')->orderBy('name')->get(['id', 'name', 'email', 'role']),
            'adjustments' => PayrollAdjustment::query()
                ->where('organization_id', $user->organization_id)
                ->with(['user', 'reimbursement', 'approvedBy', 'appliedBy', 'rejectedBy', 'appliedRun'])
                ->when($request->filled('effective_month'), fn ($query) => $query->where('effective_month', $request->effective_month))
                ->latest()
                ->get(),
            'reimbursements' => Reimbursement::query()
                ->where('organization_id', $user->organization_id)
                ->with(['user', 'approvedBy'])
                ->latest()
                ->get(),
        ]);
    }

    public function storeAdjustment(Request $request)
    {
        return $this->saveAdjustment($request);
    }

    public function updateAdjustment(Request $request, int $id)
    {
        return $this->saveAdjustment($request, $id);
    }

    public function updateAdjustmentStatus(Request $request, int $id, string $status)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if (!in_array($status, ['approve', 'reject', 'apply'], true)) {
            return response()->json(['message' => 'Invalid adjustment action'], 422);
        }

        $adjustment = PayrollAdjustment::query()
            ->where('organization_id', $user->organization_id)
            ->find($id);

        if (!$adjustment) {
            return response()->json(['message' => 'Adjustment not found'], 404);
        }

        $adjustment->status = match ($status) {
            'approve' => 'approved',
            'reject' => 'rejected',
            'apply' => 'applied',
        };
        if ($status === 'approve') {
            $adjustment->approved_by = $user->id;
            $adjustment->approved_at = now();
        }
        if ($status === 'reject') {
            $adjustment->rejected_by = $user->id;
            $adjustment->rejected_at = now();
            $adjustment->rejection_reason = (string) $request->get('rejection_reason', $adjustment->rejection_reason);
        }
        if ($status === 'apply') {
            $adjustment->applied_at = now();
            $adjustment->applied_by = $user->id;
            $adjustment->applied_run_id = PayRun::query()
                ->where('organization_id', $user->organization_id)
                ->where('payroll_month', $adjustment->effective_month)
                ->value('id');
        }
        $adjustment->approval_note = (string) $request->get('approval_note', $adjustment->approval_note);
        $trail = $adjustment->approval_trail ?: [];
        $trail[] = [
            'action' => $status,
            'actor_id' => $user->id,
            'at' => now()->toIso8601String(),
            'note' => $adjustment->approval_note,
            'rejection_reason' => $adjustment->rejection_reason,
        ];
        $adjustment->approval_trail = $trail;
        $adjustment->save();

        return response()->json($adjustment->fresh(['user', 'reimbursement', 'approvedBy', 'appliedBy', 'rejectedBy', 'appliedRun']));
    }

    public function reports(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json(
            $this->payrollWorkspaceService->reports($user, $request->get('payroll_month', now()->format('Y-m')))
        );
    }

    public function settings(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json($this->payrollWorkspaceService->settingsForOrganization((int) $user->organization_id));
    }

    public function updateSettings(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $setting = $this->payrollWorkspaceService->settingsForOrganization((int) $user->organization_id);
        $data = $request->validate([
            'payroll_calendar' => 'nullable|array',
            'default_payout_method' => 'nullable|array',
            'overtime_rules' => 'nullable|array',
            'late_deduction_rules' => 'nullable|array',
            'leave_mapping' => 'nullable|array',
            'adjustment_rules' => 'nullable|array',
            'approval_workflow' => 'nullable|array',
            'compliance_settings' => 'nullable|array',
            'tax_settings' => 'nullable|array',
            'payslip_branding' => 'nullable|array',
            'payslip_issue_rules' => 'nullable|array',
            'payout_workflow' => 'nullable|array',
        ]);

        $setting->fill($data);
        $setting->save();

        $this->payrollWorkspaceService->logWorkspaceAudit((int) $user->organization_id, $user->id, 'payroll_settings.updated', $setting, $data);

        return response()->json($setting->fresh());
    }

    public function taxDeclarations(Request $request)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json([
            'data' => PayrollTaxDeclaration::query()
                ->where('organization_id', $user->organization_id)
                ->with(['user', 'payrollProfile', 'submittedBy', 'reviewedBy'])
                ->when($request->filled('user_id'), fn ($query) => $query->where('user_id', (int) $request->user_id))
                ->when($request->filled('financial_year'), fn ($query) => $query->where('financial_year', (string) $request->financial_year))
                ->latest('financial_year')
                ->latest()
                ->get(),
        ]);
    }

    public function storeTaxDeclaration(Request $request)
    {
        return $this->saveTaxDeclaration($request);
    }

    public function updateTaxDeclaration(Request $request, int $id)
    {
        return $this->saveTaxDeclaration($request, $id);
    }

    public function reviewTaxDeclaration(Request $request, int $id, string $status)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if (!in_array($status, ['approve', 'reject'], true)) {
            return response()->json(['message' => 'Invalid declaration action'], 422);
        }

        $declaration = PayrollTaxDeclaration::query()
            ->where('organization_id', $user->organization_id)
            ->find($id);

        if (!$declaration) {
            return response()->json(['message' => 'Tax declaration not found'], 404);
        }

        $declaration->status = $status === 'approve' ? 'approved' : 'rejected';
        $declaration->reviewed_by = $user->id;
        $declaration->reviewed_at = now();
        $declaration->rejection_reason = $status === 'reject' ? (string) $request->get('rejection_reason', '') : null;
        $declaration->approved_snapshot = $status === 'approve' ? ($declaration->sections ?: []) : null;
        $declaration->save();

        PayrollProfile::query()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $declaration->user_id)
            ->update([
                'declaration_status' => $declaration->status,
                'declaration_snapshot' => $declaration->approved_snapshot ?: ['status' => $declaration->status],
            ]);

        return response()->json($declaration->fresh(['user', 'payrollProfile', 'submittedBy', 'reviewedBy']));
    }

    private function saveTaxDeclaration(Request $request, ?int $id = null)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'user_id' => 'required|integer',
            'payroll_profile_id' => 'nullable|integer',
            'financial_year' => 'nullable|string|max:20',
            'tax_regime' => 'nullable|in:old,new',
            'status' => 'nullable|in:draft,submitted,approved,rejected',
            'sections' => 'nullable|array',
            'summary' => 'nullable|array',
        ]);

        $data['financial_year'] = $data['financial_year'] ?: $this->payrollTaxDeclarationService->financialYearForMonth(now()->format('Y-m'));
        $declaration = PayrollTaxDeclaration::query()
            ->where('organization_id', $user->organization_id)
            ->when($id, fn ($query) => $query->where('id', $id))
            ->first() ?: new PayrollTaxDeclaration(['organization_id' => $user->organization_id]);

        $declaration->fill($data);
        $declaration->organization_id = $user->organization_id;
        $declaration->submitted_by = $data['status'] === 'submitted' ? $user->id : $declaration->submitted_by;
        $declaration->submitted_at = $data['status'] === 'submitted' ? now() : $declaration->submitted_at;
        $declaration->save();

        PayrollProfile::query()
            ->where('organization_id', $user->organization_id)
            ->where('user_id', $declaration->user_id)
            ->update([
                'declaration_status' => $declaration->status,
                'tax_regime' => $declaration->tax_regime,
            ]);

        return response()->json($declaration->fresh(['user', 'payrollProfile', 'submittedBy', 'reviewedBy']), $id ? 200 : 201);
    }

    private function saveProfile(Request $request, ?int $id = null)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'user_id' => 'required|integer',
            'payroll_code' => 'nullable|string|max:80',
            'salary_template_id' => 'nullable|integer',
            'currency' => 'nullable|string|max:8',
            'pay_group' => 'nullable|string|max:120',
            'payout_method' => 'nullable|string|max:32',
            'bank_name' => 'nullable|string|max:255',
            'bank_account_number' => 'nullable|string|max:255',
            'bank_ifsc_swift' => 'nullable|string|max:255',
            'payment_email' => 'nullable|email',
            'tax_identifier' => 'nullable|string|max:255',
            'tax_regime' => 'nullable|in:old,new',
            'pan_or_tax_id' => 'nullable|string|max:80',
            'pf_account_number' => 'nullable|string|max:120',
            'uan' => 'nullable|string|max:120',
            'esi_number' => 'nullable|string|max:120',
            'professional_tax_state' => 'nullable|string|max:120',
            'professional_tax_jurisdiction' => 'nullable|string|max:120',
            'payroll_start_date' => 'nullable|date',
            'bank_verification_status' => 'nullable|in:pending,verified,rejected,unverified',
            'declaration_status' => 'nullable|in:not_started,draft,submitted,approved,rejected',
            'payout_readiness_status' => 'nullable|in:pending,ready,blocked',
            'compliance_readiness_status' => 'nullable|in:pending,ready,blocked',
            'payroll_eligible' => 'nullable|boolean',
            'reimbursements_eligible' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
            'earning_components' => 'nullable|array',
            'deduction_components' => 'nullable|array',
            'bonus_amount' => 'nullable|numeric',
            'tax_amount' => 'nullable|numeric',
            'compliance_overrides' => 'nullable|array',
            'meta' => 'nullable|array',
            'template_effective_from' => 'nullable|date',
        ]);

        $profile = PayrollProfile::query()
            ->where('organization_id', $user->organization_id)
            ->when($id, fn ($query) => $query->where('id', $id))
            ->first() ?: new PayrollProfile(['organization_id' => $user->organization_id]);

        $data['pan_or_tax_id'] = strtoupper((string) ($data['pan_or_tax_id'] ?? $data['tax_identifier'] ?? '')) ?: null;
        $data['bank_verification_status'] = $data['bank_verification_status']
            ?? (!empty($data['bank_account_number']) || !empty($data['payment_email']) ? 'verified' : 'pending');
        $data['payout_readiness_status'] = $data['payout_readiness_status']
            ?? (!empty($data['payout_method']) && (!empty($data['bank_account_number']) || !empty($data['payment_email'])) ? 'ready' : 'blocked');
        $data['compliance_readiness_status'] = $data['compliance_readiness_status']
            ?? ((!empty($data['tax_identifier']) || !empty($data['pan_or_tax_id'])) ? 'ready' : 'blocked');
        $data['declaration_snapshot'] = [
            'tax_identifier' => $data['tax_identifier'] ?? null,
            'pan_or_tax_id' => $data['pan_or_tax_id'] ?? null,
            'tax_regime' => $data['tax_regime'] ?? null,
        ];

        $profile->fill($data);
        $profile->organization_id = $user->organization_id;
        $profile->save();

        if (!empty($data['salary_template_id'])) {
            $this->payrollWorkspaceService->applyTemplateAssignment(
                (int) $user->organization_id,
                (int) $data['user_id'],
                (int) $data['salary_template_id'],
                (string) ($data['template_effective_from'] ?? now()->toDateString())
            );
        }

        $this->payrollWorkspaceService->logWorkspaceAudit((int) $user->organization_id, $user->id, $id ? 'payroll_profile.updated' : 'payroll_profile.created', $profile, $data);

        return response()->json($profile->fresh(['user', 'salaryTemplate.components.component']), $id ? 200 : 201);
    }

    private function saveComponent(Request $request, ?int $id = null)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'code' => 'required|string|max:80',
            'category' => 'required|in:basic,allowance,overtime,bonus,reimbursement,penalty,tax,deduction,other',
            'impact' => 'nullable|in:earning,deduction,tax,reimbursement,employer_contribution',
            'value_type' => 'required|in:fixed,percentage',
            'calculation_basis' => 'nullable|in:basic,gross',
            'default_value' => 'nullable|numeric',
            'is_taxable' => 'nullable|boolean',
            'is_compliance_component' => 'nullable|boolean',
            'is_system_default' => 'nullable|boolean',
            'is_active' => 'nullable|boolean',
            'meta' => 'nullable|array',
        ]);

        $component = SalaryComponent::query()
            ->where('organization_id', $user->organization_id)
            ->when($id, fn ($query) => $query->where('id', $id))
            ->first() ?: new SalaryComponent(['organization_id' => $user->organization_id]);

        $component->fill($data);
        $component->organization_id = $user->organization_id;
        $component->save();

        return response()->json($component, $id ? 200 : 201);
    }

    private function saveTemplate(Request $request, ?int $id = null)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string',
            'currency' => 'nullable|string|max:8',
            'is_active' => 'nullable|boolean',
            'components' => 'nullable|array',
            'components.*.salary_component_id' => 'required|integer',
            'components.*.value_type' => 'required|in:fixed,percentage',
            'components.*.value' => 'nullable|numeric',
            'components.*.sort_order' => 'nullable|integer',
            'components.*.is_enabled' => 'nullable|boolean',
        ]);

        $template = SalaryTemplate::query()
            ->where('organization_id', $user->organization_id)
            ->when($id, fn ($query) => $query->where('id', $id))
            ->first() ?: new SalaryTemplate(['organization_id' => $user->organization_id]);

        DB::transaction(function () use ($template, $data, $user) {
            $template->fill(collect($data)->except('components')->all());
            $template->organization_id = $user->organization_id;
            $template->save();

            $template->components()->delete();
            foreach (($data['components'] ?? []) as $componentRow) {
                SalaryTemplateComponent::query()->create([
                    'salary_template_id' => $template->id,
                    'salary_component_id' => (int) $componentRow['salary_component_id'],
                    'value_type' => $componentRow['value_type'],
                    'value' => (float) ($componentRow['value'] ?? 0),
                    'sort_order' => (int) ($componentRow['sort_order'] ?? 0),
                    'is_enabled' => (bool) ($componentRow['is_enabled'] ?? true),
                ]);
            }
        });

        return response()->json($template->fresh('components.component'), $id ? 200 : 201);
    }

    private function saveAdjustment(Request $request, ?int $id = null)
    {
        $user = $request->user();
        if (!$user || !$user->organization_id || !$this->payrollDomainService->canManagePayroll($user)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $data = $request->validate([
            'user_id' => 'required|integer',
            'payroll_profile_id' => 'nullable|integer',
            'reimbursement_id' => 'nullable|integer',
            'title' => 'required|string|max:255',
            'description' => 'nullable|string',
            'kind' => 'required|in:reimbursement,bonus,manual_deduction,penalty,one_time_adjustment',
            'source' => 'nullable|string|max:80',
            'effective_month' => 'required|string|size:7',
            'amount' => 'required|numeric',
            'currency' => 'nullable|string|max:8',
            'status' => 'nullable|in:draft,pending_approval,approved,rejected,applied',
            'approval_note' => 'nullable|string',
            'rejection_reason' => 'nullable|string',
            'attachment_meta' => 'nullable|array',
            'approval_trail' => 'nullable|array',
            'applied_run_id' => 'nullable|integer',
            'claim_reference' => 'nullable|string|max:120',
            'claim_category' => 'nullable|string|max:120',
            'merchant_name' => 'nullable|string|max:255',
            'meta' => 'nullable|array',
            'reimbursement' => 'nullable|array',
            'reimbursement.title' => 'nullable|string|max:255',
            'reimbursement.description' => 'nullable|string',
            'reimbursement.expense_date' => 'nullable|date',
            'reimbursement.amount' => 'nullable|numeric',
            'reimbursement.currency' => 'nullable|string|max:8',
            'reimbursement.status' => 'nullable|in:draft,pending_approval,approved,rejected,applied',
        ]);

        $adjustment = PayrollAdjustment::query()
            ->where('organization_id', $user->organization_id)
            ->when($id, fn ($query) => $query->where('id', $id))
            ->first() ?: new PayrollAdjustment(['organization_id' => $user->organization_id, 'created_by' => $user->id]);

        DB::transaction(function () use ($adjustment, $data, $user) {
            if (!empty($data['reimbursement'])) {
                $reimbursement = !empty($data['reimbursement_id'])
                    ? Reimbursement::query()
                        ->where('organization_id', $user->organization_id)
                        ->find((int) $data['reimbursement_id'])
                    : new Reimbursement(['organization_id' => $user->organization_id, 'submitted_by' => $user->id]);

                $reimbursement ??= new Reimbursement(['organization_id' => $user->organization_id, 'submitted_by' => $user->id]);
                $reimbursement->fill([
                    'user_id' => (int) $data['user_id'],
                    'title' => (string) ($data['reimbursement']['title'] ?? $data['title']),
                    'description' => $data['reimbursement']['description'] ?? null,
                    'expense_date' => $data['reimbursement']['expense_date'] ?? null,
                    'amount' => (float) ($data['reimbursement']['amount'] ?? $data['amount']),
                    'currency' => (string) ($data['reimbursement']['currency'] ?? $data['currency'] ?? config('payroll.default_currency', 'INR')),
                    'status' => (string) ($data['reimbursement']['status'] ?? 'draft'),
                    'submitted_by' => $user->id,
                ]);
                $reimbursement->organization_id = $user->organization_id;
                $reimbursement->save();
                $adjustment->reimbursement_id = $reimbursement->id;
            }

            $adjustment->fill(collect($data)->except('reimbursement')->all());
            $adjustment->organization_id = $user->organization_id;
            if (($adjustment->status ?? null) === 'applied' && !$adjustment->applied_at) {
                $adjustment->applied_at = now();
                $adjustment->applied_by = $user->id;
            }
            $adjustment->save();
        });

        return response()->json($adjustment->fresh(['user', 'reimbursement', 'approvedBy', 'appliedBy', 'rejectedBy', 'appliedRun']), $id ? 200 : 201);
    }
}
