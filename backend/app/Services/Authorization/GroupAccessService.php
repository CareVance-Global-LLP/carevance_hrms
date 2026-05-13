<?php

namespace App\Services\Authorization;

use App\Models\EmployeeWorkInfo;
use App\Models\Group;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

class GroupAccessService
{
    public function canManageGroups(?User $user): bool
    {
        return $user?->role === 'admin';
    }

    public function canManageTasks(?User $user): bool
    {
        return in_array($user?->role, ['admin', 'manager'], true);
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

        if ($user->role === 'admin') {
            return $query;
        }

        if ($user->role === 'manager') {
            $managedGroupIds = $this->managedGroupIds($user);
            if (!empty($managedGroupIds)) {
                return $query->whereIn('id', $managedGroupIds);
            }

            return $query->whereHas('users', fn (Builder $builder) => $builder->whereKey($user->id));
        }

        if ($user->role === 'employee') {
            return $query->whereHas('users', fn (Builder $builder) => $builder->whereKey($user->id));
        }

        return Group::query()->whereRaw('1 = 0');
    }

    public function manageableGroupsQuery(?User $user): Builder
    {
        if (!$user || !$user->organization_id || !$this->canManageTasks($user)) {
            return Group::query()->whereRaw('1 = 0');
        }

        if ($user->role === 'admin') {
            return Group::query()
                ->where('organization_id', $user->organization_id)
                ->where('is_active', true);
        }

        if ($user->role === 'manager') {
            $managedGroupIds = $this->managedGroupIds($user);
            if (!empty($managedGroupIds)) {
                return Group::query()
                    ->where('organization_id', $user->organization_id)
                    ->where('is_active', true)
                    ->whereIn('id', $managedGroupIds);
            }
        }

        if ($user->role === 'manager') {
            $managedGroupIds = $this->managedGroupIds($user);
            if (!empty($managedGroupIds)) {
                return Group::query()
                    ->where('organization_id', $user->organization_id)
                    ->where('is_active', true)
                    ->whereIn('id', $managedGroupIds);
            }
        }

        return Group::query()->whereRaw('1 = 0');
    }

    public function visibleGroupIds(?User $user): ?array
    {
        if (!$user || !$user->organization_id) {
            return [];
        }

        if ($user->role === 'admin') {
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

        if ($user->role === 'admin') {
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

        if ($user->role === 'admin') {
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

        if ($user->role === 'admin') {
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

        if ($user->role === 'employee') {
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

        if ($user->role === 'admin') {
            return (
                $task->group && (int) $task->group->organization_id === (int) $user->organization_id
            ) || (
                !$task->group && $task->project && (int) $task->project->organization_id === (int) $user->organization_id
            );
        }

        if ($task->group === null || !$this->canAccessGroup($user, $task->group)) {
            return false;
        }

        if ($user->role === 'employee') {
            return $task->assignee_id === null
                || (int) $task->assignee_id === (int) $user->id
                || $task->assignees()->where('users.id', $user->id)->exists();
        }

        return true;
    }
}
