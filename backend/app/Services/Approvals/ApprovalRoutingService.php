<?php

namespace App\Services\Approvals;

use App\Models\DepartmentTeam;
use App\Models\Group;
use App\Models\User;
use Illuminate\Support\Collection;

class ApprovalRoutingService
{
    private function userHierarchyLevel(User $user): int
    {
        return $user->customRole?->hierarchy_level ?? match ($user->role) {
            'super_admin' => 0,
            'admin' => 10,
            'manager' => 50,
            'employee' => 100,
            default => 999,
        };
    }

    /**
     * @return Collection<int, int>
     */
    public function reviewerUserIds(User $requester): Collection
    {
        if (! $requester->organization_id) {
            return collect();
        }

        $requesterLevel = $this->userHierarchyLevel($requester);

        // Admins can self-review (no external reviewer needed)
        if ($requesterLevel <= 10) {
            return collect();
        }

        // Find direct reporting manager first (if they are the nearest superior)
        $directManagerIds = $this->employeeReportingManagerReviewerUserIds($requester);

        // Then find the nearest higher-ranked person in the same department(s)
        $nearestReviewerIds = $this->nearestHigherRankedReviewerIds($requester, $requesterLevel);

        // Manager-tier users (level 10-100) and regular employees (level 100)
        // also route to all org admins regardless of department.
        $adminIds = $requesterLevel <= 100
            ? $this->organizationAdminIds($requester)
            : collect();

        return $directManagerIds
            ->concat($nearestReviewerIds)
            ->concat($adminIds)
            ->unique()
            ->values();
    }

    public function canReview(User $reviewer, User $requester): bool
    {
        if (
            ! $reviewer->organization_id
            || ! $requester->organization_id
            || (int) $reviewer->organization_id !== (int) $requester->organization_id
        ) {
            return false;
        }

        $reviewerLevel = $this->userHierarchyLevel($reviewer);
        $requesterLevel = $this->userHierarchyLevel($requester);

        // Self-review allowed for admins
        if (
            $requesterLevel <= 10
            && (int) $reviewer->id === (int) $requester->id
        ) {
            return true;
        }

        // Reviewer must be higher rank (lower hierarchy_level) than requester
        if ($reviewerLevel >= $requesterLevel) {
            return false;
        }

        return $this->reviewerUserIds($requester)->contains((int) $reviewer->id);
    }

    /**
     * Find the nearest higher-ranked person in the requester's department(s).
     * Strict escalation: Employee → Team Lead → Manager → Admin.
     * @return Collection<int, int>
     */
    private function nearestHigherRankedReviewerIds(User $requester, int $requesterLevel): Collection
    {
        $groupIds = $this->requesterGroupIds($requester);

        if ($groupIds->isEmpty()) {
            return collect();
        }

        $candidates = User::query()
            ->where('organization_id', $requester->organization_id)
            ->where('id', '!=', (int) $requester->id)
            ->whereHas('groups', fn ($query) => $query->whereIn('groups.id', $groupIds))
            ->with('customRole')
            ->get()
            ->map(function (User $candidate) {
                return [
                    'id' => (int) $candidate->id,
                    'level' => $this->userHierarchyLevel($candidate),
                ];
            })
            ->filter(fn ($c) => $c['level'] < $requesterLevel)
            ->sortByDesc('level')
            ->values();

        if ($candidates->isEmpty()) {
            return collect();
        }

        // Only the nearest superior (highest level that is still below requester)
        $nearestLevel = $candidates->first()['level'];
        $nearestIds = $candidates
            ->filter(fn ($c) => $c['level'] === $nearestLevel)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();

        return $nearestIds;
    }

