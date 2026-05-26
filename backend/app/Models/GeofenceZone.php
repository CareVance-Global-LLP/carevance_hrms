<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class GeofenceZone extends Model
{
    protected $fillable = [
        'organization_id',
        'name',
        'latitude',
        'longitude',
        'radius_meters',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'latitude' => 'float',
            'longitude' => 'float',
            'radius_meters' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function scopeActiveForOrg($query, int $orgId)
    {
        return $query->where('organization_id', $orgId)->where('is_active', true);
    }

    public function isWithinZone(float $userLat, float $userLng): bool
    {
        return $this->haversineDistance($userLat, $userLng) <= $this->radius_meters;
    }

    private function haversineDistance(float $userLat, float $userLng): float
    {
        $earthRadius = 6371000;
        $dLat = deg2rad($userLat - $this->latitude);
        $dLng = deg2rad($userLng - $this->longitude);
        $a = sin($dLat / 2) ** 2
           + cos(deg2rad($this->latitude)) * cos(deg2rad($userLat)) * sin($dLng / 2) ** 2;

        return $earthRadius * 2 * atan2(sqrt($a), sqrt(1 - $a));
    }
}
