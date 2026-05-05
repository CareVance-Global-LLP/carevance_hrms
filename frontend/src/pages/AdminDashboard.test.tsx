import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from '@/pages/AdminDashboard';
import { renderWithProviders } from '@/test/renderWithProviders';

const apiMocks = vi.hoisted(() => ({
  users: vi.fn(),
  attendanceSummary: vi.fn(),
  attendanceCalendar: vi.fn(),
  leaveList: vi.fn(),
  overall: vi.fn(),
  dashboardSummary: vi.fn(),
  tasks: vi.fn(),
  payrollRecords: vi.fn(),
  notifications: vi.fn(),
  markAllRead: vi.fn(),
  groups: vi.fn(),
  auditLogs: vi.fn(),
  weeklyReport: vi.fn(),
  monthlyReport: vi.fn(),
  profile360: vi.fn(),
  employeeInsights: vi.fn(),
  screenshots: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Akash Admin', email: 'akash@example.com', role: 'admin', organization_id: 1 },
  }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    userApi: { getAll: apiMocks.users, getProfile360: apiMocks.profile360 },
    attendanceApi: { summary: apiMocks.attendanceSummary, calendar: apiMocks.attendanceCalendar },
    leaveApi: { list: apiMocks.leaveList },
    reportApi: { overall: apiMocks.overall, weekly: apiMocks.weeklyReport, monthly: apiMocks.monthlyReport, employeeInsights: apiMocks.employeeInsights },
    screenshotApi: { getAll: apiMocks.screenshots },
    dashboardApi: { summary: apiMocks.dashboardSummary },
    taskApi: { getAll: apiMocks.tasks },
    payrollSimpleApi: { runs: apiMocks.payrollRecords },
    notificationApi: { list: apiMocks.notifications, markAllRead: apiMocks.markAllRead },
    reportGroupApi: { list: apiMocks.groups },
    auditApi: { list: apiMocks.auditLogs },
  };
});

