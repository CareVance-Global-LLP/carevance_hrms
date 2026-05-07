import type { Organization, User } from '@/types';

export type AssignableRole = Exclude<User['role'], 'client'>;

export const hasAdminAccess = (user: User | null | undefined): boolean =>
  Boolean(user && (user.role === 'admin' || user.role === 'manager'));

type ApprovalActor = Pick<User, 'id'> & {
  role?: string | null;
};

export const hasStrictAdminAccess = (user: User | null | undefined): boolean =>
  user?.role === 'admin';

export const hasSuperAdminAccess = (_user: User | null | undefined): boolean =>
  false;

export const canReviewApprovalRequest = (
  reviewer: ApprovalActor | null | undefined,
  requester: ApprovalActor | null | undefined
): boolean => {
  if (!reviewer || !requester) {
    return false;
  }

  if (reviewer.role !== 'admin' && reviewer.role !== 'manager') {
    return false;
  }

  if (reviewer.role === 'manager') {
    return reviewer.id !== requester.id && requester.role === 'employee';
  }

  if (reviewer.id === requester.id) {
    return true;
  }

  return requester.role === 'employee' || requester.role === 'manager';
};

export const isEmployeeUser = (user: User | null | undefined): boolean =>
  user?.role === 'employee';

export const isTrackedTimerUser = (user: User | null | undefined): boolean =>
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
