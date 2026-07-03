<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PayslipYtdHistory extends Model
{
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
        'gross' => 'decimal:2',
        'deductions' => 'decimal:2',
        'net' => 'decimal:2',
        'pf_ee' => 'decimal:2',
        'esi_ee' => 'decimal:2',
        'pt' => 'decimal:2',
        'lwf' => 'decimal:2',
    ];
}