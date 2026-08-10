<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FbpAllocation extends Model
{
    use BelongsToOrganization;

    protected $table = 'fbp_allocations';

    // utilized_amount / claimed_amount / approved_amount are columns on
    // fbp_allocations but were missing here, so mass assignment silently
    // discarded them and every allocation persisted with 0. Tax exemptions are
    // computed from approved_amount, which meant the whole FBP exemption
    // calculation ran against zeros.
    protected $fillable = [
        'organization_id',
        'user_id',
        'fbp_component_id',
        'allocated_amount',
        'utilized_amount',
        'claimed_amount',
        'approved_amount',
        'financial_year',
        'status',
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
