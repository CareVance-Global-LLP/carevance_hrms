<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * How overtime accrues and what it is worth.
 *
 * This is the policy that replaces shifts.overtime_multiplier, which was a
 * single number and therefore could not say the three things that actually
 * decide an overtime bill:
 *
 *   - which clock it reads (gross hours, or effective hours net of breaks),
 *   - how much excess is ignored before anything accrues at all,
 *   - and that a working day, a weekly off and a public holiday are three
 *     independent scopes, each free to choose Pay or Comp-Off at its own rate.
 *
 * That last one lives in OvertimePolicyScope. The shift column stays in place
 * as the fallback for an organization that has configured no policy.
 *
 * requires_approval is not decoration: with it on, only approved hours are
 * considered, and unapproved overtime never reaches payroll.
 */
class OvertimePolicy extends Model
{
    use BelongsToOrganization;

    public const BASIS_GROSS = 'gross';
    public const BASIS_EFFECTIVE = 'effective';

    public const ROUNDING_UP = 'up';
    public const ROUNDING_DOWN = 'down';
    public const ROUNDING_NEAREST = 'nearest';

    protected $table = 'overtime_policies';

    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'hours_basis',
        'minimum_minutes_before_accrual',
        'rounding',
        'rounding_increment_minutes',
        'requires_approval',
        'pay_code',
        'is_default',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'minimum_minutes_before_accrual' => 'integer',
            'rounding_increment_minutes' => 'integer',
            'requires_approval' => 'boolean',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * The scope rows: working_day, weekly_off and holiday, plus any extended
     * tiers layered on them.
     *
     * Ordered by scope then by applies_after_minutes so the base tier of each
     * scope reads before its extended rates — the order a resolver walks to
     * find the highest tier a given quantity of overtime has reached.
     *
     * Named rateScopes(), not scopes(): a relationship called scopes() shadows
     * the Builder method of the same name through __callStatic, and anything
     * beginning scopeX is claimed by Eloquent as a local query scope.
     */
    public function rateScopes(): HasMany
    {
        return $this->hasMany(OvertimePolicyScope::class)
            ->orderBy('scope')
            ->orderBy('applies_after_minutes');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(EmployeeOvertimePolicy::class);
    }
}
