<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A punch device on somebody's wall.
 *
 * Identified only by the serial it sends on every request. A device cannot hold
 * a bearer token, so the serial must be registered by an admin before it is
 * accepted: auto-enrolling an unknown serial would let anybody who learns the
 * endpoint post attendance into a tenant.
 */
class BiometricDevice extends Model
{
    use BelongsToOrganization;

    protected $fillable = [
        'organization_id',
        'serial_number',
        'name',
        'location',
        'legal_entity_id',
        'vendor',
        'firmware',
        'ip_address',
        'last_seen_at',
        'punches_received',
        'is_active',
    ];

    protected $casts = [
        'last_seen_at' => 'datetime',
        'is_active' => 'boolean',
        'punches_received' => 'integer',
    ];

    public function punches(): HasMany
    {
        return $this->hasMany(BiometricPunch::class);
    }

    public function legalEntity(): BelongsTo
    {
        return $this->belongsTo(LegalEntity::class);
    }

    /**
     * Whether this device has gone quiet.
     *
     * The failure mode nobody notices: a device that stops talking produces no
     * attendance, which looks exactly like everybody being absent. Six hours is
     * comfortably longer than any normal gap — these poll every few seconds —
     * and short enough to catch it within a working day.
     */
    public function isStale(int $hours = 6): bool
    {
        /*
         * A device that has NEVER reported is not stale, it is unconfigured -
         * two different situations needing two different actions. Treating them
         * alike meant a terminal registered thirty seconds ago immediately
         * announced "no attendance is arriving from this device", which trains
         * an admin to ignore the warning by the time it means something.
         */
        return $this->hasEverReported() && $this->last_seen_at->lt(now()->subHours($hours));
    }

    /** Has this device ever completed a handshake or sent a punch? */
    public function hasEverReported(): bool
    {
        return $this->last_seen_at !== null;
    }
}
