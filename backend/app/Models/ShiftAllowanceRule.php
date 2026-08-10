<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ShiftAllowanceRule extends Model
{
    use BelongsToOrganization;

    protected $table = 'shift_allowance_rules';

    protected $fillable = [
        'organization_id', 'name', 'code', 'shift_type', 'allowance_per_hour',
        'allowance_per_shift', 'allowance_type', 'percentage_value',
        'applicable_days', 'start_time', 'end_time', 'is_active',
    ];

    protected $casts = [
        'allowance_per_hour' => 'decimal:2',
        'allowance_per_shift' => 'decimal:2',
        'percentage_value' => 'decimal:2',
        'start_time' => 'datetime:H:i',
        'end_time' => 'datetime:H:i',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
