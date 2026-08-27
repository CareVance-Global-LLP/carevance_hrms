import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmployeeManagementWorkspace from '@/pages/EmployeeManagementWorkspace';
import { todayIso } from '@/lib/formatters';
import { renderWithProviders } from '@/test/renderWithProviders';

const apiMocks = vi.hoisted(() => ({
  getAllUsers: vi.fn(),
  getGroups: vi.fn(),
  getMembers: vi.fn(),
  getProfile360: vi.fn(),
  updateUser: vi.fn().mockResolvedValue({ data: {} }),
  deleteUser: vi.fn(),
  listRoles: vi.fn(),
  listExits: vi.fn(),
  rejoin: vi.fn(),
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
      delete: apiMocks.deleteUser,
    },
    exitApi: {
      ...actual.exitApi,
      list: apiMocks.listExits,
      rejoin: apiMocks.rejoin,
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

/** Rita's exit. `rehire_eligibility` is what decides whether she can come back. */
const exitRecord = (over: Record<string, unknown> = {}) => ({
  id: 21,
  user_id: 14,
  resignation_id: null,
  exit_type: 'resignation',
  exit_reason: null,
  last_working_date: '2026-07-31',
  notice_period_days: 30,
  served_days: 30,
  shortfall_days: 0,
  stage: 'closed',
  days_remaining: -20,
  clearance_progress: { total: 3, done: 3, blocking_outstanding: 0 },
  clearance_completed_at: null,
  access_revoked_at: '2026-08-01T00:00:00Z',
  rehire_eligibility: 'eligible',
  rehire_note: null,
  rehire_decided_at: '2026-08-02T00:00:00Z',
  rejoined_at: null,
  previous_joining_date: null,
  user: { id: 14, name: 'Rita Former', email: 'rita@example.com' },
  ...over,
});

const openExEmployees = async () => {
  expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Ex-employees/ }));
};

