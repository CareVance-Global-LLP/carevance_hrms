<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One rung of a penalisation policy's half-day ladder.
 *
 * Half-day is not a single threshold. It is an ordered set of
 * (percent of shift hours worked) -> (leaves deducted), read lowest band first:
 * [{25, 1.00}, {50, 0.50}] means "worked under a quarter of the shift, lose a
 * full day; under half, lose half a day". Modelling that as one number on the
 * policy would make the two-tier case — which is the common one — inexpressible.
 *
 * leaves_deducted is a quantity of leave, not money, but it is decimal for the
 * same reason money is: 0.5 of a day accumulated as a float across a month of
 * attendance drifts, and it ends up in payroll.
 */
class PenalisationHalfDayRule extends Model
{
    use BelongsToOrganization;

    protected $table = 'penalisation_half_day_rules';

    protected $fillable = [
        'organization_id',
        'penalisation_policy_id',
        'sort_order',
        'percent_of_shift_hours',
        'leaves_deducted',
    ];

    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
            'percent_of_shift_hours' => 'decimal:2',
            'leaves_deducted' => 'decimal:2',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function penalisationPolicy(): BelongsTo
    {
        return $this->belongsTo(PenalisationPolicy::class);
    }
}
