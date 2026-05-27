<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\Role;
use App\Models\User;
use App\Services\Authorization\RoleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Throwable;

class RoleController extends Controller
{
    public function __construct(
        private readonly RoleService $roleService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        try {
            $user = $request->user();
            if (!$user || !$user->organization_id) {
                return response()->json(['message' => 'Unauthorized'], 403);
            }

            $org = $user->organization;
            $roles = $this->roleService->listRoles($org);

            return response()->json([
                'data' => $roles->map(fn(Role $role) => $this->serializeRole($role)),
            ]);
        } catch (Throwable $e) {
            Log::error('Role list failed', ['message' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to load roles'], 500);
        }
    }

    public function store(Request $request): JsonResponse
    {
        try {
            $user = $request->user();
            if (!$user || !$user->hasPermission('roles.manage')) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $validated = $request->validate([
                'name' => 'required|string|max:100',
                'description' => 'nullable|string|max:500',
                'hierarchy_level' => 'required|integer|min:1|max:999',
                'permissions' => 'nullable|array',
                'permissions.*' => 'string|max:100',
            ]);

            $role = $this->roleService->createRole(
                $user->organization,
                $validated,
                $validated['permissions'] ?? [],
            );

            return response()->json(['data' => $this->serializeRole($role)], 201);
        } catch (Throwable $e) {
            Log::error('Role create failed', ['message' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to create role'], 500);
        }
    }

    public function show(Request $request, Role $role): JsonResponse
    {
        $user = $request->user();
        if (!$user || $role->organization_id !== $user->organization_id) {
            return response()->json(['message' => 'Forbidden'], 403);
        }

        $role->load('permissions');
        return response()->json(['data' => $this->serializeRole($role)]);
    }

    public function update(Request $request, Role $role): JsonResponse
    {
        try {
            $user = $request->user();
            if (!$user || !$user->hasPermission('roles.manage') || $role->organization_id !== $user->organization_id) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            if ($role->is_system) {
                $validated = $request->validate([
                    'name' => 'sometimes|string|max:100',
                    'description' => 'nullable|string|max:500',
                    'permissions' => 'nullable|array',
                    'permissions.*' => 'string|max:100',
                ]);
            } else {
                $validated = $request->validate([
                    'name' => 'sometimes|string|max:100',
                    'description' => 'nullable|string|max:500',
                    'hierarchy_level' => 'sometimes|integer|min:1|max:999',
                    'is_active' => 'sometimes|boolean',
                    'permissions' => 'nullable|array',
                    'permissions.*' => 'string|max:100',
                ]);
            }

            $role = $this->roleService->updateRole($role, $validated, $validated['permissions'] ?? null);

            return response()->json(['data' => $this->serializeRole($role)]);
        } catch (Throwable $e) {
            Log::error('Role update failed', ['message' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to update role'], 500);
        }
    }

    public function destroy(Request $request, Role $role): JsonResponse
    {
        try {
            $user = $request->user();
            if (!$user || !$user->hasPermission('roles.manage') || $role->organization_id !== $user->organization_id) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $this->roleService->deleteRole($role);

            return response()->json(['message' => 'Role deleted']);
        } catch (\RuntimeException $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        } catch (Throwable $e) {
            Log::error('Role delete failed', ['message' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to delete role'], 500);
        }
    }

    public function assignUser(Request $request): JsonResponse
    {
        try {
            $user = $request->user();
            if (!$user || !$user->hasPermission('employees.manage')) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            $validated = $request->validate([
                'user_id' => 'required|integer|exists:users,id',
                'role_id' => 'nullable|integer|exists:roles,id',
            ]);

            $targetUser = User::findOrFail($validated['user_id']);
            if ($targetUser->organization_id !== $user->organization_id) {
                return response()->json(['message' => 'Forbidden'], 403);
            }

            if ($validated['role_id']) {
                $role = Role::findOrFail($validated['role_id']);
                if ($role->organization_id !== $user->organization_id) {
                    return response()->json(['message' => 'Forbidden'], 403);
                }
            }

            $this->roleService->assignRole($targetUser, $validated['role_id']);

            return response()->json(['message' => 'Role assigned']);
        } catch (Throwable $e) {
            Log::error('Role assign failed', ['message' => $e->getMessage()]);
            return response()->json(['message' => 'Failed to assign role'], 500);
        }
    }

    private function serializeRole(Role $role): array
    {
        return [
            'id' => $role->id,
            'name' => $role->name,
            'slug' => $role->slug,
            'description' => $role->description,
            'hierarchy_level' => $role->hierarchy_level,
            'is_system' => $role->is_system,
            'is_active' => $role->is_active,
            'users_count' => $role->users_count ?? User::where('role_id', $role->id)->count(),
            'permissions' => $role->relationLoaded('permissions')
                ? $role->permissions->pluck('key')->values()->all()
                : [],
            'created_at' => $role->created_at?->toIso8601String(),
            'updated_at' => $role->updated_at?->toIso8601String(),
        ];
    }
}
