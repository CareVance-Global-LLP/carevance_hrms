<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BankTransferBatch extends Model
{
    protected $table = 'bank_transfer_batches';

    protected $fillable = [
        'organization_id', 'payroll_run_id', 'batch_reference', 'bank_name',
        'total_amount', 'total_transactions', 'success_count', 'failure_count',
        'status', 'file_format', 'file_path', 'api_response', 'error_message',
        'processed_at', 'completed_at', 'created_by',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'api_response' => 'array',
        'processed_at' => 'datetime',
        'completed_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function payrollRun(): BelongsTo
    {
        return $this->belongsTo(PayrollMonthlyRun::class, 'payroll_run_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function items(): HasMany
    {
        return $this->hasMany(BankTransferItem::class, 'bank_transfer_batch_id');
    }
}
