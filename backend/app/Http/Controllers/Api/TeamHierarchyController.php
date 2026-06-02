<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Group;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TeamHierarchyController extends Controller
{
    private const MAX_ANCESTOR_DEPTH = 10;

    public function index(Request $request): JsonResponse
    {
        $currentUser = $request->user();

        if (! $currentUser || ! $currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required.'], 422);
        }

        $currentUser->loadMissing([
            'customRole',
            'employeeWorkInfo.department:id,name,slug',
            'groups:id,name,slug',
        ]);

        $userLevel = $currentUser->getHierarchyLevel();
        $isAdmin = $userLevel <= Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['admin'];
        $isManager = $userLevel < Organization::SYSTEM_ROLE_HIERARCHY_LEVELS['employee'];

        $primaryDepartment = $currentUser->employeeWorkInfo?->department;
        $primaryGroupId = (int) ($currentUser->employeeWorkInfo?->report_group_id ?? 0);

        $visibleGroupIds = $this->resolveVisibleGroupIds($currentUser, $isAdmin, $isManager, $primaryGroupId);

        $managedDepartments = $this->buildManagedDepartments($currentUser, $isAdmin, $isManager, $visibleGroupIds);

        $currentDepartmentPayload = $primaryDepartment ? $this->formatGroup($primaryDepartment) : null;

        $usersQuery = User::query()
            ->with([
                'groups:id,name,slug',
                'employeeWorkInfo.department:id,name,slug',
                'customRole',
            ])
            ->where('organization_id', $currentUser->organization_id);

        if (! $isAdmin) {
            if ($visibleGroupIds->isEmpty()) {
                $usersQuery->where('id', $currentUser->id);
            } else {
                $usersQuery->where(function ($query) use ($currentUser, $visibleGroupIds) {
                    $query->where('id', $currentUser->id)
                        ->orWhereHas('groups', fn ($g) => $g->whereIn('groups.id', $visibleGroupIds));
                });
            }
        }

        $users = $usersQuery->get();

        $managerUser = null;
        $managerId = (int) ($currentUser->employeeWorkInfo?->reporting_manager_id ?? 0);
        if ($managerId > 0) {
            $managerUser = $users->firstWhere('id', $managerId);
            if (! $managerUser) {
                $managerUser = User::query()
                    ->with(['customRole', 'employeeWorkInfo.department:id,name,slug', 'groups:id,name,slug'])
                    ->where('organization_id', $currentUser->organization_id)
                    ->where('id', $managerId)
                    ->first();
            }
        }

        $ancestors = $this->buildAncestorChain($managerUser, $currentUser, $users);

        $directReports = $users
            ->filter(fn (User $u) => (int) ($u->employeeWorkInfo?->reporting_manager_id ?? 0) === (int) $currentUser->id)
            ->values();

        $scoped = $users
            ->map(function (User $u) use ($currentUser) {
                $departmentName = (string) (
                    $u->employeeWorkInfo?->department?->name
                    ?? $u->groups->first()?->name
                    ?? ''
                );

                return [
                    'id' => (int) $u->id,
                    'name' => $u->name,
                    'email' => $u->email,
                    'avatar' => $u->avatar,
                    'role' => $u->role,
                    'role_id' => $u->role_id,
                    'role_name' => $u->customRole?->name ?? ucfirst((string) ($u->role ?? 'employee')),
                    'hierarchy_level' => $u->customRole?->hierarchy_level ?? $this->fallbackLevel($u->role),
                    'reporting_manager_id' => $u->employeeWorkInfo?->reporting_manager_id
                        ? (int) $u->employeeWorkInfo->reporting_manager_id
                        : null,
                    'designation' => $u->employeeWorkInfo?->designation,
                    'department' => trim($departmentName),
                    'department_id' => $u->employeeWorkInfo?->report_group_id
                        ? (int) $u->employeeWorkInfo->report_group_id
                        : null,
                    'groups' => $u->groups->map(fn (Group $g) => [
                        'id' => (int) $g->id,
                        'name' => $g->name,
                        'slug' => $g->slug,
                    ])->values(),
                    'is_self' => (int) $u->id === (int) $currentUser->id,
                ];
            })
            ->values();

        return response()->json([
            'current_user' => [
                'id' => (int) $currentUser->id,
                'name' => $currentUser->name,
                'email' => $currentUser->email,
                'avatar' => $currentUser->avatar,
                'role' => $currentUser->role,
                'role_id' => $currentUser->role_id,
                'role_name' => $currentUser->customRole?->name ?? ucfirst((string) ($currentUser->role ?? 'employee')),
                'hierarchy_level' => $currentUser->customRole?->hierarchy_level ?? $this->fallbackLevel($currentUser->role),
                'designation' => $currentUser->employeeWorkInfo?->designation,
                'department' => $currentDepartmentPayload,
            ],
            'manager' => $managerUser ? $this->formatPerson($managerUser) : null,
            'ancestors' => $ancestors,
            'direct_reports' => $directReports->map(fn (User $u) => $this->formatPerson($u))->values(),
            'direct_reports_count' => $directReports->count(),
            'department' => $currentDepartmentPayload,
            'managed_departments' => $managedDepartments,
            'scope' => [
                'is_admin' => $isAdmin,
                'is_manager' => $isManager,
                'level' => $userLevel,
                'total_members' => $scoped->count(),
            ],
            'members' => $scoped,
        ]);
    }

    private function resolveVisibleGroupIds(User $currentUser, bool $isAdmin, bool $isManager, int $primaryGroupId): \Illuminate\Support\Collection
    {
        if ($isAdmin) {
            return Group::query()
                ->where('organization_id', $currentUser->organization_id)
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->values();
        }

        if ($isManager) {
            $reportingGroupIds = \App\Models\EmployeeWorkInfo::query()
                ->where('organization_id', $currentUser->organization_id)
                ->where('reporting_manager_id', $currentUser->id)
                ->whereNotNull('report_group_id')
                ->pluck('report_group_id')
                ->map(fn ($id) => (int) $id)
                ->values();

            $memberGroupIds = $currentUser->groups()->pluck('groups.id')
                ->map(fn ($id) => (int) $id)
                ->values();

            $primaryFromWorkInfo = $primaryGroupId > 0
                ? collect([$primaryGroupId])
                : collect();

            return collect()
                ->concat($reportingGroupIds)
                ->concat($memberGroupIds)
                ->concat($primaryFromWorkInfo)
                ->unique()
                ->values();
        }

        if ($primaryGroupId > 0) {
            return collect([$primaryGroupId]);
        }

        $memberGroupIds = $currentUser->groups()->pluck('groups.id')
            ->map(fn ($id) => (int) $id)
            ->values();

        return $memberGroupIds;
    }

    private function buildManagedDepartments(User $currentUser, bool $isAdmin, bool $isManager, \Illuminate\Support\Collection $visibleGroupIds): array
    {
        $groupIds = $isAdmin
            ? Group::query()->where('organization_id', $currentUser->organization_id)->pluck('id')
            : $visibleGroupIds;

        if ($groupIds->isEmpty()) {
            return [];
        }

        return Group::query()
            ->whereIn('id', $groupIds)
            ->orderBy('name')
            ->get(['id', 'name', 'slug', 'description', 'is_active'])
            ->map(fn (Group $g) => [
                'id' => (int) $g->id,
                'name' => $g->name,
                'slug' => $g->slug,
                'description' => $g->description,
                'is_active' => (bool) $g->is_active,
                'is_primary' => (int) $g->id === (int) ($currentUser->employeeWorkInfo?->report_group_id ?? 0),
            ])
            ->values()
            ->all();
    }

    private function buildAncestorChain(?User $manager, User $currentUser, $users): array
    {
        if (! $manager) {
            return [];
        }

        $chain = [];
        $seen = [(int) $currentUser->id];
        $node = $manager;
        $depth = 0;

        while ($node && $depth < self::MAX_ANCESTOR_DEPTH) {
            $nodeId = (int) $node->id;
            if (in_array($nodeId, $seen, true)) {
                break;
            }
            $seen[] = $nodeId;
            $chain[] = $this->formatPerson($node);
            $parentId = (int) ($node->employeeWorkInfo?->reporting_manager_id ?? 0);
            if ($parentId <= 0) {
                break;
            }
            $node = $users->firstWhere('id', $parentId);
            if (! $node) {
                $node = User::query()
                    ->with(['customRole', 'employeeWorkInfo.department:id,name,slug', 'groups:id,name,slug'])
                    ->where('organization_id', $currentUser->organization_id)
                    ->where('id', $parentId)
                    ->first();
            }
            $depth++;
        }

        return $chain;
    }

    private function formatPerson(User $user): array
    {
        $departmentName = (string) (
            $user->employeeWorkInfo?->department?->name
            ?? $user->groups->first()?->name
            ?? ''
        );

        return [
            'id' => (int) $user->id,
            'name' => $user->name,
            'email' => $user->email,
            'avatar' => $user->avatar,
            'role' => $user->role,
            'role_id' => $user->role_id,
            'role_name' => $user->customRole?->name ?? ucfirst((string) ($user->role ?? 'employee')),
            'hierarchy_level' => $user->customRole?->hierarchy_level ?? $this->fallbackLevel($user->role),
            'designation' => $user->employeeWorkInfo?->designation,
            'department' => trim($departmentName) ?: null,
            'department_id' => $user->employeeWorkInfo?->report_group_id
                ? (int) $user->employeeWorkInfo->report_group_id
                : null,
        ];
    }

    private function formatGroup(Group $group): array
    {
        return [
            'id' => (int) $group->id,
            'name' => $group->name,
            'slug' => $group->slug,
        ];
    }

    private function fallbackLevel(?string $role): int
    {
        return match ($role) {
            'super_admin' => 0,
            'admin' => 10,
            'manager' => 50,
            'employee' => 100,
            default => 100,
        };
    }
}
