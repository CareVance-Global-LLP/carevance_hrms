<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DepartmentPayrollTemplate extends Model
{
    use BelongsToOrganization;

    protected $table = 'department_payroll_templates';

    protected $fillable = [
        'organization_id',
        'department_id',
        'default_annual_ctc',
        'basic_percentage',
        'hra_percentage',
        'da_percentage',
        'conveyance_allowance',
        'medical_allowance',
        'special_allowance',
        'pf_enabled',
        'esi_enabled',
        'pt_enabled',
        'tds_enabled',
        'lwf_enabled',
        'nps_enabled',
        'vpf_enabled',
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
        'component_settings',
        'custom_earnings',
        'custom_deductions',
        'is_active',
        'created_by',
        'updated_by',
    ];

    protected $casts = [
        'default_annual_ctc' => 'decimal:2',
        'basic_percentage' => 'decimal:2',
        'hra_percentage' => 'decimal:2',
        'da_percentage' => 'decimal:2',
        'conveyance_allowance' => 'decimal:2',
        'medical_allowance' => 'decimal:2',
        'special_allowance' => 'decimal:2',
        'pf_enabled' => 'boolean',
        'esi_enabled' => 'boolean',
        'pt_enabled' => 'boolean',
        'tds_enabled' => 'boolean',
        'lwf_enabled' => 'boolean',
        'nps_enabled' => 'boolean',
        'vpf_enabled' => 'boolean',
        'pf_employee_percentage' => 'decimal:2',
        'pf_employer_percentage' => 'decimal:2',
        'pf_wage_cap' => 'decimal:2',
        'pf_above_cap' => 'boolean',
        'esi_employee_percentage' => 'decimal:2',
        'esi_employer_percentage' => 'decimal:2',
        'esi_threshold' => 'decimal:2',
        'is_metro_city' => 'boolean',
        'component_settings' => 'array',
        'custom_earnings' => 'array',
        'custom_deductions' => 'array',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'department_id');
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
     * Build the EmployeePayrollTemplate column map derived from this
     * department template. Used as the source of defaults when creating a
     * new employee template.
     *
     * Editing a department template does NOT retroactively change existing
     * employees' templates (per the master guide). It only affects the
     * defaults applied when a new employee template is created.
     */
    public function toEmployeeTemplateDefaults(): array
    {
        return [
            'annual_ctc' => (float) ($this->default_annual_ctc ?? 0),
            'basic_percentage' => (float) ($this->basic_percentage ?? 40),
            'hra_percentage' => (float) ($this->hra_percentage ?? 50),
            'da_percentage' => (float) ($this->da_percentage ?? 0),
            'conveyance_allowance' => (float) ($this->conveyance_allowance ?? 1600),
            'medical_allowance' => (float) ($this->medical_allowance ?? 0),
            'special_allowance' => (float) ($this->special_allowance ?? 0),
            'pf_enabled' => (bool) $this->pf_enabled,
            'esi_enabled' => (bool) $this->esi_enabled,
            'pt_enabled' => (bool) $this->pt_enabled,
            'tds_enabled' => (bool) $this->tds_enabled,
            'lwf_enabled' => (bool) $this->lwf_enabled,
            'nps_enabled' => (bool) $this->nps_enabled,
            'vpf_enabled' => (bool) $this->vpf_enabled,
            'pf_employee_percentage' => (float) ($this->pf_employee_percentage ?? 12),
            'pf_employer_percentage' => (float) ($this->pf_employer_percentage ?? 12),
            'pf_wage_cap' => (float) ($this->pf_wage_cap ?? 15000),
            'pf_above_cap' => (bool) $this->pf_above_cap,
            'esi_employee_percentage' => (float) ($this->esi_employee_percentage ?? 0.75),
            'esi_employer_percentage' => (float) ($this->esi_employer_percentage ?? 3.25),
            'esi_threshold' => (float) ($this->esi_threshold ?? 21000),
            'pt_state' => $this->pt_state ?? 'maharashtra',
            'tax_regime' => $this->tax_regime ?? 'new',
            'is_metro_city' => (bool) $this->is_metro_city,
            'component_settings' => $this->component_settings ?? [],
            'custom_earnings' => $this->custom_earnings ?? [],
            'custom_deductions' => $this->custom_deductions ?? [],
        ];
    }

    /**
     * Locate the active department template for the user's primary group.
     * Returns null if none is configured (caller should fall back to org
     * defaults or EmployeePayrollTemplate::getDefaultSettings()).
     */
    public static function findForUser(User $user): ?self
    {
        $deptId = $user->groups()->first()?->id;
        if (!$deptId) {
            return null;
        }

        return self::where('organization_id', $user->organization_id)
            ->where('department_id', $deptId)
            ->where('is_active', true)
            ->first();
    }
}
