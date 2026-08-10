<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AssetAssignment extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'asset_id',
        'user_id',
        'assigned_by',
        'assigned_date',
        'returned_date',
    ];

    protected $casts = [
        'assigned_date' => 'date:Y-m-d',
        'returned_date' => 'date:Y-m-d',
    ];

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function asset(): BelongsTo
    {
        return $this->belongsTo(Asset::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function assignedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assigned_by');
    }

    public function scopeActive($query)
    {
        return $query->whereNull('returned_date');
    }

    public function isActive(): bool
    {
        return $this->returned_date === null;
    }
}
