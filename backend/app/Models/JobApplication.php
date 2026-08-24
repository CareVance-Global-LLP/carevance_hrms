<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One person's candidacy for one opening.
 *
 * Distinct from Candidate, which is the person. Somebody good applies for two
 * roles and gets two applications, one history each, one human.
 *
 * `status` and `hiring_stage_id` answer different questions and both are
 * needed: the stage is WHERE they are in the pipeline, the status is WHETHER
 * the candidacy is still live. A rejected application keeps the stage it was
 * rejected at, because "rejected after the tech round" and "rejected on the CV"
 * are different facts about the same decision.
 */
class JobApplication extends Model
{
    use BelongsToOrganization;

    public const STATUSES = ['active', 'rejected', 'withdrawn', 'hired'];

    protected $fillable = [
        'organization_id',
        'job_opening_id',
        'candidate_id',
        'hiring_stage_id',
        'status',
        'applied_at',
        'rejection_reason',
        'decided_at',
        'decided_by',
    ];

    protected $casts = [
        'applied_at' => 'datetime',
        'decided_at' => 'datetime',
    ];

    public function opening(): BelongsTo
    {
        return $this->belongsTo(JobOpening::class, 'job_opening_id');
    }

    public function candidate(): BelongsTo
    {
        return $this->belongsTo(Candidate::class);
    }

    public function stage(): BelongsTo
    {
        return $this->belongsTo(HiringStage::class, 'hiring_stage_id');
    }

    public function events(): HasMany
    {
        return $this->hasMany(ApplicationStageEvent::class);
    }

    public function decidedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'decided_by');
    }

    /** Is this candidacy still live? */
    public function isOpen(): bool
    {
        return $this->status === 'active';
    }
}
