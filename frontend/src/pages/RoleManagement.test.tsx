import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import RoleManagement from '@/pages/RoleManagement';
import { renderWithProviders } from '@/test/renderWithProviders';

const authState = vi.hoisted(() => ({
  value: {
    user: {
      id: 1,
      name: 'Admin',
      email: 'admin@example.com',
      role: 'admin',
      organization_id: 1,
      is_active: true,
      created_at: '',
      updated_at: '',
    },
  },
}));

const apiMocks = vi.hoisted(() => ({
  roleList: vi.fn(),
  roleUpdate: vi.fn().mockResolvedValue({ data: { data: {} } }),
  roleCreate: vi.fn().mockResolvedValue({ data: { data: {} } }),
  roleDelete: vi.fn().mockResolvedValue({}),
  permissionList: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => authState.value,
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    roleApi: {
      list: apiMocks.roleList,
      update: apiMocks.roleUpdate,
      create: apiMocks.roleCreate,
      delete: apiMocks.roleDelete,
    },
    permissionApi: { list: apiMocks.permissionList },
  };
});

const role = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  name: 'Role',
  slug: 'role',
  description: null,
  hierarchy_level: 50,
  color: 'slate',
  is_system: false,
  is_active: true,
  users_count: 0,
  permissions: [] as string[],
  ...over,
});

describe('RoleManagement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    // Deliberately returned out of rank order — the page must sort them.
    apiMocks.roleList.mockResolvedValue({
      data: {
        data: [
          role({ id: 3, name: 'Employee', hierarchy_level: 100, users_count: 12 }),
          role({ id: 1, name: 'Admin', hierarchy_level: 10, is_system: true, users_count: 2, permissions: ['reports.view'] }),
          role({ id: 2, name: 'Manager', hierarchy_level: 50, users_count: 4 }),
        ],
      },
    });

    apiMocks.permissionList.mockResolvedValue({
      data: {
        data: [
          {
            group: 'Reports',
            permissions: [
              { key: 'reports.view', name: 'View reports', description: 'See reports', plan_feature: null },
              { key: 'reports.export', name: 'Export reports', description: null, plan_feature: null },
            ],
          },
          {
            group: 'Payroll',
            permissions: [{ key: 'payroll.run', name: 'Run payroll', description: null, plan_feature: null }],
          },
        ],
      },
    });
  });

  it('orders roles by seniority rather than the order the API returned them', async () => {
    renderWithProviders(<RoleManagement />);

    const headers = await screen.findAllByRole('columnheader');
    // First header is the "Permission" corner cell; roles follow in rank order.
    const roleNames = headers.slice(1).map((header) => within(header).getByRole('button').textContent);

    expect(roleNames[0]).toContain('Admin');
    expect(roleNames[1]).toContain('Manager');
    expect(roleNames[2]).toContain('Employee');
  });

  it('collects matrix edits and only writes the roles that actually changed', async () => {
    renderWithProviders(<RoleManagement />);

    const cell = await screen.findByRole('checkbox', { name: 'Export reports for Manager' });
    expect(cell).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(cell);

    // Nothing is written until the change is committed.
    expect(apiMocks.roleUpdate).not.toHaveBeenCalled();
    expect(await screen.findByText('1 unsaved permission change')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(apiMocks.roleUpdate).toHaveBeenCalledTimes(1));
    expect(apiMocks.roleUpdate).toHaveBeenCalledWith(2, { permissions: ['reports.export'] });
  });

  it('discards matrix edits without writing anything', async () => {
    renderWithProviders(<RoleManagement />);

    fireEvent.click(await screen.findByRole('checkbox', { name: 'Export reports for Manager' }));
    expect(await screen.findByText('1 unsaved permission change')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Discard/ }));

    await waitFor(() => expect(screen.queryByText('1 unsaved permission change')).not.toBeInTheDocument());
    expect(apiMocks.roleUpdate).not.toHaveBeenCalled();
  });

  it('keeps permissions from locked groups read-only so they cannot be edited here', async () => {
    renderWithProviders(<RoleManagement />);

    const locked = await screen.findByRole('checkbox', { name: 'Run payroll for Manager' });
    expect(locked).toBeDisabled();
  });

  it('names the role and warns about its holders before deleting', async () => {
    renderWithProviders(<RoleManagement />);

    fireEvent.click(await screen.findByRole('button', { name: /Hierarchy/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Manager.*Level 50/s }));
    fireEvent.click(await screen.findByRole('button', { name: /^Edit$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Delete$/ }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Delete “Manager”\?/)).toBeInTheDocument();
    expect(within(dialog).getByText(/4 people hold/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete role' }));
    await waitFor(() => expect(apiMocks.roleDelete).toHaveBeenCalledWith(2));
  });
});
