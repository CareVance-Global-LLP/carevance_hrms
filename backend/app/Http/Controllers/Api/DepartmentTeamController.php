<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\DepartmentTeam;
use App\Models\Group;
use App\Models\User;
use App\Services\Authorization\GroupAccessService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

class DepartmentTeamController extends Controller
{
    public function __construct(
        private readonly GroupAccessService $groupAccessService,
    ) {
    }

    private function levelOf(User $user): int
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
     * Load the department (group) for the current org and ensure the caller
     * may manage it. Returns the Group or a JsonResponse on error.
     */
    private function resolveDepartment(Request $request, int $departmentId): Group|JsonResponse
    {
        $user = $request->user();
        $group = Group::query()
            ->where('organization_id', $user->organization_id)
            ->find($departmentId);

        if (!$group) {
            return response()->json(['message' => 'Department not found.'], 404);
        }

        if (!$this->groupAccessService->canManageGroup($user, $group)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return $group;
    }

    private function teamWithRelations(DepartmentTeam $team): DepartmentTeam
    {
        $team->load([
            'members:id,name,email',
            'managers:id,name,email',
        ]);

        $team->setAttribute('member_ids', $team->members->pluck('id')->all());
        $team->setAttribute('manager_ids', $team->managers->pluck('id')->all());

        return $team;
    }

    public function index(Request $request, int $departmentId): JsonResponse
    {
        $group = $this->resolveDepartment($request, $departmentId);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $teams = DepartmentTeam::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('department_id', $group->id)
            ->with(['members:id,name,email', 'managers:id,name,email'])
            ->orderBy('name')
            ->get();

        $teams->each(fn (DepartmentTeam $team) => $this->teamWithRelations($team));

        return response()->json(['data' => $teams]);
    }

    public function store(Request $request, int $departmentId): JsonResponse
    {
        $group = $this->resolveDepartment($request, $departmentId);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $validated = $request->validate([
            'name' => 'required|string|max:255',
            'description' => 'nullable|string|max:2000',
            'member_ids' => 'nullable|array',
            'member_ids.*' => 'integer|exists:users,id',
            'manager_ids' => 'nullable|array',
            'manager_ids.*' => 'integer|exists:users,id',
        ]);

        $slug = Str::slug($validated['name']);
        $uniqueSlug = $this->uniqueSlug($request->user()->organization_id, $group->id, $slug);

        $team = DepartmentTeam::create([
            'organization_id' => $request->user()->organization_id,
            'department_id' => $group->id,
            'name' => $validated['name'],
            'slug' => $uniqueSlug,
            'description' => $validated['description'] ?? null,
        ]);

        if (!empty($validated['member_ids'])) {
            $team->members()->syncWithoutDetaching($this->orgUserIds($request, $validated['member_ids']));
        }

        if (!empty($validated['manager_ids'])) {
            $team->managers()->syncWithoutDetaching($this->orgUserIds($request, $validated['manager_ids']));
        }

        return response()->json(['data' => $this->teamWithRelations($team->fresh())], 201);
    }

    public function update(Request $request, int $departmentId, int $teamId): JsonResponse
    {
        $group = $this->resolveDepartment($request, $departmentId);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $team = $this->findTeam($request, $group, $teamId);
        if ($team instanceof JsonResponse) {
            return $team;
        }

        $validated = $request->validate([
            'name' => 'sometimes|required|string|max:255',
            'description' => 'nullable|string|max:2000',
        ]);

        if (isset($validated['name'])) {
            $team->name = $validated['name'];
            $team->slug = $this->uniqueSlug(
                $request->user()->organization_id,
                $group->id,
                Str::slug($validated['name']),
                $team->id
            );
        }

        if (array_key_exists('description', $validated)) {
            $team->description = $validated['description'];
        }

        $team->save();

        return response()->json(['data' => $this->teamWithRelations($team->fresh())]);
    }

    public function destroy(Request $request, int $departmentId, int $teamId): JsonResponse
    {
        $group = $this->resolveDepartment($request, $departmentId);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $team = $this->findTeam($request, $group, $teamId);
        if ($team instanceof JsonResponse) {
            return $team;
        }

        $team->delete();

        return response()->json(['message' => 'Team deleted.']);
    }

    public function addMembers(Request $request, int $departmentId, int $teamId): JsonResponse
    {
        $resolution = $this->resolveTeamForMemberEdit($request, $departmentId, $teamId);
        if ($resolution instanceof JsonResponse) {
            return $resolution;
        }
        $team = $resolution;

        $validated = $request->validate([
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
        ]);

        // Unlimited membership: a user may belong to any number of teams.
        $team->members()->syncWithoutDetaching($this->orgUserIds($request, $validated['user_ids']));

        return response()->json(['data' => $this->teamWithRelations($team->fresh())]);
    }

    public function removeMember(Request $request, int $departmentId, int $teamId, int $userId): JsonResponse
    {
        $resolution = $this->resolveTeamForMemberEdit($request, $departmentId, $teamId);
        if ($resolution instanceof JsonResponse) {
            return $resolution;
        }
        $team = $resolution;

        $team->members()->detach($userId);

        return response()->json(['data' => $this->teamWithRelations($team->fresh())]);
    }

    public function addManagers(Request $request, int $departmentId, int $teamId): JsonResponse
    {
        $group = $this->resolveDepartment($request, $departmentId);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $team = $this->findTeam($request, $group, $teamId);
        if ($team instanceof JsonResponse) {
            return $team;
        }

        $validated = $request->validate([
            'user_ids' => 'required|array|min:1',
            'user_ids.*' => 'integer|exists:users,id',
        ]);

        $candidateIds = $this->orgUserIds($request, $validated['user_ids']);

        // A team manager must be a "higher up" (manager/admin), never a plain employee.
        $invalid = User::query()
            ->whereIn('id', $candidateIds)
            ->get()
            ->filter(fn (User $u) => $this->levelOf($u) >= 100)
            ->pluck('id')
            ->all();

        if (!empty($invalid)) {
            throw ValidationException::withMessages([
                'user_ids' => ['Only managers or admins (higher-ups) can be assigned as team managers.'],
            ]);
        }

        // Unlimited managers per team.
        $team->managers()->syncWithoutDetaching($candidateIds);

        return response()->json(['data' => $this->teamWithRelations($team->fresh())]);
    }

    public function removeManager(Request $request, int $departmentId, int $teamId, int $userId): JsonResponse
    {
        $group = $this->resolveDepartment($request, $departmentId);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $team = $this->findTeam($request, $group, $teamId);
        if ($team instanceof JsonResponse) {
            return $team;
        }

        $team->managers()->detach($userId);

        return response()->json(['data' => $this->teamWithRelations($team->fresh())]);
    }

    /**
     * Member edits are allowed by department managers/admins OR by any manager
     * of this specific team.
     */
    private function resolveTeamForMemberEdit(Request $request, int $departmentId, int $teamId): DepartmentTeam|JsonResponse
    {
        $group = $this->resolveDepartment($request, $departmentId);
        if ($group instanceof JsonResponse) {
            return $group;
        }

        $team = $this->findTeam($request, $group, $teamId);
        if ($team instanceof JsonResponse) {
            return $team;
        }

        $user = $request->user();
        $isTeamManager = $team->managers()
            ->where('user_id', $user->id)
            ->exists();

        if (!$isTeamManager && !$this->groupAccessService->canManageGroup($user, $group)) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        return $team;
    }

    private function findTeam(Request $request, Group $group, int $teamId): DepartmentTeam|JsonResponse
    {
        $team = DepartmentTeam::query()
            ->where('organization_id', $request->user()->organization_id)
            ->where('department_id', $group->id)
            ->find($teamId);

        if (!$team) {
            return response()->json(['message' => 'Team not found.'], 404);
        }

        return $team;
    }

    private function orgUserIds(Request $request, array $ids): array
    {
        return User::query()
            ->where('organization_id', $request->user()->organization_id)
            ->whereIn('id', $ids)
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->all();
    }

    private function uniqueSlug(int $organizationId, int $departmentId, string $slug, ?int $ignoreTeamId = null): string
    {
        $base = $slug ?: 'team';
        $candidate = $base;
        $counter = 1;

        while (DepartmentTeam::query()
            ->where('organization_id', $organizationId)
            ->where('department_id', $departmentId)
            ->where('slug', $candidate)
            ->when($ignoreTeamId, fn ($q) => $q->where('id', '!=', $ignoreTeamId))
            ->exists()
        ) {
            $candidate = $base . '-' . $counter;
            $counter++;
        }

        return $candidate;
    }
}
