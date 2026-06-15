<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FbpClaim extends Model
{
    protected $table = 'fbp_claims';

    protected $fillable = [
        'organization_id', 'user_id', 'fbp_allocation_id', 'fbp_component_id',
        'claimed_amount', 'approved_amount', 'bill_number', 'bill_date', 'description',
        'status', 'approved_by', 'approved_at', 'rejection_reason',
        'proof_file_path', 'proof_filename', 'month_year', 'is_tax_exempt',
    ];

    protected $casts = [
        'claimed_amount' => 'decimal:2',
        'approved_amount' => 'decimal:2',
        'bill_date' => 'date',
        'approved_at' => 'datetime',
        'is_tax_exempt' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function allocation(): BelongsTo
    {
        return $this->belongsTo(FbpAllocation::class, 'fbp_allocation_id');
    }

    public function component(): BelongsTo
    {
        return $this->belongsTo(FbpComponent::class, 'fbp_component_id');
    }

    public function approvedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'approved_by');
    }
}
