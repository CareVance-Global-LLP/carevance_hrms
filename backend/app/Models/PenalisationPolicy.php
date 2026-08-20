<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Grace, late rules, no-show and LOP — the half of the working-time model that
 * used to sit on the shift as grace_period_minutes and early_exit_grace_minutes.
 *
 * Splitting it out is what lets two teams share timings and differ on
 * discipline. The shift columns are still read as the fallback for an
 * organization with no policy assigned; policy wins when there is one.
 *
 * late_threshold carries two different readings depending on late_rule_type,
 * which is why it is a decimal rather than an integer: an INCIDENT rule counts
 * late arrivals per cycle (3), an HOURS rule accumulates lateness (1.5 hours).
 * Both are real options and both are per-cycle.
 *
 * There is no half-day threshold column here. Half-day is a LADDER of
 * (percent of shift hours worked) -> (leaves deducted), held in
 * PenalisationHalfDayRule, because collapsing it to one number cannot express
 * "under 25% costs a full day, under 50% costs half" — which is the shape every
 * organization running this actually configures.
 */
class PenalisationPolicy extends Model
{
    use BelongsToOrganization;

    public const LATE_RULE_INCIDENT = 'incident';
    public const LATE_RULE_HOURS = 'hours';

    public const CYCLE_WEEKLY = 'weekly';
    public const CYCLE_MONTHLY = 'monthly';

    public const BASIS_GROSS = 'gross';
    public const BASIS_EFFECTIVE = 'effective';

    protected $table = 'penalisation_policies';

    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'grace_period_minutes',
        'late_rule_type',
        'late_threshold',
        'exemptions_per_cycle',
        'cycle',
        'ignore_late_when_hours_met',
        'hours_basis',
        'no_show_below_hours',
        'treat_penalties_as_lop',
        'is_default',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'grace_period_minutes' => 'integer',
            'exemptions_per_cycle' => 'integer',
            // Decimal, never float: these decide whether a day is paid.
            'late_threshold' => 'decimal:2',
            'no_show_below_hours' => 'decimal:2',
            'ignore_late_when_hours_met' => 'boolean',
            'treat_penalties_as_lop' => 'boolean',
            'is_default' => 'boolean',
            'is_active' => 'boolean',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * The half-day ladder, ascending.
     *
     * Ordered by sort_order and then by percent_of_shift_hours so a ladder saved
     * without explicit ordering still reads lowest band first, which is the
     * order the resolution rule assumes: the first band the day falls below is
     * the one that applies.
     */
    public function halfDayRules(): HasMany
    {
        return $this->hasMany(PenalisationHalfDayRule::class)
            ->orderBy('sort_order')
            ->orderBy('percent_of_shift_hours');
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(EmployeePenalisationPolicy::class);
    }
}
