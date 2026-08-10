<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PayrollMonthlyRun extends Model
{
    use BelongsToOrganization;

    protected $table = 'payroll_monthly_runs';

    protected $fillable = [
        'organization_id',
        'month_year',
        'status',
        'pay_date',
        // Background processing progress — written by ProcessPayrollRunEmployees
        // and polled through payroll/runs/{id}/processing-status.
        'processing_state',
        'processing_total',
        'processing_done',
        'processing_failed',
        'processing_skipped',
        'processing_started_at',
        'processing_finished_at',
        'processing_message',
        'total_employees',
        'total_gross',
        'total_deductions',
        'total_net_pay',
        'total_employer_contributions',
        'total_pf_employee',
        'total_pf_employer',
        'total_esi_employee',
        'total_esi_employer',
        'total_pt',
        'total_tds',
        'total_arrears',
        'total_variable_pay',
        'total_leave_encashment',
        'total_nps',
        'total_vpf',
        'total_lwf',
        'created_by',
        'approved_by',
        'approved_at',
        'locked_at',
        'locked_by',
        'lock_reason',
        'released_at',
        'released_by',
        'disbursed_at',
        'disbursed_by',
        'notes',
        'is_full_and_final_run',
    ];

    protected $casts = [
        'pay_date' => 'date',
        'processing_started_at' => 'datetime',
        'processing_finished_at' => 'datetime',
        'total_gross' => 'decimal:2',
        'total_deductions' => 'decimal:2',
        'total_net_pay' => 'decimal:2',
        'total_employer_contributions' => 'decimal:2',
        'total_pf_employee' => 'decimal:2',
        'total_pf_employer' => 'decimal:2',
        'total_esi_employee' => 'decimal:2',
        'total_esi_employer' => 'decimal:2',
        'total_pt' => 'decimal:2',
        'total_tds' => 'decimal:2',
        'total_arrears' => 'decimal:2',
        'total_variable_pay' => 'decimal:2',
        'total_leave_encashment' => 'decimal:2',
        'total_nps' => 'decimal:2',
        'total_vpf' => 'decimal:2',
        'total_lwf' => 'decimal:2',
        'approved_at' => 'datetime',
        'locked_at' => 'datetime',
        'released_at' => 'datetime',
        'disbursed_at' => 'datetime',
        'is_full_and_final_run' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function lockedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'locked_by');
    }

    public function releasedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'released_by');
    }

    public function disbursedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'disbursed_by');
    }

    public function items(): HasMany
    {
        return $this->hasMany(PayrollItem::class, 'payroll_run_id');
    }

    public function scopeForMonth($query, string $monthYear)
    {
        return $query->where('month_year', $monthYear);
    }

    public function scopeDraft($query)
    {
        return $query->where('status', 'draft');
    }

    public function scopeProcessed($query)
    {
        return $query->where('status', 'processed');
    }

    public function isDraft(): bool
    {
        return $this->status === 'draft';
    }

    public function isProcessed(): bool
    {
        return $this->status === 'processed';
    }

    public function isLocked(): bool
    {
        return $this->status === 'locked';
    }

    public function isApproved(): bool
    {
        return $this->status === 'approved';
    }

    public function isReleased(): bool
    {
        return $this->status === 'released';
    }

    public function isDisbursed(): bool
    {
        return $this->status === 'disbursed';
    }

    /**
     * Terminal state — once disbursed, the run is immutable for compliance.
     * Used by frontend stepper to show "completed" state and disable further actions.
     */
    public function isImmutable(): bool
    {
        return $this->status === 'disbursed';
    }

    /**
     * Available status transitions.
     *
     * Lifecycle: draft → (processing) → locked → approved → released → disbursed
     * - 'disbursed' is the terminal state and has NO outgoing transitions
     * - 'locked' can be rolled back to 'draft' via the unlock endpoint (with audit)
     * - 'approved' can be rolled back to 'locked' if not yet released
     */
    public static function getStatusFlow(): array
    {
        return [
            'draft' => ['processing', 'locked'],
            'processing' => ['draft', 'locked'],
            'locked' => ['approved', 'draft'],
            'approved' => ['released', 'locked'],
            'released' => ['disbursed', 'approved'],
            'disbursed' => [],
        ];
    }

    public function canTransitionTo(string $newStatus): bool
    {
        $allowed = self::getStatusFlow()[$this->status] ?? [];
        return in_array($newStatus, $allowed);
    }
}
