<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * What is being offered, and who agreed to it.
 *
 * An amount alone is not an offer — somebody has to agree to spend it, and in
 * most organizations that is not the person who typed it. The approval chain is
 * a first-class record here rather than a workflow flag.
 *
 * `sent` and `accepted` are separate states deliberately. An offer out with a
 * candidate is a commitment the business has made and cannot quietly retract,
 * and a headcount report that cannot tell the two apart under-states what has
 * already been spent.
 */
class JobOffer extends Model
{
    use BelongsToOrganization;

    public const STATUSES = [
        'draft', 'pending_approval', 'approved', 'sent',
        'accepted', 'declined', 'withdrawn', 'expired',
    ];

    /** Once here, the candidate has seen it. Changes become revisions. */
    public const COMMITTED_STATUSES = ['sent', 'accepted'];

    protected $fillable = [
        'organization_id',
        'job_application_id',
        'legal_entity_id',
        'designation',
        'annual_ctc',
        'joining_bonus',
        'proposed_joining_date',
        'status',
        'valid_until',
        'sent_at',
        'responded_at',
        'decline_reason',
        'created_by',
        'signing_token_hash',
        'signing_token_expires_at',
        'letter_path',
    ];

    /**
     * The signing token hash never leaves the server.
     *
     * It is the candidate's only credential. Hashed at rest is the first
     * defence; not serialising it at all is the second, so a resource that
     * happens to include an offer cannot leak it.
     */
    protected $hidden = ['signing_token_hash'];

    protected $casts = [
        // Money is decimal, never float — an offer is the number a payroll
        // template is later built from.
        'annual_ctc' => 'decimal:2',
        'joining_bonus' => 'decimal:2',
        // date:Y-m-d, not date: a plain date cast serialises as a UTC datetime
        // and a joining date reaches the client a day early east of UTC.
        'proposed_joining_date' => 'date:Y-m-d',
        'valid_until' => 'date:Y-m-d',
        'sent_at' => 'datetime',
        'responded_at' => 'datetime',
        'signing_token_expires_at' => 'datetime',
    ];

    public function application(): BelongsTo
    {
        return $this->belongsTo(JobApplication::class, 'job_application_id');
    }

    public function approvals(): HasMany
    {
        return $this->hasMany(OfferApproval::class);
    }

    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntity::class);
    }

    public function signature(): \Illuminate\Database\Eloquent\Relations\HasOne
    {
        return $this->hasOne(OfferSignature::class);
    }

    /** Has every approver said yes? */
    public function isFullyApproved(): bool
    {
        if ($this->approvals()->count() === 0) {
            return false;
        }

        return $this->approvals()->where('status', '!=', 'approved')->count() === 0;
    }

    /** Has anybody in the chain refused? */
    public function isRejected(): bool
    {
        return $this->approvals()->where('status', 'rejected')->exists();
    }

    /**
     * Has the candidate seen this?
     *
     * The line past which an offer stops being an internal draft. Editing one
     * that has been sent is a revision the candidate must be told about, not a
     * correction.
     */
    public function isCommitted(): bool
    {
        return in_array($this->status, self::COMMITTED_STATUSES, true);
    }

    /**
     * Has the acceptance window closed?
     *
     * Computed from the date rather than trusting `status`, because nothing
     * runs at midnight to flip it — an offer expires whether or not a job
     * noticed.
     */
    public function hasLapsed(): bool
    {
        return $this->valid_until !== null
            && $this->status === 'sent'
            && $this->valid_until->isBefore(now()->startOfDay());
    }
}
