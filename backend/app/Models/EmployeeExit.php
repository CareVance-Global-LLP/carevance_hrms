<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class EmployeeExit extends Model
{
    use Auditable;
    use BelongsToOrganization;

    public const STAGE_NOTICE = 'notice';
    public const STAGE_CLEARANCE = 'clearance';
    public const STAGE_SETTLEMENT = 'settlement';
    public const STAGE_CLOSED = 'closed';

    public const TYPES = ['resignation', 'termination', 'retirement', 'death', 'layoff'];

    /**
     * The EMPLOYER's view on taking this person back.
     *
     * Deliberately separate from `exit_interviews.would_rejoin`, which is the
     * departing person's own answer on the way out — given in confidence, to a
     * different question, and pointing the other way. Collapsing the two would
     * let a survey answer decide a hiring policy: somebody dismissed for cause
     * can still tick "yes, I'd come back", and somebody the organisation would
     * rehire tomorrow may say they would not. Only this column gates a rehire.
     *
     * The vocabulary lives here rather than in a database enum because the two
     * enum() columns already on this table became Postgres CHECK constraints
     * that no later change can alter without a second migration.
     */
    public const REHIRE_UNDECIDED = 'undecided';
    public const REHIRE_ELIGIBLE = 'eligible';
    public const REHIRE_NOT_ELIGIBLE = 'not_eligible';

    public const REHIRE_DECISIONS = [
        self::REHIRE_UNDECIDED,
        self::REHIRE_ELIGIBLE,
        self::REHIRE_NOT_ELIGIBLE,
    ];

    protected $table = 'employee_exits';

    protected $fillable = [
        'organization_id',
        'user_id',
        'resignation_id',
        'exit_type',
        'exit_reason',
        'notice_start_date',
        'last_working_date',
        'notice_period_days',
        'served_days',
        'shortfall_days',
        'stage',
        'clearance_completed_at',
        'access_revoked_at',
        'closed_at',
        'initiated_by',
        'rehire_eligibility',
        'rehire_note',
        'rehire_decided_by',
        'rehire_decided_at',
        'rejoined_at',
        'previous_joining_date',
    ];

    protected $casts = [
        'notice_start_date' => 'date:Y-m-d',
        'last_working_date' => 'date:Y-m-d',
        'notice_period_days' => 'integer',
        'served_days' => 'integer',
        'shortfall_days' => 'integer',
        'clearance_completed_at' => 'datetime',
        'access_revoked_at' => 'datetime',
        'closed_at' => 'datetime',
        'rehire_decided_at' => 'datetime',
        'rejoined_at' => 'datetime',
        // Date-only, so 'date:Y-m-d'. A plain 'date' serialises as a UTC
        // datetime and reaches the client a day early in IST — here that would
        // shift the service start the five-year gratuity test is measured from.
        'previous_joining_date' => 'date:Y-m-d',
    ];

    protected $appends = ['days_remaining', 'clearance_progress'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function resignation(): BelongsTo
    {
        return $this->belongsTo(Resignation::class);
    }

    public function initiatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'initiated_by');
    }

    public function rehireDecidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'rehire_decided_by');
    }

    public function interview(): HasOne
    {
        return $this->hasOne(ExitInterview::class);
    }

    public function settlement(): HasOne
    {
        return $this->hasOne(FullAndFinalSettlement::class);
    }

    public function checklistItems(): MorphMany
    {
        return $this->morphMany(ChecklistItem::class, 'subject')->orderBy('sort_order');
    }

    /**
     * Take the checklist with the exit, for the same reason OnboardingJourney
     * does: `subject_type`/`subject_id` is polymorphic, so no foreign key can
     * cascade this. No orphans have been observed from this side yet — this is
     * here so the pair cannot drift.
     */
    protected static function booted(): void
    {
        static::deleting(function (self $exit) {
            $exit->checklistItems()->delete();
        });
    }

    /** Negative once the last working day has passed. */
    public function getDaysRemainingAttribute(): int
    {
        return (int) now()->startOfDay()->diffInDays($this->last_working_date->startOfDay(), false);
    }

    public function getClearanceProgressAttribute(): array
    {
        $items = $this->relationLoaded('checklistItems')
            ? $this->checklistItems
            : $this->checklistItems()->get();

        $settled = $items->filter(fn (ChecklistItem $item) => $item->isSettled())->count();

        return [
            'total' => $items->count(),
            'done' => $settled,
            'blocking_outstanding' => $items
                ->filter(fn (ChecklistItem $item) => $item->is_blocking && ! $item->isSettled())
                ->count(),
        ];
    }

    /**
     * Settlement is gated on clearance. This is the single rule that stops a
     * final payment going out while the person still holds a laptop, and it is
     * the reason `is_blocking` exists at all.
     */
    public function canEnterSettlement(): bool
    {
        return $this->clearance_progress['blocking_outstanding'] === 0;
    }

    public function isOpen(): bool
    {
        return $this->stage !== self::STAGE_CLOSED;
    }

    public function scopeOpen(Builder $query): Builder
    {
        return $query->where('stage', '!=', self::STAGE_CLOSED);
    }
}
