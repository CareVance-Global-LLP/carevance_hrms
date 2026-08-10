<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class VariablePayRule extends Model
{
    use BelongsToOrganization;

    protected $table = 'variable_pay_rules';

    protected $fillable = [
        'organization_id', 'name', 'code', 'calculation_type', 'default_percentage',
        'max_percentage', 'frequency', 'slabs', 'eligibility_criteria',
        'is_performance_based', 'is_active',
    ];

    protected $casts = [
        'default_percentage' => 'decimal:2',
        'max_percentage' => 'decimal:2',
        'slabs' => 'array',
        'eligibility_criteria' => 'array',
        'is_performance_based' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(VariablePayAssignment::class, 'variable_pay_rule_id');
    }
}
