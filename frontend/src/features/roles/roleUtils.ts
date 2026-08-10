/* ────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────── */

export interface Role {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  hierarchy_level: number;
  color: string;
  is_system: boolean;
  is_active: boolean;
  users_count: number;
  permissions: string[];
}

export interface Permission {
  key: string;
  name: string;
  description: string | null;
  plan_feature: string | null;
}

export interface PermissionGroup {
  group: string;
  permissions: Permission[];
}

/** A role being created or edited. `id` is absent while creating. */
export type RoleDraft = Partial<Role> & { permissions: string[] };

/* ────────────────────────────────────────────────────────────────
   Rank
   ──────────────────────────────────────────────────────────────── */

export type RoleRank = 'owner' | 'senior' | 'mid' | 'member';

/**
 * Lower `hierarchy_level` means more authority — the anchors the product
 * documents are Admin 10, Manager 50, Employee 100. Bands are fixed rather
 * than derived from the current set of roles so a role does not silently
 * change colour when an unrelated role is added beside it.
 */
export const rankOf = (level: number): RoleRank => {
  if (level <= 10) return 'owner';
  if (level <= 50) return 'senior';
  if (level < 100) return 'mid';
  return 'member';
};

export const RANK_LABEL: Record<RoleRank, string> = {
  owner: 'Administration',
  senior: 'Management',
  mid: 'Supervisory',
  member: 'Individual contributor',
};

/*
  Depth of teal maps to authority, matching the departments board. `lib/roleColors`
  is left untouched — it cycles thirteen unrelated hues by level and is still
  read by the organisation chart, but as a rank signal it encodes nothing: two
  adjacent levels get unrelated colours, and level 1 and level 14 get the same one.
*/
export const RANK_SWATCH: Record<RoleRank, { backgroundColor: string; color: string }> = {
  owner: { backgroundColor: '#233B40', color: '#F0F7F8' },
  senior: { backgroundColor: '#3D656B', color: '#F0F7F8' },
  mid: { backgroundColor: '#8DC3C9', color: '#16262B' },
  member: { backgroundColor: '#D2D8DD', color: '#3A4147' },
};

export const RANK_DOT: Record<RoleRank, string> = {
  owner: '#233B40',
  senior: '#3D656B',
  mid: '#8DC3C9',
  member: '#D2D8DD',
};

export const getInitials = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/* ────────────────────────────────────────────────────────────────
   Ordering
   ──────────────────────────────────────────────────────────────── */

/**
 * Most senior first. The previous page rendered `roles.map(...)` straight off
 * the API response, so a hierarchy was displayed in arbitrary order.
 */
export const byRank = (roles: Role[]): Role[] =>
  [...roles].sort(
    (a, b) => a.hierarchy_level - b.hierarchy_level || a.name.localeCompare(b.name)
  );

/** Levels shared by more than one role — a real configuration problem. */
export const duplicateLevels = (roles: Role[]): Set<number> => {
  const seen = new Map<number, number>();
  roles.forEach((role) => seen.set(role.hierarchy_level, (seen.get(role.hierarchy_level) ?? 0) + 1));
  const clashes = new Set<number>();
  seen.forEach((count, level) => {
    if (count > 1) clashes.add(level);
  });
  return clashes;
};

/* ────────────────────────────────────────────────────────────────
   Permissions
   ──────────────────────────────────────────────────────────────── */

/*
  These groups were filtered out of the old editor entirely. Anything a role
  already held in them survived a save (the draft is seeded from the role's own
  list) but could not be read or changed here. They are now shown, locked, so
  the permission set a role actually holds is at least visible.
*/
export const READ_ONLY_GROUPS = ['Payroll', 'Invoices'] as const;

export const isReadOnlyGroup = (group: string): boolean =>
  (READ_ONLY_GROUPS as readonly string[]).includes(group);

/** Filters groups and their permissions by a free-text query. */
export const filterGroups = (groups: PermissionGroup[], query: string): PermissionGroup[] => {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;

  return groups
    .map((group) => {
      // A matching group name keeps everything under it.
      if (group.group.toLowerCase().includes(needle)) return group;
      const permissions = group.permissions.filter((permission) =>
        [permission.name, permission.description, permission.key]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle)
      );
      return { ...group, permissions };
    })
    .filter((group) => group.permissions.length > 0);
};

/** How many of a group's permissions a draft currently grants. */
export const grantedInGroup = (group: PermissionGroup, granted: Set<string>): number =>
  group.permissions.reduce((count, permission) => count + (granted.has(permission.key) ? 1 : 0), 0);

/* ────────────────────────────────────────────────────────────────
   Matrix drafts
   ──────────────────────────────────────────────────────────────── */

export type MatrixDraft = Map<number, Set<string>>;

export const draftFromRoles = (roles: Role[]): MatrixDraft =>
  new Map(roles.map((role) => [role.id, new Set(role.permissions)]));

/** Role ids whose permission set differs from what the server last returned. */
export const dirtyRoleIds = (roles: Role[], draft: MatrixDraft): number[] =>
  roles
    .filter((role) => {
      const next = draft.get(role.id);
      if (!next) return false;
      if (next.size !== role.permissions.length) return true;
      return role.permissions.some((key) => !next.has(key));
    })
    .map((role) => role.id);

export const countChanges = (roles: Role[], draft: MatrixDraft): number =>
  roles.reduce((total, role) => {
    const next = draft.get(role.id);
    if (!next) return total;
    const before = new Set(role.permissions);
    let changed = 0;
    next.forEach((key) => {
      if (!before.has(key)) changed += 1;
    });
    before.forEach((key) => {
      if (!next.has(key)) changed += 1;
    });
    return total + changed;
  }, 0);
