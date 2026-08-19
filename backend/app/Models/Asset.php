<?php

namespace App\Models;

use App\Traits\Auditable;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Asset extends Model
{
    use Auditable;
    use BelongsToOrganization;

    use SoftDeletes;

    public const STATUS_AVAILABLE = 'available';
    public const STATUS_ASSIGNED = 'assigned';

    protected $fillable = [
        'organization_id',
        'asset_tag',
        'name',
        'category',
        'serial_number',
        'status',
        'purchase_date',
    ];

    protected $casts = [
        'purchase_date' => 'date:Y-m-d',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function assignments(): HasMany
    {
        return $this->hasMany(AssetAssignment::class);
    }

    public function currentAssignment(): HasOne
    {
        return $this->hasOne(AssetAssignment::class)
            ->whereNull('returned_date')
            ->latestOfMany();
    }

    public function scopeForOrganization($query, int $organizationId)
    {
        return $query->where('organization_id', $organizationId);
    }

    public function scopeAvailable($query)
    {
        return $query->where('status', self::STATUS_AVAILABLE);
    }

    public function isAssigned(): bool
    {
        return $this->status === self::STATUS_ASSIGNED;
    }
}
