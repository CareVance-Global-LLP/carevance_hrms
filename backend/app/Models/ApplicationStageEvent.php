<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * How a candidacy moved, and when.
 *
 * Append-only by intent. The application carries where somebody IS; this
 * carries how they got there. "Why has this person been in screening for three
 * weeks" is the question a hiring manager actually asks, and a current-stage
 * column cannot answer it.
 */
class ApplicationStageEvent extends Model
{
    use BelongsToOrganization;

    public const ACTIONS = ['applied', 'advanced', 'moved_back', 'rejected', 'withdrawn', 'hired'];

    protected $fillable = [
        'organization_id',
        'job_application_id',
        'from_stage_id',
        'to_stage_id',
        'action',
        'note',
        'actor_id',
    ];

    public function application(): BelongsTo
    {
        return $this->belongsTo(JobApplication::class, 'job_application_id');
    }

    public function fromStage(): BelongsTo
    {
        return $this->belongsTo(HiringStage::class, 'from_stage_id');
    }

    public function toStage(): BelongsTo
    {
        return $this->belongsTo(HiringStage::class, 'to_stage_id');
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}
