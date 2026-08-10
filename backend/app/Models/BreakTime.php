<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BreakTime extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'time_entry_id',
        'break_type_id',
        'break_date',
        'start_at',
        'end_at',
        'duration_seconds',
        'reason',
    ];

    protected $casts = [
        'break_date' => 'date',
        'start_at' => 'datetime',
        'end_at' => 'datetime',
        'duration_seconds' => 'integer',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** The paired is_break time entry. Nullable for rows written before the link existed. */
    public function timeEntry(): BelongsTo
    {
        return $this->belongsTo(TimeEntry::class);
    }

    /** Nullable for rows written before break types existed. */
    public function breakType(): BelongsTo
    {
        return $this->belongsTo(BreakType::class);
    }

    public function scopeActive($query)
    {
        return $query->whereNull('end_at');
    }

    public function scopeForDate($query, $userId, $date)
    {
        return $query->where('user_id', $userId)->where('break_date', $date);
    }
}
