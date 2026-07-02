<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PayrollReconciliation extends Model
{
    protected $table = 'payroll_reconciliation';
    
    protected $fillable = [
        'payroll_item_id',
        'old_present_days',
        'new_present_days',
        'difference',
        'month_year',
        'debug_info',
    ];

    protected $casts = [
        'old_present_days' => 'decimal:2',
        'new_present_days' => 'decimal:2',
        'difference' => 'decimal:2',
        'debug_info' => 'array',
        'created_at' => 'datetime',
        'updated_at' => 'datetime',
    ];

    public function payrollItem(): BelongsTo
    {
        return $this->belongsTo(PayrollItem::class, 'payroll_item_id');
    }
}
