<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\User;
use App\Models\EmployeePayrollTemplate;
use App\Models\SalaryTemplate;
use App\Models\PayGroupAssignment;
use App\Services\SalaryBreakdownService;
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
            // salaryTemplate eager-loaded: the map below reached for it per
            // employee, so a roster of seventeen issued 204 identical
            // salary_templates lookups. show() already loads it this way.
            ->with(['employeeProfile', 'employeePayrollTemplate.salaryTemplate', 'payGroupAssignments.payGroup', 'groups'])
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
            $salaryTemplate = $template?->salaryTemplate;
            $dept = $emp->groups->first();

            return [
                'id' => $emp->id,
                'name' => $emp->displayName(),
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
                'name' => $employee->displayName(),
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
                // Reported as null when nobody has set one — not as a state.
                // This card is an editable form: whatever it reports comes
                // straight back on the next save and is written to the
                // template by updateConfig() below, so a cosmetic
                // 'maharashtra' fallback here was a slow way of committing
                // Maharashtra's professional tax to an employee no one had
                // ever assigned a state to.
                'pt_state' => $template?->pt_state,
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

    /**
     * The employee's CTC split into components, driven by a salary structure.
     *
     * Read-only by design: nothing here writes. Every parameter is a what-if —
     * `salary_template_id`, `annual_ctc` and `pt_state` swap the inputs, and
     * `custom[...]` replaces the structure entirely with percentages the admin
     * types, so they can ask "what if basic were 50%?" without touching the
     * employee's saved configuration. Each defaults to the stored value.
     */
    public function breakdown(Request $request, int $userId, SalaryBreakdownService $breakdowns): JsonResponse
    {
        $user = $request->user();
        if (!$user) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        $validated = $request->validate([
            'salary_template_id' => 'nullable|integer|exists:salary_templates,id',
            'annual_ctc' => 'nullable|numeric|min:0',
            'pt_state' => 'nullable|string',
            'custom' => 'nullable|array',
            'custom.basic_percentage' => 'nullable|numeric|min:0|max:100',
            'custom.hra_percentage' => 'nullable|numeric|min:0|max:100',
            /*
             * A rupee amount is an INPUT FORMAT, not a second engine.
             *
             * Both are MONTHLY, matching conveyance_amount, the only other
             * rupee field here. They are converted to the percentages
             * SalaryBreakdownService already takes, so there is exactly one
             * arithmetic path and nothing new can drift from it.
             */
            'custom.basic_amount' => 'nullable|numeric|min:0',
            'custom.hra_amount' => 'nullable|numeric|min:0',
            'custom.da_percentage' => 'nullable|numeric|min:0|max:100',
            'custom.conveyance_amount' => 'nullable|numeric|min:0',
            'custom.nps_percentage' => 'nullable|numeric|min:0|max:100',
            'custom.vpf_percentage' => 'nullable|numeric|min:0|max:100',
        ]);

        $employee = User::query()
            ->with(['employeeProfile', 'employeePayrollTemplate', 'payGroupAssignments.payGroup', 'groups'])
            ->where('organization_id', $user->organization_id)
            ->where('id', $userId)
            ->first();

        if (!$employee) {
            return response()->json(['message' => 'Employee not found.'], 404);
        }

        $config = $employee->employeePayrollTemplate
            ?: new EmployeePayrollTemplate([
                'user_id' => $employee->id,
                'organization_id' => $user->organization_id,
            ]);

        $annualCtc = array_key_exists('annual_ctc', $validated) && $validated['annual_ctc'] !== null
            ? (float) $validated['annual_ctc']
            : (float) ($config->annual_ctc ?? 0);

        $isPreview = false;

        $structureId = $config->salary_template_id;
        if (array_key_exists('salary_template_id', $validated)) {
            $structureId = $validated['salary_template_id'];
            $isPreview = $isPreview || $structureId !== $config->salary_template_id;
        }

        $ptState = null;
        if (array_key_exists('pt_state', $validated) && $validated['pt_state'] !== null) {
            $ptState = $validated['pt_state'];
            $isPreview = $isPreview || $ptState !== $config->pt_state;
        }

        if (array_key_exists('annual_ctc', $validated) && $validated['annual_ctc'] !== null) {
            $isPreview = $isPreview || (float) $validated['annual_ctc'] !== (float) ($config->annual_ctc ?? 0);
        }

        /*
         * Custom mode builds a transient, never-saved SalaryTemplate from the
         * admin's percentages. calculateBreakdown() is an instance method that
         * reads its own attributes, so an unsaved model runs the identical
         * arithmetic a real structure would — no second implementation to drift.
         */
        // '' as well as null: an absent number must not reach a decimal cast.
        $custom = array_filter($validated['custom'] ?? [], fn ($v) => $v !== null && $v !== '');

        /*
         * Amounts become percentages before anything else looks at them.
         *
         * Basic is a share of monthly CTC; HRA is a share of monthly BASIC —
         * so HRA has to be converted after basic, against the basic that
         * conversion produced. Doing it the other way round silently rates HRA
         * against the wrong base.
         *
         * The guards are the crash: a zero CTC or a zero basic would divide by
         * nothing, and a zero basic is entirely reachable — an admin clearing
         * the Basic field before typing a new one.
         */
        $customWarnings = [];
        $monthlyCtcForCustom = $annualCtc / 12;

        if (isset($custom['basic_amount']) && $monthlyCtcForCustom > 0) {
            if (isset($custom['basic_percentage'])) {
                $customWarnings[] = 'Basic was given as both an amount and a percentage; the amount was used.';
            }
            $custom['basic_percentage'] = $custom['basic_amount'] / $monthlyCtcForCustom * 100;
        }

        if (isset($custom['hra_amount'])) {
            $basicMonthly = $monthlyCtcForCustom * (float) ($custom['basic_percentage'] ?? 40) / 100;

            if ($basicMonthly > 0) {
                if (isset($custom['hra_percentage'])) {
                    $customWarnings[] = 'HRA was given as both an amount and a percentage; the amount was used.';
                }
                $custom['hra_percentage'] = $custom['hra_amount'] / $basicMonthly * 100;
            }
        }

        unset($custom['basic_amount'], $custom['hra_amount']);

        if ($custom !== []) {
            $structure = SalaryTemplate::transient([
                'organization_id' => $user->organization_id,
                'name' => 'Custom',
                'basic_percentage' => $custom['basic_percentage'] ?? 40,
                'hra_percentage' => $custom['hra_percentage'] ?? 50,
                'da_percentage' => $custom['da_percentage'] ?? 0,
                'conveyance_amount' => $custom['conveyance_amount'] ?? 0,
                'nps_percentage' => $custom['nps_percentage'] ?? 0,
                'vpf_percentage' => $custom['vpf_percentage'] ?? 0,
            ]);
            $isPreview = true;
        } else {
            // where(organization_id), not find(): a salary template belongs to a
            // tenant and the id arrives from the client.
            $structure = $structureId
                ? SalaryTemplate::where('organization_id', $user->organization_id)->find($structureId)
                : null;
        }

        if ($annualCtc <= 0) {
            return response()->json([
                'success' => false,
                'message' => 'This employee has no annual CTC set, so there is nothing to break down.',
            ], 422);
        }

        $payGroup = $employee->payGroupAssignments->first()?->payGroup;

        return response()->json([
            'success' => true,
            'employee' => [
                'id' => $employee->id,
                'name' => $employee->displayName(),
                'email' => $employee->email,
                'designation' => $employee->employeeProfile?->designation ?? null,
                'department' => $employee->groups->first()?->name ?? null,
                'pay_group' => $payGroup?->name ?? null,
            ],
            'source' => [
                // A transient custom structure has no id — the panel uses that
                // to tell "Custom" apart from a saved structure.
                'salary_template_id' => $structure?->id,
                'salary_template_name' => $structure?->name,
                'is_custom' => $custom !== [],
                'annual_ctc' => round($annualCtc, 2),
                'pt_state' => $ptState ?? $config->pt_state,
                'tax_regime' => $config->tax_regime ?? 'new',
                'is_metro_city' => (bool) ($config->is_metro_city ?? true),
                'is_preview' => $isPreview,
            ],
        ] + $this->withCustomWarnings(
            $breakdowns->forEmployee($employee, $structure, $annualCtc, $config, $ptState),
            $customWarnings,
        ));
    }

    /**
     * Fold the amount-versus-percentage notes into the breakdown's own
     * warnings, rather than adding a second place a caller has to look.
     *
     * @param  array<string, mixed>  $breakdown
     * @param  list<string>  $warnings
     * @return array<string, mixed>
     */
    private function withCustomWarnings(array $breakdown, array $warnings): array
    {
        if ($warnings === []) {
            return $breakdown;
        }

        $breakdown['warnings'] = array_merge($breakdown['warnings'] ?? [], $warnings);

        return $breakdown;
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
                ['user_id' => $employee->id, 'organization_id' => $user->organization_id],
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
                    /*
                     * pt_state is left NULL on create, never seeded with a
                     * state.
                     *
                     * This wrote 'maharashtra'. Saving anything at all on an
                     * employee's payroll card — a bank account, a CTC — is
                     * what first creates their template, so an admin who had
                     * never seen the professional-tax field committed
                     * Maharashtra's slab to that employee, and
                     * PayrollAutoProcessService then deducted ₹200 a month
                     * (₹300 in February) from someone who may work in Delhi
                     * or Haryana and owe nothing. The `pt_state` key below is
                     * still writable, so an admin who *does* name a state
                     * gets it; NULL means nobody has, and PTStateService
                     * prices that at ₹0.
                     */
                    'pt_state' => null,
                    'tax_regime' => 'new',
                    'is_metro_city' => true,
                ]
            );

            /*
             * Only the fields the request actually sent, nulls included.
             *
             * This was an array_filter that dropped every null, which made
             * nullable fields impossible to clear: blanking Annual CTC or
             * choosing "— None —" for the salary template sent null, the null
             * was stripped, and the old value was returned intact — the save
             * reported success and changed nothing. Fields the caller omits are
             * still left untouched, which is what array_filter was reaching for.
             */
            $templateFields = [
                'annual_ctc',
                'basic_percentage',
                'hra_percentage',
                'da_percentage',
                'conveyance_allowance',
                'salary_template_id',
                'pt_state',
                'tax_regime',
                'is_metro_city',
                'pf_enabled',
                'esi_enabled',
                'pt_enabled',
                'tds_enabled',
                'lwf_enabled',
                'pf_employee_percentage',
                'pf_employer_percentage',
                'pf_wage_cap',
                'esi_employee_percentage',
                'esi_employer_percentage',
                'esi_threshold',
                'is_active',
            ];

            $updateData = [];
            foreach ($templateFields as $field) {
                if (array_key_exists($field, $validated)) {
                    $updateData[$field] = $validated[$field];
                }
            }

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
