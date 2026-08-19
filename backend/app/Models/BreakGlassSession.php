<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One governed episode of vendor access to a customer tenant.
 *
 * Carries BelongsToOrganization like every other tenant-owned model, so a
 * customer admin listing sessions sees only their own. The vendor-side
 * endpoints, which legitimately span tenants, opt out explicitly with
 * withoutOrganizationScope() — visible at the call site, which is the whole
 * point of that trait's design.
 */
class BreakGlassSession extends Model
{
    use Auditable;
    use BelongsToOrganization;

    /** The longest a session may ever last, regardless of what is requested. */
    public const MAX_DURATION_MINUTES = 60;

    protected $fillable = [
        'organization_id',
        'target_user_id',
        'requested_by_user_id',
        'reason',
        'status',
        'requested_at',
        'approved_by_user_id',
        'approved_at',
        'expires_at',
        'token_issued_at',
        'revoked_by_user_id',
        'revoked_at',
        'revoked_reason',
        'ip_address',
        'user_agent',
    ];

    protected function casts(): array
    {
        return [
            'requested_at' => 'datetime',
            'approved_at' => 'datetime',
            'expires_at' => 'datetime',
            'token_issued_at' => 'datetime',
            'revoked_at' => 'datetime',
        ];
    }

    /**
     * Whether this session may currently be used to act as the target user.
     *
     * Deliberately one method rather than a set of scattered checks: the
     * middleware, the token endpoint and the UI all need the same answer, and
     * three copies of it would eventually disagree.
     */
    public function isUsable(): bool
    {
        if ($this->status !== 'approved') {
            return false;
        }

        if ($this->revoked_at !== null) {
            return false;
        }

        return $this->expires_at !== null && $this->expires_at->isFuture();
    }

    /**
     * Why the session cannot be used, phrased for the person who will read it.
     */
    public function unusableReason(): ?string
    {
        if ($this->isUsable()) {
            return null;
        }

        return match (true) {
            $this->revoked_at !== null => 'This access session was revoked.',
            $this->status === 'pending' => 'This access session has not been approved by the customer yet.',
            $this->status === 'rejected' => 'The customer declined this access request.',
            $this->expires_at === null => 'This access session has no approved window.',
            default => 'This access session has expired.',
        };
    }

    /** Minutes left, floored at zero. */
    public function remainingMinutes(): int
    {
        if ($this->expires_at === null || $this->expires_at->isPast()) {
            return 0;
        }

        return (int) ceil(now()->diffInSeconds($this->expires_at) / 60);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function targetUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'target_user_id');
    }

    public function requestedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by_user_id');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by_user_id');
    }
}
