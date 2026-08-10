<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Payroll extends Model
{
    use BelongsToOrganization;

    protected $table = 'payrolls';

    protected $fillable = [
        'organization_id',
        'user_id',
        'payroll_month',
        'basic_salary',
        'allowances',
        'deductions',
        'bonus',
        'tax',
        'net_salary',
        'payroll_status',
        'payout_method',
        'payout_status',
        'generated_by',
        'updated_by',
        'processed_at',
        'paid_at',
    ];

    protected $casts = [
        'basic_salary'  => 'decimal:2',
        'allowances'    => 'decimal:2',
        'deductions'    => 'decimal:2',
        'bonus'         => 'decimal:2',
        'tax'           => 'decimal:2',
        'net_salary'    => 'decimal:2',
        'processed_at'  => 'datetime',
        'paid_at'       => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }

    public function updatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'updated_by');
    }
}
