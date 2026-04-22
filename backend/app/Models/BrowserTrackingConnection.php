<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class BrowserTrackingConnection extends Model
{
    protected $fillable = [
        'organization_id',
        'user_id',
        'device_id',
        'device_label',
        'browser_name',
        'browser_profile_key',
        'extension_version',
        'status',
        'connected_at',
        'last_seen_at',
        'last_sync_at',
        'disconnected_at',
        'disconnect_reason',
        'meta',
    ];

    protected function casts(): array
    {
        return [
            'connected_at' => 'datetime',
            'last_seen_at' => 'datetime',
            'last_sync_at' => 'datetime',
            'disconnected_at' => 'datetime',
            'meta' => 'array',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