    /**
     * @return Collection<int, int>
     */
    private function employeeReportingManagerReviewerUserIds(User $requester): Collection
    {
        $workInfo = $requester->relationLoaded('employeeWorkInfo')
            ? $requester->employeeWorkInfo
            : $requester->employeeWorkInfo()->first();
        $reportingManagerId = (int) ($workInfo?->reporting_manager_id ?? 0);

        if ($reportingManagerId <= 0) {
            return collect();
        }

        $manager = User::query()
            ->where('organization_id', $requester->organization_id)
            ->where('id', $reportingManagerId)
            ->with('customRole')
            ->first();

        if (! $manager) {
            return collect();
        }

        $managerLevel = $this->userHierarchyLevel($manager);
        $requesterLevel = $this->userHierarchyLevel($requester);

        if ($managerLevel >= $requesterLevel) {
            return collect();
        }

        return collect([(int) $manager->id]);
    }

    /**
     * @return Collection<int, int>
     */
    private function requesterGroupIds(User $requester): Collection
    {
        $workInfo = $requester->relationLoaded('employeeWorkInfo')
            ? $requester->employeeWorkInfo
            : $requester->employeeWorkInfo()->first();
        $primaryGroupId = (int) ($workInfo?->report_group_id ?? 0);

        $membershipGroupIds = ($requester->relationLoaded('groups')
            ? $requester->groups
            : $requester->groups()->get(['groups.id']))
            ->pluck('id')
            ->map(fn ($id) => (int) $id);

        return collect([$primaryGroupId])
            ->concat($membershipGroupIds)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->when(
                fn (Collection $groupIds) => $groupIds->isNotEmpty(),
                fn (Collection $groupIds) => Group::query()
                    ->where('organization_id', $requester->organization_id)
                    ->whereIn('id', $groupIds)
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->values(),
                fn () => collect()
            );
    }

    /**
     * Return the next higher-ranked reviewer(s) a request can be escalated to,
     * intentionally skipping an unavailable reviewer. Reuses the same hierarchy
     * rules as reviewerUserIds (custom-role hierarchy_level aware).
     *
     * @return Collection<int, int>
     */
    public function escalationTargetIds(User $requester, ?int $excludeUserId = null): Collection
    {
        if (! $requester->organization_id) {
            return collect();
        }

        $requesterLevel = $this->userHierarchyLevel($requester);

        // Admins (level <= 10) are already top of the chain — nothing higher exists.
        if ($requesterLevel <= 10) {
            return collect();
        }

        $excludeUser = null;
        if ($excludeUserId !== null) {
            $excludeUser = User::query()
                ->where('organization_id', $requester->organization_id)
                ->where('id', (int) $excludeUserId)
                ->with('customRole')
                ->first();
        }
        $excludeLevel = $excludeUser ? $this->userHierarchyLevel($excludeUser) : $requesterLevel;

        $candidates = User::query()
            ->where('organization_id', $requester->organization_id)
            ->where('id', '!=', (int) $requester->id)
            ->with('customRole')
            ->get(['id', 'organization_id', 'role', 'role_id'])
            // Escalation jumps to the next higher-ranked user in the hierarchy,
            // bypassing the stricter department/department canReview rule used
            // for normal routing. A skipped reviewer (excludeLevel) is lower
            // rank (higher number) than the requester, so requiring a strictly
            // lower level than it guarantees we only move upward.
            ->filter(fn (User $candidate) => $this->userHierarchyLevel($candidate) < $excludeLevel)
            ->map(fn (User $candidate) => [
                'id' => (int) $candidate->id,
                'level' => $this->userHierarchyLevel($candidate),
            ])
            ->sortByDesc('level')
            ->values();

        if ($candidates->isEmpty()) {
            return collect();
        }

        $nearestLevel = $candidates->first()['level'];

        return $candidates
            ->filter(fn ($c) => $c['level'] === $nearestLevel)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();
    }

