<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TaskRecurrence extends Model
{
    protected $fillable = [
        'task_id',
        'template_title',
        'template_description',
        'template_group_id',
        'template_project_id',
        'template_priority',
        'template_estimated_time',
        'template_assignee_ids',
        'template_label_ids',
        'frequency',
        'interval_value',
        'days_of_week',
        'day_of_month',
        'start_date',
        'end_date',
        'next_run_date',
        'is_active',
    ];

    protected $casts = [
        'template_assignee_ids' => 'array',
        'template_label_ids' => 'array',
        'days_of_week' => 'array',
        'interval_value' => 'integer',
        'day_of_month' => 'integer',
        'start_date' => 'date',
        'end_date' => 'date',
        'next_run_date' => 'date',
        'is_active' => 'boolean',
    ];

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }
}
