<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SalarySlabComponent extends Model
{
    use BelongsToOrganization;

    protected $table = 'salary_slab_components';

    protected $fillable = [
        'organization_id', 'name', 'code', 'slab_type', 'slabs',
        'applicable_on', 'default_value', 'is_active',
    ];

    protected $casts = [
        'slabs' => 'array',
        'default_value' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    const SLAB_TYPES = ['range', 'percentage', 'flat'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function calculateForValue(float $value): float
    {
        if (!$this->slabs || !is_array($this->slabs)) {
            return $this->default_value ?? 0;
        }

        foreach ($this->slabs as $slab) {
            $min = $slab['min'] ?? 0;
            $max = $slab['max'] ?? PHP_FLOAT_MAX;

            if ($value >= $min && $value <= $max) {
                return match ($this->slab_type) {
                    'percentage' => $value * ($slab['percentage'] / 100),
                    'flat' => $slab['amount'] ?? 0,
                    default => $slab['amount'] ?? $this->default_value ?? 0,
                };
            }
        }

        return $this->default_value ?? 0;
    }
}
