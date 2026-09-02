<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Reimbursement extends Model
{
    use Auditable;
    use BelongsToOrganization;
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
        'expense_date' => 'date:Y-m-d',
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
     * Filter by the month the claim was submitted (created_at),
     * using a "YYYY-MM" month_year value. Used for the per-month review UI.
     */
    /**
     * Claims belonging to a month by WHEN THE EXPENSE HAPPENED.
     *
     * Deliberately separate from scopeForMonth, which filters on the submitted
     * date and is what the approval workflow wants — an approver reviewing
     * "July submissions" means what landed in July, and ReimbursementFlowTest
     * pins that down.
     *
     * Payroll needs the other question. A taxi taken on 28 August is an August
     * cost whether the receipt is filed on the 29th or in September, and
     * processEmployeePayroll has always paid on `expense_date`. Without this
     * scope the payroll wizard's review step asked the workflow question and
     * showed ₹0 for claims the run would go on to pay — the screen an admin
     * checks disagreeing with what processing does.
     *
     * `expense_date` is nullable, so an undated claim falls back to its
     * submitted date rather than belonging to no month at all.
     */
    public function scopeForExpenseMonth($query, ?string $monthYear)
    {
        if ($monthYear && preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', $monthYear, $m)) {
            $year = (int) $m[1];
            $month = (int) $m[2];

            $query->where(function ($q) use ($year, $month) {
                $q->where(function ($dated) use ($year, $month) {
                    $dated->whereNotNull('expense_date')
                        ->whereMonth('expense_date', $month)
                        ->whereYear('expense_date', $year);
                })->orWhere(function ($undated) use ($year, $month) {
                    $undated->whereNull('expense_date')
                        ->whereMonth('created_at', $month)
                        ->whereYear('created_at', $year);
                });
            });
        }

        return $query;
    }

    public function scopeForMonth($query, ?string $monthYear)
    {
        if ($monthYear && preg_match('/^(\d{4})-(0[1-9]|1[0-2])$/', $monthYear, $m)) {
            $query->whereMonth('created_at', (int) $m[2])
                ->whereYear('created_at', (int) $m[1]);
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
