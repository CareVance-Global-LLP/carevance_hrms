<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A role somebody is hiring for.
 *
 * Named JobOpening rather than Job because Laravel's queue owns `jobs`, and a
 * collision there surfaces in a worker rather than in a test.
 */
class JobOpening extends Model
{
    use BelongsToOrganization;
    /*
     * Archived, never erased. A closed requisition is a record - it had
     * candidates, approvals and an agreed headcount - and its reference must
     * never be handed to a different role later.
     */
    use SoftDeletes;

    public const STATUSES = ['draft', 'open', 'on_hold', 'closed', 'filled'];

    public const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'intern', 'temporary'];

    protected $fillable = [
        'organization_id',
        'legal_entity_id',
        'group_id',
        'code',
        'title',
        'description',
        'employment_type',
        'location',
        'is_remote',
        'openings_count',
        'min_ctc',
        'max_ctc',
        'status',
        'hiring_manager_id',
        'recruiter_id',
        'created_by',
        'opened_at',
        'closed_at',
    ];

    protected $casts = [
        'is_remote' => 'boolean',
        'openings_count' => 'integer',
        'min_ctc' => 'decimal:2',
        'max_ctc' => 'decimal:2',
        // date:Y-m-d, never date — a plain date cast serialises as a UTC
        // datetime and reaches the client a day early east of UTC.
        'opened_at' => 'date:Y-m-d',
        'closed_at' => 'date:Y-m-d',
    ];

    public function applications(): HasMany
    {
        return $this->hasMany(JobApplication::class);
    }

    public function hiringManager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'hiring_manager_id');
    }

    public function recruiter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'recruiter_id');
    }

    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntity::class);
    }

    /** Departments are `groups` in this codebase. */
    public function department(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'group_id');
    }

    /** Can somebody still apply, and can applications still move? */
    public function isAcceptingApplications(): bool
    {
        return $this->status === 'open';
    }

    /**
     * How many hires this opening still needs.
     *
     * Counted from applications actually marked hired rather than from a
     * decrementing counter, because a counter and the underlying rows drift the
     * first time somebody un-hires a candidate or an application is deleted.
     */
    public function remainingOpenings(): int
    {
        $hired = $this->applications()->where('status', 'hired')->count();

        return max(0, (int) $this->openings_count - $hired);
    }
}
