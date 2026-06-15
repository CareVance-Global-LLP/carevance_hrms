<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FbpComponent extends Model
{
    protected $table = 'fbp_components';

    protected $fillable = [
        'organization_id', 'name', 'code', 'category', 'max_exempt_limit',
        'requires_proof', 'is_taxable', 'description', 'is_active',
    ];

    protected $casts = [
        'max_exempt_limit' => 'decimal:2',
        'requires_proof' => 'boolean',
        'is_taxable' => 'boolean',
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
}
