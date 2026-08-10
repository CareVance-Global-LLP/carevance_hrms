<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BreakType extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'name',
        'is_paid',
        'max_minutes_per_day',
        'is_active',
    ];

    protected $casts = [
        'is_paid' => 'boolean',
        'is_active' => 'boolean',
        'max_minutes_per_day' => 'integer',
    ];

    /**
     * Defaults created for an organization that has never configured types.
     * Values mirror what the demo data and common Indian shift policy assume:
     * an unpaid lunch hour, a short paid tea break, and an uncapped personal
     * bucket for everything else.
     *
     * @return array<int, array<string, mixed>>
     */
    public const DEFAULTS = [
        ['name' => 'Lunch', 'is_paid' => false, 'max_minutes_per_day' => 60],
        ['name' => 'Tea break', 'is_paid' => true, 'max_minutes_per_day' => 15],
        ['name' => 'Personal', 'is_paid' => false, 'max_minutes_per_day' => null],
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    /**
     * The org's active types, creating the defaults on first touch. Lazy so no
     * signup/backfill path has to know break types exist.
     */
    public static function forOrganization(int $organizationId)
    {
        $types = static::query()
            ->where('organization_id', $organizationId)
            ->active()
            ->orderBy('id')
            ->get();

        if ($types->isNotEmpty()) {
            return $types;
        }

        foreach (self::DEFAULTS as $default) {
            static::query()->firstOrCreate(
                ['organization_id' => $organizationId, 'name' => $default['name']],
                $default,
            );
        }

        return static::query()
            ->where('organization_id', $organizationId)
            ->active()
            ->orderBy('id')
            ->get();
    }
}
