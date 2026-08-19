<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Resignation extends Model
{
    use Auditable;
    use BelongsToOrganization;
    use HasFactory;

    protected $fillable = [
        'user_id',
        'organization_id',
        'last_working_date',
        'reason',
        'status',
        'approved_by',
        'approved_at',
        'rejection_reason',
        'rejected_at',
        'cancelled_at',
        'escalated_to_user_id',
        'escalation_history',
        'notice_period_days',
        'shortfall_days',
    ];

    protected $casts = [
        'last_working_date' => 'date:Y-m-d',
        'approved_at' => 'datetime',
        'rejected_at' => 'datetime',
        'cancelled_at' => 'datetime',
        'escalation_history' => 'array',
    ];

    protected $appends = ['submitted_at'];

    public function getSubmittedAtAttribute(): ?string
    {
        return $this->created_at?->toIso8601String();
    }

    /**
     * Get the user who submitted the resignation.
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Get the organization.
     */
    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /**
     * Get the user who approved the resignation.
     */
    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    /**
     * Get the user the resignation was escalated/forwarded to.
     */
    public function escalatedTo(): BelongsTo
    {
        return $this->belongsTo(User::class, 'escalated_to_user_id');
    }

    /**
     * Check if resignation is pending.
     */
    public function isPending(): bool
    {
        return $this->status === 'pending';
    }

    /**
     * Check if resignation is approved.
     */
    public function isApproved(): bool
    {
        return $this->status === 'approved';
    }

    /**
     * Check if resignation is rejected.
     */
    public function isRejected(): bool
    {
        return $this->status === 'rejected';
    }

    /**
     * Approve the resignation.
     */
    public function approve(int $approverId): void
    {
        $this->update([
            'status' => 'approved',
            'approved_by' => $approverId,
            'approved_at' => now(),
        ]);
    }

    /**
     * Reject the resignation.
     */
    public function reject(string $reason): void
    {
        $this->update([
            'status' => 'rejected',
            'rejection_reason' => $reason,
            'rejected_at' => now(),
        ]);
    }

    /**
     * Cancel the resignation.
     */
    public function cancel(): void
    {
        $this->update([
            'status' => 'cancelled',
            'cancelled_at' => now(),
        ]);
    }
}
