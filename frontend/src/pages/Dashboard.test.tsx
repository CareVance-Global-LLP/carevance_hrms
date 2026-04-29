import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '@/pages/Dashboard';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  summaryMock: vi.fn(),
  attendanceTodayMock: vi.fn(),
  overtimeCreateMock: vi.fn(),
  notificationListMock: vi.fn(),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, name: 'Employee User', email: 'employee@example.com', role: 'employee', organization_id: 1, is_active: true, created_at: '', updated_at: '' },
  }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    dashboardApi: { summary: mocks.summaryMock },
    attendanceApi: { today: mocks.attendanceTodayMock },
    attendanceTimeEditApi: { create: mocks.overtimeCreateMock },
    notificationApi: { list: mocks.notificationListMock },
  };
});

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.summaryMock.mockResolvedValue({
      data: {
        today_entries: [
          {
            id: 5,
            start_time: '2026-03-11T09:00:00Z',
            end_time: '2026-03-11T11:00:00Z',
            duration: 7200,
            description: 'Worked on QA fixes',
            project: { id: 7, name: 'Core Platform' },
          },
        ],
        today_total_elapsed_duration: 14400,
        weekly_total_elapsed_duration: 45600,
        all_time_total_elapsed_duration: 86400,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_projects_count: 2,
        total_projects_count: 3,
      },
    });

    mocks.attendanceTodayMock.mockResolvedValue({
      data: {
        shift_target_seconds: 28800,
        record: {
          worked_seconds: 14400,
          is_checked_in: true,
          shift_target_seconds: 28800,
          attendance_date: '2026-03-11',
          check_in_at: '2026-03-11T09:00:00Z',
          check_out_at: null,
          late_minutes: 0,
        },
      },
    });

    mocks.notificationListMock.mockResolvedValue({
      data: {
        unread_count: 1,
        data: [
          {
            id: 1,
            type: 'announcement',
            title: 'Shift reminder',
            message: 'Please submit pending work updates.',
            is_read: false,
            created_at: '2026-03-11T08:30:00Z',
          },
        ],
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows employee progress metrics without timer controls', async () => {
    renderWithProviders(<Dashboard />);

    expect(await screen.findByRole('heading', { name: "Today's shift" })).toBeInTheDocument();
    expect(screen.getByText('Worked Today')).toBeInTheDocument();
    expect(screen.getByText('Time Left Today')).toBeInTheDocument();
    expect(screen.getByText('Attendance & Shift')).toBeInTheDocument();
    expect(screen.getByText('My Focus')).toBeInTheDocument();
    expect(screen.getByText('Time Tracker')).toBeInTheDocument();
    expect(screen.getByText('This Week')).toBeInTheDocument();
    expect(screen.getByText('12h 40m')).toBeInTheDocument();
    expect(screen.getByText('Quick Actions')).toBeInTheDocument();
    expect(screen.queryByText(/people in your organization/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /sending|send overtime proof/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/start tracking/i)).not.toBeInTheDocument();
  });

  it('shows attendance worked time instead of the smaller timer total when edits increase worked hours', async () => {
    mocks.summaryMock.mockResolvedValue({
      data: {
        today_entries: [
          {
            id: 5,
            start_time: '2026-03-11T09:00:00Z',
            end_time: '2026-03-11T10:16:00Z',
            duration: 4560,
            description: 'Worked on QA fixes',
            project: { id: 7, name: 'Core Platform' },
          },
        ],
        today_total_elapsed_duration: 4560,
        weekly_total_elapsed_duration: 4560,
        all_time_total_elapsed_duration: 4560,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_projects_count: 2,
        total_projects_count: 3,
      },
    });

    mocks.attendanceTodayMock.mockResolvedValue({
      data: {
        shift_target_seconds: 28800,
        record: {
          worked_seconds: 34020,
          is_checked_in: false,
          shift_target_seconds: 28800,
          attendance_date: '2026-03-11',
          check_in_at: '2026-03-11T09:00:00Z',
          check_out_at: '2026-03-11T18:27:00Z',
          late_minutes: 0,
        },
      },
    });

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText(/attendance worked 9h 27m/i)).toBeInTheDocument();
  });

  it('shows task context in the work log and falls back when no task was selected', async () => {
    mocks.summaryMock.mockResolvedValue({
      data: {
        today_entries: [
          {
            id: 5,
            start_time: '2026-03-11T09:00:00Z',
            end_time: '2026-03-11T10:00:00Z',
            duration: 3600,
            description: 'Fallback entry description',
            project: { id: 7, name: 'Core Platform' },
            task: { id: 22, title: 'Fix payroll export', description: 'Repair CSV column order' },
          },
          {
            id: 6,
            start_time: '2026-03-11T10:15:00Z',
            end_time: '2026-03-11T11:00:00Z',
            duration: 2700,
            description: '',
            project: null,
            task: null,
          },
        ],
        today_total_elapsed_duration: 6300,
        weekly_total_elapsed_duration: 6300,
        all_time_total_elapsed_duration: 6300,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_projects_count: 2,
        total_projects_count: 3,
      },
    });

    renderWithProviders(<Dashboard />);

    expect(await screen.findByText('Fix payroll export')).toBeInTheDocument();
    expect(screen.getByText('Repair CSV column order')).toBeInTheDocument();
    expect(screen.getByText('No task selected')).toBeInTheDocument();
    expect(screen.getByText('No description provided')).toBeInTheDocument();
  });

  it('shows universal search suggestions while typing', async () => {
    renderWithProviders(<Dashboard />);

    expect(await screen.findByRole('heading', { name: "Today's shift" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Universal dashboard search'), { target: { value: 'att' } });

    expect(screen.getByRole('option', { name: /attendance open attendance and shift records/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /attendance & shift/i })).toBeInTheDocument();
  });

  it('opens dashboard notifications in a floating panel', async () => {
    renderWithProviders(<Dashboard />);

    const bellButton = await screen.findByRole('button', { name: /notifications/i });
    fireEvent.click(bellButton);

    const panel = await screen.findByRole('region', { name: /dashboard notifications/i });
    expect(within(panel).getByText('Shift reminder')).toBeInTheDocument();
    expect(within(panel).getByText('Please submit pending work updates.')).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: /view all notifications/i })).toHaveAttribute('href', '/notifications');
  });

  it('shows a live seconds clock for the active employee timer', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-11T09:00:29Z'));

    mocks.summaryMock.mockResolvedValue({
      data: {
        active_timer: {
          id: 9,
          start_time: '2026-03-11T09:00:00Z',
          end_time: null,
          duration: 0,
          description: '',
          project: null,
          task: null,
        },
        today_entries: [
          {
            id: 9,
            start_time: '2026-03-11T09:00:00Z',
            end_time: null,
            duration: 0,
            description: '',
            project: null,
            task: null,
          },
        ],
        today_total_elapsed_duration: 0,
        weekly_total_elapsed_duration: 0,
        productivity_score: 0,
        active_projects_count: 1,
        total_projects_count: 1,
      },
    });

    mocks.attendanceTodayMock.mockResolvedValue({
      data: {
        shift_target_seconds: 28800,
        record: {
          worked_seconds: 0,
          is_checked_in: true,
          shift_target_seconds: 28800,
          attendance_date: '2026-03-11',
          check_in_at: '2026-03-11T09:00:00Z',
          check_out_at: null,
          late_minutes: 0,
        },
      },
    });

    renderWithProviders(<Dashboard />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('Time Tracker')).toBeInTheDocument();
    expect(screen.getByText('00:00:29')).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('00:00:30')).toBeInTheDocument();
  });
});
