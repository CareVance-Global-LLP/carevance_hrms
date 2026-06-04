<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class PayrollProfile extends Model
{
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'salary_template_id',
        'currency',
        'payout_method',
        'bank_name',
        'bank_account_number',
        'bank_ifsc_swift',
        'payment_email',
        'tax_identifier',
        'payroll_eligible',
        'reimbursements_eligible',
        'is_active',
        'earning_components',
        'deduction_components',
        'bonus_amount',
        'tax_amount',
        'meta',
    ];

    protected $casts = [
        'earning_components' => 'array',
        'deduction_components' => 'array',
        'meta' => 'array',
        'payroll_eligible' => 'boolean',
        'reimbursements_eligible' => 'boolean',
        'is_active' => 'boolean',
        'bonus_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function salaryTemplate(): BelongsTo
    {
        return $this->belongsTo(SalaryTemplate::class);
    }

    public function salaryAssignments(): HasMany
    {
        return $this->hasMany(EmployeeSalaryAssignment::class, 'user_id', 'user_id');
    }
}
