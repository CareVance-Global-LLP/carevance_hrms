<?php

namespace App\Services\Approvals;

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

        // Manager-tier users (level 10-100) also route to all org admins regardless of department
        $adminIds = $requesterLevel < 100
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
    private function organizationAdminIds(User $requester): Collection
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
