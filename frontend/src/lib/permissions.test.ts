import { describe, expect, it } from 'vitest';
import { canReviewApprovalRequest, getAssignableRoles, hasStrictAdminAccess, isTrackedTimerUser } from '@/lib/permissions';

describe('getAssignableRoles', () => {
  it('allows admins to assign the admin role', () => {
    expect(
      getAssignableRoles(
        {
          id: 2,
          name: 'Workspace Admin',
          email: 'admin@example.com',
          role: 'admin',
          organization_id: 10,
          is_active: true,
          created_at: '',
          updated_at: '',
        },
        {
          id: 10,
          name: 'CareVance',
          slug: 'carevance',
          owner_user_id: 1,
          created_at: '',
          updated_at: '',
        }
      )
    ).toEqual(['admin', 'manager', 'employee']);
  });
});

describe('hasStrictAdminAccess', () => {
  it('only allows admins', () => {
    expect(hasStrictAdminAccess({ id: 1, name: 'Admin', email: 'admin@example.com', role: 'admin', organization_id: 1, is_active: true, created_at: '', updated_at: '' })).toBe(true);
    expect(hasStrictAdminAccess({ id: 2, name: 'Manager', email: 'manager@example.com', role: 'manager', organization_id: 1, is_active: true, created_at: '', updated_at: '' })).toBe(false);
  });
});

describe('isTrackedTimerUser', () => {
  it('allows managers and employees into the tracked timer flow', () => {
    expect(isTrackedTimerUser({ id: 1, name: 'Employee', email: 'employee@example.com', role: 'employee', organization_id: 1, is_active: true, created_at: '', updated_at: '' })).toBe(true);
    expect(isTrackedTimerUser({ id: 2, name: 'Manager', email: 'manager@example.com', role: 'manager', organization_id: 1, is_active: true, created_at: '', updated_at: '' })).toBe(true);
    expect(isTrackedTimerUser({ id: 3, name: 'Admin', email: 'admin@example.com', role: 'admin', organization_id: 1, is_active: true, created_at: '', updated_at: '' })).toBe(false);
  });
});

describe('canReviewApprovalRequest', () => {
  it('allows managers to review employee requests only', () => {
    const manager = { id: 2, role: 'manager' as const };

    expect(canReviewApprovalRequest(manager, { id: 3, role: 'employee' })).toBe(true);
    expect(canReviewApprovalRequest(manager, { id: 2, role: 'manager' })).toBe(false);
    expect(canReviewApprovalRequest(manager, { id: 4, role: 'manager' })).toBe(false);
  });

  it('allows admins to review manager requests and their own requests only when appropriate', () => {
    const admin = { id: 1, role: 'admin' as const };

    expect(canReviewApprovalRequest(admin, { id: 2, role: 'manager' })).toBe(true);
    expect(canReviewApprovalRequest(admin, { id: 3, role: 'employee' })).toBe(true);
    expect(canReviewApprovalRequest(admin, { id: 1, role: 'admin' })).toBe(true);
    expect(canReviewApprovalRequest(admin, { id: 4, role: 'admin' })).toBe(false);
  });

  it('normalizes role casing and whitespace before evaluating approval permissions', () => {
    const admin = { id: 1, role: ' Admin ' };
    const manager = { id: 2, role: ' Manager ' };

    expect(canReviewApprovalRequest(admin, manager)).toBe(true);
  });
});
