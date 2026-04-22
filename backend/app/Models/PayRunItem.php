<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayRunItem extends Model
{
    protected $fillable = [
        'pay_run_id',
        'organization_id',
        'user_id',
        'payroll_id',
        'payroll_profile_id',
        'payable_days',
        'worked_seconds',
        'overtime_seconds',
        'approved_leave_days',
        'approved_time_edit_seconds',
        'gross_pay',
        'total_deductions',
        'net_pay',
        'status',
        'payout_status',
        'salary_breakdown',
        'adjustment_breakdown',
        'compliance_breakdown',
        'attendance_summary',
        'warnings',
    ];

    protected function casts(): array
    {
        return [
            'payable_days' => 'float',
            'worked_seconds' => 'integer',
            'overtime_seconds' => 'integer',
            'approved_leave_days' => 'float',
            'approved_time_edit_seconds' => 'integer',
            'gross_pay' => 'float',
            'total_deductions' => 'float',
            'net_pay' => 'float',
            'salary_breakdown' => 'array',
            'adjustment_breakdown' => 'array',
            'compliance_breakdown' => 'array',
            'attendance_summary' => 'array',
            'warnings' => 'array',
        ];
    }

    public function payRun(): BelongsTo
    {
        return $this->belongsTo(PayRun::class);
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function payroll(): BelongsTo
    {
        return $this->belongsTo(Payroll::class);
    }

    public function payrollProfile(): BelongsTo
    {
        return $this->belongsTo(PayrollProfile::class);
    }
}
