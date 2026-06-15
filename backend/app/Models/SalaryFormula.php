<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SalaryFormula extends Model
{
    protected $table = 'salary_formulas';

    protected $fillable = [
        'organization_id', 'salary_component_id', 'name', 'formula_expression',
        'description', 'effective_from', 'effective_to', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function salaryComponent(): BelongsTo
    {
        return $this->belongsTo(SalaryComponent::class);
    }
}
