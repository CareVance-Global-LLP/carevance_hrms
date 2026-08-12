<?php

namespace App\Support;

use Illuminate\Support\Str;

/**
 * Human-readable names for the built-in role slugs.
 *
 * The slugs are snake_case identifiers, so the obvious `ucfirst($role)` puts
 * "Super_admin" and "Hr" in front of a recipient — which is exactly what the
 * invitation email used to do. Anything that shows a role to a person should
 * come through here.
 *
 * The slug list matches `User::hierarchyLevel()`; an organisation's own custom
 * roles carry their own display name and never reach this map, so an unknown
 * slug is title-cased rather than replaced with a generic label.
 */
class RoleLabel
{
    private const LABELS = [
        'super_admin' => 'Super Admin',
        'admin' => 'Admin',
        'hr' => 'HR',
        'payroll_manager' => 'Payroll Manager',
        'manager' => 'Manager',
        'employee' => 'Employee',
    ];

    public static function for(?string $role, string $fallback = 'Team member'): string
    {
        $role = trim((string) $role);

        if ($role === '') {
            return $fallback;
        }

        return self::LABELS[$role] ?? Str::headline($role);
    }
}
