<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SalaryComponent extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'name',
        'code',
        'category',
        'impact',
        'value_type',
        'calculation_basis',
        'default_value',
        'is_taxable',
        'is_compliance_component',
        'is_system_default',
        'is_active',
        'meta',
        // The residual role and its fallback chain. is_taxable above is the
        // second link: the balancer skips non-taxable components rather than
        // eroding HRA or conveyance and moving the employee's tax position.
        'is_residual',
        'allow_employee_override',
        'residual_order',
    ];

    protected function casts(): array
    {
        return [
            'default_value' => 'float',
            'is_taxable' => 'boolean',
            'is_residual' => 'boolean',
            'allow_employee_override' => 'boolean',
            'residual_order' => 'integer',
            'is_compliance_component' => 'boolean',
            'is_system_default' => 'boolean',
            'is_active' => 'boolean',
            'meta' => 'array',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function templateComponents(): HasMany
    {
        return $this->hasMany(SalaryTemplateComponent::class);
    }

    public function formulas(): HasMany
    {
        return $this->hasMany(SalaryFormula::class, 'salary_component_id');
    }

    public function activeFormula(): HasOne
    {
        return $this->hasOne(SalaryFormula::class, 'salary_component_id')
            ->where('is_active', true)
            ->orderBy('id');
    }
}
