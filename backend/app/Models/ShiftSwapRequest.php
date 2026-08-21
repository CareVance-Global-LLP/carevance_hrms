<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Two people trading days.
 *
 * Both roster days are named, so a swap is a concrete exchange rather than a
 * request to "cover Tuesday" somebody has to interpret.
 *
 * It needs the other person to agree AND a manager to approve. One person
 * cannot give away their shift, and two people cannot rewrite the site's cover
 * between them — which is exactly what a two-party-only swap allows on a rota
 * that exists to guarantee cover.
 */
class ShiftSwapRequest extends Model
{
    use BelongsToOrganization;

    protected $table = 'shift_swap_requests';

    public const STATUSES = [
        'pending_counterparty', 'pending_approval', 'approved', 'declined', 'cancelled',
    ];

    protected $fillable = [
        'organization_id',
        'requested_by',
        'requested_with',
        'requester_roster_day_id',
        'counterparty_roster_day_id',
        'status',
        'reason',
        'decline_reason',
        'accepted_at',
        'approved_by',
        'decided_at',
    ];

    protected $casts = [
        'accepted_at' => 'datetime',
        'decided_at' => 'datetime',
    ];

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function counterparty(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_with');
    }

    public function requesterDay(): BelongsTo
    {
        return $this->belongsTo(RosterDay::class, 'requester_roster_day_id');
    }

    public function counterpartyDay(): BelongsTo
    {
        return $this->belongsTo(RosterDay::class, 'counterparty_roster_day_id');
    }

    public function isOpen(): bool
    {
        return in_array($this->status, ['pending_counterparty', 'pending_approval'], true);
    }
}
