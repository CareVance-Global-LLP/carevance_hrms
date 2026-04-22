<?php

namespace App\Services\Approvals;

use App\Models\Group;
use App\Models\User;
use Illuminate\Support\Collection;

class ApprovalRoutingService
{
    /**
     * @return Collection<int, int>
     */
    public function reviewerUserIds(User $requester): Collection
    {
        if (! $requester->organization_id) {
            return collect();
        }

        return match ($requester->role) {
            'employee' => $this->employeeGroupManagerReviewerUserIds($requester),
            'manager' => $this->organizationRoleIds($requester, 'admin', (int) $requester->id),
            'admin' => collect(),
            default => $this->organizationRoleIds($requester, 'admin', (int) $requester->id),
        };
    }

    public function canReview(User $reviewer, User $requester): bool
    {
        if (
            ! $reviewer->organization_id
            || ! $requester->organization_id
            || (int) $reviewer->organization_id !== (int) $requester->organization_id
            || ! in_array($reviewer->role, ['admin', 'manager'], true)
        ) {
            return false;
        }

        if ($reviewer->role === 'admin' && $requester->role === 'admin' && (int) $reviewer->id === (int) $requester->id) {
            return true;
        }

        return $this->reviewerUserIds($requester)->contains((int) $reviewer->id);
    }

    /**
     * @return Collection<int, int>
     */
    private function employeeGroupManagerReviewerUserIds(User $requester): Collection
    {
        $groupIds = $this->requesterGroupIds($requester);

        if ($groupIds->isEmpty()) {
            return collect();
        }

        return User::query()
            ->where('organization_id', $requester->organization_id)
            ->where('role', 'manager')
            ->where('id', '!=', (int) $requester->id)
            ->whereHas('groups', fn ($query) => $query->whereIn('groups.id', $groupIds))
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();
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
        if ($requester->role === 'admin') {
            return true;
        }

        return $this->reviewerUserIds($requester)->isNotEmpty();
    }

    public function missingReviewerMessage(User $requester): string
    {
        return match ($requester->role) {
            'employee' => 'No manager is assigned to your group yet. Please contact an admin.',
            'manager' => 'No admin is available to review this request yet. Please contact an admin owner.',
            default => 'No eligible reviewer is configured for this request.',
        };
    }

    /**
     * @return Collection<int, int>
     */
    public function reviewableRequesterIds(User $reviewer): Collection
    {
        if (! $reviewer->organization_id || ! in_array($reviewer->role, ['admin', 'manager'], true)) {
            return collect();
        }

        return User::query()
            ->with(['employeeWorkInfo', 'groups:id'])
            ->where('organization_id', $reviewer->organization_id)
            ->get(['id', 'organization_id', 'role'])
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
            ->where('role', $role)
            ->where('id', '!=', $excludeUserId)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values();
    }
}
