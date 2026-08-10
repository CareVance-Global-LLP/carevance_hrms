<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PerquisiteRecord extends Model
{
    use BelongsToOrganization;

    protected $table = 'perquisite_records';

    protected $fillable = [
        'organization_id', 'user_id', 'type', 'description', 'monthly_value', 'annual_value',
        'taxable_value', 'employee_contribution', 'from_date', 'to_date', 'details', 'is_active',
    ];

    protected $casts = [
        'monthly_value' => 'decimal:2',
        'annual_value' => 'decimal:2',
        'taxable_value' => 'decimal:2',
        'employee_contribution' => 'decimal:2',
        'from_date' => 'date',
        'to_date' => 'date',
        'details' => 'array',
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
}
