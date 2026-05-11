import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeManagementWorkspace from '@/pages/EmployeeManagementWorkspace';
import { renderWithProviders } from '@/test/renderWithProviders';

const apiMocks = vi.hoisted(() => ({
  getAllUsers: vi.fn(),
  getGroups: vi.fn(),
  getMembers: vi.fn(),
  getProfile360: vi.fn(),
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
        { id: 11, name: 'Zara Khan', email: 'zara@example.com', role: 'employee', department: 'Design', is_working: false, total_duration: 600 },
        { id: 12, name: 'Ayush Temp', email: 'ayush@example.com', role: 'employee', department: 'Engineering', is_working: true, total_duration: 7200 },
        { id: 13, name: 'Mit Gujarati', email: 'mit@example.com', role: 'manager', department: 'Engineering', is_working: true, total_duration: 3600 },
      ],
    });
    apiMocks.getGroups.mockResolvedValue({ data: { data: [] } });
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

  it('filters the employee directory to a specific employee from the dropdown', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Specific employee filter'));
    const employeeListbox = await screen.findByRole('listbox');
    fireEvent.click(within(employeeListbox).getByRole('option', { name: /Ayush Temp/i }));

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

    fireEvent.click(screen.getByLabelText('Employee directory sort'));
    fireEvent.click(await screen.findByRole('option', { name: 'Tracked time high to low' }));

    const directoryTable = screen.getAllByRole('table')[0];
    const bodyRows = within(directoryTable).getAllByRole('row').slice(1);
    const firstEmployeeCell = within(bodyRows[0]).getByRole('link');

    expect(firstEmployeeCell).toHaveTextContent('Ayush Temp');
  });

  it('filters the employee directory by department', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Employee department filter'));
    fireEvent.click(await screen.findByRole('option', { name: 'Engineering' }));

    await waitFor(() => {
      const directoryTable = screen.getAllByRole('table')[0];
      expect(within(directoryTable).getByRole('link', { name: 'Mit Gujarati' })).toBeInTheDocument();
      expect(within(directoryTable).queryByRole('link', { name: 'Zara Khan' })).not.toBeInTheDocument();
    });
  });

  it('filters role assignments with the roles search box', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="roles" />, { route: '/employees/roles' });

    expect(await screen.findByRole('heading', { name: 'Roles / Permissions' })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search name, email, role, or department'), {
      target: { value: 'engineering' },
    });

    await waitFor(() => {
      expect(screen.getByText('Ayush Temp')).toBeInTheDocument();
      expect(screen.getByText('Mit Gujarati')).toBeInTheDocument();
      expect(screen.queryByText('Zara Khan')).not.toBeInTheDocument();
    });
  });
});
