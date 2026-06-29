<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\EmployeePayrollTemplate;
use App\Models\SalaryTemplate;
use App\Models\PayGroupAssignment;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class EmployeePayrollCardController extends Controller
{
    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $departmentId = $request->query('department_id');
        $payGroupId = $request->query('pay_group_id');
        $stateCode = $request->query('state');

        $query = User::query()
            ->with(['employeeProfile', 'employeePayrollTemplate', 'payGroupAssignments.payGroup', 'groups'])
            ->where('organization_id', $user->organization_id);

        if ($departmentId) {
            $query->whereHas('groups', function ($q) use ($departmentId) {
                $q->where('groups.id', $departmentId);
            });
        }

        if ($payGroupId) {
            $query->whereHas('payGroupAssignments', function ($q) use ($payGroupId) {
                $q->where('pay_group_id', $payGroupId)
                  ->where('is_active', true);
            });
        }

        if ($stateCode) {
            $query->whereHas('employeePayrollTemplate', function ($q) use ($stateCode) {
                $q->where('pt_state', $stateCode);
            });
        }

        $employees = $query->get()->map(function ($emp) {
            $template = $emp->employeePayrollTemplate;
            $payGroupAssignment = $emp->payGroupAssignments->first();
            $payGroup = $payGroupAssignment?->payGroup;
            $salaryTemplate = $template?->salary_template_id
                ? SalaryTemplate::find($template->salary_template_id)
                : null;
            $dept = $emp->groups->first();

            return [
                'id' => $emp->id,
                'name' => trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? '')),
                'email' => $emp->email,
                'department' => $dept?->name ?? null,
                'department_id' => $dept?->id ?? null,
                'designation' => $emp->employeeProfile?->designation ?? null,
                'pay_group' => $payGroup?->name ?? null,
                'pay_group_id' => $payGroup?->id ?? null,
                'annual_ctc' => $template?->annual_ctc ?? null,
                'salary_structure' => $salaryTemplate?->name ?? null,
                'salary_template_id' => $template?->salary_template_id ?? null,
                'state' => $template?->pt_state ?? null,
                'tax_regime' => $template?->tax_regime ?? 'new',
                'is_metro_city' => $template?->is_metro_city ?? true,
                'status' => $emp->active ?? true ? 'Active' : 'Inactive',
                'template_active' => $template?->is_active ?? false,
            ];
        });

        return response()->json([
            'success' => true,
            'employees' => $employees,
        ]);
    }

    public function show(Request $request, int $userId): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $employee = User::query()
            ->with(['employeeProfile', 'employeePayrollTemplate.salaryTemplate', 'payGroupAssignments.payGroup', 'groups'])
            ->where('organization_id', $user->organization_id)
            ->where('id', $userId)
            ->first();

        if (!$employee) {
            return response()->json(['message' => 'Employee not found.'], 404);
        }

        $template = $employee->employeePayrollTemplate;
        $payGroupAssignment = $employee->payGroupAssignments->first();

        $payGroup = null;
        if ($payGroupAssignment && $payGroupAssignment->payGroup) {
            $pg = $payGroupAssignment->payGroup;
            $payGroup = [
                'id' => $pg->id,
                'name' => $pg->name,
                'code' => $pg->code,
            ];
        }

        $salaryTemplate = $template?->salaryTemplate;

        return response()->json([
            'success' => true,
            'employee' => [
                'id' => $employee->id,
                'name' => trim(($employee->first_name ?? '') . ' ' . ($employee->last_name ?? '')),
                'email' => $employee->email,
                'department' => $employee->groups->first()?->name ?? null,
                'department_id' => $employee->groups->first()?->id ?? null,
                'designation' => $employee->employeeProfile?->designation ?? null,
            ],
            'payroll_config' => [
                'annual_ctc' => $template?->annual_ctc ?? null,
                'basic_percentage' => $template?->basic_percentage ?? 40,
                'hra_percentage' => $template?->hra_percentage ?? 50,
                'da_percentage' => $template?->da_percentage ?? 0,
                'conveyance_allowance' => $template?->conveyance_allowance ?? 1600,
                'salary_template_id' => $template?->salary_template_id ?? null,
                'salary_template' => $salaryTemplate ? [
                    'id' => $salaryTemplate->id,
                    'name' => $salaryTemplate->name,
                    'basic_percentage' => $salaryTemplate->basic_percentage,
                    'hra_percentage' => $salaryTemplate->hra_percentage,
                    'conveyance_amount' => $salaryTemplate->conveyance_amount,
                ] : null,
                'pay_group_id' => $payGroupAssignment?->pay_group_id ?? null,
                'pay_group' => $payGroup,
                'pt_state' => $template?->pt_state ?? 'maharashtra',
                'tax_regime' => $template?->tax_regime ?? 'new',
                'is_metro_city' => $template?->is_metro_city ?? true,
                'pf_enabled' => $template?->pf_enabled ?? true,
                'esi_enabled' => $template?->esi_enabled ?? true,
                'pt_enabled' => $template?->pt_enabled ?? true,
                'tds_enabled' => $template?->tds_enabled ?? true,
                'lwf_enabled' => $template?->lwf_enabled ?? false,
                'pf_employee_percentage' => $template?->pf_employee_percentage ?? 12,
                'pf_employer_percentage' => $template?->pf_employer_percentage ?? 12,
                'pf_wage_cap' => $template?->pf_wage_cap ?? 15000,
                'esi_employee_percentage' => $template?->esi_employee_percentage ?? 0.75,
                'esi_employer_percentage' => $template?->esi_employer_percentage ?? 3.25,
                'esi_threshold' => $template?->esi_threshold ?? 21000,
                'is_active' => $template?->is_active ?? true,
            ],
        ]);
    }

    public function update(Request $request, int $userId): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $employee = User::query()
            ->where('organization_id', $user->organization_id)
            ->where('id', $userId)
            ->first();

        if (!$employee) {
            return response()->json(['message' => 'Employee not found.'], 404);
        }

        $validated = $request->validate([
            'annual_ctc' => 'nullable|numeric|min:0',
            'basic_percentage' => 'nullable|numeric|min:0|max:100',
            'hra_percentage' => 'nullable|numeric|min:0|max:100',
            'da_percentage' => 'nullable|numeric|min:0|max:100',
            'conveyance_allowance' => 'nullable|numeric|min:0',
            'salary_template_id' => 'nullable|integer|exists:salary_templates,id',
            'pay_group_id' => 'nullable|integer|exists:pay_groups,id',
            'pt_state' => 'nullable|string',
            'tax_regime' => 'nullable|in:new,old',
            'is_metro_city' => 'nullable|boolean',
            'pf_enabled' => 'nullable|boolean',
            'esi_enabled' => 'nullable|boolean',
            'pt_enabled' => 'nullable|boolean',
            'tds_enabled' => 'nullable|boolean',
            'lwf_enabled' => 'nullable|boolean',
            'pf_employee_percentage' => 'nullable|numeric|min:0|max:100',
            'pf_employer_percentage' => 'nullable|numeric|min:0|max:100',
            'pf_wage_cap' => 'nullable|numeric|min:0',
            'esi_employee_percentage' => 'nullable|numeric|min:0|max:100',
            'esi_employer_percentage' => 'nullable|numeric|min:0|max:100',
            'esi_threshold' => 'nullable|numeric|min:0',
            'is_active' => 'nullable|boolean',
        ]);

        DB::transaction(function () use ($employee, $validated, $user) {
            $template = EmployeePayrollTemplate::firstOrCreate(
                ['user_id' => $employee->id],
                [
                    'organization_id' => $user->organization_id,
                    'basic_percentage' => 50,
                    'hra_percentage' => 50,
                    'conveyance_allowance' => 1600,
                    'pf_enabled' => true,
                    'esi_enabled' => true,
                    'pt_enabled' => true,
                    'tds_enabled' => true,
                    'lwf_enabled' => false,
                    'pt_state' => 'maharashtra',
                    'tax_regime' => 'new',
                    'is_metro_city' => true,
                ]
            );

            $updateData = array_filter([
                'annual_ctc' => $validated['annual_ctc'] ?? null,
                'basic_percentage' => $validated['basic_percentage'] ?? null,
                'hra_percentage' => $validated['hra_percentage'] ?? null,
                'da_percentage' => $validated['da_percentage'] ?? null,
                'conveyance_allowance' => $validated['conveyance_allowance'] ?? null,
                'salary_template_id' => $validated['salary_template_id'] ?? null,
                'pt_state' => $validated['pt_state'] ?? null,
                'tax_regime' => $validated['tax_regime'] ?? null,
                'is_metro_city' => $validated['is_metro_city'] ?? null,
                'pf_enabled' => $validated['pf_enabled'] ?? null,
                'esi_enabled' => $validated['esi_enabled'] ?? null,
                'pt_enabled' => $validated['pt_enabled'] ?? null,
                'tds_enabled' => $validated['tds_enabled'] ?? null,
                'lwf_enabled' => $validated['lwf_enabled'] ?? null,
                'pf_employee_percentage' => $validated['pf_employee_percentage'] ?? null,
                'pf_employer_percentage' => $validated['pf_employer_percentage'] ?? null,
                'pf_wage_cap' => $validated['pf_wage_cap'] ?? null,
                'esi_employee_percentage' => $validated['esi_employee_percentage'] ?? null,
                'esi_employer_percentage' => $validated['esi_employer_percentage'] ?? null,
                'esi_threshold' => $validated['esi_threshold'] ?? null,
                'is_active' => $validated['is_active'] ?? null,
            ], fn ($v) => !is_null($v));

            if (!empty($updateData)) {
                $template->update($updateData);
            }

            if (array_key_exists('pay_group_id', $validated)) {
                PayGroupAssignment::where('user_id', $employee->id)->delete();

                if ($validated['pay_group_id']) {
                    PayGroupAssignment::create([
                        'user_id' => $employee->id,
                        'pay_group_id' => $validated['pay_group_id'],
                    ]);
                }
            }
        });

        return $this->show($request, $userId);
    }
}
