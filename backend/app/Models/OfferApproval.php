<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One link in an offer's approval chain.
 *
 * Rows are created when the offer is submitted for approval, so the chain
 * records who was ASKED as well as who answered. Deriving approvers at read
 * time would lose that, and "nobody ever asked finance" is exactly the finding
 * an audit is looking for.
 */
class OfferApproval extends Model
{
    use BelongsToOrganization;

    protected $table = 'offer_approvals';

    public const STATUSES = ['pending', 'approved', 'rejected'];

    protected $fillable = [
        'organization_id',
        'job_offer_id',
        'approver_id',
        'position',
        'status',
        'note',
        'decided_at',
    ];

    protected $casts = [
        'position' => 'integer',
        'decided_at' => 'datetime',
    ];

    public function offer(): BelongsTo
    {
        return $this->belongsTo(JobOffer::class, 'job_offer_id');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approver_id');
    }
}
