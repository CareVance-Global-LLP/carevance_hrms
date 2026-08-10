<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class AttendanceRecord extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'user_id',
        'attendance_date',
        'check_in_at',
        'check_out_at',
        'worked_seconds',
        'manual_adjustment_seconds',
        'late_minutes',
        'status',
    ];

    protected function casts(): array
    {
        return [
            // date:Y-m-d, not date — a plain 'date' cast serializes as a full
            // datetime, so a bare 'Y-m-d' bound in a whereBetween sorts before
            // the stored value and silently drops the last day of the month.
            'attendance_date' => 'date:Y-m-d',
            'check_in_at' => 'datetime',
            'check_out_at' => 'datetime',
            'worked_seconds' => 'integer',
            'manual_adjustment_seconds' => 'integer',
            'late_minutes' => 'integer',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function punches(): HasMany
    {
        return $this->hasMany(AttendancePunch::class)->orderBy('punch_in_at');
    }
}
