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
    protected $fillable = ['description', 'project_id', 'task_id', 'start_time', 'end_time', 'duration', 'billable', 'user_id', 'timer_slot', 'is_break', 'break_type_id', 'auto_stopped_for_idle', 'stop_reason', 'idle_seconds', 'trailing_idle_seconds', 'last_activity_at', 'duration_reconciled_at', 'local_id', 'device_id'];

    protected $casts = [
        'start_time' => 'datetime',
        'end_time' => 'datetime',
        'last_activity_at' => 'datetime',
        'duration_reconciled_at' => 'datetime',
        'billable' => 'boolean',
        'is_break' => 'boolean',
        'auto_stopped_for_idle' => 'boolean',
        'idle_seconds' => 'integer',
        'trailing_idle_seconds' => 'integer',
    ];

    /** Which code path closed this entry. Values for stop_reason. */
    public const STOP_MANUAL = 'manual';
    public const STOP_MANUAL_OFFLINE_SYNC = 'manual_offline_sync';
    public const STOP_IDLE_CLIENT = 'idle_auto_stop_client';
    public const STOP_IDLE_SERVER = 'idle_auto_stop_server';
    public const STOP_IDLE_CRON = 'idle_auto_stop_cron';
    public const STOP_DAILY_BOUNDARY = 'daily_boundary';
    public const STOP_STALE_CLOSE = 'stale_close';
    public const STOP_BREAK = 'break';

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

    /** Set on is_break entries; null on work entries and legacy breaks. */
    public function breakType(): BelongsTo
    {
        return $this->belongsTo(BreakType::class);
    }
}
