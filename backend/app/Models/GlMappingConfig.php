<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GlMappingConfig extends Model
{
    protected $table = 'gl_mapping_configs';

    protected $fillable = [
        'organization_id', 'entity_type', 'entity_id', 'gl_code', 'gl_name',
        'debit_account', 'credit_account', 'cost_center', 'description', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function scopeForEntity($query, string $type, $entityId = null)
    {
        $query->where('entity_type', $type);
        if ($entityId) $query->where('entity_id', $entityId);
        return $query;
    }
}
