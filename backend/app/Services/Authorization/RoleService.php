<?php

namespace App\Services\Authorization;

use App\Models\Organization;
use App\Models\Permission;
use App\Models\Role;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class RoleService
{
    public function listRoles(Organization $org): Collection
    {
        return Role::where('organization_id', $org->id)
            ->orderBy('is_system', 'desc')
            ->orderBy('hierarchy_level')
            ->orderBy('name')
            ->with('permissions')
            ->withCount('users')
            ->get();
    }

    public function createRole(Organization $org, array $data, array $permissionKeys = []): Role
    {
        $slug = Str::slug($data['name']);
        $baseSlug = $slug;
        $counter = 1;
        while (Role::where('organization_id', $org->id)->where('slug', $slug)->exists()) {
            $slug = $baseSlug . '-' . $counter++;
        }

        $role = Role::create([
            'organization_id' => $org->id,
            'name' => $data['name'],
            'slug' => $slug,
            'description' => $data['description'] ?? null,
            'hierarchy_level' => $data['hierarchy_level'] ?? 100,
            'is_system' => false,
            'is_active' => true,
        ]);

        if (!empty($permissionKeys)) {
            $permIds = Permission::whereIn('key', $permissionKeys)->pluck('id');
            $role->permissions()->attach($permIds);
        }

        return $role->load('permissions');
    }

    public function updateRole(Role $role, array $data, ?array $permissionKeys = null): Role
    {
        $role->update([
            'name' => $data['name'] ?? $role->name,
            'description' => array_key_exists('description', $data) ? $data['description'] : $role->description,
            'hierarchy_level' => $data['hierarchy_level'] ?? $role->hierarchy_level,
            'is_active' => $data['is_active'] ?? $role->is_active,
        ]);

        if ($permissionKeys !== null) {
            $permIds = Permission::whereIn('key', $permissionKeys)->pluck('id');
            $role->permissions()->sync($permIds);
        }

        return $role->fresh('permissions');
    }

    public function deleteRole(Role $role): void
    {
        if ($role->is_system) {
            throw new \RuntimeException('System roles cannot be deleted.');
        }

        DB::transaction(function () use ($role) {
            User::where('role_id', $role->id)->update(['role_id' => null]);
            $role->delete();
        });
    }

    public function assignRole(User $user, ?int $roleId): void
    {
        if ($roleId === null) {
            $user->update(['role_id' => null]);
            return;
        }

        $role = Role::find($roleId);
        if (!$role) {
            throw new \Illuminate\Database\Eloquent\ModelNotFoundException('Role not found');
        }

        if ((int) $role->organization_id !== (int) $user->organization_id) {
            throw new \Illuminate\Auth\Access\AuthorizationException('Role does not belong to the user organization');
        }

        $user->update(['role_id' => $roleId]);
    }

    public function getRoleUsers(Role $role): Collection
    {
        return User::where('role_id', $role->id)->get();
    }

    public function getAvailablePermissions(Organization $org): Collection
    {
        $planFeature = $org->plan_code ?? 'basic';
        $planFeatureMap = [
            'basic' => ['desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop', 'screenshot', 'screenshot_history', 'reports', 'csv_export', 'user_management', 'overtime', 'approval_workflow', 'overtime_history', 'workspace_onboarding', 'multi_role_access'],
            'advanced_tracker' => ['desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop', 'screenshot', 'screenshot_history', 'reports', 'csv_export', 'user_management', 'overtime', 'approval_workflow', 'overtime_history', 'workspace_onboarding', 'multi_role_access', 'chat', 'geo_fencing', 'leave_management', 'employee_timeline', 'project_tracking', 'task_tracking', 'monitoring'],
            'enterprise' => ['desktop_timer', 'check_in_out', 'idle_detection', 'auto_stop', 'screenshot', 'screenshot_history', 'reports', 'csv_export', 'user_management', 'overtime', 'approval_workflow', 'overtime_history', 'workspace_onboarding', 'multi_role_access', 'chat', 'geo_fencing', 'leave_management', 'employee_timeline', 'project_tracking', 'task_tracking', 'monitoring'],
        ];

        $enabledFeatures = $planFeatureMap[$planFeature] ?? $planFeatureMap['basic'];

        return Permission::query()
            ->where(function ($query) use ($enabledFeatures) {
                $query->whereNull('plan_feature')
                    ->orWhereIn('plan_feature', $enabledFeatures);
            })
            ->get()
            ->values();
    }
}
