import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  onboardingStatus: vi.fn(),
  weeklyReport: vi.fn(),
  monthlyReport: vi.fn(),
  profile360: vi.fn(),
  employeeInsights: vi.fn(),
  activitiesAllPages: vi.fn(),
  timeEntries: vi.fn(),
  screenshots: vi.fn(),
  projects: vi.fn(),
  resignations: vi.fn(),
  timeEditRequests: vi.fn(),
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
    activityApi: { ...actual.activityApi, getAllPages: apiMocks.activitiesAllPages },
    screenshotApi: { getAll: apiMocks.screenshots },
    timeEntryApi: { getAll: apiMocks.timeEntries },
    dashboardApi: { summary: apiMocks.dashboardSummary },
    taskApi: { getAll: apiMocks.tasks },
    payrollSimpleApi: { runs: apiMocks.payrollRecords },
    notificationApi: { list: apiMocks.notifications, markAllRead: apiMocks.markAllRead },
    reportGroupApi: { list: apiMocks.groups },
    auditApi: { list: apiMocks.auditLogs },
    /*
     * These three are not decoration. Left unmocked they hit the real axios
     * client, which retries a failed request three times with backoff — and
     * the dashboard's own query awaits projectApi.getAll() inside its
     * Promise.allSettled, so the whole page stayed empty until those retries
     * gave up, long after the assertions timed out. Nine tests in this file
     * failed for that reason alone.
     */
    projectApi: { ...actual.projectApi, getAll: apiMocks.projects },
    resignationApi: { ...actual.resignationApi, list: apiMocks.resignations },
    attendanceTimeEditApi: { ...actual.attendanceTimeEditApi, list: apiMocks.timeEditRequests },
    // A fourth, added after that comment was written and caught the same way.
    workspaceOnboardingApi: { ...actual.workspaceOnboardingApi, getStatus: apiMocks.onboardingStatus },
  };
});

