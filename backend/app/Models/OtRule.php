<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OtRule extends Model
{
    protected $table = 'ot_rules';

    protected $fillable = [
        'organization_id', 'name', 'code', 'rate_multiplier', 'daily_limit_hours',
        'weekly_limit_hours', 'monthly_limit_hours', 'holiday_ot_enabled',
        'holiday_rate_multiplier', 'comp_off_enabled', 'comp_off_hours_per_ot_hour',
        'applicable_days', 'is_active',
    ];

    protected $casts = [
        'rate_multiplier' => 'decimal:2',
        'daily_limit_hours' => 'decimal:2',
        'weekly_limit_hours' => 'decimal:2',
        'monthly_limit_hours' => 'decimal:2',
        'holiday_rate_multiplier' => 'decimal:2',
        'comp_off_hours_per_ot_hour' => 'decimal:2',
        'holiday_ot_enabled' => 'boolean',
        'comp_off_enabled' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
