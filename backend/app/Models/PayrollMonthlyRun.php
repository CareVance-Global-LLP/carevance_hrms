<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PayrollMonthlyRun extends Model
{
    protected $table = 'payroll_monthly_runs';

    protected $fillable = [
        'organization_id',
        'month_year',
        'status',
        'pay_date',
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
        'created_by',
        'approved_by',
        'approved_at',
        'notes',
    ];

    protected $casts = [
        'pay_date' => 'date',
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
        'approved_at' => 'datetime',
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

    public function isPaid(): bool
    {
        return $this->status === 'paid';
    }

    public function isLocked(): bool
    {
        return $this->status === 'locked';
    }
}
