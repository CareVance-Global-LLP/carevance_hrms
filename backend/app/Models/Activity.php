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
        'type',
        'name',
        'app_name',
        'window_title',
        'url',
        'duration',
        'recorded_at',
        'normalized_label',
        'normalized_domain',
        'software_name',
        'tool_type',
        'classification',
        'classification_reason',
        'classified_at',
        'classifier_version',
    ];

    protected $casts = [
        'recorded_at' => 'datetime',
        'classified_at' => 'datetime',
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
