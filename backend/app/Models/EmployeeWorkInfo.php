<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeWorkInfo extends Model
{
    protected $fillable = [
        'organization_id',
        'user_id',
        'employee_code',
        'report_group_id',
        'designation',
        'reporting_manager_id',
        'work_location',
        'shift_name',
        'attendance_policy',
        'employment_type',
        'joining_date',
        'probation_status',
        'employment_status',
        'exit_date',
        'work_mode',
        'expected_start_time',
        'expected_timezone',
        'meta',
    ];

    protected function casts(): array
    {
        return [
            'joining_date' => 'date',
            'exit_date' => 'date',
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

    public function department(): BelongsTo
    {
        return $this->belongsTo(Group::class, 'report_group_id');
    }

    public function reportingManager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'reporting_manager_id');
    }
}