    /**
     * The user(s) *currently holding* a request and therefore the only ones
     * allowed to forward it upward. This enforces a strict chain: only the
     * nearest reviewer (or the explicitly escalated target) can forward — not
     * every eligible reviewer at once.
     *
     * - If the request was already escalated, the single target holds it.
     * - Otherwise the nearest (lowest hierarchy_level) reviewer(s) hold it.
     *
     * @return Collection<int, int>
     */
    public function currentReviewerIds(User $requester, ?int $escalatedToUserId): Collection
    {
        if ($escalatedToUserId) {
            return collect([(int) $escalatedToUserId]);
        }

        $ids = $this->reviewerUserIds($requester);
        if ($ids->isEmpty()) {
            return collect();
        }

        $holders = User::query()
            ->whereIn('id', $ids)
            ->with('customRole')
            ->get(['id', 'organization_id', 'role', 'role_id'])
            ->map(fn (User $candidate) => [
                'id' => (int) $candidate->id,
                'level' => $this->userHierarchyLevel($candidate),
            ])
            ->sortBy('level')
            ->values();

        if ($holders->isEmpty()) {
            return collect();
        }

        $nearestLevel = $holders->first()['level'];

        return $holders
            ->filter(fn ($c) => $c['level'] === $nearestLevel)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();
    }

    public function hierarchyLevel(User $user): int
    {
        return $this->userHierarchyLevel($user);
    }

    /**
     * Candidates a request may be forwarded to, scoped to the requester's
     * department. A forward target is any "higher up" (strictly higher rank than
     * the current holder) among:
     *  - managers of any team inside the department (annotated with team_names),
     *  - the requester's reporting manager (if in the department),
     *  - organization admins (top of the chain).
     *
     * @return Collection<int, array{id:int,name:string,hierarchy_level:int,team_names:array<int,string>}>
     */
    public function forwardTargets(User $requester, ?int $excludeUserId = null): Collection
    {
        if (! $requester->organization_id) {
            return collect();
        }

        $requesterLevel = $this->userHierarchyLevel($requester);

        $workInfo = $requester->relationLoaded('employeeWorkInfo')
            ? $requester->employeeWorkInfo
            : $requester->employeeWorkInfo()->first();
        $departmentId = (int) ($workInfo?->report_group_id ?? 0);
        $reportingManagerId = (int) ($workInfo?->reporting_manager_id ?? 0);

        $holderIds = $this->currentReviewerIds($requester, $excludeUserId);
        $holderLevel = $holderIds->isNotEmpty()
            ? User::query()->whereIn('id', $holderIds)->with('customRole')->get()
                ->map(fn (User $u) => $this->userHierarchyLevel($u))->min()
            : $requesterLevel;

        // Gather every organization member who sits at or above the current
        // holder's rank (peer managers and any admins count). A holder may
        // forward to *another manager* anywhere in the organization, not just
        // within the requester's own department — this keeps the Forward option
        // available whenever at least one other eligible approver exists.
        $candidates = User::query()
            ->where('organization_id', $requester->organization_id)
            ->where('id', '!=', (int) $requester->id)
            ->with('customRole')
            ->get(['id', 'organization_id', 'role', 'role_id', 'name'])
            ->map(function (User $candidate) use ($reportingManagerId) {
                $id = (int) $candidate->id;

                return [
                    'id' => $id,
                    'name' => $candidate->name,
                    'hierarchy_level' => $this->userHierarchyLevel($candidate),
                    'team_names' => [],
                    'source' => $id === $reportingManagerId ? 'reporting_manager' : 'upper_hierarchy',
                ];
            })
            ->filter(fn (array $c) => $c['hierarchy_level'] <= $holderLevel)
            ->filter(fn (array $c) => $excludeUserId === null || $c['id'] !== (int) $excludeUserId)
            ->keyBy('id');

        // Annotate managers of department teams inside the requester's
        // department, so the forwarder can see which team each manager belongs
        // to. These are still part of the candidate set above.
        if ($departmentId > 0) {
            $teams = DepartmentTeam::query()
                ->where('organization_id', $requester->organization_id)
                ->where('department_id', $departmentId)
                ->with('managers:id,name,role,role_id', 'managers.customRole')
                ->get();

            foreach ($teams as $team) {
                foreach ($team->managers as $manager) {
                    $id = (int) $manager->id;
                    if (! $candidates->has($id)) {
                        continue;
                    }
                    $entry = $candidates->get($id);
                    $entry['team_names'][] = $team->name;
                    $entry['source'] = 'team';
                    $candidates->put($id, $entry);
                }
            }
        }

        return $candidates->values()
            ->filter(fn (array $c) => $c['id'] !== (int) $requester->id)
            ->sortByDesc('hierarchy_level')
            ->values();
    }

