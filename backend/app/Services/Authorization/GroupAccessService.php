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
        $teamDepartmentIds = $this->teamDepartmentIds($user);

        if (!empty($managedGroupIds) || !empty($teamDepartmentIds)) {
            $allowed = collect([...$managedGroupIds, ...$teamDepartmentIds])
                ->unique()
                ->values()
                ->all();

            return $query->whereIn('id', $allowed);
        }

        return $query->whereHas('users', fn (Builder $builder) => $builder->whereKey($user->id));
    }

    /**
     * Department IDs a user belongs to via a team membership. Team members can
     * view department-scoped tasks even if they are not direct department members.
     *
     * @return array<int>
     */
    private function teamDepartmentIds(User $user): array
    {
        if (!$user->organization_id) {
            return [];
        }

        return \App\Models\DepartmentTeam::query()
            ->where('organization_id', $user->organization_id)
            ->whereHas('members', fn (Builder $builder) => $builder->where('users.id', $user->id))
            ->pluck('department_id')
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values()
            ->all();
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
            /*
             * Tasks reach a user two ways: through a group, or through a
             * project. This used to filter on group_id alone, and `whereIn`
             * never matches NULL — so once tasks moved onto projects, every
             * non-admin saw nothing. Measured 17 Aug 2026: all 54 tasks had
             * group_id NULL, and an employee with three assigned to him could
             * open none of them. Admins were unaffected because their branch
             * above already carries the group-less fallback, which is why this
             * looked like a working feature to whoever tested it.
             *
             * A group-less task is visible when its project belongs to the
             * user's organisation AND the user is on that project — the same
             * shape as group membership, so this widens the scope to reach
             * project work without handing every task to everyone.
             */
            $query->where(function (Builder $builder) use ($visibleGroupIds, $user) {
                if (!empty($visibleGroupIds)) {
                    $builder->whereIn('group_id', $visibleGroupIds);
                }

                $builder->orWhere(function (Builder $projectQuery) use ($user) {
                    $projectQuery->whereNull('group_id')
                        ->whereHas('project', fn (Builder $project) => $project->where('organization_id', $user->organization_id))
                        /*
                         * Reached either by being on the project, or by the
                         * task being yours. Project membership alone was not
                         * enough: test7 is the assignee on three tasks but a
                         * member of only one of their projects, so two tasks
                         * with his name on them stayed invisible to him.
                         */
                        ->where(function (Builder $reach) use ($user) {
                            $reach->whereHas('project.assignedUsers', fn (Builder $member) => $member->where('users.id', $user->id))
                                ->orWhere('assignee_id', $user->id)
                                ->orWhereHas('assignees', fn (Builder $member) => $member->where('users.id', $user->id));
                        });
                });
            });
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
