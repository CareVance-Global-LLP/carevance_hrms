<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payslip extends Model
{
    use HasFactory;

    protected $fillable = [
        'pay_group_id',
        'user_id',
        'employee_id',
        'pay_month',
        'pay_year',
        'payslip_number',
        'status',
        'total_days',
        'days_present',
        'paid_leave',
        'lop_days',
        'half_days',
        'overtime_hours',
        'earnings',
        'total_earnings',
        'deductions',
        'total_deductions',
        'net_payable',
        'net_pay_words',
        'pf_ee',
        'pf_er',
        'edli',
        'admin_charges',
        'esi_ee',
        'esi_er',
        'pt_amount',
        'lwf_ee',
        'lwf_er',
        'tds',
        'loan_emi',
        'advance_recovery',
        'late_penalty',
        'employer_contribution',
        'total_employer_contribution',
        'ytd_gross',
        'ytd_deductions',
        'ytd_net',
        'ytd_pf_ee',
        'ytd_esi_ee',
        'ytd_pt',
        'ytd_lwf',
        'pdf_path',
        'pdf_generated_at',
    ];

    protected $casts = [
        'earnings' => 'array',
        'deductions' => 'array',
        'employer_contribution' => 'array',
        'total_days' => 'decimal:1',
        'days_present' => 'decimal:1',
        'paid_leave' => 'decimal:1',
        'lop_days' => 'decimal:1',
        'overtime_hours' => 'decimal:1',
        'pdf_generated_at' => 'datetime',
    ];

    public function payGroup(): BelongsTo
    {
        return $this->belongsTo(PayGroup::class, 'pay_group_id');
    }

    public function employee(): BelongsTo
    {
        // Bug 6: there is no Employee model in this codebase — the
        // canonical employee record lives on the User table. The
        // Payslip's `employee_id` column aliased `user_id` for legacy
        // reasons, so the relationship resolves to User. If a real
        // Employee model is ever introduced (e.g. a separate HRIS
        // import table), wire it here instead of crashing on
        // "Class App\Models\Employee not found".
        return $this->belongsTo(User::class, 'employee_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Generate payslip number in format: PAY-YYYY-MM-XXXXX
     */
    public static function generateNumber(int $payMonth, int $payYear): string
    {
        $prefix = 'PAY-' . $payYear . '-' . str_pad($payMonth, 2, '0', STR_PAD_LEFT) . '-';

        $last = self::where('pay_month', $payMonth)
            ->where('pay_year', $payYear)
            ->orderBy('id', 'desc')
            ->value('payslip_number');

        if ($last) {
            $seq = (int) substr($last, -5) + 1;
        } else {
            $seq = 1;
        }

        return $prefix . str_pad($seq, 5, '0', STR_PAD_LEFT);
    }
}
