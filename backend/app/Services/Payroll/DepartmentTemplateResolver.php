<?php

namespace App\Services\Payroll;

use App\Models\DepartmentPayrollTemplate;
use App\Models\EmployeePayrollTemplate;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for the three-level payroll template hierarchy:
 *
 *   Organization defaults (Organization.settings['payroll'])
 *     -> Department template (DepartmentPayrollTemplate, new)
 *       -> Employee template (EmployeePayrollTemplate, existing — per-employee override)
 *
 * Editing a department template does NOT retroactively change existing
 * employees' templates. The dept template only seeds new employee
 * templates that don't yet exist. This matches normal payroll-software
 * behavior and the master guide's single-source-of-truth rule.
 */
class DepartmentTemplateResolver
{
    /**
     * Resolve the merged payroll defaults for a user, in priority order:
     *   1. Built-in hard defaults
     *   2. DepartmentPayrollTemplate (if active and the user has a primary group)
     *   3. Organization.settings['payroll']
     */
    public function resolveDefaultsForUser(User $user): array
    {
        $builtIn = EmployeePayrollTemplate::getDefaultSettings();
        $org = Organization::find($user->organization_id);
        $orgSettings = is_array($org?->settings['payroll'] ?? null) ? $org->settings['payroll'] : [];
        $dept = DepartmentPayrollTemplate::findForUser($user);

        $merged = array_merge($builtIn, $dept ? $dept->toEmployeeTemplateDefaults() : []);

        $override = [
            'basic_percentage' => $orgSettings['defaultBasicPercentage'] ?? $merged['basic_percentage'],
            'hra_percentage' => $orgSettings['defaultHraPercentage'] ?? $merged['hra_percentage'],
            'conveyance_allowance' => $orgSettings['defaultConveyance'] ?? $merged['conveyance_allowance'],
            'pf_employee_percentage' => $orgSettings['pfEmployeePercentage'] ?? $merged['pf_employee_percentage'],
            'pf_employer_percentage' => $orgSettings['pfEmployerPercentage'] ?? $merged['pf_employer_percentage'],
            'pf_wage_cap' => $orgSettings['pfWageCap'] ?? $merged['pf_wage_cap'],
            'esi_employee_percentage' => $orgSettings['esiEmployeePercentage'] ?? $merged['esi_employee_percentage'],
            'esi_employer_percentage' => $orgSettings['esiEmployerPercentage'] ?? $merged['esi_employer_percentage'],
            'esi_threshold' => $orgSettings['esiThreshold'] ?? $merged['esi_threshold'],
            'pt_state' => $orgSettings['defaultState'] ?? $merged['pt_state'],
            'tax_regime' => $orgSettings['defaultTaxRegime'] ?? $merged['tax_regime'],
            'is_metro_city' => $orgSettings['isMetroCity'] ?? $merged['is_metro_city'],
            'pf_enabled' => $orgSettings['pfEnabled'] ?? $merged['pf_enabled'],
            'esi_enabled' => $orgSettings['esiEnabled'] ?? $merged['esi_enabled'],
            'pt_enabled' => $orgSettings['ptEnabled'] ?? $merged['pt_enabled'],
            'tds_enabled' => $orgSettings['tdsEnabled'] ?? $merged['tds_enabled'],
            'lwf_enabled' => $orgSettings['lwfEnabled'] ?? $merged['lwf_enabled'],
        ];

        return array_merge($merged, $override);
    }

    /**
     * Upsert a department template for a (org, department) pair. Used by
     * the controller's `store` and `update` methods.
     */
    public function upsert(int $organizationId, int $departmentId, array $data, ?int $userId = null): DepartmentPayrollTemplate
    {
        return DB::transaction(function () use ($organizationId, $departmentId, $data, $userId) {
            $template = DepartmentPayrollTemplate::where('organization_id', $organizationId)
                ->where('department_id', $departmentId)
                ->first();

            $payload = array_intersect_key($data, array_flip([
                'default_annual_ctc',
                'basic_percentage', 'hra_percentage', 'da_percentage',
                'conveyance_allowance', 'medical_allowance', 'special_allowance',
                'pf_enabled', 'esi_enabled', 'pt_enabled', 'tds_enabled',
                'lwf_enabled', 'nps_enabled', 'vpf_enabled',
                'pf_employee_percentage', 'pf_employer_percentage', 'pf_wage_cap', 'pf_above_cap',
                'esi_employee_percentage', 'esi_employer_percentage', 'esi_threshold',
                'pt_state', 'tax_regime', 'is_metro_city',
                'component_settings', 'custom_earnings', 'custom_deductions',
                'is_active',
            ]));

            if ($template) {
                $template->fill($payload);
                if ($userId !== null) {
                    $template->updated_by = $userId;
                }
                $template->save();
            } else {
                $template = new DepartmentPayrollTemplate(array_merge([
                    'organization_id' => $organizationId,
                    'department_id' => $departmentId,
                ], $payload));
                if ($userId !== null) {
                    $template->created_by = $userId;
                    $template->updated_by = $userId;
                }
                $template->save();
            }

            return $template;
        });
    }
}
