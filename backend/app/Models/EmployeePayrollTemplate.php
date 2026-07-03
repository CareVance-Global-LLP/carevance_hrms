<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeePayrollTemplate extends Model
{
    protected $table = 'employee_payroll_templates';
    
    protected $fillable = [
        'organization_id',
        'user_id',
        'salary_template_id',
        'annual_ctc',
        'basic_percentage',
        'hra_percentage',
        'da_percentage',
        'conveyance_allowance',
        'medical_allowance',
        'special_allowance',
        'cca_amount',
        'education_allowance',
        'hostel_allowance',
        'internet_allowance',
        'meal_allowance',
        'transport_allowance',
        'uniform_allowance',
        'books_periodicals',
        'fuel_maintenance',
        'pf_enabled',
        'esi_enabled',
        'pt_enabled',
        'tds_enabled',
        'lwf_enabled',
        'nps_enabled',
        'nps_employee_percentage',
        'vpf_enabled',
        'vpf_percentage',
        'pf_employee_percentage',
        'pf_employer_percentage',
        'pf_wage_cap',
        'pf_above_cap',
        'esi_employee_percentage',
        'esi_employer_percentage',
        'esi_threshold',
        'pt_state',
        'tax_regime',
        'is_metro_city',
        'custom_earnings',
        'custom_deductions',
        'component_settings',
        'is_active',
        'created_by',
        'updated_by',
        // Per-step completion tracking (used by the Bulk Payroll Matrix
        // view). Added by migration 2026_06_22_000001.
        'step1_completed',
        'step2_completed',
        'step3_completed',
        'step4_completed',
        'step5_completed',
        'step6_completed',
        'current_step',
    ];

    protected $casts = [
        'basic_percentage' => 'decimal:2',
        'hra_percentage' => 'decimal:2',
        'da_percentage' => 'decimal:2',
        'conveyance_allowance' => 'decimal:2',
        'medical_allowance' => 'decimal:2',
        'special_allowance' => 'decimal:2',
        'cca_amount' => 'decimal:2',
        'education_allowance' => 'decimal:2',
        'hostel_allowance' => 'decimal:2',
        'internet_allowance' => 'decimal:2',
        'meal_allowance' => 'decimal:2',
        'transport_allowance' => 'decimal:2',
        'uniform_allowance' => 'decimal:2',
        'books_periodicals' => 'decimal:2',
        'fuel_maintenance' => 'decimal:2',
        'pf_enabled' => 'boolean',
        'esi_enabled' => 'boolean',
        'pt_enabled' => 'boolean',
        'tds_enabled' => 'boolean',
        'lwf_enabled' => 'boolean',
        'nps_enabled' => 'boolean',
        'nps_employee_percentage' => 'decimal:2',
        'vpf_enabled' => 'boolean',
        'vpf_percentage' => 'decimal:2',
        'pf_employee_percentage' => 'decimal:2',
        'pf_employer_percentage' => 'decimal:2',
        'pf_wage_cap' => 'decimal:2',
        'pf_above_cap' => 'boolean',
        'esi_employee_percentage' => 'decimal:2',
        'esi_employer_percentage' => 'decimal:2',
        'esi_threshold' => 'decimal:2',
        'is_metro_city' => 'boolean',
        'custom_earnings' => 'array',
        'custom_deductions' => 'array',
        'component_settings' => 'array',
        'is_active' => 'boolean',
        // Per-step completion tracking (Bulk Payroll Matrix)
        'step1_completed' => 'boolean',
        'step2_completed' => 'boolean',
        'step3_completed' => 'boolean',
        'step4_completed' => 'boolean',
        'step5_completed' => 'boolean',
        'step6_completed' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function salaryTemplate(): BelongsTo
    {
        return $this->belongsTo(SalaryTemplate::class, 'salary_template_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }

    /**
     * Get default template settings
     */
    public static function getDefaultSettings(): array
    {
        return [
            'basic_percentage' => 40.00,
            'hra_percentage' => 50.00,
            'da_percentage' => 0,
            'conveyance_allowance' => 1600.00,
            'medical_allowance' => 0,
            'special_allowance' => 0,
            'cca_amount' => 0,
            'education_allowance' => 0,
            'hostel_allowance' => 0,
            'internet_allowance' => 0,
            'meal_allowance' => 0,
            'transport_allowance' => 0,
            'uniform_allowance' => 0,
            'books_periodicals' => 0,
            'fuel_maintenance' => 0,
            'pf_enabled' => true,
            'esi_enabled' => true,
            'pt_enabled' => true,
            'tds_enabled' => true,
            'lwf_enabled' => false,
            'nps_enabled' => false,
            'nps_employee_percentage' => 10.00,
            'vpf_enabled' => false,
            'vpf_percentage' => 0,
            'pf_employee_percentage' => 12.00,
            'pf_employer_percentage' => 12.00,
            'pf_wage_cap' => 15000.00,
            'pf_above_cap' => false,
            'esi_employee_percentage' => 0.75,
            'esi_employer_percentage' => 3.25,
            'esi_threshold' => 21000.00,
            'tax_regime' => 'new',
            'is_metro_city' => true,
            'custom_earnings' => [],
            'custom_deductions' => [],
            'component_settings' => [],
        ];
    }

    /**
     * Create or update template for user.
     *
     * Default-resolution order (highest priority last):
     *   1. Built-in hard defaults (getDefaultSettings)
     *   2. DepartmentPayrollTemplate for the user's primary group, if one exists
     *   3. Organization.settings['payroll']
     *
     * NOTE: this method only runs when there is no existing template for the
     * user. Editing a department template does NOT retroactively change
     * existing employees' templates (per the master guide §4: 'Make sure the
     * check actually runs *after* ... not before' / 'payroll is a consumer').
     */
    public static function getOrCreateForUser(int $userId, int $organizationId, ?int $createdBy = null): self
    {
        $template = self::where('user_id', $userId)
            ->where('organization_id', $organizationId)
            ->first();

        if (!$template) {
            $organization = \App\Models\Organization::find($organizationId);
            $orgSettings = is_array($organization?->settings['payroll'] ?? null) ? $organization->settings['payroll'] : [];

            $deptTemplate = null;
            $user = \App\Models\User::find($userId);
            if ($user) {
                $deptTemplate = DepartmentPayrollTemplate::findForUser($user);
            }

            $settings = array_merge(
                self::getDefaultSettings(),
                $deptTemplate ? $deptTemplate->toEmployeeTemplateDefaults() : [],
                [
                    'basic_percentage' => $orgSettings['defaultBasicPercentage']
                        ?? ($deptTemplate?->basic_percentage ?? 40.00),
                    'hra_percentage' => $orgSettings['defaultHraPercentage']
                        ?? ($deptTemplate?->hra_percentage ?? 50.00),
                    'conveyance_allowance' => $orgSettings['defaultConveyance']
                        ?? ($deptTemplate?->conveyance_allowance ?? 1600.00),
                    'pf_employee_percentage' => $orgSettings['pfEmployeePercentage']
                        ?? ($deptTemplate?->pf_employee_percentage ?? 12.00),
                    'pf_employer_percentage' => $orgSettings['pfEmployerPercentage']
                        ?? ($deptTemplate?->pf_employer_percentage ?? 12.00),
                    'pf_wage_cap' => $orgSettings['pfWageCap']
                        ?? ($deptTemplate?->pf_wage_cap ?? 15000.00),
                    'esi_employee_percentage' => $orgSettings['esiEmployeePercentage']
                        ?? ($deptTemplate?->esi_employee_percentage ?? 0.75),
                    'esi_employer_percentage' => $orgSettings['esiEmployerPercentage']
                        ?? ($deptTemplate?->esi_employer_percentage ?? 3.25),
                    'esi_threshold' => $orgSettings['esiThreshold']
                        ?? ($deptTemplate?->esi_threshold ?? 21000.00),
                    'pt_state' => $orgSettings['defaultState']
                        ?? ($deptTemplate?->pt_state ?? 'maharashtra'),
                    'tax_regime' => $orgSettings['defaultTaxRegime']
                        ?? ($deptTemplate?->tax_regime ?? 'new'),
                    'is_metro_city' => $orgSettings['isMetroCity']
                        ?? ($deptTemplate?->is_metro_city ?? true),
                    'pf_enabled' => $orgSettings['pfEnabled']
                        ?? ($deptTemplate?->pf_enabled ?? true),
                    'esi_enabled' => $orgSettings['esiEnabled']
                        ?? ($deptTemplate?->esi_enabled ?? true),
                    'pt_enabled' => $orgSettings['ptEnabled']
                        ?? ($deptTemplate?->pt_enabled ?? true),
                    'tds_enabled' => $orgSettings['tdsEnabled']
                        ?? ($deptTemplate?->tds_enabled ?? true),
                    'lwf_enabled' => $orgSettings['lwfEnabled']
                        ?? ($deptTemplate?->lwf_enabled ?? false),
                    'nps_enabled' => $orgSettings['npsEnabled']
                        ?? ($deptTemplate?->nps_enabled ?? false),
                    'nps_employee_percentage' => $orgSettings['npsEmployeePercentage']
                        ?? ($deptTemplate?->nps_employee_percentage ?? 10.00),
                    'vpf_enabled' => $orgSettings['vpfEnabled']
                        ?? ($deptTemplate?->vpf_enabled ?? false),
                    'vpf_percentage' => $orgSettings['vpfPercentage']
                        ?? ($deptTemplate?->vpf_percentage ?? 0),
                ]);

            // Persist the new template so subsequent reads return it.
            // Without this, the method built the $settings array but
            // never created the row, so the next read would still find
            // nothing and the bug would surface again. (The previous
            // implementation only worked for users who already had a
            // template pre-created via some other path.)
            $settings['organization_id'] = $organizationId;
            $settings['user_id'] = $userId;
            $settings['created_by'] = $createdBy;
            $settings['annual_ctc'] = 0; // explicit — wizard will set it later
            $template = self::create($settings);

            // Auto-assign the organisation's default salary template so
            // every new employee gets one out of the box. The admin can
            // override it later from the employee payroll card.
            $defaultSalaryTemplate = \App\Models\SalaryTemplate::where('organization_id', $organizationId)
                ->where('is_default', true)
                ->first();
            if ($defaultSalaryTemplate) {
                $template->salary_template_id = $defaultSalaryTemplate->id;
                $template->save();
            }
        } elseif (empty($template->salary_template_id)) {
            // Existing template but no salary structure assigned yet
            // (created before the default-assignment logic). Backfill
            // the default now so the employee card shows it.
            $defaultSalaryTemplate = \App\Models\SalaryTemplate::where('organization_id', $organizationId)
                ->where('is_default', true)
                ->first();
            if ($defaultSalaryTemplate) {
                $template->salary_template_id = $defaultSalaryTemplate->id;
                $template->save();
            }
        }

        return $template;
    }
}
