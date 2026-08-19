<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BankTransferItem extends Model
{
    use Auditable;
    use BelongsToOrganization;

    protected $table = 'bank_transfer_items';

    protected $fillable = [
        'organization_id', 'bank_transfer_batch_id', 'user_id', 'payroll_item_id',
        'beneficiary_name', 'beneficiary_account', 'beneficiary_ifsc', 'amount',
        'status', 'transaction_reference', 'failure_reason', 'api_response', 'processed_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'api_response' => 'array',
        'processed_at' => 'datetime',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(BankTransferBatch::class, 'bank_transfer_batch_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function payrollItem(): BelongsTo
    {
        return $this->belongsTo(PayrollItem::class);
    }
}
