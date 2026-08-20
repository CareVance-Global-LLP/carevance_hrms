<?php

namespace App\Models\Concerns;

use App\Models\Organization;
use App\Models\User;
use App\Traits\BelongsToOrganization;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * The shared shape of an effective-dated policy assignment.
 *
 * Every working-time policy reaches an employee the same way employee_shifts
 * does, and matching that precedent is the whole point:
 *
 *   - The assignment key is the employee, never the department or the location.
 *     Those are how you choose whom to assign, not what the assignment hangs
 *     off.
 *   - Re-assigning someone is a NEW ROW with a later effective_from, not an
 *     edit. History stays readable, and a payroll re-run for an earlier month
 *     resolves the policy that was actually in force then rather than today's.
 *   - effective_to NULL is open-ended, which is the normal state — the previous
 *     assignment is usually left open when a new one is added, so windows
 *     overlap by design and the latest effective_from wins.
 *
 * This lives under Models/Concerns rather than Models/ so TenantIsolationTest's
 * glob over app/Models/*.php does not try to instantiate an abstract class.
 *
 * Four concrete subclasses, not one polymorphic table: a (policy_type,
 * policy_id) pair cannot carry a foreign key, so a deleted policy would leave
 * assignments pointing at nothing with only application code to notice. This
 * schema has drifted from its migrations before; a relationship the database
 * cannot enforce is the wrong direction to go.
 */
abstract class EmployeePolicyAssignment extends Model
{
    use BelongsToOrganization;

    /** The foreign key column naming the assigned policy. */
    abstract public function policyForeignKey(): string;

    /** The policy this assignment points at. */
    abstract public function policy(): BelongsTo;

    public function getFillable(): array
    {
        return [
            'organization_id',
            'user_id',
            $this->policyForeignKey(),
            'effective_from',
            'effective_to',
            'is_active',
        ];
    }

    protected function casts(): array
    {
        return [
            // date:Y-m-d, not date — a bare date cast serialises as UTC
            // midnight, so an assignment effective from the 1st reaches an IST
            // client as the 31st and the change looks a day early.
            'effective_from' => 'date:Y-m-d',
            'effective_to' => 'date:Y-m-d',
            'is_active' => 'boolean',
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
}
