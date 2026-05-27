import type { Organization, User } from '@/types';

export type AssignableRole = Exclude<User['role'], 'client' | 'super_admin'>;

const getUserLevel = (user: User | null | undefined): number => {
  if (!user) return 999;
  if (user.hierarchy_level !== null && user.hierarchy_level !== undefined) return user.hierarchy_level;
  return user.role === 'super_admin' ? 0 : user.role === 'admin' ? 10 : user.role === 'manager' ? 50 : user.role === 'employee' ? 100 : 999;
};

export const hasAdminAccess = (user: User | null | undefined): boolean =>
  getUserLevel(user) < 100;

export const canAccess = (user: User | null | undefined, permission: string): boolean => {
  if (!user) return false;
  if (user.role === 'super_admin') return true;
  if (user.permissions && Array.isArray(user.permissions)) {
    return user.permissions.includes(permission);
  }
  return hasAdminAccess(user);
};

type ApprovalActor = Pick<User, 'id'> & {
  role?: string | null;
};

const normalizeRole = (role: string | null | undefined): string =>
  String(role || '').trim().toLowerCase();

export const hasStrictAdminAccess = (user: User | null | undefined): boolean =>
  getUserLevel(user) <= 10;

export const hasSuperAdminAccess = (user: User | null | undefined): boolean =>
  getUserLevel(user) === 0;

export const canReviewApprovalRequest = (
  reviewer: ApprovalActor | null | undefined,
  requester: ApprovalActor | null | undefined
): boolean => {
  if (!reviewer || !requester) {
    return false;
  }

  const reviewerLevel = (reviewer as any)?.hierarchy_level
    ?? (reviewer as any)?.customRole?.hierarchy_level
    ?? (normalizeRole(reviewer.role) === 'admin' ? 10 : normalizeRole(reviewer.role) === 'manager' ? 50 : 100);
  const requesterLevel = (requester as any)?.hierarchy_level
    ?? (requester as any)?.customRole?.hierarchy_level
    ?? (normalizeRole(requester.role) === 'admin' ? 10 : normalizeRole(requester.role) === 'manager' ? 50 : normalizeRole(requester.role) === 'employee' ? 100 : 999);

  // Self-review not allowed (except admin)
  if (reviewer.id === requester.id) {
    return reviewerLevel <= 10;
  }

  // Reviewer must be higher rank (lower level number)
  return reviewerLevel < requesterLevel;
};

export const isEmployeeUser = (user: User | null | undefined): boolean =>
  getUserLevel(user) >= 100;

export const isTrackedTimerUser = (user: User | null | undefined): boolean =>
  getUserLevel(user) >= 50;

export const hasEmployeeOrManagerAccess = (user: User | null | undefined): boolean =>
  getUserLevel(user) >= 50;

export interface Role {
  id: number;
  name: string;
  hierarchy_level?: number | null;
}

export const resolveUserRoleLabel = (user: { role?: string | null; role_id?: number | null; role_name?: string | null } | null | undefined, customRoles: Role[] = []): string => {
  if (!user) return 'Employee';
  if (user.role_name) return user.role_name;
  if (user.role_id) {
    const cr = customRoles.find((r) => r.id === user.role_id);
    if (cr) return cr.name;
  }
  return user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Employee';
};

export const resolveUserHierarchyLevel = (
  user: { role?: string | null; role_id?: number | null; hierarchy_level?: number | null; customRole?: { hierarchy_level?: number | null } } | null | undefined,
  customRoles: Role[] = []
): number | null => {
  if (!user) return null;
  if (user.hierarchy_level !== null && user.hierarchy_level !== undefined) {
    return user.hierarchy_level;
  }
  if (user.customRole?.hierarchy_level !== null && user.customRole?.hierarchy_level !== undefined) {
    return user.customRole.hierarchy_level;
  }
  if (user.role_id) {
    const cr = customRoles.find((r) => r.id === user.role_id);
    if (cr && cr.hierarchy_level !== null && cr.hierarchy_level !== undefined) {
      return cr.hierarchy_level;
    }
    return null;
  }

  const normalizedRole = normalizeRole(user.role);
  return normalizedRole === 'super_admin' ? 0 : normalizedRole === 'admin' ? 10 : normalizedRole === 'manager' ? 50 : normalizedRole === 'employee' ? 100 : null;
};

export const getAssignableRoles = (
  user: User | null | undefined,
  organization: Organization | null | undefined
): AssignableRole[] => {
  if (!user || !organization) {
    return [];
  }

  const userLevel = getUserLevel(user);

  if (userLevel <= 10) {
    return ['admin', 'manager', 'employee'];
  }

  if (userLevel <= 50) {
    return ['employee'];
  }

  return [];
};
