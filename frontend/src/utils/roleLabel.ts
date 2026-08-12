/**
 * Human-readable names for the built-in role slugs.
 *
 * The slugs are snake_case, so rendering one raw puts "super_admin" or an
 * uppercased "SUPER_ADMIN" in front of a user. Mirrors `App\Support\RoleLabel`
 * on the backend — keep the two lists together if a role is added.
 *
 * An organisation's own custom roles carry their own display name and never
 * reach this map, so an unknown slug is title-cased rather than replaced.
 */
const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  hr: 'HR',
  payroll_manager: 'Payroll Manager',
  manager: 'Manager',
  employee: 'Employee',
};

export function roleLabel(role?: string | null, fallback = 'Team member'): string {
  const slug = String(role ?? '').trim();

  if (!slug) {
    return fallback;
  }

  if (ROLE_LABELS[slug]) {
    return ROLE_LABELS[slug];
  }

  return slug
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
