<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Services\Authorization\RoleService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class PermissionController extends Controller
{
    public function __construct(
        private readonly RoleService $roleService,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $user = $request->user();
        if (!$user || !$user->organization_id) {
            return response()->json(['message' => 'Unauthorized'], 403);
        }

        $permissions = $this->roleService->getAvailablePermissions($user->organization);

        $grouped = $permissions->groupBy('group_name')->map(function ($perms, $group) {
            return [
                'group' => $group,
                'permissions' => $perms->map(fn($p) => [
                    'key' => $p->key,
                    'name' => $p->name,
                    'description' => $p->description,
                    'plan_feature' => $p->plan_feature,
                ])->values(),
            ];
        })->values();

        return response()->json(['data' => $grouped]);
    }
}
