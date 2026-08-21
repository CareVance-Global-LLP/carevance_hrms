<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One day of a rotation.
 *
 * A null shift_id is a REST DAY, deliberately rather than a separate boolean.
 * A rotation is a sequence of "what you are doing", and "nothing" is one of the
 * things you can be doing.
 */
class ShiftRotationStep extends Model
{
    use BelongsToOrganization;

    protected $table = 'shift_rotation_steps';

    protected $fillable = [
        'organization_id',
        'shift_rotation_id',
        'position',
        'shift_id',
    ];

    protected $casts = ['position' => 'integer'];

    public function rotation(): BelongsTo
    {
        return $this->belongsTo(ShiftRotation::class, 'shift_rotation_id');
    }

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    public function isRestDay(): bool
    {
        return $this->shift_id === null;
    }
}
