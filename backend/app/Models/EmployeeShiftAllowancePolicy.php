<?php

namespace App\Models;

use App\Models\Concerns\EmployeePolicyAssignment;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An effective-dated assignment of one shift-allowance policy to one person.
 * See EmployeePolicyAssignment for why re-assignment appends rather than edits.
 */
class EmployeeShiftAllowancePolicy extends EmployeePolicyAssignment
{
    protected $table = 'employee_shift_allowance_policies';

    public function policyForeignKey(): string
    {
        return 'shift_allowance_policy_id';
    }

    public function policy(): BelongsTo
    {
        return $this->shiftAllowancePolicy();
    }

    public function shiftAllowancePolicy(): BelongsTo
    {
        return $this->belongsTo(ShiftAllowancePolicy::class);
    }
}
