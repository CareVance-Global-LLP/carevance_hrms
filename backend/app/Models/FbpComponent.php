<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class FbpComponent extends Model
{
    use BelongsToOrganization;

    protected $table = 'fbp_components';

    /**
     * Mirrors the fbp_components table as actually migrated by
     * 2026_06_11_000003_create_fbp_tables — which is also the shape FbpService
     * and PayrollDepartmentController read.
     *
     * This previously listed `max_annual_amount`, a column from an abandoned
     * alternative schema that no business logic consumes, so `category`,
     * `max_exempt_limit`, `requires_proof` and `is_taxable` were all
     * unassignable through mass assignment.
     */
    protected $fillable = [
        'organization_id',
        'name',
        'code',
        'category',
        'max_exempt_limit',
        'requires_proof',
        'is_taxable',
        'description',
        'is_active',
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

    public function claims(): HasMany
    {
        return $this->hasMany(FbpClaim::class, 'fbp_component_id');
    }
}
