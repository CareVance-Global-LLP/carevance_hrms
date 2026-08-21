<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A repeating shift pattern.
 *
 * Length is in DAYS rather than weeks, because plenty of real rotas are not
 * seven-day: a four-on-four-off runs on an eight-day cycle, and a week-based
 * model cannot express it at all.
 */
class ShiftRotation extends Model
{
    use BelongsToOrganization;

    protected $table = 'shift_rotations';

    protected $fillable = [
        'organization_id',
        'name',
        'description',
        'cycle_length_days',
        'is_active',
    ];

    protected $casts = [
        'cycle_length_days' => 'integer',
        'is_active' => 'boolean',
    ];

    public function steps(): HasMany
    {
        return $this->hasMany(ShiftRotationStep::class)->orderBy('position');
    }

    /**
     * What this rotation says to do on a given day of its cycle.
     *
     * Returns the step, or null where the cycle has no step at that position -
     * which is a REST DAY, the same as a step whose shift_id is null. A
     * rotation of length 7 with only 5 steps defined means two rest days, and
     * making the caller distinguish "no step" from "step with no shift" would
     * be a difference without a meaning.
     */
    public function stepFor(int $dayOfCycle): ?ShiftRotationStep
    {
        $position = $this->cycle_length_days > 0
            ? (($dayOfCycle % $this->cycle_length_days) + $this->cycle_length_days) % $this->cycle_length_days
            : 0;

        return $this->steps->firstWhere('position', $position);
    }
}
