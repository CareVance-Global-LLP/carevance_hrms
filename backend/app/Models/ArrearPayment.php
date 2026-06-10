<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ArrearPayment extends Model
{
    use HasFactory;

    protected $table = 'arrear_payments';

    protected $fillable = [
        'organization_id',
        'user_id',
        'payroll_run_id',
        'arrear_month',
        'calculation_month',
        'arrear_type',
        'original_basic',
        'revised_basic',
        'basic_difference',
        'original_gross',
        'revised_gross',
        'gross_difference',
        'pf_on_arrear',
        'esi_on_arrear',
        'tds_on_arrear',
        'pt_on_arrear',
        'net_arrear_amount',
        'status',
        'reason',
        'requested_by',
        'approved_by',
        'approved_at',
        'rejection_reason',
    ];

    protected $casts = [
        'original_basic' => 'decimal:2',
        'revised_basic' => 'decimal:2',
        'basic_difference' => 'decimal:2',
        'original_gross' => 'decimal:2',
        'revised_gross' => 'decimal:2',
        'gross_difference' => 'decimal:2',
        'pf_on_arrear' => 'decimal:2',
        'esi_on_arrear' => 'decimal:2',
        'tds_on_arrear' => 'decimal:2',
        'pt_on_arrear' => 'decimal:2',
        'net_arrear_amount' => 'decimal:2',
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
        return $this->gross_difference - $this->pf_on_arrear - $this->esi_on_arrear - $this->tds_on_arrear - $this->pt_on_arrear;
    }
}