    public function isValidForwardTarget(User $requester, int $targetId, ?int $excludeUserId = null): bool
    {
        return $this->forwardTargets($requester, $excludeUserId)
            ->contains(fn (array $c) => (int) $c['id'] === $targetId);
    }

    /**
     * Whether the requester has any eligible reviewer for their submission.
     */
    public function hasEligibleReviewer(User $requester): bool
    {
        $requesterLevel = $this->userHierarchyLevel($requester);

        if ($requesterLevel <= 10) {
            return true;
        }

        return $this->reviewerUserIds($requester)->isNotEmpty();
    }

    public function missingReviewerMessage(User $requester): string
    {
        $requesterLevel = $this->userHierarchyLevel($requester);

        if ($requesterLevel >= 100) {
            return 'No team lead is assigned to your department yet. Please contact an admin.';
        }

        if ($requesterLevel > 10) {
            return 'No admin is available to review this request yet. Please contact an admin owner.';
        }

        return 'No eligible reviewer is configured for this request.';
    }

    /**
     * Return a human label for who will review the requester's submissions.
     * Strict escalation: Employee → Team Lead → Manager → Admin.
     */
    public function reviewerLabel(User $requester, int $reviewerCount = 1): string
    {
        $requesterLevel = $this->userHierarchyLevel($requester);

        if ($requesterLevel >= 100) {
            return $reviewerCount === 1 ? 'your team lead' : 'your team leads';
        }

        if ($requesterLevel > 50) {
            return $reviewerCount === 1 ? 'your manager' : 'your managers';
        }

        if ($requesterLevel > 10) {
            return $reviewerCount === 1 ? 'an admin' : 'admins';
        }

        return 'the reviewer';
    }

    /**
     * Return hierarchy_levels the reviewer can potentially approve (all levels above their own).
     * The strict nearest-superior rule is enforced dynamically by reviewerUserIds/canReview.
     * @return array<int>
     */
    public function reviewerHierarchyLevels(User $reviewer): array
    {
        $reviewerLevel = $this->userHierarchyLevel($reviewer);

        if ($reviewerLevel <= 10) {
            return [50, 100, 999];
        }

        if ($reviewerLevel < 100) {
            return [100, 999];
        }

        return [];
    }

    /**
     * @return Collection<int, int>
     */
    public function reviewableRequesterIds(User $reviewer): Collection
    {
        if (! $reviewer->organization_id) {
            return collect();
        }

        $reviewerLevel = $this->userHierarchyLevel($reviewer);

        // Only people higher than the reviewer (lower level) can review, not peers or self
        if ($reviewerLevel >= 100) {
            return collect();
        }

        return User::query()
            ->with(['employeeWorkInfo', 'groups:id'])
            ->where('organization_id', $reviewer->organization_id)
            ->get(['id', 'organization_id', 'role', 'role_id'])
            ->filter(fn (User $candidate) => $this->canReview($reviewer, $candidate))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();
    }

    /**
     * @return Collection<int, int>
     */
    private function organizationRoleIds(User $requester, string $role, int $excludeUserId): Collection
    {
        return User::query()
            ->where('organization_id', $requester->organization_id)
            ->whereRaw('LOWER(TRIM(role)) = ?', [strtolower(trim($role))])
            ->where('id', '!=', $excludeUserId)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();
    }

    /**
     * Get all admin-level users (hierarchy_level <= 10) in the organization.
     * These are eligible to review manager-tier requests regardless of department.
     * @return Collection<int, int>
     */
    public function organizationAdminIds(User $requester): Collection
    {
        return User::query()
            ->where('organization_id', $requester->organization_id)
            ->where('id', '!=', (int) $requester->id)
            ->with('customRole')
            ->get(['id', 'organization_id', 'role', 'role_id'])
            ->filter(fn (User $candidate) => $this->userHierarchyLevel($candidate) <= 10)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();
    }
}
