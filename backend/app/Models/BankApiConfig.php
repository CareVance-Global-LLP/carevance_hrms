<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BankApiConfig extends Model
{
    protected $table = 'bank_api_configs';

    protected $fillable = [
        'organization_id', 'bank_name', 'api_endpoint', 'api_key', 'api_secret',
        'api_token', 'account_number', 'beneficiary_validation_endpoint',
        'bulk_transfer_endpoint', 'status_callback_endpoint', 'is_active', 'meta',
    ];

    protected $casts = [
        'is_active' => 'boolean',
        'meta' => 'array',
    ];

    const BANKS = ['ICICI', 'HDFC', 'AXIS', 'SBI', 'KOTAK', 'YES_BANK'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }
}
