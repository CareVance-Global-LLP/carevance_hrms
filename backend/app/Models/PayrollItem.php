<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollItem extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'payroll_run_id',
        'month_year',
        'organization_id',
        'user_id',
        'department_id',
        'total_working_days',
        'days_present',
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
        'da',
        'cca',
        'education',
        'hostel',
        'internet',
        'meal',
        'transport',
        'uniform',
        'books_periodicals_amount',
        'fuel_maintenance',
        'variable_pay',
        'performance_bonus',
        'retention_bonus',
        'engine_version',
        'arrears',
        'arrears_pf',
        'leave_encashment',
        'encashed_leave_days',
        'notice_pay_recovery',
        'notice_pay_addition',
        'custom_earnings',
        'gross_salary',
        // The contracted monthly rate. gross_salary is what was earned after
        // loss of pay; this is what it would have been at full attendance.
        'gross_full_month',
        'pf_employee',
        'esi_employee',
        'pt',
        'tds',
        'nps_employee',
        'vpf_employee',
        'lwf',
        'medical_insurance',
        'life_insurance',
        'custom_deductions',
        'total_deductions',
        'pf_employer',
        'eps',
        'epf',
        'esi_employer',
        'gratuity',
        'nps_employer',
        'superannuation',
        'medical_insurance_employer',
        'total_employer_contributions',
        'net_pay',
        'shift_differential',
        'night_shift_hours',
        'weekend_hours',
        'is_full_and_final',
        'settlement_type',
        'payment_status',
        'payment_method',
        'payment_reference',
        'paid_at',
        'template_snapshot',
        'additional_components',
        // Simplified attendance fields
        'present_days',
        'paid_leave_days',
        'unpaid_leave_days',
        'half_day_present',
        'half_day_absent',
        'absent_days',
        'total_payable_days',
        'attendance_calculation_mode',
        // The divisor this row's daily rate was computed with, frozen at run
        // time so the payslip stays reproducible if the setting later changes.
        'salary_day_basis',
        'salary_divisor_days',
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
        'da' => 'decimal:2',
        'cca' => 'decimal:2',
        'education' => 'decimal:2',
        'hostel' => 'decimal:2',
        'internet' => 'decimal:2',
        'meal' => 'decimal:2',
        'transport' => 'decimal:2',
        'uniform' => 'decimal:2',
        'books_periodicals_amount' => 'decimal:2',
        'fuel_maintenance' => 'decimal:2',
        'variable_pay' => 'decimal:2',
        'performance_bonus' => 'decimal:2',
        'retention_bonus' => 'decimal:2',
        'arrears' => 'decimal:2',
        'arrears_pf' => 'decimal:2',
        'leave_encashment' => 'decimal:2',
        'encashed_leave_days' => 'integer',
        'notice_pay_recovery' => 'decimal:2',
        'notice_pay_addition' => 'decimal:2',
        'custom_earnings' => 'decimal:2',
        'gross_salary' => 'decimal:2',
        'gross_full_month' => 'decimal:2',
        'pf_employee' => 'decimal:2',
        'esi_employee' => 'decimal:2',
        'pt' => 'decimal:2',
        'tds' => 'decimal:2',
        'nps_employee' => 'decimal:2',
        'vpf_employee' => 'decimal:2',
        'lwf' => 'decimal:2',
        'salary_divisor_days' => 'decimal:2',
        'medical_insurance' => 'decimal:2',
        'life_insurance' => 'decimal:2',
        'custom_deductions' => 'decimal:2',
        'total_deductions' => 'decimal:2',
        'pf_employer' => 'decimal:2',
        'eps' => 'decimal:2',
        'epf' => 'decimal:2',
        'esi_employer' => 'decimal:2',
        'gratuity' => 'decimal:2',
        'nps_employer' => 'decimal:2',
        'superannuation' => 'decimal:2',
        'medical_insurance_employer' => 'decimal:2',
        'total_employer_contributions' => 'decimal:2',
        'net_pay' => 'decimal:2',
        'shift_differential' => 'decimal:2',
        'night_shift_hours' => 'integer',
        'weekend_hours' => 'integer',
        'is_full_and_final' => 'boolean',
        'paid_at' => 'datetime',
        'template_snapshot' => 'array',
        'additional_components' => 'array',
        'present_days' => 'decimal:2',
        'paid_leave_days' => 'decimal:2',
        'unpaid_leave_days' => 'decimal:2',
        'half_day_present' => 'decimal:2',
        'half_day_absent' => 'decimal:2',
        'absent_days' => 'decimal:2',
        'total_payable_days' => 'decimal:2',
    ];

    /**
     * Accessors appended to JSON output so any API response that returns
     * a PayrollItem (or a collection of them) automatically includes the
     * hour-snapshot of every time-attendance field. Seconds remain the
     * source of truth; the hour fields are derived.
     */
    protected $appends = [
        'worked_hours',
        'productive_hours',
        'idle_hours',
        'unproductive_hours',
        'overtime_hours',
        'attendance_percentage',
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
     * Get productive hours
     */
    public function getProductiveHoursAttribute(): float
    {
        return round($this->total_productive_seconds / 3600, 2);
    }

    /**
     * Get idle hours
     */
    public function getIdleHoursAttribute(): float
    {
        return round($this->total_idle_seconds / 3600, 2);
    }

    /**
     * Get unproductive hours
     */
    public function getUnproductiveHoursAttribute(): float
    {
        return round($this->total_unproductive_seconds / 3600, 2);
    }

    /**
     * Serialize time-attendance fields as hours for the API response.
     * Returns a fresh associative array (the model itself, when
     * ->toArray()'d, will already include these via $appends).
     *
     * Useful when you want a flat "hours" snapshot alongside the raw
     * seconds (e.g. PayrollItem-level responses, reports, exports).
     */
    public function hoursSnapshot(): array
    {
        return [
            'worked_hours' => $this->worked_hours,
            'productive_hours' => $this->productive_hours,
            'idle_hours' => $this->idle_hours,
            'unproductive_hours' => $this->unproductive_hours,
            'overtime_hours' => $this->overtime_hours,
        ];
    }

    /**
     * Get attendance percentage
     */
    public function getAttendancePercentageAttribute(): float
    {
        if ($this->total_working_days === 0) return 0;
        return round(($this->days_present / $this->total_working_days) * 100, 2);
    }

    /**
     * days_absent is computed from total_working_days - days_present - days_leave.
     * The stored column is kept for backward compatibility but the accessor
     * ensures the value is always consistent with its source fields.
     */
    public function getDaysAbsentAttribute(): float
    {
        return max(0, $this->total_working_days - $this->days_present - $this->days_leave);
    }

    /**
     * total_lop_days is an alias for lOP_days.
     * The stored column is kept for backward compatibility but the accessor
     * ensures consistency with the canonical lOP_days field.
     */
    public function getTotalLopDaysAttribute(): float
    {
        return (float) $this->lOP_days;
    }

    /**
     * lOP_deduction = (gross / salary divisor) × lopDays.
     *
     * The divisor is the one frozen onto this row at run time — the calendar
     * month by default. It used to be `total_working_days` (~22), which made
     * this accessor a divisor path of its own: whatever the engines computed
     * and stored, every reader got the working-day figure back, so a single
     * absent day was reported as costing 1/22 of wages rather than the 1/30
     * that Payment of Wages Act s.9(2) caps it at.
     *
     * Rows written before the divisor was recorded fall back to their
     * working-day count, which is genuinely what they were divided by.
     */
    public function getLOPDeductionAttribute(): float
    {
        if ($this->lOP_days <= 0) {
            return 0;
        }

        $divisor = app(\App\Services\Payroll\PayrollDayBasisResolver::class)->forStoredItem($this);

        if ($divisor <= 0) {
            return 0;
        }

        /*
         * Derived from the CONTRACTED month, not from gross_salary — the
         * latter is now the earned figure, which already has this amount
         * taken out of it. Dividing the earned gross would understate the
         * loss and never reconcile back to the full month.
         */
        $fullMonth = (float) ($this->gross_full_month ?: $this->gross_salary);

        return round(min(($fullMonth / $divisor) * (float) $this->lOP_days, $fullMonth), 2);
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
