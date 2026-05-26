import type { Organization, User } from '@/types';

export type AssignableRole = Exclude<User['role'], 'client' | 'super_admin'>;

export const hasAdminAccess = (user: User | null | undefined): boolean =>
  Boolean(user && (user.role === 'admin' || user.role === 'manager'));

type ApprovalActor = Pick<User, 'id'> & {
  role?: string | null;
};

const normalizeRole = (role: string | null | undefined): string =>
  String(role || '').trim().toLowerCase();

export const hasStrictAdminAccess = (user: User | null | undefined): boolean =>
  user?.role === 'admin';

export const hasSuperAdminAccess = (user: User | null | undefined): boolean =>
  user?.role === 'super_admin';

export const canReviewApprovalRequest = (
  reviewer: ApprovalActor | null | undefined,
  requester: ApprovalActor | null | undefined
): boolean => {
  if (!reviewer || !requester) {
    return false;
  }

  const reviewerRole = normalizeRole(reviewer.role);
  const requesterRole = normalizeRole(requester.role);

  if (reviewerRole !== 'admin' && reviewerRole !== 'manager') {
    return false;
  }

  if (reviewerRole === 'manager') {
    return reviewer.id !== requester.id && requesterRole === 'employee';
  }

  if (reviewer.id === requester.id) {
    return true;
  }

  return requesterRole === 'employee' || requesterRole === 'manager';
};

export const isEmployeeUser = (user: User | null | undefined): boolean =>
  user?.role === 'employee';

export const isTrackedTimerUser = (user: User | null | undefined): boolean =>
  Boolean(user && (user.role === 'employee' || user.role === 'manager'));

export const hasEmployeeOrManagerAccess = (user: User | null | undefined): boolean =>
  Boolean(user && (user.role === 'employee' || user.role === 'manager'));

export const getAssignableRoles = (
  user: User | null | undefined,
  organization: Organization | null | undefined
): AssignableRole[] => {
  if (!user || !organization) {
    return [];
  }

  const isOwner = organization.owner_user_id === user.id;

  if (isOwner) {
    return ['admin', 'manager', 'employee'];
  }

  if (user.role === 'admin') {
    return ['admin', 'manager', 'employee'];
  }

  if (user.role === 'manager') {
    return ['employee'];
  }

  return [];
};
