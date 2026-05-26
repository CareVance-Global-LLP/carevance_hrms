<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendancePunch extends Model
{
    protected $fillable = [
        'organization_id',
        'user_id',
        'attendance_record_id',
        'punch_in_at',
        'punch_out_at',
        'worked_seconds',
        'punch_in_latitude',
        'punch_in_longitude',
        'punch_out_latitude',
        'punch_out_longitude',
    ];

    protected function casts(): array
    {
        return [
            'punch_in_at' => 'datetime',
            'punch_out_at' => 'datetime',
            'worked_seconds' => 'integer',
        ];
    }

    public function attendanceRecord(): BelongsTo
    {
        return $this->belongsTo(AttendanceRecord::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
