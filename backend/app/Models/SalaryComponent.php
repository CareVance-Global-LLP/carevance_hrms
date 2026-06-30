<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class SalaryComponent extends Model
{
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
    ];

    protected function casts(): array
    {
        return [
            'default_value' => 'float',
            'is_taxable' => 'boolean',
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
