<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class VariablePayAssignment extends Model
{
    protected $table = 'variable_pay_assignments';

    protected $fillable = [
        'organization_id', 'user_id', 'variable_pay_rule_id', 'percentage',
        'fixed_amount', 'month_year', 'is_active',
    ];

    protected $casts = [
        'percentage' => 'decimal:2',
        'fixed_amount' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function rule(): BelongsTo
    {
        return $this->belongsTo(VariablePayRule::class, 'variable_pay_rule_id');
    }
}
