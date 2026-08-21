<?php

namespace App\Services\Organization;

use App\Models\User;

/**
 * Whose record may this person act on?
 *
 * One rule, in one place, for every "a manager may do this to their own team"
 * question. An admin reaches everyone in the organization; anybody else needs
 * the subject to sit LOWER in the hierarchy and to share at least one
 * department with them.
 *
 * Both halves matter. Hierarchy alone would let any manager act on any employee
 * in the company; departments alone would let a manager act on their own
 * department head. The pair is what makes "my team" mean my team.
 *
 * This is not `ReportingManagerResolver::canManage`, and the difference is
 * deliberate. That one answers "who is your parent node in the org chart" and
 * documents itself as ignoring department and team on purpose. This one answers
 * "whose record am I allowed to touch", which is a permissions question and
 * does depend on where somebody sits.
 *
 * It lived as a private method on EmployeeWorkspaceController until asset
 * assignment needed the same answer. Copying it would have been the third time
 * this codebase forked a rule and let the copies drift.
 */
class EmployeeScopeResolver
{
    /** Below employee level, i.e. holds some administrative authority. */
    public function canManageAnyone(User $actor): bool
    {
        return $actor->getHierarchyLevel() < 100;
    }

    public function canActOn(User $actor, User $subject): bool
    {
        if (! $this->canManageAnyone($actor)) {
            return false;
        }

        if ((int) $actor->organization_id !== (int) $subject->organization_id) {
            return false;
        }

        $actorLevel = $actor->getHierarchyLevel();

        // Admin and above. The whole organization is theirs.
        if ($actorLevel <= 10) {
            return true;
        }

        // Never sideways or upwards: a peer is not somebody you administer, and
        // neither is the person you report to.
        if ($subject->getHierarchyLevel() <= $actorLevel) {
            return false;
        }

        $groupIds = $actor->groups()->pluck('groups.id')->all();

        // A manager attached to no department administers nobody. Returning
        // true here would silently promote them to organization-wide reach,
        // which is the failure mode this class exists to close.
        if (empty($groupIds)) {
            return false;
        }

        return $subject->groups()->whereIn('groups.id', $groupIds)->exists();
    }
}
