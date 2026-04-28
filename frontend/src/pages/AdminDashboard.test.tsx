import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AdminDashboard from '@/pages/AdminDashboard';
import { renderWithProviders } from '@/test/renderWithProviders';

const apiMocks = vi.hoisted(() => ({
  users: vi.fn(),
  attendanceSummary: vi.fn(),
  leaveList: vi.fn(),
  overall: vi.fn(),
  dashboardSummary: vi.fn(),
  tasks: vi.fn(),
  payrollRecords: vi.fn(),
  notifications: vi.fn(),
  groups: vi.fn(),
  auditLogs: vi.fn(),
  weeklyReport: vi.fn(),
  monthlyReport: vi.fn(),
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
    userApi: { getAll: apiMocks.users },
    attendanceApi: { summary: apiMocks.attendanceSummary },
    leaveApi: { list: apiMocks.leaveList },
    reportApi: { overall: apiMocks.overall, weekly: apiMocks.weeklyReport, monthly: apiMocks.monthlyReport },
    dashboardApi: { summary: apiMocks.dashboardSummary },
    taskApi: { getAll: apiMocks.tasks },
    payrollApi: { getRecords: apiMocks.payrollRecords },
    notificationApi: { list: apiMocks.notifications },
    reportGroupApi: { list: apiMocks.groups },
    auditApi: { list: apiMocks.auditLogs },
  };
});

describe('AdminDashboard WorkWise redesign', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    apiMocks.users.mockResolvedValue({
      data: [
        { id: 1, name: 'Alex Johnson', email: 'alex@carevance.test', role: 'employee', department: 'Design', position: 'UI/UX Designer', is_active: true },
        { id: 2, name: 'Leslie Alexander', email: 'leslie@carevance.test', role: 'employee', department: 'Marketing', position: 'Marketing Manager', is_active: true },
      ],
    });
    apiMocks.attendanceSummary.mockResolvedValue({
      data: {
        data: [
          { user: { id: 1, name: 'Alex Johnson', email: 'alex@carevance.test', role: 'employee' }, present_days: 1, late_days: 0, total_worked_seconds: 19800, is_checked_in: true },
          { user: { id: 2, name: 'Leslie Alexander', email: 'leslie@carevance.test', role: 'employee' }, present_days: 0, late_days: 1, total_worked_seconds: 0, is_checked_in: false },
        ],
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
    apiMocks.notifications.mockResolvedValue({ data: { data: [{ id: 1, title: 'Office closed on May 27', message: 'Memorial Day', created_at: '2026-04-27T08:00:00Z' }] } });
    apiMocks.groups.mockResolvedValue({ data: { data: [{ id: 1, name: 'Design' }, { id: 2, name: 'Marketing' }] } });
    apiMocks.auditLogs.mockResolvedValue({ data: { data: [{ id: 1, action: 'auth.login', actor: { name: 'Akash Admin' }, created_at: '2026-04-27T08:00:00Z' }] } });
    apiMocks.weeklyReport.mockResolvedValue({ data: { time_entries: [], by_project: [], total_duration: 0 } });
    apiMocks.monthlyReport.mockResolvedValue({ data: { by_day: [] } });
  });

  it('renders the WorkWise-style dashboard sections', async () => {
    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Total Employees')).toBeInTheDocument();
    expect(screen.getByText('Present Today')).toBeInTheDocument();
    expect(screen.getByText('Attendance Overview')).toBeInTheDocument();
    expect(screen.getByText('Leave Summary')).toBeInTheDocument();
    expect(screen.getByText('Department Distribution')).toBeInTheDocument();
    expect(screen.getByText('Upcoming Birthdays')).toBeInTheDocument();
    expect(screen.getByText('Recent Activities')).toBeInTheDocument();
    expect(screen.getByText('Announcements')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Employees' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Time Tracker' })).toBeInTheDocument();
    expect(screen.getByText('Timesheets')).toBeInTheDocument();
    expect(screen.getByText('Payroll Summary')).toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByText('Projects')).toBeInTheDocument();
  });

  it('does not render demo fallback records when the database is empty', async () => {
    apiMocks.users.mockResolvedValue({ data: [] });
    apiMocks.attendanceSummary.mockResolvedValue({ data: { data: [] } });
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

    renderWithProviders(<AdminDashboard />, { route: '/dashboard' });

    expect(await screen.findByText('No employees found')).toBeInTheDocument();
    expect(screen.getByText('No birthdays available')).toBeInTheDocument();
    expect(screen.getByText('No recent activity yet')).toBeInTheDocument();
    expect(screen.getByText('No announcements yet')).toBeInTheDocument();
    expect(screen.getByText('No time entries this week')).toBeInTheDocument();
    expect(screen.getByText('No projects yet')).toBeInTheDocument();
    expect(screen.queryByText('Website Redesign')).not.toBeInTheDocument();
    expect(screen.queryByText('Mobile App')).not.toBeInTheDocument();
    expect(screen.queryByText('Leslie Alexander')).not.toBeInTheDocument();
    expect(screen.queryByText('₹98,750')).not.toBeInTheDocument();
  });
});
