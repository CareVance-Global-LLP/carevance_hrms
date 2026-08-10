<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DailyWageStructure extends Model
{
    use BelongsToOrganization;

    protected $table = 'daily_wage_structures';

    protected $fillable = [
        'organization_id', 'name', 'code', 'daily_wage', 'working_days_per_month',
        'overtime_rate_multiplier', 'allowances', 'pf_applicable', 'esi_applicable', 'is_active',
    ];

    protected $casts = [
        'daily_wage' => 'decimal:2',
        'overtime_rate_multiplier' => 'decimal:2',
        'allowances' => 'array',
        'pf_applicable' => 'boolean',
        'esi_applicable' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function getMonthlyCtcAttribute(): float
    {
        return $this->daily_wage * $this->working_days_per_month;
    }
}
