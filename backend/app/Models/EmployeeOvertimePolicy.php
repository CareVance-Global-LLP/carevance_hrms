<?php

namespace App\Models;

use App\Models\Concerns\EmployeePolicyAssignment;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An effective-dated assignment of one overtime policy to one person.
 * See EmployeePolicyAssignment for why re-assignment appends rather than edits.
 */
class EmployeeOvertimePolicy extends EmployeePolicyAssignment
{
    protected $table = 'employee_overtime_policies';

    public function policyForeignKey(): string
    {
        return 'overtime_policy_id';
    }

    public function policy(): BelongsTo
    {
        return $this->overtimePolicy();
    }

    public function overtimePolicy(): BelongsTo
    {
        return $this->belongsTo(OvertimePolicy::class);
    }
}
