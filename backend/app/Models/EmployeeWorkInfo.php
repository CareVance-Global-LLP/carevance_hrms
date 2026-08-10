<?php

namespace App\Models;

use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeWorkInfo extends Model
{
    use BelongsToOrganization;
    use HasFactory;

    protected $fillable = [
        'organization_id',
        'user_id',
        'employee_code',
        'report_group_id',
        'designation',
        'reporting_manager_id',
        'reporting_manager_source',
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
            // date:Y-m-d — these are calendar dates, not instants. Under a plain
            // `date` cast they serialise as UTC midnight and land a day early
            // for any client ahead of UTC. Joining date in particular anchors
            // the onboarding checklist, probation reviews and the five-year
            // gratuity floor, so a one-day drift is not cosmetic.
            'joining_date' => 'date:Y-m-d',
            'exit_date' => 'date:Y-m-d',
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
