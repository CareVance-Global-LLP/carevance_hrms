<?php

namespace App\Services\Organization;

use App\Models\Organization;
use App\Models\User;

/**
 * Who an employee in a group reports to.
 *
 * This existed TWICE, in UserController and ReportGroupController, and the two
 * copies disagreed:
 *
 *   - UserController filtered to 10 < hierarchy_level < 100, correctly excluding
 *     admins.
 *   - ReportGroupController sorted every group member by hierarchy_level
 *     ascending and took the first — which actively PREFERS an admin, because
 *     admins have the lowest level number. Any group containing an admin had
 *     every employee in it re-pointed at that admin.
 *
 * Whichever controller ran last won, so the reporting line silently flipped
 * depending on whether you edited the person or the department. That is the
 * "employee reporting to admin" bug.
 *
 * One implementation, one rule.
 */
class ReportingManagerResolver
{
    private const ADMIN_LEVEL = 10;
    private const EMPLOYEE_LEVEL = 100;

    /**
     * The manager for a group, or null when the group has none.
     *
     * Deliberately returns null rather than falling back to an admin or the org
     * owner. An unassigned reporting line is a visible gap someone can fix; a
     * silently-wrong one routes approvals to the wrong person indefinitely.
     */
    public function forGroup(?int $organizationId, ?int $groupId): ?int
    {
        if (! $organizationId || ! $groupId) {
            return null;
        }

        return $this->managerCandidates($organizationId, $groupId)
            ->sortBy(fn (User $user) => [$this->levelFor($user), $user->name])
            ->first()
            ?->id;
    }

    /**
     * Resolve for one specific user, so a manager is never made to report to
     * themselves — they fall through to the next candidate, then to null.
     */
    public function forUserInGroup(User $user, ?int $groupId): ?int
    {
        if (! $groupId || ! $user->organization_id) {
            return null;
        }

        return $this->managerCandidates((int) $user->organization_id, $groupId)
            ->reject(fn (User $candidate) => (int) $candidate->id === (int) $user->id)
            ->sortBy(fn (User $candidate) => [$this->levelFor($candidate), $candidate->name])
            ->first()
            ?->id;
    }

    /** Only managers: above employee level, below admin level. */
    private function managerCandidates(int $organizationId, int $groupId)
    {
        return User::query()
            ->where('organization_id', $organizationId)
            ->whereHas('groups', fn ($query) => $query->where('groups.id', $groupId))
            ->with('customRole')
            ->get()
            ->filter(function (User $candidate) {
                $level = $this->levelFor($candidate);

                return $level > self::ADMIN_LEVEL && $level < self::EMPLOYEE_LEVEL;
            })
            ->values();
    }

    /** A custom role's level wins; otherwise fall back to the system role. */
    public function levelFor(User $user): int
    {
        if ($user->customRole?->hierarchy_level !== null) {
            return (int) $user->customRole->hierarchy_level;
        }

        return (int) (Organization::SYSTEM_ROLE_HIERARCHY_LEVELS[$user->role]
            ?? self::EMPLOYEE_LEVEL);
    }

    public const SOURCE_DERIVED = 'derived';
    public const SOURCE_EXPLICIT = 'explicit';

    /**
     * May $managerId manage $userId?
     *
     * One rule, borrowed from how Zoho and BambooHR validate this: your manager
     * must hold more authority than you — a lower hierarchy level number. That
     * permits manager -> manager (a team lead under a department head, which
     * every HRMS supports) and manager -> admin, while rejecting
     * employee -> employee and manager -> employee.
     *
     * Note what this rule does NOT consider: department, team, or job title.
     * Those decide permissions and grouping, never who your parent node is.
     * Blending them is what let the org chart contradict the data.
     */
    public function canManage(User $manager, User $subject): bool
    {
        if ((int) $manager->id === (int) $subject->id) {
            return false;
        }

        if ((int) $manager->organization_id !== (int) $subject->organization_id) {
            return false;
        }

        return $this->levelFor($manager) < $this->levelFor($subject);
    }

    /**
     * Would making $managerId the manager of $userId create a loop?
     *
     * Nothing previously stopped A -> B -> A. A cycle makes an org chart render
     * infinitely and makes approval escalation never terminate, so it has to be
     * rejected at write time rather than defended against at every read.
     */
    public function wouldCreateCycle(int $userId, ?int $managerId): bool
    {
        if ($managerId === null) {
            return false;
        }

        if ($managerId === $userId) {
            return true;
        }

        // Walk up from the proposed manager. If we reach the user, the edge
        // closes a loop. The visited set also protects against a pre-existing
        // cycle in the data, so this can never itself hang.
        $seen = [];
        $cursor = $managerId;

        while ($cursor !== null && ! isset($seen[$cursor])) {
            if ($cursor === $userId) {
                return true;
            }

            $seen[$cursor] = true;

            $cursor = \App\Models\EmployeeWorkInfo::query()
                ->where('user_id', $cursor)
                ->value('reporting_manager_id');

            $cursor = $cursor === null ? null : (int) $cursor;
        }

        return false;
    }

    /**
     * Apply a group-derived manager, but never clobber a line a human set.
     *
     * This is the inversion the research pointed to: derivation becomes a
     * convenience for new records, not the source of truth. Previously every
     * user or department save recomputed the line, so an explicit assignment
     * survived only until the next unrelated edit.
     */
    public function applyDerivedManager(int $organizationId, int $userId, ?int $groupId): void
    {
        $existing = \App\Models\EmployeeWorkInfo::query()
            ->where('organization_id', $organizationId)
            ->where('user_id', $userId)
            ->first();

        if ($existing && $existing->reporting_manager_source === self::SOURCE_EXPLICIT) {
            // Keep the human's answer; only refresh which group they sit in.
            $existing->update(['report_group_id' => $groupId]);

            return;
        }

        $managerId = $this->forGroup($organizationId, $groupId);

        if ($managerId !== null && ($managerId === $userId || $this->wouldCreateCycle($userId, $managerId))) {
            $managerId = null;
        }

        \App\Models\EmployeeWorkInfo::query()->updateOrCreate(
            ['organization_id' => $organizationId, 'user_id' => $userId],
            [
                'report_group_id' => $groupId,
                'reporting_manager_id' => $managerId,
                'reporting_manager_source' => self::SOURCE_DERIVED,
            ],
        );
    }

    /** Users who should be given a reporting manager — employees, not managers or admins. */
    public function reportingMemberIds(int $organizationId, int $groupId): array
    {
        return User::query()
            ->where('organization_id', $organizationId)
            ->whereHas('groups', fn ($query) => $query->where('groups.id', $groupId))
            ->with('customRole')
            ->get()
            ->filter(fn (User $candidate) => $this->levelFor($candidate) >= self::EMPLOYEE_LEVEL)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }
}
