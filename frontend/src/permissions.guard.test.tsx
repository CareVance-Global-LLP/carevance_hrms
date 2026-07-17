import { describe, expect, it, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import {
  hasAdminAccess,
  hasStrictAdminAccess,
  hasSuperAdminAccess,
  canAccess,
  isEmployeeUser,
  hasEmployeeOrManagerAccess,
} from '@/lib/permissions';
import { AdminRoute, StrictAdminRoute, SuperAdminRoute, PermissionRoute, EmployeeRoute } from '@/App';
import type { User } from '@/types';

// These tests verify the DESKTOP route-guard logic in isolation (only AuthContext
// is mocked), independent of the full <App/> render which requires many providers
// (Consent, Plan, Notification, GoogleOAuth). They also prove parity with the
// mobile hierarchy_level-aware helper in mobile-app/src/hooks/usePermissions.tsx:
// both resolve hierarchy_level ?? (admin?10 : manager?50 : employee?100 : 999)
// and treat level < 100 as elevated.

const authMock = vi.hoisted(() => ({
  value: { user: null as User | null, isLoading: false, isAuthenticated: false, organization: null, wasOfflineRestored: false },
}));
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authMock.value,
}));

function makeUser(overrides: Partial<User>): User {
  return {
    id: 1,
    name: 'U',
    email: 'u@carevance.test',
    role: 'employee',
    organization_id: 1,
    is_active: true,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

function setUser(user: User | null) {
  authMock.value = { user, isLoading: false, isAuthenticated: !!user, organization: null, wasOfflineRestored: false };
}

function renderAt(guard: React.ReactElement, targetText: string) {
  return render(
    <MemoryRouter initialEntries={['/x']}>
      <Routes>
        <Route path="/x" element={guard} />
        <Route path="/dashboard" element={<div>RedirectedToDashboard</div>} />
        <Route path="/employees" element={<div>RedirectedToEmployees</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('permissions.ts guard logic (desktop source of truth)', () => {
  it('hasAdminAccess: elevated = hierarchy_level < 100', () => {
    expect(hasAdminAccess(makeUser({ role: 'admin' }))).toBe(true);
    expect(hasAdminAccess(makeUser({ role: 'super_admin' }))).toBe(true);
    expect(hasAdminAccess(makeUser({ role: 'manager' }))).toBe(true);
    expect(hasAdminAccess(makeUser({ role: 'employee' }))).toBe(false);
    expect(hasAdminAccess(makeUser({ role: 'employee', hierarchy_level: 10 }))).toBe(true); // elevated custom role
    expect(hasAdminAccess(makeUser({ role: 'employee', hierarchy_level: 100 }))).toBe(false); // qa.customrole baseline
    expect(hasAdminAccess(null)).toBe(false);
  });

  it('hasStrictAdminAccess: hierarchy_level <= 10', () => {
    expect(hasStrictAdminAccess(makeUser({ role: 'admin' }))).toBe(true);
    expect(hasStrictAdminAccess(makeUser({ role: 'super_admin' }))).toBe(true);
    expect(hasStrictAdminAccess(makeUser({ role: 'manager' }))).toBe(false);
    expect(hasStrictAdminAccess(makeUser({ role: 'employee', hierarchy_level: 10 }))).toBe(true); // elevated custom == admin tier
    expect(hasStrictAdminAccess(makeUser({ role: 'employee', hierarchy_level: 30 }))).toBe(false);
  });

  it('hasSuperAdminAccess: hierarchy_level === 0', () => {
    expect(hasSuperAdminAccess(makeUser({ role: 'super_admin' }))).toBe(true);
    expect(hasSuperAdminAccess(makeUser({ role: 'admin' }))).toBe(false);
    expect(hasSuperAdminAccess(makeUser({ role: 'employee', hierarchy_level: 10 }))).toBe(false);
    expect(hasSuperAdminAccess(null)).toBe(false);
  });

  it('isEmployeeUser: hierarchy_level >= 100', () => {
    expect(isEmployeeUser(makeUser({ role: 'employee' }))).toBe(true);
    expect(isEmployeeUser(makeUser({ role: 'employee', hierarchy_level: 100 }))).toBe(true);
    expect(isEmployeeUser(makeUser({ role: 'employee', hierarchy_level: 10 }))).toBe(false); // elevated custom role
    expect(isEmployeeUser(makeUser({ role: 'admin' }))).toBe(false);
  });

  it('hasEmployeeOrManagerAccess: hierarchy_level >= 50', () => {
    expect(hasEmployeeOrManagerAccess(makeUser({ role: 'employee' }))).toBe(true); // 100
    expect(hasEmployeeOrManagerAccess(makeUser({ role: 'manager' }))).toBe(true); // 50
    expect(hasEmployeeOrManagerAccess(makeUser({ role: 'employee', hierarchy_level: 10 }))).toBe(false); // 10 < 50
    expect(hasEmployeeOrManagerAccess(makeUser({ role: 'employee', hierarchy_level: 50 }))).toBe(true);
  });

  it('canAccess: super_admin bypass; permission list for custom roles; admin fallback', () => {
    expect(canAccess(makeUser({ role: 'super_admin' }), 'assets.view')).toBe(true);
    expect(canAccess(makeUser({ role: 'admin' }), 'assets.view')).toBe(true); // built-in admin fallback
    expect(canAccess(makeUser({ role: 'employee', hierarchy_level: 10, permissions: ['leave.view'] }), 'assets.view')).toBe(false);
    expect(canAccess(makeUser({ role: 'employee', hierarchy_level: 10, permissions: ['assets.view'] }), 'assets.view')).toBe(true); // positive-access case
    expect(canAccess(makeUser({ role: 'employee', hierarchy_level: 10 }), 'assets.view')).toBe(true); // elevated custom, admin fallback
    expect(canAccess(null, 'assets.view')).toBe(false);
  });
});

describe('App.tsx route-guard components (isolated render)', () => {
  afterEach(() => cleanup());

  it('AdminRoute allows admins and elevated custom roles; blocks plain employees', () => {
    setUser(makeUser({ role: 'admin' }));
    renderAt(<AdminRoute><div>ALLOWED</div></AdminRoute>, 'ALLOWED');
    expect(screen.queryByText('ALLOWED')).toBeInTheDocument();
    expect(screen.queryByText('RedirectedToDashboard')).toBeNull();

    cleanup();
    setUser(makeUser({ role: 'employee', hierarchy_level: 10 }));
    renderAt(<AdminRoute><div>ALLOWED</div></AdminRoute>, 'ALLOWED');
    expect(screen.queryByText('ALLOWED')).toBeInTheDocument();

    cleanup();
    setUser(makeUser({ role: 'employee' }));
    renderAt(<AdminRoute><div>ALLOWED</div></AdminRoute>, 'ALLOWED');
    expect(screen.queryByText('RedirectedToDashboard')).toBeInTheDocument();
    expect(screen.queryByText('ALLOWED')).toBeNull();
  });

  it('StrictAdminRoute blocks elevated custom role at level 30 but allows level 10', () => {
    setUser(makeUser({ role: 'employee', hierarchy_level: 30 }));
    renderAt(<StrictAdminRoute><div>ALLOWED</div></StrictAdminRoute>, 'ALLOWED');
    expect(screen.queryByText('RedirectedToEmployees')).toBeInTheDocument();

    cleanup();
    setUser(makeUser({ role: 'employee', hierarchy_level: 10 }));
    renderAt(<StrictAdminRoute><div>ALLOWED</div></StrictAdminRoute>, 'ALLOWED');
    expect(screen.queryByText('ALLOWED')).toBeInTheDocument();
  });

  it('SuperAdminRoute only allows super_admin', () => {
    setUser(makeUser({ role: 'super_admin' }));
    renderAt(<SuperAdminRoute><div>ALLOWED</div></SuperAdminRoute>, 'ALLOWED');
    expect(screen.queryByText('ALLOWED')).toBeInTheDocument();

    cleanup();
    setUser(makeUser({ role: 'admin' }));
    renderAt(<SuperAdminRoute><div>ALLOWED</div></SuperAdminRoute>, 'ALLOWED');
    expect(screen.queryByText('RedirectedToDashboard')).toBeInTheDocument();
  });

  it('EmployeeRoute allows plain employees and blocks admins', () => {
    setUser(makeUser({ role: 'employee' }));
    renderAt(<EmployeeRoute><div>ALLOWED</div></EmployeeRoute>, 'ALLOWED');
    expect(screen.queryByText('ALLOWED')).toBeInTheDocument();

    cleanup();
    setUser(makeUser({ role: 'admin' }));
    renderAt(<EmployeeRoute><div>ALLOWED</div></EmployeeRoute>, 'ALLOWED');
    expect(screen.queryByText('RedirectedToDashboard')).toBeInTheDocument();
  });

  it('PermissionRoute allows when user has the permission, blocks otherwise', () => {
    setUser(makeUser({ role: 'employee', hierarchy_level: 10, permissions: ['assets.view'] }));
    renderAt(<PermissionRoute permission="assets.view"><div>ALLOWED</div></PermissionRoute>, 'ALLOWED');
    expect(screen.queryByText('ALLOWED')).toBeInTheDocument();

    cleanup();
    setUser(makeUser({ role: 'employee', hierarchy_level: 10, permissions: ['leave.view'] }));
    renderAt(<PermissionRoute permission="assets.view"><div>ALLOWED</div></PermissionRoute>, 'ALLOWED');
    expect(screen.queryByText('RedirectedToDashboard')).toBeInTheDocument();
  });
});
