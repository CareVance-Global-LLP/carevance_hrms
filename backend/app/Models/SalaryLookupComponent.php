<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SalaryLookupComponent extends Model
{
    protected $table = 'salary_lookup_components';

    protected $fillable = [
        'organization_id', 'name', 'code', 'lookup_type', 'value_map',
        'default_value', 'data_type', 'is_active',
    ];

    protected $casts = [
        'value_map' => 'array',
        'is_active' => 'boolean',
    ];

    const LOOKUP_TYPES = ['category', 'grade', 'location', 'department', 'designation'];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function getValueForKey(string $key): mixed
    {
        return $this->value_map[$key] ?? $this->default_value;
    }
}