describe('AdminDashboard WorkWise redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    apiMocks.users.mockResolvedValue({
      data: [
        { id: 1, name: 'Alex Johnson', email: 'alex@carevance.test', role: 'employee', department: 'Design', position: 'UI/UX Designer', is_active: true },
        { id: 2, name: 'Leslie Alexander', email: 'leslie@carevance.test', role: 'employee', department: 'Marketing', position: 'Marketing Manager', is_active: true },
        { id: 3, name: 'Morgan Lee', email: 'morgan@carevance.test', role: 'employee', department: 'Design', position: 'QA Analyst', is_active: true },
      ],
    });
    apiMocks.attendanceSummary.mockResolvedValue({
      data: {
        data: [
          {
            user: { id: 1, name: 'Alex Johnson', email: 'alex@carevance.test', role: 'employee' },
            present_days: 1,
            late_days: 0,
            late_minutes: 0,
            total_worked_seconds: 19800,
            is_checked_in: true,
            check_in_at: '2026-04-27T09:00:00Z',
            check_out_at: null,
            open_punch_in_at: '2026-04-27T09:00:00Z',
            last_check_in_at: '2026-04-27T09:00:00Z',
            last_check_out_at: null,
          },
          {
            user: { id: 2, name: 'Leslie Alexander', email: 'leslie@carevance.test', role: 'employee' },
            present_days: 0,
            late_days: 1,
            late_minutes: 12,
            total_worked_seconds: 0,
            is_checked_in: false,
            check_in_at: '2026-04-27T10:05:00Z',
            check_out_at: '2026-04-27T12:10:00Z',
            last_check_in_at: '2026-04-27T10:05:00Z',
            last_check_out_at: '2026-04-27T12:10:00Z',
          },
        ],
      },
    });
    apiMocks.attendanceCalendar.mockResolvedValue({
      data: {
        month: '2026-04',
        scope: 'overall',
        days: [
          { date: '2026-04-22', status: 'present', is_weekend: false, is_leave: false, is_holiday: false, late_minutes: 0, worked_seconds: 0 },
          { date: '2026-04-23', status: 'checked_in', is_weekend: false, is_leave: false, is_holiday: false, late_minutes: 12, worked_seconds: 0 },
          { date: '2026-04-24', status: 'leave', is_weekend: false, is_leave: true, is_holiday: false, late_minutes: 0, worked_seconds: 0 },
          { date: '2026-04-25', status: 'none', is_weekend: false, is_leave: false, is_holiday: false, late_minutes: 0, worked_seconds: 0 },
        ],
        summary: { present_days: 2, absent_days: 1, weekend_days: 0, leave_days: 1, holiday_days: 0, late_days: 1, total_worked_seconds: 0 },
      },
    });
    apiMocks.leaveList.mockResolvedValue({ data: { data: [{ id: 1, user_id: 2, status: 'approved', start_date: '2026-04-27', end_date: '2026-04-27' }] } });
    apiMocks.overall.mockResolvedValue({
      data: {
        summary: { total_duration: 31500, working_duration: 27000, idle_duration: 4500, active_users: 1 },
        by_user: [],
        by_day: [{ date: '2026-04-27', total_duration: 31500, working_duration: 27000, idle_duration: 4500 }],
      },
    });
    apiMocks.dashboardSummary.mockResolvedValue({
      data: {
        active_timer: { id: 9, start_time: '2026-04-27T09:00:00Z', project: { name: 'Website Redesign' }, task: { title: 'UI Design' } },
        today_total_elapsed_duration: 19800,
        weekly_total_elapsed_duration: 83700,
        today_entries: [],
      },
    });
    apiMocks.tasks.mockResolvedValue({
      data: [
        { id: 1, title: 'Website Redesign', status: 'in_progress' },
        { id: 2, title: 'Mobile App', status: 'todo' },
      ],
    });
    apiMocks.payrollRecords.mockResolvedValue({ data: { data: [{ id: 1, net_pay: 98750, deductions: 18590 }] } });
    apiMocks.notifications.mockResolvedValue({ data: { data: [{ id: 1, title: 'Office closed on May 27', message: 'Memorial Day', is_read: false, created_at: '2026-04-27T08:00:00Z' }] } });
    apiMocks.markAllRead.mockResolvedValue({});
    apiMocks.groups.mockResolvedValue({ data: { data: [{ id: 1, name: 'Design' }, { id: 2, name: 'Marketing' }] } });
    apiMocks.auditLogs.mockResolvedValue({ data: { data: [{ id: 1, action: 'auth.login', actor: { name: 'Akash Admin' }, created_at: '2026-04-27T08:00:00Z' }] } });
    apiMocks.weeklyReport.mockResolvedValue({ data: { time_entries: [], by_project: [], total_duration: 0 } });
    apiMocks.monthlyReport.mockResolvedValue({ data: { by_day: [] } });
    apiMocks.profile360.mockResolvedValue({
      data: {
        summary: { present_days: 4, idle_duration: 1800, attendance_days: 5 },
        status: { is_working: true, latest_attendance: { check_in_at: '2026-04-27T09:00:00Z', check_out_at: null } },
        recent_time_entries: [{ id: 11, description: 'UI polish', duration: 3600, start_time: '2026-04-27T09:00:00Z', project: { name: 'Website Redesign' } }],
        attendance_records: [{ id: 21, attendance_date: '2026-04-27', status: 'present', worked_seconds: 19800, late_minutes: 0 }],
      },
    });
    apiMocks.employeeInsights.mockResolvedValue({
      data: {
        stats: {
          tracked_duration: 19800,
          working_duration: 18000,
          idle_total_duration: 1800,
          productive_duration: 12600,
          unproductive_duration: 900,
          neutral_duration: 450,
          context_dependent_duration: 0,
          activity_total_duration: 13950,
        },
        selected_user_tools: {
          productive: [{ label: 'Figma', classification: 'productive', total_duration: 7200 }],
          unproductive: [{ label: 'Social media', classification: 'unproductive', total_duration: 900 }],
          neutral: [],
          context_dependent: [],
        },
        recent_screenshots: [],
      },
    });
    apiMocks.screenshots.mockResolvedValue({
      data: {
        total: 2,
        data: [
          { id: 31, filename: 'screen-1.png', recorded_at: '2026-04-27T09:30:00Z' },
          { id: 32, filename: 'screen-2.png', recorded_at: '2026-04-27T10:30:00Z' },
        ],
      },
    });
  });

  it('renders the WorkWise-style dashboard sections', async () => {
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect((await screen.findAllByText('Alex Johnson')).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Universal dashboard search')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /add user/i })).toHaveAttribute('href', '/add-user');
    expect(screen.getByText('Date Filter')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Scope')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overall' })).toBeInTheDocument();
    expect(screen.getByText('Scope Summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.getByText('Total Employees')).toBeInTheDocument();
    expect(screen.getAllByText('Present').length).toBeGreaterThan(0);
    expect(screen.getByText('Attendance Overview')).toBeInTheDocument();
    expect(screen.getByText('Leave Summary')).toBeInTheDocument();
    expect(screen.getByText('Department Distribution')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Communication Hub' })).toBeInTheDocument();
    expect(screen.getByText('Birthdays')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Announcements')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current Work Status' })).toBeInTheDocument();
    expect(screen.getAllByText('Working').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Not working').length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Search work status')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter work status by department')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter work status')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Check-In / Check-Out Log' })).toBeInTheDocument();
    expect(screen.getAllByText('Last check in').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Last check out').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Still checked in').length).toBeGreaterThan(0);
    expect(screen.getAllByText('On time').length).toBeGreaterThan(0);
    expect(screen.getByText('12 min late')).toBeInTheDocument();
    expect(screen.getByText('No punch')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Attendance Health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'People Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Employees' })).not.toBeInTheDocument();
    expect(screen.getByText('Manage Employees')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time Tracker' })).toBeInTheDocument();
    expect(screen.getAllByText('Timesheets').length).toBeGreaterThan(0);
    expect(screen.getByText('Payroll Snapshot')).toBeInTheDocument();
    expect(screen.getByText('Task Pipeline')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('opens universal search suggestions and applies employee results', async () => {
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect(await screen.findByText('Dashboard Scope')).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.users).toHaveBeenCalled();
    });
    fireEvent.change(screen.getByLabelText('Universal dashboard search'), { target: { value: 'leslie' } });
    fireEvent.click(await screen.findByRole('button', { name: /Leslie Alexander/ }));

    expect(screen.getByRole('heading', { name: 'Selected Employee Detail' })).toBeInTheDocument();
    expect(screen.getByLabelText('Search scoped employee')).toHaveValue('Leslie Alexander');
  });

  it('opens dashboard notifications in a floating panel and keeps the full center behind view all', async () => {
    const user = userEvent.setup();

    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    const bellButton = await screen.findByRole('button', { name: /notifications/i });
    await waitFor(() => {
      expect(apiMocks.notifications).toHaveBeenCalled();
    });
    await user.click(bellButton);

    const floatingPanel = await screen.findByRole('region', { name: /dashboard notifications/i });
    expect(await within(floatingPanel).findByText('Office closed on May 27')).toBeInTheDocument();
    expect(within(floatingPanel).getByRole('link', { name: /view all notifications/i })).toHaveAttribute('href', '/notifications');
  });

  it('clears the admin dashboard notification dot when notifications are viewed', async () => {
    const user = userEvent.setup();

    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    const bellButton = await screen.findByRole('button', { name: /notifications/i });
    await waitFor(() => {
      expect(bellButton.querySelector('.bg-rose-500')).toBeTruthy();
    });

    await user.click(bellButton);

    await waitFor(() => {
      expect(apiMocks.markAllRead).toHaveBeenCalledWith({
        exclude_types: ['chat_direct_message', 'chat_group_message', 'chat_message', 'direct_message', 'group_message'],
      });
    });
    expect(bellButton.querySelector('.bg-rose-500')).toBeFalsy();
  });

  it('switches to a specific employee and updates the scoped detail panel', async () => {
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect(await screen.findByText('Dashboard Scope')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Specific Employee' }));
    fireEvent.change(screen.getByLabelText('Search scoped employee'), { target: { value: 'leslie' } });

    expect(screen.getByLabelText('Select dashboard employee')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Selected Employee Detail' })).toBeInTheDocument();
    expect(await screen.findByText('Screenshot Access')).toBeInTheDocument();
    expect(screen.getByText('Productivity')).toBeInTheDocument();
    expect(screen.getByText('Top Tools & Sites')).toBeInTheDocument();
    expect(screen.getByText('Recent Work')).toBeInTheDocument();
    expect(screen.getByText('Attendance History')).toBeInTheDocument();
  });

  it('counts missing days as absent for a selected employee range', async () => {
    window.localStorage.setItem('admin-dashboard-filters', JSON.stringify({
      dashboardScope: 'employee',
      selectedEmployeeId: 1,
      scopeDepartmentFilter: 'all',
      datePreset: 'custom',
      customRange: { startDate: '2026-04-23', endDate: '2026-04-27' },
    }));
    apiMocks.attendanceCalendar.mockResolvedValue({
      data: {
        month: '2026-04',
        scope: 'selected',
        days: [
          { date: '2026-04-23', status: 'none', is_weekend: false, is_leave: false, is_holiday: false, late_minutes: 0 },
          { date: '2026-04-24', status: 'none', is_weekend: false, is_leave: false, is_holiday: false, late_minutes: 0 },
          { date: '2026-04-25', status: 'none', is_weekend: true, is_leave: false, is_holiday: false, late_minutes: 0 },
          { date: '2026-04-26', status: 'none', is_weekend: true, is_leave: false, is_holiday: false, late_minutes: 0 },
          { date: '2026-04-27', status: 'present', is_weekend: false, is_leave: false, is_holiday: false, late_minutes: 0 },
        ],
      },
    });

    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    await waitFor(() => {
      expect(apiMocks.attendanceCalendar).toHaveBeenCalledWith({ month: '2026-04', user_id: 1, scope: 'selected' });
    });

    const presentCard = (await screen.findByText('Present days')).closest('div');
    const absentCard = screen.getByText('Absent days').closest('div');

    expect(presentCard).not.toBeNull();
    expect(absentCard).not.toBeNull();
    await waitFor(() => {
      expect(within(presentCard as HTMLElement).getByText('1')).toBeInTheDocument();
      expect(within(absentCard as HTMLElement).getByText('4')).toBeInTheDocument();
    });

    const absentLegend = await screen.findByText('Absent');
    expect(within(absentLegend.closest('div') as HTMLElement).getByText('4')).toBeInTheDocument();
  });

  it('filters current work status by status and search term', async () => {
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect((await screen.findAllByText('Alex Johnson')).length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Filter work status'), { target: { value: 'Working' } });

    expect(screen.getAllByText('Alex Johnson').length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Leslie Alexander')).toHaveLength(0);

    fireEvent.change(screen.getByLabelText('Search work status'), { target: { value: 'leslie' } });
    expect(screen.getByText('No employees found')).toBeInTheDocument();
  });

  it('does not render demo fallback records when the database is empty', async () => {
    apiMocks.users.mockResolvedValue({ data: [] });
    apiMocks.attendanceSummary.mockResolvedValue({ data: { data: [] } });
    apiMocks.attendanceCalendar.mockResolvedValue({ data: { days: [], summary: {} } });
    apiMocks.leaveList.mockResolvedValue({ data: { data: [] } });
    apiMocks.overall.mockResolvedValue({ data: { summary: {}, by_day: [], by_user: [] } });
    apiMocks.dashboardSummary.mockResolvedValue({ data: { active_timer: null, today_total_elapsed_duration: 0, weekly_total_elapsed_duration: 0, today_entries: [] } });
    apiMocks.tasks.mockResolvedValue({ data: [] });
    apiMocks.payrollRecords.mockResolvedValue({ data: { data: [] } });
    apiMocks.notifications.mockResolvedValue({ data: { data: [] } });
    apiMocks.groups.mockResolvedValue({ data: { data: [] } });
    apiMocks.auditLogs.mockResolvedValue({ data: { data: [] } });
    apiMocks.weeklyReport.mockResolvedValue({ data: { time_entries: [], by_project: [], total_duration: 0 } });
    apiMocks.monthlyReport.mockResolvedValue({ data: { by_day: [] } });
    apiMocks.profile360.mockResolvedValue({ data: null });
    apiMocks.employeeInsights.mockResolvedValue({ data: null });
    apiMocks.screenshots.mockResolvedValue({ data: { data: [], total: 0 } });

    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect((await screen.findAllByText('No employees found')).length).toBeGreaterThan(0);
    expect(screen.getByText('No birthdays available')).toBeInTheDocument();
    expect(screen.getByText('No recent activity yet')).toBeInTheDocument();
    expect(screen.getByText('No announcements yet')).toBeInTheDocument();
    expect(screen.getByText('No time entries in this range')).toBeInTheDocument();
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
    expect(screen.queryByText('Website Redesign')).not.toBeInTheDocument();
    expect(screen.queryByText('Mobile App')).not.toBeInTheDocument();
    expect(screen.queryByText('Leslie Alexander')).not.toBeInTheDocument();
    expect(screen.queryByText('₹98,750')).not.toBeInTheDocument();
  });
});
