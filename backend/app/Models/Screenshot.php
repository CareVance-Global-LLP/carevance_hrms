<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\URL;

class Screenshot extends Model
{
    protected $fillable = ['time_entry_id', 'filename', 'thumbnail', 'blurred'];

    protected $casts = [
        'blurred' => 'boolean',
    ];

    protected $appends = ['path', 'recorded_at', 'user_id', 'user', 'session_id', 'activity_state'];

    public function timeEntry(): BelongsTo
    {
        return $this->belongsTo(TimeEntry::class);
    }

    public function getPathAttribute(): string
    {
        $ttlMinutes = (int) config('screenshots.url_ttl_minutes', 30);
        $ttlMinutes = max(1, $ttlMinutes);

        $relativeSignedPath = URL::temporarySignedRoute(
            'screenshots.file',
            now()->addMinutes($ttlMinutes),
            ['screenshot' => $this->getKey()],
            absolute: false
        );

        $fallbackBaseUrl = rtrim((string) config('app.url', ''), '/');
        if ($fallbackBaseUrl !== '') {
            return $fallbackBaseUrl.$relativeSignedPath;
        }

        $request = request();
        if ($request) {
            return rtrim($request->getSchemeAndHttpHost(), '/').$relativeSignedPath;
        }

        return $relativeSignedPath;
    }

    public function getRecordedAtAttribute(): string
    {
        return $this->created_at?->toIso8601String() ?? '';
    }

    public function getUserIdAttribute(): ?int
    {
        return $this->timeEntry?->user_id ? (int) $this->timeEntry->user_id : null;
    }

    public function getUserAttribute(): ?array
    {
        $user = $this->timeEntry?->user;

        if (!$user) {
            return null;
        }

        return [
            'id' => (int) $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'role' => $user->role,
        ];
    }

    public function getSessionIdAttribute(): ?int
    {
        return $this->time_entry_id ? (int) $this->time_entry_id : null;
    }

    public function getActivityStateAttribute(): string
    {
        return 'active';
    }
}