describe('EmployeeManagementWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiMocks.getAllUsers.mockResolvedValue({
      data: [
        { id: 11, name: 'Zara Khan', email: 'zara@example.com', role: 'employee', department: 'Design', is_working: false, total_duration: 600, groups: [{ id: 7, name: 'Design' }] },
        { id: 12, name: 'Ayush Temp', email: 'ayush@example.com', role: 'employee', department: 'Engineering', is_working: true, total_duration: 7200, groups: [{ id: 9, name: 'Engineering' }] },
        { id: 13, name: 'Mit Gujarati', email: 'mit@example.com', role: 'manager', department: 'Engineering', is_working: true, total_duration: 3600, groups: [{ id: 9, name: 'Engineering' }] },
        /*
         * A leaver. `/api/users` returns everybody — there is no is_active
         * condition on it — so this row is what the page has always received
         * and, until the Ex-employees segment, silently listed under Everyone.
         */
        { id: 14, name: 'Rita Former', email: 'rita@example.com', role: 'employee', department: 'Design', is_working: false, is_active: false, deactivated_at: '2026-08-01T00:00:00Z', groups: [{ id: 7, name: 'Design' }] },
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
    apiMocks.deleteUser.mockResolvedValue({ data: {} });
    apiMocks.rejoin.mockResolvedValue({ data: { data: exitRecord() } });
    apiMocks.listExits.mockResolvedValue({ data: { data: [exitRecord()] } });
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

  it('does not offer a tracked-time sort the directory cannot honour', async () => {
    /*
     * Replaces a test that sorted by tracked time and passed, while the feature
     * was dead in production the whole time. The fixture above hands
     * userApi.getAll a total_duration; the real /api/users returns no duration
     * field of any kind, so every row rendered an em dash and the sort compared
     * zeroes. Verified against the live API on 18 Aug 2026. The column and the
     * sort are gone — tracked time belongs on the dashboard and in reports,
     * where it comes with the date range it needs.
     */
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Sort' }));

    expect(screen.queryByRole('option', { name: 'Tracked time high to low' })).not.toBeInTheDocument();

    const directoryTable = screen.getAllByRole('table')[0];
    expect(within(directoryTable).queryByText('Tracked')).not.toBeInTheDocument();
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

  it('renders the row action menu outside the table so the scroll container cannot clip it', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Zara Khan' }));

    const menu = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-row-menu]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    /*
     * The menu used to be absolutely positioned inside the table's
     * `overflow-x-auto` wrapper, which clips an absolute child just as it clips
     * an in-flow one — on the last row only the first item survived, sliced in
     * half. It has to portal out to escape that.
     */
    expect(menu.closest('table')).toBeNull();
    expect(menu.parentElement).toBe(document.body);
    expect(within(menu).getByRole('link', { name: /Open profile/ })).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: /Settings/ })).toBeInTheDocument();
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

  it('lists somebody who has left under Ex-employees, with the day they left and our rehire decision', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });
    await openExEmployees();

    const directoryTable = screen.getAllByRole('table')[0];
    expect(await within(directoryTable).findByRole('link', { name: 'Rita Former' })).toBeInTheDocument();
    expect(within(directoryTable).queryByRole('link', { name: 'Zara Khan' })).not.toBeInTheDocument();

    // The three facts an admin needs before deciding anything about a leaver.
    expect(await within(directoryTable).findByText(/Left Jul 31, 2026 · resignation/)).toBeInTheDocument();
    expect(within(directoryTable).getByText('Rehire eligible')).toBeInTheDocument();
    expect(within(directoryTable).getByText('Ex-employee')).toBeInTheDocument();
  });

  it('keeps ex-employees out of Everyone, so the tab and the roster cannot contradict each other', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();

    const directoryTable = screen.getAllByRole('table')[0];
    expect(within(directoryTable).getByRole('link', { name: 'Zara Khan' })).toBeInTheDocument();
    expect(within(directoryTable).queryByRole('link', { name: 'Rita Former' })).not.toBeInTheDocument();

    // Three of the four fixture people are still here; the pill must say so.
    expect(screen.getByRole('button', { name: /Everyone/ }).textContent).toContain('3');
  });

  it('does not count somebody who has left as an incomplete profile to chase', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Incomplete profiles/ }).textContent).toContain('3');

    fireEvent.click(screen.getByRole('button', { name: /Incomplete profiles/ }));

    await waitFor(() => {
      const directoryTable = screen.getAllByRole('table')[0];
      expect(within(directoryTable).getByRole('link', { name: 'Zara Khan' })).toBeInTheDocument();
      expect(within(directoryTable).queryByRole('link', { name: 'Rita Former' })).not.toBeInTheDocument();
    });
  });

  it('offers to bring an eligible ex-employee back, and confirms before doing it', async () => {
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });
    await openExEmployees();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Rita Former' }));
    fireEvent.click(await screen.findByRole('button', { name: /Bring back/ }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/takes a seat, exactly like a new hire/)).toBeInTheDocument();
    // The re-based joining date is the consequence worth stating up front.
    expect(within(dialog).getByText(/continuous-service clock/)).toBeInTheDocument();
    expect(apiMocks.rejoin).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Bring them back' }));

    await waitFor(() => expect(apiMocks.rejoin).toHaveBeenCalledWith(21, { joining_date: todayIso() }));
  });

  it('hides the rejoin action when the exit says they are not eligible for rehire', async () => {
    apiMocks.listExits.mockResolvedValue({
      data: { data: [exitRecord({ rehire_eligibility: 'not_eligible' })] },
    });

    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });
    await openExEmployees();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Rita Former' }));

    // The menu really opened — the absence below is the gate, not a dead click.
    expect(await screen.findByRole('button', { name: /Settings/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Bring back/ })).not.toBeInTheDocument();
  });

  it("shows the server's seat refusal verbatim when there is no seat free", async () => {
    apiMocks.rejoin.mockRejectedValue({
      response: { data: { message: '2 of 2 seats are in use. Add at least 1 more seat to bring somebody back.' } },
    });

    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });
    await openExEmployees();

    fireEvent.click(await screen.findByRole('button', { name: 'Actions for Rita Former' }));
    fireEvent.click(await screen.findByRole('button', { name: /Bring back/ }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Bring them back' }));

    /*
     * SeatGuard's own wording carries the shortfall, which is what tells the
     * admin that buying a seat is the fix. A generic "could not bring this
     * person back" would leave them with a button that failed and no next step.
     */
    expect(
      await screen.findByText('2 of 2 seats are in use. Add at least 1 more seat to bring somebody back.')
    ).toBeInTheDocument();
  });

  it('offers to start an exit, and no longer offers to delete the employee', async () => {
    /*
     * "Remove employee" called DELETE /users/{id} — a hard delete with 101
     * tables cascading off a users row, payslips and bank-transfer lines among
     * them. The API refuses it now for anyone with history, which left a menu
     * item that could only ever fail. A button that always errors is worse than
     * an absent one: it teaches people the product is broken.
     *
     * Keka answers "how do I remove an employee" with Initiate Exit and nothing
     * else. The exit is what gives a leaver a notice period, a clearance list, a
     * settlement, and the seat back on their last working day.
     */
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Zara Khan' }));

    const startExit = await screen.findByRole('link', { name: /Start exit/ });
    expect(startExit).toHaveAttribute('href', '/exits');

    expect(screen.queryByRole('button', { name: /Remove employee/ })).toBeNull();
    expect(apiMocks.deleteUser).not.toHaveBeenCalled();
  });

  it('offers no bulk offboarding, because an exit is a per-person decision', async () => {
    /*
     * The old bulk Remove fired one DELETE per selected person and reported only
     * the successes, so a mixed selection said "Removed 3" while silently
     * dropping seven refusals. An exit has a last working day, a clearance list
     * and a settlement — none of which has a sensible batch form.
     */
    renderWithProviders(<EmployeeManagementWorkspace mode="employees" />, { route: '/employees' });

    expect(await screen.findByRole('heading', { name: 'Employees' })).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Select Zara Khan'));
    fireEvent.click(screen.getByLabelText('Select Ayush Temp'));

    expect(await screen.findByRole('button', { name: /Export selected/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(apiMocks.deleteUser).not.toHaveBeenCalled();
  });
});
