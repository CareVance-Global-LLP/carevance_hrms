<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FullAndFinalSettlement extends Model
{
    use HasFactory;

    protected + = 'full_and_final_settlements';

    protected $fillable = [
        'organization_id',
        'user_id',
        'payroll_run_id',
        'resignation_date',
        'last_working_date',
        'settlement_date',
        'exit_type',
        'exit_reason',
        'notice_period_days',
        'served_days',
        'shortfall_days',
        'notice_pay_recovery',
        'notice_pay_payable',
        'basic_salary',
        'current_month_salary',
        'salary_in_arrears',
        'earned_leave_balance',
        'leave_encashment',
        'comp_off_balance',
        'comp_off_value',
        'years_of_service',
        'gratuity_amount',
        'is_gratuity_eligible',
        'retrenchment_compensation',
        'severance_package',
        'loan_recovery',
        'advance_recovery',
        'asset_recovery',
        'other_deductions',
        'deduction_breakdown',
        'total_earnings',
        'total_deductions',
        'net_settlement_amount',
        'tds_on_settlement',
        'is_tds_applicable',
        'status',
        'prepared_by',
        'approved_by',
        'approved_at',
        'rejection_reason',
        'notes',
        'payment_method',
        'payment_reference',
        'paid_at',
    ];

    protected $casts = [
        'resignation_date' => 'date',
        'last_working_date' => 'date',
        'settlement_date' => 'date',
        'notice_pay_recovery' => 'decimal:2',
        'notice_pay_payable' => 'decimal:2',
        'basic_salary' => 'decimal:2',
        'current_month_salary' => 'decimal:2',
        'salary_in_arrears' => 'decimal:2',
        'leave_encashment' => 'decimal:2',
        'comp_off_value' => 'decimal:2',
        'years_of_service' => 'decimal:2',
        'gratuity_amount' => 'decimal:2',
        'is_gratuity_eligible' => 'boolean',
        'retrenchment_compensation' => 'decimal:2',
        'severance_package' => 'decimal:2',
        'loan_recovery' => 'decimal:2',
        'advance_recovery' => 'decimal:2',
        'asset_recovery' => 'decimal:2',
        'other_deductions' => 'decimal:2',
        'deduction_breakdown' => 'array',
        'total_earnings' => 'decimal:2',
        'total_deductions' => 'decimal:2',
        'net_settlement_amount' => 'decimal:2',
        'tds_on_settlement' => 'decimal:2',
        'is_tds_applicable' => 'boolean',
        'approved_at' => 'datetime',
        'paid_at' => 'datetime',
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

    public function preparer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'prepared_by');
    }

    public function approver(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }

    public function scopeDraft($query)
    {
        return $query->where('status', 'draft');
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeApproved($query)
    {
        return $query->where('status', 'approved');
    }

    public function scopePaid($query)
    {
        return $query->where('status', 'paid');
    }

    public function isPaid(): bool
    {
        return $this->status === 'paid';
    }

    public function calculateGratuity(float $lastBasic, float $yearsOfService): float
    {
        return round(($lastBasic * 15 * $yearsOfService) / 26, 2);
    }

    public function calculateNetSettlement(): float
    {
        $this->total_earnings = ->current_month_salary + ->salary_in_arrears + ->leave_encashment + ->comp_off_value + ->gratuity_amount + ->retrenchment_compensation + ->severance_package;
        
        $this->total_deductions = ->notice_pay_recovery + ->loan_recovery + ->advance_recovery + ->asset_recovery + ->other_deductions + ->tds_on_settlement;
        
        $this->net_settlement_amount = ->total_earnings - ->total_deductions;
        
        return $this->net_settlement_amount;
    }
}
