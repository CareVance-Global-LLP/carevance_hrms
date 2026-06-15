<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FbpAllocation extends Model
{
    protected $table = 'fbp_allocations';

    protected $fillable = [
        'organization_id', 'user_id', 'fbp_component_id', 'financial_year',
        'allocated_amount', 'utilized_amount', 'claimed_amount', 'approved_amount', 'status',
    ];

    protected $casts = [
        'allocated_amount' => 'decimal:2',
        'utilized_amount' => 'decimal:2',
        'claimed_amount' => 'decimal:2',
        'approved_amount' => 'decimal:2',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function component(): BelongsTo
    {
        return $this->belongsTo(FbpComponent::class, 'fbp_component_id');
    }

    public function claims(): HasMany
    {
        return $this->hasMany(FbpClaim::class, 'fbp_allocation_id');
    }
}
