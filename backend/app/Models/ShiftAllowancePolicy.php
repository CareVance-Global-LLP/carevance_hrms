<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * The night and weekend premium, lifted off the shift's six differential
 * columns so two teams on the same timings can be paid differently for them.
 *
 * The shift columns (has_shift_differential, differential_percentage,
 * differential_fixed and the three weekend equivalents) stay exactly where they
 * are and remain the fallback for an organization with no policy assigned.
 *
 * Not to be confused with the older ShiftAllowanceRule, which is a payroll-side
 * per-hour/per-shift allowance keyed by shift_type. This is the assignable
 * policy object in the working-time model.
 *
 * night_allowance_type carries "none" rather than being nullable, so
 * "configured to pay nothing" and "never configured" stay distinguishable from
 * the row alone — the same distinction PT state handling depends on.
 *
 * On the window columns, and why they are NOT cast
 * ------------------------------------------------
 * night_window_start and night_window_end are SQL TIME values: wall-clock
 * readings with no date. A datetime cast would anchor them to today, and this
 * window crosses midnight by definition — a 22:00→06:00 window pinned to one
 * calendar day claims it ends sixteen hours before it starts. They stay
 * strings, normalised to H:i:s on read, exactly as Shift does it.
 */
class ShiftAllowancePolicy extends Model
{
    use BelongsToOrganization;

    public const TYPE_NONE = 'none';
    public const TYPE_PERCENTAGE = 'percentage';
    public const TYPE_FIXED = 'fixed';

    protected $table = 'shift_allowance_policies';

    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'night_allowance_type',
        'night_percentage',
        'night_fixed',
        'night_window_start',
        'night_window_end',
        'night_minimum_minutes_in_window',
        'weekend_allowance_type',
        'weekend_percentage',
        'weekend_fixed',
        'is_default',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            // Money and rates: decimal, never float.
            'night_percentage' => 'decimal:2',
            'night_fixed' => 'decimal:2',
            'weekend_percentage' => 'decimal:2',
            'weekend_fixed' => 'decimal:2',
            'night_minimum_minutes_in_window' => 'integer',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
            // night_window_start / night_window_end are deliberately uncast —
            // see the class docblock.
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(EmployeeShiftAllowancePolicy::class);
    }

    protected function nightWindowStart(): Attribute
    {
        return Attribute::get(fn ($value) => Shift::normalizeTime($value));
    }

    protected function nightWindowEnd(): Attribute
    {
        return Attribute::get(fn ($value) => Shift::normalizeTime($value));
    }

    public function paysNightPremium(): bool
    {
        return $this->night_allowance_type !== self::TYPE_NONE;
    }

    public function paysWeekendPremium(): bool
    {
        return $this->weekend_allowance_type !== self::TYPE_NONE;
    }
}
