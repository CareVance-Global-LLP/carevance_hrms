<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Somebody on a rotation, from a date.
 *
 * Effective-dated like every other assignment here, so changing a rota next
 * month does not rewrite what somebody worked last month.
 *
 * `start_offset` is where in the cycle this person begins. Two people on the
 * same five-on-two-off rota are usually offset so the site stays covered;
 * without it they would all rest on the same days.
 */
class EmployeeShiftRotation extends Model
{
    use BelongsToOrganization;

    protected $table = 'employee_shift_rotations';

    protected $fillable = [
        'organization_id',
        'user_id',
        'shift_rotation_id',
        'effective_from',
        'effective_to',
        'start_offset',
        'is_active',
    ];

    protected $casts = [
        // date:Y-m-d, never date - a plain date cast serialises as a UTC
        // datetime and a roster boundary reaches the client a day early.
        'effective_from' => 'date:Y-m-d',
        'effective_to' => 'date:Y-m-d',
        'start_offset' => 'integer',
        'is_active' => 'boolean',
    ];

    public function rotation(): BelongsTo
    {
        return $this->belongsTo(ShiftRotation::class, 'shift_rotation_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
