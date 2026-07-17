import type { User } from '../types';

/**
 * Single source of truth for role/permission gating on mobile.
 *
 * Mobile previously gated manager/admin UI with plain string checks against
 * `user.role` (e.g. `user?.role === 'admin' || 'manager' || 'super_admin'`).
 * The web app instead gates on `hierarchy_level`, which is the only signal
 * that reflects custom roles: a custom role user has `role='employee'` in the
 * DB but a real `hierarchy_level` set via `role_id`. A custom role with an
 * elevated hierarchy (e.g. level 10) is admin-equivalent on web but invisible
 * to the old string-only checks, so the approval inbox would be hidden from
 * legitimately elevated users.
 *
 * This helper mirrors the web's resolution exactly (see frontend/src/App.tsx
 * and frontend/src/lib/permissions.ts):
 *   hierarchy_level ?? (admin ? 10 : manager ? 50 : employee ? 100 : 999)
 * and treats any resolved level < 100 as elevated (manager/admin capable).
 */

const DEFAULT_LEVEL_BY_ROLE: Record<string, number> = {
  admin: 10,
  super_admin: 10,
  manager: 50,
  employee: 100,
};

export function resolveHierarchyLevel(user: Pick<User, 'role' | 'hierarchy_level'> | null | undefined): number {
  if (!user) return 999;
  if (user.hierarchy_level !== null && user.hierarchy_level !== undefined) {
    return user.hierarchy_level;
  }
  const role = (user.role || '').toLowerCase();
  if (role in DEFAULT_LEVEL_BY_ROLE) return DEFAULT_LEVEL_BY_ROLE[role];
  return 999;
}

/** Elevated = hierarchy_level < 100 (admin/manager, including elevated custom roles). */
export function isElevated(user: Pick<User, 'role' | 'hierarchy_level'> | null | undefined): boolean {
  return resolveHierarchyLevel(user) < 100;
}

/** Web-equivalent of the old `isManager`/`canApprove` string checks. */
export function isManager(user: Pick<User, 'role' | 'hierarchy_level'> | null | undefined): boolean {
  return isElevated(user);
}

/** Mobile approval-inbox capability: same as isManager on web. */
export function canApprove(user: Pick<User, 'role' | 'hierarchy_level'> | null | undefined): boolean {
  return isElevated(user);
}
