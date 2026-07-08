<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Reimbursement extends Model
{
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'title',
        'category',
        'amount',
        'currency',
        'expense_date',
        'description',
        'receipt_url',
        'merchant_name',
        'location',
        'status',
        'submitted_by',
        'approved_by',
        'approved_at',
        // Two-level approval chain
        'approval_level',
        'manager_approved_by',
        'manager_approved_at',
        'manager_read_at',
        'admin_read_at',
        'rejection_reason',
        'payout_mode',
        'paid_at',
        'payment_reference',
        'meta',
    ];

    protected $casts = [
        'expense_date' => 'date',
        'approved_at' => 'datetime',
        'manager_approved_at' => 'datetime',
        'manager_read_at' => 'datetime',
        'admin_read_at' => 'datetime',
        'paid_at' => 'datetime',
        'amount' => 'decimal:2',
    ];

    // ─── Relationships ────────────────────────────────────────

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function managerApprover(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_approved_by');
    }

    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitted_by');
    }

    // ─── Scopes (legacy status-based) ─────────────────────────

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeApproved($query)
    {
        return $query->where('status', 'approved');
    }

    public function scopeRejected($query)
    {
        return $query->where('status', 'rejected');
    }

    // ─── Scopes (approval-level based) ────────────────────────

    public function scopePendingManager($query)
    {
        return $query->where('approval_level', 'pending_manager');
    }

    public function scopePendingAdmin($query)
    {
        return $query->where('approval_level', 'pending_admin');
    }

    /**
     * Filter by the month the expense was incurred (expense_date),
     * using a "YYYY-MM" month_year value. Used for the per-month review UI.
     */
    public function scopeForMonth($query, ?string $monthYear)
    {
        if ($monthYear && preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', $monthYear, $m)) {
            $query->whereMonth('expense_date', (int) $m[2])
                ->whereYear('expense_date', (int) $m[1]);
        }

        return $query;
    }

    // ─── Helpers ──────────────────────────────────────────────

    /**
     * Human-readable approval status.
     */
    public function getApprovalStatusTextAttribute(): string
    {
        return match ($this->approval_level) {
            'pending_manager' => 'Awaiting manager approval',
            'pending_admin' => 'Awaiting admin approval',
            'approved' => 'Approved',
            'rejected' => 'Rejected',
            default => ucfirst(str_replace('_', ' ', $this->approval_level ?? 'unknown')),
        };
    }

    /**
     * Badge color class based on approval level.
     */
    public function getApprovalBadgeClassAttribute(): string
    {
        return match ($this->approval_level) {
            'pending_manager' => 'bg-amber-50 text-amber-700',
            'pending_admin' => 'bg-blue-50 text-blue-700',
            'approved' => 'bg-emerald-50 text-emerald-700',
            'rejected' => 'bg-rose-50 text-rose-700',
            default => 'bg-slate-50 text-slate-700',
        };
    }

    /**
     * Find the reporting manager for this reimbursement's employee.
     */
    public function getReportingManagerId(): ?int
    {
        $workInfo = $this->employee?->employeeWorkInfo;
        return $workInfo?->reporting_manager_id;
    }
}
