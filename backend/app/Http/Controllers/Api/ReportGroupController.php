<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Api\Concerns\InteractsWithApiResponses;
use App\Http\Controllers\Controller;
use App\Http\Requests\Api\ReportGroups\StoreReportGroupRequest;
use App\Models\EmployeeWorkInfo;
use App\Http\Requests\Api\ReportGroups\UpdateReportGroupRequest;
use App\Models\Group;
use App\Models\User;
use App\Services\Authorization\GroupAccessService;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class ReportGroupController extends Controller
{
    use InteractsWithApiResponses;

    public function __construct(
        private readonly GroupAccessService $groupAccessService,
    ) {
    }

    public function index(Request $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['data' => []]);
        }

        $groups = $this->groupAccessService
            ->visibleGroupsQuery($currentUser)
            ->with(['users:id,name,email,role'])
            ->withCount('tasks')
            ->orderBy('name')
            ->get();

        return response()->json(['data' => $groups]);
    }

    public function store(StoreReportGroupRequest $request)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required'], 422);
        }
        if (!$this->groupAccessService->canManageGroups($currentUser)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $this->assertUniqueGroupName($currentUser->organization_id, (string) $request->name);

        $group = Group::create([
            'organization_id' => $currentUser->organization_id,
            'name' => trim((string) $request->name),
            'slug' => $this->uniqueSlug($currentUser->organization_id, (string) $request->name),
            'description' => $request->input('description'),
            'is_active' => $request->boolean('is_active', true),
        ]);

        $userIds = $this->resolveOrgUserIds($currentUser->organization_id, $request->input('user_ids', []));
        $this->assertAssignableUsersForGroup($currentUser->organization_id, $userIds, null);
        if ($currentUser->role === 'manager' && !in_array((int) $currentUser->id, $userIds, true)) {
            $userIds[] = (int) $currentUser->id;
        }
        $group->users()->sync($userIds);
        $this->syncEmployeesForGroup((int) $currentUser->organization_id, (int) $group->id);

        return $this->createdResponse($group->load(['users:id,name,email,role'])->loadCount('tasks')->toArray(), 'Group created.');
    }

    public function show(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required'], 422);
        }

        $group = Group::query()
            ->with(['users:id,name,email,role'])
            ->withCount('tasks')
            ->where('organization_id', $currentUser->organization_id)
            ->find($id);

        if (!$group) {
            return response()->json(['message' => 'Group not found'], 404);
        }

        if (!$this->groupAccessService->canAccessGroup($currentUser, $group)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return response()->json($group);
    }

    public function update(UpdateReportGroupRequest $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required'], 422);
        }
        $group = Group::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$group) {
            return response()->json(['message' => 'Group not found'], 404);
        }

        if (!$this->groupAccessService->canManageGroup($currentUser, $group)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        if ($request->filled('name')) {
            $this->assertUniqueGroupName(
                $currentUser->organization_id,
                (string) $request->name,
                (int) $group->id,
            );
            $group->name = trim((string) $request->name);
            $group->slug = $this->uniqueSlug($currentUser->organization_id, (string) $request->name, (int) $group->id);
        }

        if ($request->exists('description')) {
            $group->description = $request->input('description');
        }

        if ($request->exists('is_active')) {
            $group->is_active = $request->boolean('is_active');
        }

        if ($group->isDirty()) {
            $group->save();
        }

        if ($request->has('user_ids')) {
            $userIds = $this->resolveOrgUserIds($currentUser->organization_id, $request->input('user_ids', []));
            $this->assertAssignableUsersForGroup($currentUser->organization_id, $userIds, (int) $group->id);
            $group->users()->sync($userIds);
            $this->syncEmployeesForGroup((int) $currentUser->organization_id, (int) $group->id);
        }

        return $this->updatedResponse($group->fresh()->load(['users:id,name,email,role'])->loadCount('tasks')->toArray(), 'Group updated.');
    }

    public function destroy(Request $request, int $id)
    {
        $currentUser = $request->user();
        if (!$currentUser || !$currentUser->organization_id) {
            return response()->json(['message' => 'Organization is required'], 422);
        }
        $group = Group::where('organization_id', $currentUser->organization_id)->find($id);
        if (!$group) {
            return response()->json(['message' => 'Group not found'], 404);
        }

        if (!$this->groupAccessService->canManageGroup($currentUser, $group)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $group->delete();

        return $this->deletedResponse('Group deleted');
    }

    private function assertUniqueGroupName(int $organizationId, string $name, ?int $ignoreId = null): void
    {
        $exists = Group::query()
            ->where('organization_id', $organizationId)
            ->whereRaw('LOWER(name) = ?', [mb_strtolower(trim($name))])
            ->when($ignoreId, fn ($query) => $query->where('id', '!=', $ignoreId))
            ->exists();

        if ($exists) {
            throw ValidationException::withMessages([
                'name' => ['A group with this name already exists.'],
            ]);
        }
    }

    private function uniqueSlug(int $organizationId, string $name, ?int $ignoreId = null): string
    {
        $baseSlug = Str::slug($name) ?: 'group';
        $slug = $baseSlug;
        $suffix = 2;

        while (
            Group::query()
                ->where('organization_id', $organizationId)
                ->where('slug', $slug)
                ->when($ignoreId, fn ($query) => $query->where('id', '!=', $ignoreId))
                ->exists()
        ) {
            $slug = sprintf('%s-%d', $baseSlug, $suffix);
            $suffix++;
        }

        return $slug;
    }

    private function resolveOrgUserIds(int $organizationId, array $ids): array
    {
        $cleanIds = collect($ids)->map(fn ($id) => (int) $id)->filter(fn ($id) => $id > 0)->unique()->values();

        if ($cleanIds->isEmpty()) {
            return [];
        }

        return User::where('organization_id', $organizationId)
            ->whereIn('id', $cleanIds)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->values()
            ->all();
    }

    private function assertAssignableUsersForGroup(int $organizationId, array $userIds, ?int $currentGroupId): void
    {
        if (empty($userIds)) {
            return;
        }

        $conflictingUser = User::query()
            ->where('organization_id', $organizationId)
            ->whereIn('id', $userIds)
            ->whereIn('role', ['manager', 'employee'])
            ->whereHas('groups', function ($query) use ($currentGroupId) {
                if ($currentGroupId) {
                    $query->where('groups.id', '!=', $currentGroupId);
                    return;
                }

                $query->whereNotNull('groups.id');
            })
            ->first(['id', 'name', 'role']);

        if (! $conflictingUser) {
            return;
        }

        throw ValidationException::withMessages([
            'user_ids' => [sprintf(
                '%s is already assigned to another group. Move %s instead of adding to multiple groups.',
                $conflictingUser->name,
                $conflictingUser->role === 'manager' ? 'this manager' : 'this employee'
            )],
        ]);
    }

    private function resolveGroupManagerId(int $organizationId, int $groupId): ?int
    {
        return User::query()
            ->where('organization_id', $organizationId)
            ->where('role', 'manager')
            ->whereHas('groups', fn ($query) => $query->where('groups.id', $groupId))
            ->orderBy('name')
            ->value('id');
    }

    private function syncEmployeesForGroup(int $organizationId, int $groupId): void
    {
        $managerId = $this->resolveGroupManagerId($organizationId, $groupId);
        $employeeIds = User::query()
            ->where('organization_id', $organizationId)
            ->where('role', 'employee')
            ->whereHas('groups', fn ($query) => $query->where('groups.id', $groupId))
            ->pluck('id');

        foreach ($employeeIds as $employeeId) {
            EmployeeWorkInfo::query()->updateOrCreate(
                [
                    'organization_id' => $organizationId,
                    'user_id' => (int) $employeeId,
                ],
                [
                    'report_group_id' => $groupId,
                    'reporting_manager_id' => $managerId,
                ]
            );
        }
    }
}
