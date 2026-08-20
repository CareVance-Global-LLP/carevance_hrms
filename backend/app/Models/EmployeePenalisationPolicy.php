<?php

namespace App\Models;

use App\Models\Concerns\EmployeePolicyAssignment;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * An effective-dated assignment of one penalisation policy to one person.
 * See EmployeePolicyAssignment for why re-assignment appends rather than edits.
 */
class EmployeePenalisationPolicy extends EmployeePolicyAssignment
{
    protected $table = 'employee_penalisation_policies';

    public function policyForeignKey(): string
    {
        return 'penalisation_policy_id';
    }

    public function policy(): BelongsTo
    {
        return $this->penalisationPolicy();
    }

    public function penalisationPolicy(): BelongsTo
    {
        return $this->belongsTo(PenalisationPolicy::class);
    }
}
