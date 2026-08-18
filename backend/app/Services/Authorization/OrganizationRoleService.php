<?php

namespace App\Services\Authorization;

    use App\Models\Role;
    use App\Models\User;
    use Illuminate\Database\Eloquent\Collection;
    use Illuminate\Validation\ValidationException;

class OrganizationRoleService
{
    public function isOwner(?User $user): bool
    {
        if (!$user || !$user->organization_id) {
            return false;
        }

        $organization = $user->relationLoaded('organization')
            ? $user->organization
            : $user->organization()->first();

        return (int) ($organization?->owner_user_id ?? 0) === (int) $user->id;
    }

    public function allowedAssignableRoles(?User $user): array
    {
        if (!$user || !$user->organization_id) {
            return [];
        }

        /*
         * Nobody hands out a role at or above their own.
         *
         * This gated the full list on `employees.manage` alone — a permission
         * PERMISSIONS_MANAGER grants to every manager — so a manager could
         * invite an ADMIN, and the `employees.edit` branch below was
         * unreachable for them. Escalation by invitation, and it made the
         * narrower branch dead code.
         *
         * Hierarchy is the check that actually expresses the rule; the
         * permission still has to be present as well.
         */
        if ($this->isOwner($user) || ($user->hasPermission('employees.manage') && $user->getHierarchyLevel() <= 10)) {
            return ['admin', 'manager', 'employee', 'client'];
        }

        if (
            ($user->hasPermission('employees.edit') || $user->hasPermission('employees.manage'))
            && config('carevance.manager_can_invite_employees', true)
        ) {
            return ['employee'];
        }

        return [];
    }

    public function allowedAssignableRoleIds(User $user): Collection
    {
        // Mirrors allowedAssignableRoles above; see the reasoning there.
        if ($this->isOwner($user) || ($user->hasPermission('employees.manage') && $user->getHierarchyLevel() <= 10)) {
            return Role::where('organization_id', $user->organization_id)
                ->where('is_active', true)
                ->whereIn('slug', ['admin', 'manager', 'employee', 'client'])
                ->orderBy('hierarchy_level')
                ->get();
        }

        if (
            ($user->hasPermission('employees.edit') || $user->hasPermission('employees.manage'))
            && config('carevance.manager_can_invite_employees', true)
        ) {
            return Role::where('organization_id', $user->organization_id)
                ->where('is_active', true)
                ->where('slug', 'employee')
                ->orderBy('hierarchy_level')
                ->get();
        }

        return new Collection();
    }

    public function assertCanAssignRole(User $actor, string $role, string $field = 'role'): void
    {
        if (!in_array($role, $this->allowedAssignableRoles($actor), true)) {
            throw ValidationException::withMessages([
                $field => ['You are not allowed to assign this role.'],
            ]);
        }
    }

    public function canManageUsers(?User $user): bool
    {
        return !empty($this->allowedAssignableRoles($user));
    }
}
