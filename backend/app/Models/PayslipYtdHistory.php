<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Year-to-date payroll aggregates, one row per (employee, month, year).
 *
 * The table was migrated in 2026_06_26_162518_create_payslip_ytd_history_table
 * but the model was never created, so every reference to it fataled. Note that
 * `employee_id` is a foreign key to `users` — there is no employees table.
 */
class PayslipYtdHistory extends Model
{
    use HasFactory;

    protected $table = 'payslip_ytd_history';

    protected $fillable = [
        'employee_id',
        'pay_month',
        'pay_year',
        'gross',
        'deductions',
        'net',
        'pf_ee',
        'esi_ee',
        'pt',
        'lwf',
    ];

    protected $casts = [
        'pay_month' => 'integer',
        'pay_year' => 'integer',
        'gross' => 'decimal:2',
        'deductions' => 'decimal:2',
        'net' => 'decimal:2',
        'pf_ee' => 'decimal:2',
        'esi_ee' => 'decimal:2',
        'pt' => 'decimal:2',
        'lwf' => 'decimal:2',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'employee_id');
    }

    /**
     * Running YTD totals for a financial year up to and including $upToMonth.
     *
     * @return array{gross:float,deductions:float,net:float,pf_ee:float,esi_ee:float,pt:float,lwf:float}
     */
    public static function totalsFor(int $employeeId, int $payYear, int $upToMonth): array
    {
        $row = self::query()
            ->where('employee_id', $employeeId)
            ->where('pay_year', $payYear)
            ->where('pay_month', '<=', $upToMonth)
            ->selectRaw(
                'COALESCE(SUM(gross),0) as gross,'
                . ' COALESCE(SUM(deductions),0) as deductions,'
                . ' COALESCE(SUM(net),0) as net,'
                . ' COALESCE(SUM(pf_ee),0) as pf_ee,'
                . ' COALESCE(SUM(esi_ee),0) as esi_ee,'
                . ' COALESCE(SUM(pt),0) as pt,'
                . ' COALESCE(SUM(lwf),0) as lwf'
            )
            ->first();

        return [
            'gross' => (float) ($row->gross ?? 0),
            'deductions' => (float) ($row->deductions ?? 0),
            'net' => (float) ($row->net ?? 0),
            'pf_ee' => (float) ($row->pf_ee ?? 0),
            'esi_ee' => (float) ($row->esi_ee ?? 0),
            'pt' => (float) ($row->pt ?? 0),
            'lwf' => (float) ($row->lwf ?? 0),
        ];
    }
}
