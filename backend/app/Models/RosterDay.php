<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * What one person is doing on one day.
 *
 * A NULL shift_id means rostered OFF. No row at all means not rostered. Those
 * are different facts and the difference is the point of publishing a roster:
 * somebody given the day off has been told something, somebody nobody
 * scheduled has not.
 *
 * DRAFT AND PUBLISHED ARE DIFFERENT THINGS. ShiftResolver reads only published
 * days, so a manager can build next month without changing what attendance
 * expects of anybody today.
 */
class RosterDay extends Model
{
    use BelongsToOrganization;

    protected $table = 'roster_days';

    public const SOURCES = ['generated', 'manual', 'swap'];

    protected $fillable = [
        'organization_id',
        'user_id',
        'roster_date',
        'shift_id',
        'status',
        'source',
        'shift_rotation_id',
        'note',
        'published_at',
        'published_by',
    ];

    protected $casts = [
        // date:Y-m-d, never date — a plain cast serialises as a UTC datetime
        // and a rostered day reaches the client a day early east of UTC, which
        // on a roster is the difference between turning up and not.
        'roster_date' => 'date:Y-m-d',
        'published_at' => 'datetime',
    ];

    public function shift(): BelongsTo
    {
        return $this->belongsTo(Shift::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function rotation(): BelongsTo
    {
        return $this->belongsTo(ShiftRotation::class, 'shift_rotation_id');
    }

    public function isPublished(): bool
    {
        return $this->status === 'published';
    }

    /** Rostered, and rostered off. Not the same as unrostered. */
    public function isRestDay(): bool
    {
        return $this->shift_id === null;
    }

    /**
     * Was this set by a person rather than produced by a pattern?
     *
     * Regeneration replaces only what it produced, so this is what protects a
     * manager's decision from being rebuilt away.
     */
    public function isHumanSet(): bool
    {
        return in_array($this->source, ['manual', 'swap'], true);
    }
}
