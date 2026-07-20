<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BankTransferBatch extends Model
{
    public const STATUS_PENDING = 'pending';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    protected $table = 'bank_transfer_batches';

    protected $fillable = [
        'organization_id',
        'payroll_run_id',
        'batch_name',
        'bank_name',
        'total_amount',
        'total_employees',
        'status',
        'file_path',
        'processed_at',
        'created_by',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'total_employees' => 'integer',
        'processed_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function payrollRun(): BelongsTo
    {
        return $this->belongsTo(PayrollMonthlyRun::class, 'payroll_run_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
