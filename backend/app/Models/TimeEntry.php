<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TimeEntry extends Model
{
    // local_id / device_id are the offline-sync idempotency keys. They were
    // missing from $fillable, so the values IdempotentSync merges into the
    // request were silently discarded on create and every replayed sync
    // inserted a fresh row.
    protected $fillable = ['description', 'project_id', 'task_id', 'start_time', 'end_time', 'duration', 'billable', 'user_id', 'timer_slot', 'is_break', 'auto_stopped_for_idle', 'local_id', 'device_id'];

    protected $casts = [
        'start_time' => 'datetime',
        'end_time' => 'datetime',
        'billable' => 'boolean',
        'is_break' => 'boolean',
        'auto_stopped_for_idle' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class);
    }
}
