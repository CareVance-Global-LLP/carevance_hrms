<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class EmployeeExit extends Model
{
    use BelongsToOrganization;

    public const STAGE_NOTICE = 'notice';
    public const STAGE_CLEARANCE = 'clearance';
    public const STAGE_SETTLEMENT = 'settlement';
    public const STAGE_CLOSED = 'closed';

    public const TYPES = ['resignation', 'termination', 'retirement', 'death', 'layoff'];

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
