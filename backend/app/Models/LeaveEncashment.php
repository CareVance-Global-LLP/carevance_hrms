<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeaveEncashment extends Model
{
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'payroll_run_id',
        'leave_type',
        'eligible_days',
        'encashed_days',
        'balance_days',
        'rate_per_day',
        'total_amount',
        'pf_deduction',
        'tax_deduction',
        'net_amount',
        'status',
        'month_year',
        'requested_by',
        'approved_by',
        'approved_at',
        'rejection_reason',
        'notes',
    ];

    protected $casts = [
        'rate_per_day' => 'decimal:2',
        'total_amount' => 'decimal:2',
        'pf_deduction' => 'decimal:2',
        'tax_deduction' => 'decimal:2',
        'net_amount' => 'decimal:2',
        'eligible_days' => 'integer',
        'encashed_days' => 'integer',
        'balance_days' => 'integer',
        'approved_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function payrollRun(): BelongsTo
    {
        return $this->belongsTo(PayrollMonthlyRun::class, 'payroll_run_id');
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requested_by');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeApproved($query)
    {
        return $query->where('status', 'approved');
    }

    public function scopeProcessed($query)
    {
        return $query->where('status', 'processed');
    }

    public function isProcessed(): bool
    {
        return $this->status === 'processed';
    }

    public function calculateNetAmount(): float
    {
        return $this->total_amount - $this->pf_deduction - $this->tax_deduction;
    }
}
