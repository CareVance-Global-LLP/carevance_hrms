<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollItem extends Model
{
    protected $fillable = [
        'payroll_run_id',
        'organization_id',
        'user_id',
        'department_id',
        'total_working_days',
        'days_present',
        'days_absent',
        'days_leave',
        'lOP_days',
        'total_worked_seconds',
        'total_productive_seconds',
        'total_idle_seconds',
        'total_unproductive_seconds',
        'activity_percentage',
        'productivity_score',
        'overtime_seconds',
        'overtime_pay',
        'basic',
        'hra',
        'conveyance',
        'medical',
        'special_allowance',
        'custom_earnings',
        'gross_salary',
        'pf_employee',
        'esi_employee',
        'pt',
        'tds',
        'lOP_deduction',
        'custom_deductions',
        'total_deductions',
        'pf_employer',
        'eps',
        'epf',
        'esi_employer',
        'gratuity',
        'total_employer_contributions',
        'net_pay',
        'payment_status',
        'payment_method',
        'payment_reference',
        'paid_at',
        'template_snapshot',
    ];

    protected $casts = [
        'lOP_days' => 'decimal:2',
        'activity_percentage' => 'decimal:2',
        'productivity_score' => 'decimal:2',
        'overtime_pay' => 'decimal:2',
        'basic' => 'decimal:2',
        'hra' => 'decimal:2',
        'conveyance' => 'decimal:2',
        'medical' => 'decimal:2',
        'special_allowance' => 'decimal:2',
        'custom_earnings' => 'decimal:2',
        'gross_salary' => 'decimal:2',
        'pf_employee' => 'decimal:2',
        'esi_employee' => 'decimal:2',
        'pt' => 'decimal:2',
        'tds' => 'decimal:2',
        'lOP_deduction' => 'decimal:2',
        'custom_deductions' => 'decimal:2',
        'total_deductions' => 'decimal:2',
        'pf_employer' => 'decimal:2',
        'eps' => 'decimal:2',
        'epf' => 'decimal:2',
        'esi_employer' => 'decimal:2',
        'gratuity' => 'decimal:2',
        'total_employer_contributions' => 'decimal:2',
        'net_pay' => 'decimal:2',
        'paid_at' => 'datetime',
        'template_snapshot' => 'array',
    ];

    public function payrollRun(): BelongsTo
    {
        return $this->belongsTo(PayrollMonthlyRun::class, 'payroll_run_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'department_id');
    }

    /**
     * Get formatted worked hours
     */
    public function getWorkedHoursAttribute(): float
    {
        return round($this->total_worked_seconds / 3600, 2);
    }

    /**
     * Get formatted overtime hours
     */
    public function getOvertimeHoursAttribute(): float
    {
        return round($this->overtime_seconds / 3600, 2);
    }

    /**
     * Get attendance percentage
     */
    public function getAttendancePercentageAttribute(): float
    {
        if ($this->total_working_days === 0) return 0;
        return round(($this->days_present / $this->total_working_days) * 100, 2);
    }

    public function scopePending($query)
    {
        return $query->where('payment_status', 'pending');
    }

    public function scopePaid($query)
    {
        return $query->where('payment_status', 'paid');
    }

    public function isPaid(): bool
    {
        return $this->payment_status === 'paid';
    }
}
