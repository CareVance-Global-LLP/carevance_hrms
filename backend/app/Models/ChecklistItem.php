<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

class ChecklistItem extends Model
{
    use BelongsToOrganization;

    public const STATUS_PENDING = 'pending';
    public const STATUS_DONE = 'done';
    public const STATUS_BLOCKED = 'blocked';
    public const STATUS_SKIPPED = 'skipped';

    protected $fillable = [
        'organization_id',
        'subject_type',
        'subject_id',
        'checklist_template_item_id',
        'title',
        'description',
        'owner_kind',
        'owner_user_id',
        'due_date',
        'requires',
        'is_blocking',
        'status',
        'completed_at',
        'completed_by',
        'notes',
        'employee_document_id',
        'evidence_kind',
        'evidence_label',
        'asset_assignment_id',
        'sort_order',
    ];

    protected $casts = [
        // Plain calendar date — see OnboardingJourney::$casts. A due date that
        // shifts a day when serialized makes every deadline read early.
        'due_date' => 'date:Y-m-d',
        'completed_at' => 'datetime',
        'is_blocking' => 'boolean',
        'sort_order' => 'integer',
    ];

    protected $appends = ['is_overdue'];

    public function subject(): MorphTo
    {
        return $this->morphTo();
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_user_id');
    }

    public function completedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'completed_by');
    }

    public function assetAssignment(): BelongsTo
    {
        return $this->belongsTo(AssetAssignment::class);
    }

    /**
     * The template row this item was materialised from.
     *
     * `document_category` — which decides what an upload has to be to satisfy
     * this item — lives on the template item rather than being copied onto each
     * materialised row, so it is only reachable through here.
     */
    public function checklistTemplateItem(): BelongsTo
    {
        return $this->belongsTo(ChecklistTemplateItem::class, 'checklist_template_item_id');
    }

    public function document(): BelongsTo
    {
        return $this->belongsTo(EmployeeDocument::class, 'employee_document_id');
    }

    /**
     * Derived, never stored. An "overdue" column would need a nightly job to
     * stay truthful and would be wrong for the rest of the day; the date and
     * the status already contain the answer.
     */
    public function getIsOverdueAttribute(): bool
    {
        if ($this->status === self::STATUS_DONE || $this->status === self::STATUS_SKIPPED) {
            return false;
        }

        return $this->due_date !== null && $this->due_date->isPast();
    }

    public function isSettled(): bool
    {
        return in_array($this->status, [self::STATUS_DONE, self::STATUS_SKIPPED], true);
    }

    public function scopeOutstanding(Builder $query): Builder
    {
        return $query->whereIn('status', [self::STATUS_PENDING, self::STATUS_BLOCKED]);
    }

    public function scopeForSubject(Builder $query, Model $subject): Builder
    {
        return $query->where('subject_type', $subject->getMorphClass())
            ->where('subject_id', $subject->getKey());
    }
}
