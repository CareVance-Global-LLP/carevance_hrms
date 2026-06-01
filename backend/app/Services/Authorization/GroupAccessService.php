<?php

namespace App\Services\Authorization;

use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class GroupAccessService
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

    public function canManageGroups(?User $user): bool
    {
        if (!$user) return false;
        return $this->userHierarchyLevel($user) <= 10;
    }

    public function canManageTasks(?User $user): bool
    {
        if (!$user) return false;
        return $this->userHierarchyLevel($user) <= 50;
    }

    public function visibleGroupsQuery(?User $user): Builder
    {
        $query = Group::query()->whereRaw('1 = 0');

        if (!$user || !$user->organization_id) {
            return $query;
        }

        $query = Group::query()
            ->where('organization_id', $user->organization_id)
            ->where('is_active', true);

        $level = $this->userHierarchyLevel($user);

        if ($level <= 10) {
            return $query;
        }

        $managedGroupIds = $this->managedGroupIds($user);
        if (!empty($managedGroupIds)) {
            return $query->whereIn('id', $managedGroupIds);
        }

        return $query->whereHas('users', fn (Builder $builder) => $builder->whereKey($user->id));
    }

    public function manageableGroupsQuery(?User $user): Builder
    {
        if (!$user || !$user->organization_id || !$this->canManageTasks($user)) {
            return Group::query()->whereRaw('1 = 0');
        }

        $level = $this->userHierarchyLevel($user);

        if ($level <= 10) {
            return Group::query()
                ->where('organization_id', $user->organization_id)
                ->where('is_active', true);
        }

        $managedGroupIds = $this->managedGroupIds($user);
        if (!empty($managedGroupIds)) {
            return Group::query()
                ->where('organization_id', $user->organization_id)
                ->where('is_active', true)
                ->whereIn('id', $managedGroupIds);
        }

        return Group::query()->whereRaw('1 = 0');
    }

    public function visibleGroupIds(?User $user): ?array
    {
        if (!$user || !$user->organization_id) {
            return [];
        }

        if ($this->userHierarchyLevel($user) <= 10) {
            return null;
        }

        return $this->visibleGroupsQuery($user)
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    public function canAccessGroup(?User $user, Group $group): bool
    {
        if (!$user || !$user->organization_id || (int) $group->organization_id !== (int) $user->organization_id) {
            return false;
        }

        if ($this->userHierarchyLevel($user) <= 10) {
            return true;
        }

        return $this->visibleGroupsQuery($user)
            ->whereKey($group->id)
            ->exists();
    }

    public function canManageGroup(?User $user, Group $group): bool
    {
        if (!$user || !$user->organization_id || (int) $group->organization_id !== (int) $user->organization_id) {
            return false;
        }

        if ($this->userHierarchyLevel($user) <= 10) {
            return true;
        }

        return $this->manageableGroupsQuery($user)
            ->whereKey($group->id)
            ->exists();
    }

    private function managedGroupIds(User $user): array
    {
        $fromReporting = EmployeeWorkInfo::query()
            ->where('organization_id', $user->organization_id)
            ->where('reporting_manager_id', $user->id)
            ->whereNotNull('report_group_id')
            ->pluck('report_group_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        $fromMembership = $user->groups()
            ->where('groups.organization_id', $user->organization_id)
            ->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();

        return collect([...$fromReporting, ...$fromMembership])
            ->unique()
            ->values()
            ->all();
    }

    public function applyTaskVisibilityScope(Builder $query, ?User $user): Builder
    {
        if (!$user || !$user->organization_id) {
            return $query->whereRaw('1 = 0');
        }

        if ($this->userHierarchyLevel($user) <= 10) {
            return $query->where(function (Builder $builder) use ($user) {
                $builder->whereHas('group', fn (Builder $groupQuery) => $groupQuery->where('organization_id', $user->organization_id))
                    ->orWhere(function (Builder $legacyQuery) use ($user) {
                        $legacyQuery->whereNull('group_id')
                            ->whereHas('project', fn (Builder $projectQuery) => $projectQuery->where('organization_id', $user->organization_id));
                    });
            });
        }

        $visibleGroupIds = $this->visibleGroupIds($user);

        if (is_array($visibleGroupIds)) {
            if (empty($visibleGroupIds)) {
                return $query->whereRaw('1 = 0');
            }

            $query->whereIn('group_id', $visibleGroupIds);
        }

        if ($this->userHierarchyLevel($user) >= 100) {
            $query->where(function (Builder $builder) use ($user) {
                $builder->whereNull('assignee_id')
                    ->orWhere('assignee_id', $user->id)
                    ->orWhereHas('assignees', fn (Builder $assigneeQuery) => $assigneeQuery->where('users.id', $user->id));
            });
        }

        return $query;
    }

    public function canAccessTask(?User $user, Task $task): bool
    {
        $task->loadMissing(['group', 'project']);

        if (!$user || !$user->organization_id) {
            return false;
        }

        if ($this->userHierarchyLevel($user) <= 10) {
            return (
                $task->group && (int) $task->group->organization_id === (int) $user->organization_id
            ) || (
                !$task->group && $task->project && (int) $task->project->organization_id === (int) $user->organization_id
            );
        }

        if ($task->group === null || !$this->canAccessGroup($user, $task->group)) {
            return false;
        }

        if ($this->userHierarchyLevel($user) >= 100) {
            return $task->assignee_id === null
                || (int) $task->assignee_id === (int) $user->id
                || $task->assignees()->where('users.id', $user->id)->exists();
        }

        return true;
    }
}
