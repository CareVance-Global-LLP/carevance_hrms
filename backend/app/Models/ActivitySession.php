<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ActivitySession extends Model
{
    protected $fillable = [
        'user_id',
        'time_entry_id',
        'source',
        'activity_kind',
        'tool_type',
        'display_name',
        'app_name',
        'window_title',
        'url',
        'normalized_label',
        'normalized_domain',
        'software_name',
        'classification',
        'classification_reason',
        'started_at',
        'ended_at',
        'duration_seconds',
        'confidence',
        'metadata',
    ];

    protected function casts(): array
    {
        return [
            'started_at' => 'datetime',
            'ended_at' => 'datetime',
            'metadata' => 'array',
        ];
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
