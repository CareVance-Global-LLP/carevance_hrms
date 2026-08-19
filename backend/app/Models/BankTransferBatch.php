<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class BankTransferBatch extends Model
{
    use Auditable;
    use BelongsToOrganization;

    public const STATUS_PENDING = 'pending';
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';

    protected $table = 'bank_transfer_batches';

    /*
     * These names track the table exactly. `batch_name` and `total_employees`
     * were listed here previously and exist on neither the table nor any
     * migration, so every mass-assignment of them was silently discarded while
     * batch_reference and total_transactions were never populated at all.
     */
    protected $fillable = [
        'organization_id',
        'payroll_run_id',
        'batch_reference',
        'bank_name',
        'total_amount',
        'total_transactions',
        'success_count',
        'failure_count',
        'status',
        'file_format',
        'file_path',
        'api_response',
        'error_message',
        'processed_at',
        'completed_at',
        'created_by',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'total_transactions' => 'integer',
        'success_count' => 'integer',
        'failure_count' => 'integer',
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

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** The individual payment instructions in this batch. */
    public function items(): HasMany
    {
        return $this->hasMany(BankTransferItem::class, 'bank_transfer_batch_id');
    }
}
