<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One overtime rate, for one kind of day.
 *
 * Working Day, Weekly Off and Holiday are three INDEPENDENT scopes: each picks
 * Pay or Comp-Off on its own, at its own multiplier. An organization that pays
 * 1.5x on a weekday, hands back comp-off for a weekly off and pays 2x on a
 * public holiday needs all three, and a single overtime_multiplier column on
 * the shift can express none of it.
 *
 * A scope is deliberately not unique per policy. Two more shapes ride on the
 * same table:
 *
 *   applies_after_minutes  extended OT — a second row for the same scope at a
 *                          higher rate once the overtime itself passes a
 *                          threshold. 0 is the base tier.
 *   effective_from/to      a validity window, for a rate that only holds for a
 *                          season. Null on both ends means always in force.
 */
class OvertimePolicyScope extends Model
{
    use BelongsToOrganization;

    public const SCOPE_WORKING_DAY = 'working_day';
    public const SCOPE_WEEKLY_OFF = 'weekly_off';
    public const SCOPE_HOLIDAY = 'holiday';

    public const TREATMENT_PAY = 'pay';
    public const TREATMENT_COMP_OFF = 'comp_off';

    protected $table = 'overtime_policy_scopes';

    protected $fillable = [
        'organization_id',
        'overtime_policy_id',
        'scope',
        'treatment',
        'multiplier',
        'applies_after_minutes',
        'effective_from',
        'effective_to',
    ];

    protected function casts(): array
    {
        return [
            // A rate, not an amount, but the same rule holds: decimal, never
            // float, or 1.5x drifts by a paisa an hour across a payroll run.
            'multiplier' => 'decimal:2',
            'applies_after_minutes' => 'integer',
            // date:Y-m-d, not date. A bare date cast serialises as UTC
            // midnight, so a window opening on 1 October reaches an IST client
            // as 30 September and the rate appears to start a day early.
            'effective_from' => 'date:Y-m-d',
            'effective_to' => 'date:Y-m-d',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function overtimePolicy(): BelongsTo
    {
        return $this->belongsTo(OvertimePolicy::class);
    }
}
