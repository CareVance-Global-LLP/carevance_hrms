<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AttendancePunch extends Model
{
    use BelongsToOrganization;

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
        // Offline-sync idempotency keys. Missing from $fillable, so the values
        // merged in by IdempotentSync were dropped on create and the
        // (local_id, device_id) unique index never had anything to match on.
        'local_id',
        'device_id',
        // Set when a sweeper closed this punch because nobody checked out.
        // Distinguishes "left at 18:00" from "was still open, closed at 18:00".
        'auto_closed_reason',
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
