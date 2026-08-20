<?php

namespace App\Models;

use App\Models\Concerns\EmployeePolicyAssignment;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An effective-dated assignment of one weekly-off policy to one person.
 * See EmployeePolicyAssignment for why re-assignment appends rather than edits.
 */
class EmployeeWeeklyOffPolicy extends EmployeePolicyAssignment
{
    protected $table = 'employee_weekly_off_policies';

    public function policyForeignKey(): string
    {
        return 'weekly_off_policy_id';
    }

    public function policy(): BelongsTo
    {
        return $this->weeklyOffPolicy();
    }

    public function weeklyOffPolicy(): BelongsTo
    {
        return $this->belongsTo(WeeklyOffPolicy::class);
    }
}
