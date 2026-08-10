<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CtcRangeBand extends Model
{
    use BelongsToOrganization;

    protected $table = 'ctc_range_bands';

    protected $fillable = [
        'organization_id', 'name', 'code', 'min_ctc', 'max_ctc', 'basic_percentage',
        'hra_percentage', 'pf_mandatory', 'esi_mandatory', 'pf_wage_cap',
        'additional_rules', 'is_active',
    ];

    protected $casts = [
        'min_ctc' => 'decimal:2',
        'max_ctc' => 'decimal:2',
        'basic_percentage' => 'decimal:2',
        'hra_percentage' => 'decimal:2',
        'pf_mandatory' => 'boolean',
        'esi_mandatory' => 'boolean',
        'pf_wage_cap' => 'decimal:2',
        'additional_rules' => 'array',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public static function findBandForCtc(int $organizationId, float $annualCtc): ?self
    {
        return self::where('organization_id', $organizationId)
            ->where('min_ctc', '<=', $annualCtc)
            ->where('max_ctc', '>=', $annualCtc)
            ->where('is_active', true)
            ->first();
    }
}
