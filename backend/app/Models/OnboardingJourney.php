<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class OnboardingJourney extends Model
{
    use BelongsToOrganization;

    public const STAGE_PREBOARDING = 'preboarding';
    public const STAGE_DAY_ONE = 'day_one';
    public const STAGE_ONBOARDING = 'onboarding';
    public const STAGE_COMPLETED = 'completed';
    public const STAGE_CANCELLED = 'cancelled';

    protected $fillable = [
        'organization_id',
        'user_id',
        'invitation_id',
        'candidate_name',
        'candidate_email',
        'job_title',
        'joining_date',
        'group_id',
        'manager_id',
        'buddy_id',
        'stage',
        'completed_at',
        'cancelled_at',
        'notes',
        'created_by',
    ];

    protected $casts = [
        // `date` serializes as a UTC datetime, so a joining date of the 24th
        // reaches the client as "…T18:30:00Z" on the 23rd and reads a day early
        // in any timezone ahead of UTC. `date:Y-m-d` keeps a calendar date a
        // calendar date.
        'joining_date' => 'date:Y-m-d',
        'completed_at' => 'datetime',
        'cancelled_at' => 'datetime',
    ];

    protected $appends = ['days_until_joining', 'readiness'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_id');
    }

    public function buddy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'buddy_id');
    }

    public function group(): BelongsTo
    {
        return $this->belongsTo(Group::class);
    }

    public function checklistItems(): MorphMany
    {
        return $this->morphMany(ChecklistItem::class, 'subject')->orderBy('sort_order');
    }

    /**
     * Take the checklist with the journey.
     *
     * `subject_type`/`subject_id` is polymorphic, so the database cannot own
     * this with a foreign key — deleting a journey left its items behind as
     * rows pointing at nothing. A real workspace was found holding 36 such
     * orphans across two journeys that no longer existed, which silently
     * inflates any "open onboarding tasks" count built on this table.
     */
    protected static function booted(): void
    {
        static::deleting(function (self $journey) {
            $journey->checklistItems()->delete();
        });
    }

    /** Negative once the joining date has passed. */
    public function getDaysUntilJoiningAttribute(): int
    {
        return (int) now()->startOfDay()->diffInDays($this->joining_date->startOfDay(), false);
    }

    /**
     * What the timeline reads off each row. `blocking_overdue` is the only one
     * that should ever raise an alarm — a task that is merely late but not
     * blocking Day 1 is noise.
     */
    public function getReadinessAttribute(): array
    {
        $items = $this->relationLoaded('checklistItems')
            ? $this->checklistItems
            : $this->checklistItems()->get();

        return [
            'total' => $items->count(),
            'done' => $items->filter(fn (ChecklistItem $item) => $item->isSettled())->count(),
            'overdue' => $items->filter(fn (ChecklistItem $item) => $item->is_overdue)->count(),
            'blocking_overdue' => $items
                ->filter(fn (ChecklistItem $item) => $item->is_blocking && $item->is_overdue)
                ->count(),
            // Blocking work still open, whether or not it has run late yet.
            // The summary showed only the overdue subset under a "Blocking"
            // heading, so a journey with four unfinished blocking tasks
            // reported "Blocking 0" until one of them slipped its date.
            'blocking_outstanding' => $items
                ->filter(fn (ChecklistItem $item) => $item->is_blocking && ! $item->isSettled())
                ->count(),
        ];
    }

    public function isOpen(): bool
    {
        return ! in_array($this->stage, [self::STAGE_COMPLETED, self::STAGE_CANCELLED], true);
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->whereNotIn('stage', [self::STAGE_COMPLETED, self::STAGE_CANCELLED]);
    }
}