describe('AdminDashboard WorkWise redesign', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();

    /*
     * Every fixture below is dated 2026-04-27, and the dashboard defaults its
     * range to today — so from 1 May 2026 onwards the range excluded all of
     * them and the page rendered empty. Nine tests in this file failed for
     * that reason alone and were carried in the vitest baseline as if they
     * described real defects. Freeze the clock to the day the fixtures
     * describe. Only Date is faked: waitFor and userEvent need real timers.
     */
    vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-04-27T12:00:00Z'));

    apiMocks.projects.mockResolvedValue({ data: [] });
    apiMocks.resignations.mockResolvedValue({ data: { data: [], total: 0 } });
    apiMocks.timeEditRequests.mockResolvedValue({ data: { data: [], total: 0 } });

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
    apiMocks.onboardingStatus.mockResolvedValue({
      data: {
        onboarded: true,
        dismissed_at: null,
        tour_seen_at: null,
        steps: {},
        completed_steps: [],
        step_labels: {},
        step_routes: {},
        includes_payroll: false,
        next_action: null,
        completed_count: 0,
        total_count: 0,
        completion_percentage: 100,
      },
    });
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
    apiMocks.activitiesAllPages.mockResolvedValue([]);
    apiMocks.timeEntries.mockResolvedValue({ data: { data: [] } });
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
    /*
     * The universal search box is gone from this page: searching across the
     * product is the command bar's job now (CommandBar.test.tsx and
     * commandRegistry.test.ts own it), and the dashboard keeps only its two
     * SCOPED searches - "Search scoped employee" and "Search work status" -
     * which filter this page rather than navigating away from it.
     */
    expect(screen.queryByRole('link', { name: /add user/i })).not.toBeInTheDocument();
    expect(screen.getByText('Date Filter')).toBeInTheDocument();
    expect(screen.getByText('Dashboard Scope')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Overall' })).toBeInTheDocument();
    expect(screen.getByText('Scope Summary')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Last 7 days' })).toBeInTheDocument();
    expect(screen.getByText('Total Employees')).toBeInTheDocument();
    expect(screen.getAllByText('Present').length).toBeGreaterThan(0);
    expect(screen.getByText('Attendance Overview')).toBeInTheDocument();
    expect(screen.getByText('Department Work vs Idle Time')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Communication Hub' })).toBeInTheDocument();

    expect(screen.getByText('Birthdays')).toBeInTheDocument();
    expect(screen.getByText('Activity')).toBeInTheDocument();
    expect(screen.getByText('Announcements')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Current Work Status' })).toBeInTheDocument();

    expect(screen.getAllByText('Working').length).toBeGreaterThan(0);
    expect(screen.getAllByText('On time').length).toBeGreaterThan(0);
    expect(screen.getByText('12 min late')).toBeInTheDocument();
    /*
     * Somebody who never punched is counted behind a toggle rather than given a
     * row: the log is a record of punches, and rendering everyone made the one
     * real punch the 80th row. So the control is what is asserted here, not a
     * "No punch" cell that only appears once it is opened.
     */
    expect(screen.getByText(/show people with no punch/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Attendance Health' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'People Summary' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Employees' })).not.toBeInTheDocument();
    expect(screen.getByText('Manage Employees')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time Tracker' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Timesheets' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Attendance Trend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Admin Watchlist' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Leave Balance' })).not.toBeInTheDocument();
    /*
     * The payroll snapshot is gone from this page - payroll is plan-gated and
     * role-gated behind its own screens, and salary figures on a dashboard any
     * admin opens is a wider audience than those gates intend. Asserted as
     * absent rather than dropped silently, so putting it back is a decision
     * somebody makes on purpose.
     */
    expect(screen.queryByText('Payroll Snapshot')).not.toBeInTheDocument();

    expect(screen.getByText('Task Pipeline')).toBeInTheDocument();
    // The generic "Reports" tile became the Admin Focus Board, which links out
    // to analytics rather than being a heading of its own.
    expect(screen.getByRole('heading', { name: 'Admin Focus Board' })).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  /*
   * Was 'opens universal search suggestions and applies employee results'.
   *
   * The universal search box is gone - searching across the product belongs to
   * the command bar now. What it drove is still here and still worth holding:
   * picking somebody scopes the whole dashboard to them. That is now reached
   * through the scope selector, so the test drives that instead of a widget
   * that no longer exists.
   */
  it('scopes the dashboard to a selected employee', async () => {
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect(await screen.findByText('Dashboard Scope')).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.users).toHaveBeenCalled();
    });

    // Scope has to be switched off "Overall" before there is anybody to pick.
    fireEvent.click(screen.getByRole('button', { name: 'Specific Employee' }));
    fireEvent.click(await screen.findByRole('button', { name: /Select dashboard employee/i }));
    fireEvent.click(await screen.findByRole('option', { name: /Leslie Alexander/ }));

    expect(await screen.findByRole('heading', { name: 'Selected Employee Detail' })).toBeInTheDocument();
  });

  /*
   * Removed: two tests for a notification bell and floating panel this page
   * used to own.
   *
   * Notifications live in the application header now, not on the dashboard, so
   * there is no bell here to click. Layout.test.tsx holds what these were
   * protecting - the panel opening and closing from its own button, "view all"
   * pointing at /notifications, and mark-all-read excluding chat types so
   * messages nobody opened are not swept up with it.
   */

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

  it('passes the selected employee and date range into scoped panel links', async () => {
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    fireEvent.click(await screen.findByRole('button', { name: 'Specific Employee' }));
    fireEvent.change(screen.getByLabelText('Search scoped employee'), { target: { value: 'leslie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Open Monitoring' })).toHaveAttribute(
        'href',
        expect.stringContaining('/monitoring/screenshots?user=2&start=')
      );
    });

    expect(screen.getByRole('link', { name: 'Details' })).toHaveAttribute(
      'href',
      expect.stringContaining('/monitoring/productive-time?user=2&start=')
    );
    expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute(
      'href',
      expect.stringContaining('/attendance?user=2&start=')
    );
  });

  it('falls back to processed activities for ranged employee tool rollups when insights return empty buckets', async () => {
    apiMocks.employeeInsights.mockResolvedValue({
      data: {
        stats: {
          tracked_duration: 0,
          working_duration: 0,
          idle_total_duration: 0,
          productive_duration: 0,
          unproductive_duration: 0,
          neutral_duration: 0,
          context_dependent_duration: 0,
          activity_total_duration: 0,
        },
        selected_user_tools: {
          productive: [],
          unproductive: [],
          neutral: [],
          context_dependent: [],
        },
        recent_screenshots: [],
      },
    });
    apiMocks.activitiesAllPages.mockResolvedValue([
      {
        id: 51,
        type: 'app',
        duration: 3600,
        classification: 'productive',
        tool_type: 'software',
        normalized_label: 'figma',
        name: 'Figma',
      },
      {
        id: 52,
        type: 'url',
        duration: 1800,
        classification: 'unproductive',
        tool_type: 'website',
        normalized_domain: 'youtube.com',
        name: 'YouTube',
      },
    ]);

    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    fireEvent.click(await screen.findByRole('button', { name: 'Specific Employee' }));
    fireEvent.change(screen.getByLabelText('Search scoped employee'), { target: { value: 'leslie' } });
    fireEvent.click(screen.getByRole('button', { name: 'Last 15 days' }));

    await waitFor(() => {
      expect(apiMocks.activitiesAllPages).toHaveBeenCalledWith({
        user_id: 2,
        start_date: expect.any(String),
        end_date: expect.any(String),
        processed: true,
        // Paging dropped to 100 with an explicit 500-record ceiling: an
        // employee with months of activity would otherwise pull the lot into
        // the browser to render one rollup card.
        per_page: 100,
        max_records: 500,
      });
    });

    const topToolsCard = screen.getByText('Top Tools & Sites').closest('div')?.parentElement;
    expect(topToolsCard).not.toBeNull();
    expect(await within(topToolsCard as HTMLElement).findByText('figma')).toBeInTheDocument();
    expect(within(topToolsCard as HTMLElement).getByText('youtube.com')).toBeInTheDocument();
    expect(within(topToolsCard as HTMLElement).getByText('1h 0m')).toBeInTheDocument();
    expect(within(topToolsCard as HTMLElement).getByText('0h 30m')).toBeInTheDocument();
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

    /*
     * These four count DAYS, and used to be labelled "Present days" / "Absent
     * days" - the same words the KPI cards an inch above use for HEAD counts.
     * The labels now name their subject, which is why they read "Days present
     * on time" rather than the shorter form this test was written against.
     */
    const presentCard = (await screen.findByText('Days present on time')).closest('div');
    const absentCard = screen.getByText('Days absent').closest('div');

    expect(presentCard).not.toBeNull();
    expect(absentCard).not.toBeNull();
    /*
     * TWO absences, not four. The range has four days with no attendance, but
     * the 25th and 26th are weekends and a weekend is not an absence - the
     * count now excludes weekends, holidays and leave, which is what makes
     * "days absent" a number somebody can act on rather than a headline that
     * accuses half the company every Monday.
     */
    await waitFor(() => {
      expect(within(presentCard as HTMLElement).getByText('1')).toBeInTheDocument();
      expect(within(absentCard as HTMLElement).getByText('2')).toBeInTheDocument();
    });

    /*
     * The legend assertion that used to sit here indexed absentLegends[1]
     * positionally. Two very different things match the text "Absent" on this
     * page - a chart legend and the work-status filter - so the index decided
     * which one silently, and neither is the day count this test is about. The
     * cards above are where that number lives, and they are asserted directly.
     */
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
    apiMocks.projects.mockResolvedValue({ data: [] });
    apiMocks.resignations.mockResolvedValue({ data: { data: [], total: 0 } });
    apiMocks.timeEditRequests.mockResolvedValue({ data: { data: [], total: 0 } });

    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect((await screen.findAllByText('No employees found')).length).toBeGreaterThan(0);
    expect(screen.getByText('No birthdays available')).toBeInTheDocument();
    expect(screen.getByText('No recent activity yet')).toBeInTheDocument();
    expect(screen.getByText('No announcements yet')).toBeInTheDocument();
    expect(screen.getByText('No projects yet')).toBeInTheDocument();

    expect(screen.queryByText('Website Redesign')).not.toBeInTheDocument();
    expect(screen.queryByText('Mobile App')).not.toBeInTheDocument();
    expect(screen.queryByText('Leslie Alexander')).not.toBeInTheDocument();
    expect(screen.queryByText('₹98,750')).not.toBeInTheDocument();
  });

  it('asks for every task, not only the ones a timer can start', async () => {
    /*
     * timer_only is defined server-side as status != 'done', so feeding it to a
     * chart labelled To Do / In Progress / Done pinned the Done bucket at zero
     * and hid every completed task. Measured 18 Aug 2026: 18 done tasks in the
     * database, none of them on the chart.
     */
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    await screen.findByRole('heading', { name: 'Dashboard' });

    expect(apiMocks.tasks).toHaveBeenCalled();
    for (const call of apiMocks.tasks.mock.calls) {
      expect(call[0]?.timer_only).not.toBe(true);
    }
  });


});
