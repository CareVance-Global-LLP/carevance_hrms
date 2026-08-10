<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class FbpClaim extends Model
{
    use BelongsToOrganization;

    protected $table = 'fbp_claims';

    protected $fillable = [
        'organization_id',
        'user_id',
        'fbp_component_id',
        'fbp_allocation_id',
        'amount',
        'claim_date',
        'description',
        'receipt_path',
        'status',
        'reviewer_id',
        'reviewer_notes',
        'reviewed_at',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'claim_date' => 'date:Y-m-d',
        'reviewed_at' => 'datetime',
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

    public function allocation(): BelongsTo
    {
        return $this->belongsTo(FbpAllocation::class, 'fbp_allocation_id');
    }

    public function reviewer(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reviewer_id');
    }
}
