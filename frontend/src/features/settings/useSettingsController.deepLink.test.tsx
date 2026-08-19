import { createElement, type ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * paneDeepLink.test.ts proves the two pure halves. This file proves they are
 * actually wired to the address bar, which is the part that was broken in
 * production: PaymentPage sends an admin to /settings?pane=organization when
 * the invoice has no billing address, Settings opened on Profile, and the
 * person typed their personal address into employee_profiles while the
 * organization's billing address stayed empty.
 *
 * Unplug the URL reading from the controller and the pure tests stay green —
 * only this one goes red, so this is the test that guards the wiring.
 */

const mockUseAuth = vi.fn();
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
}));

/*
 * Every endpoint the controller touches on mount is stubbed. An unmocked one
 * would be retried three times by the axios client and hold the render past
 * the timeout, which looks like a routing failure and is not one.
 */
const settingsMe = vi.fn();
const settingsBilling = vi.fn();
vi.mock('@/services/api', () => ({
  settingsApi: {
    me: (...args: unknown[]) => settingsMe(...args),
    billing: (...args: unknown[]) => settingsBilling(...args),
    updateProfile: vi.fn(),
    updatePreferences: vi.fn(),
    updateOrganization: vi.fn(),
    updatePassword: vi.fn(),
  },
  employeeWorkspaceApi: {
    getWorkspace: vi.fn().mockResolvedValue({ data: { about: {} } }),
    updateProfile: vi.fn(),
  },
  supportApi: { submitBugReport: vi.fn() },
  organizationApi: { delete: vi.fn() },
}));

// Imported after the mocks so the controller picks them up.
const { useSettingsController } = await import('./useSettingsController');

const ADMIN = { id: 1, name: 'Ada', email: 'ada@example.com', role: 'admin', hierarchy_level: 10 };
const EMPLOYEE = { id: 2, name: 'Eve', email: 'eve@example.com', role: 'employee', hierarchy_level: 100 };
const ORGANIZATION = { id: 7, name: 'CareVance', slug: 'carevance', settings: {} };

const openSettingsAt = async (url: string, user: Record<string, unknown>) => {
  mockUseAuth.mockReturnValue({
    user,
    organization: ORGANIZATION,
    updateUser: vi.fn(),
    updateOrganization: vi.fn(),
  });

  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(MemoryRouter, { initialEntries: [url] }, children);

  const view = renderHook(() => useSettingsController(), { wrapper });
  // The controller blanks the page until its first load settles; waiting for
  // that also flushes the routing effect's state update inside act().
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
};

beforeEach(() => {
  vi.clearAllMocks();
  settingsMe.mockResolvedValue({
    data: { user: ADMIN, organization: ORGANIZATION, can_manage_org: true },
  });
  settingsBilling.mockResolvedValue({ data: null });
});

describe('useSettingsController deep links', () => {
  it('opens Organization for /settings?pane=organization', async () => {
    const { result } = await openSettingsAt('/settings?pane=organization', ADMIN);
    expect(result.current.activeTab).toBe('organization');
  });

  it('opens Billing for the ?tab= form the command bar sends', async () => {
    const { result } = await openSettingsAt('/settings?tab=billing', ADMIN);
    expect(result.current.activeTab).toBe('billing');
  });

  it('opens Integrations for its own path', async () => {
    const { result } = await openSettingsAt('/settings/integrations', ADMIN);
    expect(result.current.activeTab).toBe('integrations');
  });

  it('stays on Profile when the URL asks for nothing', async () => {
    const { result } = await openSettingsAt('/settings', ADMIN);
    expect(result.current.activeTab).toBe('profile');
  });

  it('will not open a workspace pane for an employee following the same link', async () => {
    settingsMe.mockResolvedValue({
      data: { user: EMPLOYEE, organization: ORGANIZATION, can_manage_org: false },
    });
    const { result } = await openSettingsAt('/settings?pane=organization', EMPLOYEE);
    expect(result.current.activeTab).toBe('profile');
    expect(result.current.visibleTabs.map((tab) => tab.id)).not.toContain('organization');
  });
});
