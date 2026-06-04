<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollTimeEntry extends Model
{
    protected $fillable = [
        'organization_id',
        'user_id',
        'work_date',
        'check_in',
        'check_out',
        'duration_seconds',
        'break_seconds',
        'payable_hours',
        'status',
        'notes',
        'meta',
    ];

    protected $casts = [
        'work_date' => 'date',
        'check_in' => 'datetime',
        'check_out' => 'datetime',
        'duration_seconds' => 'integer',
        'break_seconds' => 'integer',
        'payable_hours' => 'decimal:2',
        'meta' => 'array',
    ];

    /**
     * Get the organization that owns the time entry.
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * Get the user that owns the time entry.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Check if there's an active check-in without checkout.
     */
    public function isActive(): bool
    {
        return $this->check_in !== null && $this->check_out === null;
    }

    /**
     * Calculate duration between check-in and check-out.
     */
    public function calculateDuration(): int
    {
        if (!$this->check_in) {
            return 0;
        }

        $end = $this->check_out ?? now();
        return $this->check_in->diffInSeconds($end);
    }

    /**
     * Scope to get active entries.
     */
    public function scopeActive($query)
    {
        return $query->whereNotNull('check_in')
            ->whereNull('check_out');
    }

    /**
     * Scope to get today's entry for a user.
     */
    public function scopeToday($query, int $userId)
    {
        return $query->where('user_id', $userId)
            ->where('work_date', today());
    }

    /**
     * Get duration in hours.
     */
    public function getDurationHoursAttribute(): float
    {
        return round($this->duration_seconds / 3600, 2);
    }

    /**
     * Get formatted duration.
     */
    public function getFormattedDurationAttribute(): string
    {
        $hours = floor($this->duration_seconds / 3600);
        $minutes = floor(($this->duration_seconds % 3600) / 60);
        return sprintf('%02d:%02d', $hours, $minutes);
    }
}
