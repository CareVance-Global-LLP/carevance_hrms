<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FbpComponent extends Model
{
    protected $table = 'fbp_components';

    protected $fillable = [
        'organization_id',
        'name',
        'code',
        'description',
        'max_annual_amount',
        'is_active',
    ];

    protected $casts = [
        'max_annual_amount' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function allocations(): HasMany
    {
        return $this->hasMany(FbpAllocation::class, 'fbp_component_id');
    }

    public function claims(): HasMany
    {
        return $this->hasMany(FbpClaim::class, 'fbp_component_id');
    }
}
