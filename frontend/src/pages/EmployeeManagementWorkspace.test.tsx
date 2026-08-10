import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeManagementWorkspace from '@/pages/EmployeeManagementWorkspace';
import { renderWithProviders } from '@/test/renderWithProviders';

const apiMocks = vi.hoisted(() => ({
  getAllUsers: vi.fn(),
  getGroups: vi.fn(),
  getMembers: vi.fn(),
  getProfile360: vi.fn(),
  updateUser: vi.fn().mockResolvedValue({ data: {} }),
  listRoles: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Akash Admin', email: 'akash@example.com', role: 'admin', organization_id: 1 },
    organization: { id: 1, name: 'CareVance', slug: 'carevance' },
  }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    userApi: {
      ...actual.userApi,
      getAll: apiMocks.getAllUsers,
      getProfile360: apiMocks.getProfile360,
      update: apiMocks.updateUser,
    },
    roleApi: {
      ...actual.roleApi,
      list: apiMocks.listRoles,
    },
    reportGroupApi: {
      ...actual.reportGroupApi,
      list: apiMocks.getGroups,
    },
    organizationApi: {
      ...actual.organizationApi,
      getMembers: apiMocks.getMembers,
    },
  };
});

describe('EmployeeManagementWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiMocks.getAllUsers.mockResolvedValue({
      data: [
        { id: 11, name: 'Zara Khan', email: 'zara@example.com', role: 'employee', department: 'Design', is_working: false, total_duration: 600, groups: [{ id: 7, name: 'Design' }] },
        { id: 12, name: 'Ayush Temp', email: 'ayush@example.com', role: 'employee', department: 'Engineering', is_working: true, total_duration: 7200, groups: [{ id: 9, name: 'Engineering' }] },
        { id: 13, name: 'Mit Gujarati', email: 'mit@example.com', role: 'manager', department: 'Engineering', is_working: true, total_duration: 3600, groups: [{ id: 9, name: 'Engineering' }] },
      ],
    });
    apiMocks.listRoles.mockResolvedValue({
      data: {
        data: [
          { id: 1, name: 'Admin', slug: 'admin', hierarchy_level: 10, is_system: true, is_active: true, users_count: 0, permissions: [], description: null, color: 'slate' },
          { id: 2, name: 'Manager', slug: 'manager', hierarchy_level: 50, is_system: true, is_active: true, users_count: 1, permissions: [], description: null, color: 'slate' },
        ],
      },
    });
    apiMocks.getGroups.mockResolvedValue({
      data: { data: [{ id: 9, name: 'Engineering', users: [] }, { id: 7, name: 'Design', users: [] }] },
    });
    apiMocks.getMembers.mockResolvedValue({ data: [] });
    apiMocks.getProfile360.mockResolvedValue({
      data: {
        summary: {
          total_duration: 7200,
          present_days: 1,
          approved_leave_days: 0,
          approved_time_edit_seconds: 0,
        },
        recent_time_entries: [],
      },
    });
  });

  it('narrows the employee directory to a specific person from the search box', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search employees'), { target: { value: 'ayush' } });

    await waitFor(() => {
      const directoryTable = screen.getAllByRole('table')[0];
      expect(within(directoryTable).getByRole('link', { name: 'Ayush Temp' })).toBeInTheDocument();
      expect(within(directoryTable).queryByRole('link', { name: 'Zara Khan' })).not.toBeInTheDocument();
      expect(within(directoryTable).queryByRole('link', { name: 'Mit Gujarati' })).not.toBeInTheDocument();
    });
  });

  it('sorts the employee directory by tracked time descending', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tracked time high to low' }));

    const directoryTable = screen.getAllByRole('table')[0];
    const bodyRows = within(directoryTable).getAllByRole('row').slice(1);
    const firstEmployeeCell = within(bodyRows[0]).getByRole('link');

    expect(firstEmployeeCell).toHaveTextContent('Ayush Temp');
  });

  it('filters the employee directory by department', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Department' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Engineering' }));

    await waitFor(() => {
      const directoryTable = screen.getAllByRole('table')[0];
      expect(within(directoryTable).getByRole('link', { name: 'Mit Gujarati' })).toBeInTheDocument();
      expect(within(directoryTable).queryByRole('link', { name: 'Zara Khan' })).not.toBeInTheDocument();
    });
  });

  it('segments the directory to people who are working right now', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Working now/ }));

    await waitFor(() => {
      const directoryTable = screen.getAllByRole('table')[0];
      expect(within(directoryTable).getByRole('link', { name: 'Ayush Temp' })).toBeInTheDocument();
      expect(within(directoryTable).getByRole('link', { name: 'Mit Gujarati' })).toBeInTheDocument();
      // Zara Khan has is_working: false.
      expect(within(directoryTable).queryByRole('link', { name: 'Zara Khan' })).not.toBeInTheDocument();
    });
  });

  it('assigns a role to every selected person in one action', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select Zara Khan'));
    fireEvent.click(screen.getByLabelText('Select Ayush Temp'));
    expect(await screen.findByText('2 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Assign role/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Manager' }));

    // One write per person — there is no bulk endpoint behind this.
    await waitFor(() => expect(apiMocks.updateUser).toHaveBeenCalledTimes(2));
    expect(apiMocks.updateUser).toHaveBeenCalledWith(11, { role: 'manager' });
    expect(apiMocks.updateUser).toHaveBeenCalledWith(12, { role: 'manager' });
  });

  it('adds selected people to a department without dropping their other departments', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Select Zara Khan'));
    fireEvent.click(screen.getByRole('button', { name: /Add to department/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Engineering' }));

    await waitFor(() => expect(apiMocks.updateUser).toHaveBeenCalledTimes(1));
    // Zara already sits in group 7; the new department is added, not swapped in.
    expect(apiMocks.updateUser).toHaveBeenCalledWith(11, { group_ids: [7, 9] });
  });

  it('opens employee settings in a drawer instead of a panel below the table', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Zara Khan' }));
    fireEvent.click(await screen.findByRole('button', { name: /Settings/ }));

    const drawer = await screen.findByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'Zara Khan' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Save settings' })).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('filters role assignments with the roles search box', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="roles" />, { route: '/employees/roles' });

    expect(await screen.findByRole('heading', { name: 'Roles / Permissions' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Search people'), {
      target: { value: 'engineering' },
    });

    await waitFor(() => {
      expect(screen.getByText('Ayush Temp')).toBeInTheDocument();
      expect(screen.getByText('Mit Gujarati')).toBeInTheDocument();
      expect(screen.queryByText('Zara Khan')).not.toBeInTheDocument();
    });
  });
});
