<?php

namespace App\Models;

use App\Services\Monitoring\ProductivityClassifier;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Log;

class Activity extends Model
{
    protected $fillable = [
        'user_id',
        'time_entry_id',
        'session_key',
        // Offline-sync idempotency key. The desktop tracker retries a queued
        // record until the server acknowledges it, so a response lost after the
        // write would otherwise duplicate the row on the next attempt.
        'local_id',
        'device_id',
        'type',
        'name',
        'app_name',
        'window_title',
        'url',
        'duration',
        'recorded_at',
        'started_at',
        'last_seen_at',
        'ended_at',
        'normalized_label',
        'normalized_domain',
        'software_name',
        'tool_type',
        'classification',
        'classification_reason',
        'classified_at',
        'classifier_version',
        // How the person answered the idle prompt: 'kept', 'discarded', or
        // null while the question is still outstanding.
        'idle_resolution',
        'idle_resolved_at',
    ];

    protected $casts = [
        'recorded_at' => 'datetime',
        'started_at' => 'datetime',
        'last_seen_at' => 'datetime',
        'ended_at' => 'datetime',
        'classified_at' => 'datetime',
        'idle_resolved_at' => 'datetime',
    ];

    protected static function booted(): void
    {
        static::saving(function (Activity $activity) {
            try {
                app(ProductivityClassifier::class)->stampActivity($activity);
            } catch (\Throwable $exception) {
                Log::warning('Activity productivity classification failed during save.', [
                    'activity_id' => $activity->id,
                    'user_id' => $activity->user_id,
                    'type' => $activity->type,
                    'name' => $activity->name,
                    'exception' => $exception::class,
                    'message' => $exception->getMessage(),
                ]);
            }
        });
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function timeEntry(): BelongsTo
    {
        return $this->belongsTo(TimeEntry::class);
    }
}
