<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per loan EMI actually recovered in a payroll run.
 *
 * The unique key on (payroll_run_id, employee_loan_id) is the idempotency
 * guarantee: re-processing an employee cannot decrement the loan twice.
 */
class PayrollLoanRecovery extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $table = 'payroll_loan_recoveries';

    protected $fillable = [
        'organization_id',
        'payroll_run_id',
        'employee_loan_id',
        'user_id',
        'amount',
        'recovered_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'recovered_at' => 'datetime',
    ];

    public function payrollRun(): BelongsTo
    {
        return $this->belongsTo(PayrollMonthlyRun::class, 'payroll_run_id');
    }

    public function loan(): BelongsTo
    {
        return $this->belongsTo(EmployeeLoan::class, 'employee_loan_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
