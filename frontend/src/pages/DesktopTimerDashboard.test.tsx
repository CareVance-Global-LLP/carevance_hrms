import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { armAutoStart, setWorkedBaselineSnapshot, suppressAutoStart } from '@/lib/desktopTimerSession';
import DesktopTimerDashboard from '@/pages/DesktopTimerDashboard';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  summaryMock: vi.fn(),
  attendanceTodayMock: vi.fn(),
  overtimeCreateMock: vi.fn(),
  startMock: vi.fn(),
  stopMock: vi.fn(),
  activeMock: vi.fn(),
  updateMock: vi.fn(),
  updateTaskStatusMock: vi.fn(),
  todayMock: vi.fn(),
  getTasksMock: vi.fn(),
  authUser: {
    id: 1,
    name: 'Employee User',
    email: 'employee@example.com',
    role: 'employee',
    organization_id: 1,
    is_active: true,
    created_at: '',
    updated_at: '',
  },
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mocks.authUser,
  }),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    dashboardApi: { summary: mocks.summaryMock },
    attendanceApi: { today: mocks.attendanceTodayMock },
    attendanceTimeEditApi: { create: mocks.overtimeCreateMock },
    timeEntryApi: {
      start: mocks.startMock,
      stop: mocks.stopMock,
      active: mocks.activeMock,
      update: mocks.updateMock,
      today: mocks.todayMock,
    },
    taskApi: {
      getAll: mocks.getTasksMock,
      updateStatus: mocks.updateTaskStatusMock,
    },
  };
});

describe('DesktopTimerDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    const runningStartTime = new Date(Date.now() - 5000).toISOString();
    window.desktopTracker = {
      captureScreenshot: vi.fn(),
      getSystemIdleSeconds: vi.fn(),
      getActiveWindowContext: vi.fn(),
      revealWindow: vi.fn(),
    };
    armAutoStart(1);

    mocks.summaryMock
      .mockResolvedValueOnce({
        data: {
          active_timer: null,
          today_entries: [],
          today_total_elapsed_duration: 0,
          all_time_total_elapsed_duration: 0,
          team_members_count: 4,
          new_members_this_week: 1,
          productivity_score: 82,
          active_tasks_count: 1,
          total_tasks_count: 1,
        },
      })
      .mockResolvedValue({
        data: {
        active_timer: {
            id: 99,
            user_id: 1,
            project_id: null,
            task_id: null,
            start_time: runningStartTime,
            duration: 0,
            timer_slot: 'primary',
            created_at: runningStartTime,
            updated_at: runningStartTime,
            task: null,
          },
          today_entries: [],
          today_total_elapsed_duration: 0,
          all_time_total_elapsed_duration: 0,
          team_members_count: 4,
          new_members_this_week: 1,
          productivity_score: 82,
          active_tasks_count: 1,
          total_tasks_count: 1,
        },
      });

    mocks.attendanceTodayMock.mockResolvedValue({
      data: {
        shift_target_seconds: 28800,
        record: {
          worked_seconds: 0,
          is_checked_in: false,
          attendance_date: '2026-03-16',
        },
      },
    });

    mocks.getTasksMock.mockResolvedValue({
      data: [
        {
          id: 42,
          group_id: 7,
          project_id: 7,
          title: 'Write sync logic',
          description: 'Connect the running timer to task selection.',
          status: 'todo',
          priority: 'medium',
          assignee_id: 1,
          group: { id: 7, name: 'Digital Marketing', is_active: true },
          created_at: '2026-03-16T09:00:00Z',
          updated_at: '2026-03-16T09:00:00Z',
        },
      ],
    });

    mocks.updateTaskStatusMock.mockResolvedValue({ data: { id: 42, status: 'in_progress' } });
    mocks.activeMock.mockResolvedValue({ data: null });

    mocks.startMock.mockResolvedValue({
      data: {
        id: 99,
        user_id: 1,
        project_id: null,
        task_id: null,
        start_time: runningStartTime,
        duration: 0,
        timer_slot: 'primary',
        created_at: runningStartTime,
        updated_at: runningStartTime,
      },
    });

    mocks.updateMock.mockResolvedValue({
      data: {
        id: 99,
        user_id: 1,
        project_id: 7,
        task_id: 42,
        start_time: runningStartTime,
        duration: 0,
        timer_slot: 'primary',
        created_at: runningStartTime,
        updated_at: new Date().toISOString(),
        task: {
          id: 42,
          group_id: 7,
          project_id: 7,
          title: 'Write sync logic',
          status: 'in_progress',
          priority: 'medium',
          group: { id: 7, name: 'Digital Marketing', is_active: true },
          created_at: '2026-03-16T09:00:00Z',
          updated_at: '2026-03-16T09:00:00Z',
        },
      },
    });

    mocks.stopMock.mockResolvedValue({ data: null });
    mocks.todayMock.mockResolvedValue({ data: { time_entries: [], total_duration: 0 } });
  });

  it('removes the project selector and updates the running timer from the task selector only', async () => {
    const user = userEvent.setup();

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByText(/timer running/i)).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /active timer project/i })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.startMock).toHaveBeenCalledTimes(1);
      expect(mocks.getTasksMock).toHaveBeenCalledWith({ timer_only: true });
    });

    await user.click(screen.getByRole('button', { name: /active timer task/i }));
    await user.click(screen.getByRole('option', { name: /write sync logic - digital marketing/i }));

    await waitFor(() => {
      expect(mocks.updateMock).toHaveBeenCalledWith(99, expect.objectContaining({ project_id: 7, task_id: 42 }));
      expect(mocks.updateTaskStatusMock).toHaveBeenCalledWith(42, 'in_progress');
    });
  });

  it('shows the empty task state when no allowed tasks are available', async () => {
    mocks.getTasksMock.mockReset();
    mocks.getTasksMock.mockResolvedValue({ data: [] });

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByText(/timer running/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /active timer task/i })).toBeDisabled();
    expect(screen.getByText(/no tasks are currently available for your assigned groups/i)).toBeInTheDocument();
  });

  it('keeps the timer stopped after a manual stop', async () => {
    const user = userEvent.setup();
    const runningStartTime = new Date(Date.now() - 5000).toISOString();
    const emptySummary = {
      data: {
        active_timer: null,
        today_entries: [],
        today_total_elapsed_duration: 0,
        all_time_total_elapsed_duration: 0,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_tasks_count: 1,
        total_tasks_count: 1,
      },
    };
    const runningSummary = {
      data: {
        active_timer: {
          id: 99,
          user_id: 1,
          project_id: null,
          task_id: null,
          start_time: runningStartTime,
          duration: 0,
          timer_slot: 'primary',
          created_at: runningStartTime,
          updated_at: runningStartTime,
          task: null,
        },
        today_entries: [],
        today_total_elapsed_duration: 0,
        all_time_total_elapsed_duration: 0,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_tasks_count: 1,
        total_tasks_count: 1,
      },
    };

    mocks.summaryMock.mockReset();
    mocks.summaryMock
      .mockResolvedValueOnce(emptySummary)
      .mockResolvedValueOnce(runningSummary)
      .mockResolvedValue(emptySummary);

    mocks.attendanceTodayMock.mockReset();
    mocks.attendanceTodayMock
      .mockResolvedValueOnce({
        data: {
          shift_target_seconds: 28800,
          record: {
            worked_seconds: 0,
            is_checked_in: false,
            attendance_date: '2026-03-16',
          },
        },
      })
      .mockResolvedValueOnce({
        data: {
          shift_target_seconds: 28800,
          record: {
            worked_seconds: 0,
            is_checked_in: true,
            attendance_date: '2026-03-16',
          },
        },
      })
      .mockResolvedValue({
        data: {
          shift_target_seconds: 28800,
          record: {
            worked_seconds: 900,
            is_checked_in: false,
            attendance_date: '2026-03-16',
          },
        },
      });

    mocks.stopMock.mockResolvedValue({
      data: {
        id: 99,
        user_id: 1,
        project_id: null,
        task_id: null,
        start_time: runningStartTime,
        end_time: new Date().toISOString(),
        duration: 900,
        timer_slot: 'primary',
        created_at: runningStartTime,
        updated_at: new Date().toISOString(),
      },
    });

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByRole('button', { name: /pause timer/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /pause timer/i }));

    await waitFor(() => {
      expect(mocks.stopMock).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('button', { name: /start timer/i })).toBeInTheDocument();
    });

    expect(screen.getAllByText('00:00:00').length).toBeGreaterThan(0);
    expect(screen.getByText(/today's attendance worked: 0h 15m/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(mocks.startMock).toHaveBeenCalledTimes(1);
    });
  });

  it('does not auto-start in browser mode even when auto-start is armed', async () => {
    delete window.desktopTracker;

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByRole('button', { name: /start timer/i })).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.summaryMock).toHaveBeenCalledTimes(1);
    });
    expect(mocks.startMock).not.toHaveBeenCalled();
  });

  it('restores the timer snapshot immediately while dashboard data is loading', async () => {
    localStorage.setItem('active_timer_snapshot', JSON.stringify({
      id: 120,
      start_time: new Date().toISOString(),
      duration: 3600,
      description: 'Restored timer',
      timer_slot: 'primary',
    }));

    mocks.summaryMock.mockImplementation(() => new Promise(() => {}));
    mocks.attendanceTodayMock.mockImplementation(() => new Promise(() => {}));
    mocks.getTasksMock.mockImplementation(() => new Promise(() => {}));

    renderWithProviders(<DesktopTimerDashboard />);

    await waitFor(() => {
      expect(screen.queryByText(/loading dashboard/i)).not.toBeInTheDocument();
    });
    expect(await screen.findByText(/01:00:0[0-1]/)).toBeInTheDocument();
    expect(screen.getByText(/timer running/i)).toBeInTheDocument();
  });

  it('does not restore a stopped timer snapshot after reload', async () => {
    localStorage.setItem('active_timer_snapshot', JSON.stringify({
      id: 120,
      start_time: new Date().toISOString(),
      duration: 3600,
      description: 'Stopped timer',
      timer_slot: 'primary',
    }));
    suppressAutoStart(1);

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockResolvedValue({
      data: {
        active_timer: null,
        today_entries: [],
        today_total_elapsed_duration: 3600,
        all_time_total_elapsed_duration: 3600,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_tasks_count: 1,
        total_tasks_count: 1,
      },
    });

    mocks.attendanceTodayMock.mockResolvedValue({
      data: {
        shift_target_seconds: 28800,
        record: {
          worked_seconds: 3600,
          is_checked_in: false,
          attendance_date: '2026-03-16',
        },
      },
    });

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByRole('button', { name: /start timer/i })).toBeInTheDocument();
    expect(screen.getAllByText('00:00:00').length).toBeGreaterThan(0);
    expect(screen.getByText(/today's attendance worked: 1h 0m/i)).toBeInTheDocument();
    expect(localStorage.getItem('active_timer_snapshot')).toBeNull();
  });

  it('keeps paused shift context after reload when backend totals are not updated yet', async () => {
    const today = new Date().toISOString().split('T')[0];
    suppressAutoStart(1);
    setWorkedBaselineSnapshot(1, 120, today);
    sessionStorage.clear();
    suppressAutoStart(1);

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockResolvedValue({
      data: {
        active_timer: null,
        today_entries: [],
        today_total_elapsed_duration: 0,
        all_time_total_elapsed_duration: 0,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_tasks_count: 1,
        total_tasks_count: 1,
      },
    });

    mocks.attendanceTodayMock.mockReset();
    mocks.attendanceTodayMock.mockResolvedValue({
      data: {
        shift_target_seconds: 28800,
        record: {
          worked_seconds: 0,
          is_checked_in: false,
          attendance_date: today,
        },
      },
    });

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByRole('button', { name: /start timer/i })).toBeInTheDocument();
    expect(screen.getByText(/timer paused/i)).toBeInTheDocument();
    expect(screen.getByText('07:58:00')).toBeInTheDocument();
    expect(screen.getByText(/today's attendance worked: 0h 2m/i)).toBeInTheDocument();
  });

  it('keeps today entries and worked totals when task options request fails', async () => {
    suppressAutoStart(1);
    const today = new Date().toISOString().split('T')[0];

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockResolvedValue({
      data: {
        active_timer: null,
        today_entries: [
          {
            id: 777,
            user_id: 1,
            project_id: null,
            task_id: null,
            start_time: `${today}T09:00:00Z`,
            end_time: `${today}T09:05:00Z`,
            duration: 300,
            timer_slot: 'primary',
            created_at: `${today}T09:00:00Z`,
            updated_at: `${today}T09:05:00Z`,
            task: { title: 'Prepare campaign brief', group: { id: 7, name: 'Digital Marketing' } },
          },
        ],
        today_total_elapsed_duration: 300,
        all_time_total_elapsed_duration: 300,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_tasks_count: 1,
        total_tasks_count: 1,
      },
    });

    mocks.attendanceTodayMock.mockReset();
    mocks.attendanceTodayMock.mockResolvedValue({
      data: {
        shift_target_seconds: 28800,
        record: {
          worked_seconds: 300,
          is_checked_in: false,
          attendance_date: today,
        },
      },
    });

    mocks.getTasksMock.mockReset();
    mocks.getTasksMock.mockRejectedValue(new Error('Task API down'));

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByRole('button', { name: /start timer/i })).toBeInTheDocument();
    expect(screen.getByText(/prepare campaign brief/i)).toBeInTheDocument();
    expect(screen.getByText(/today's attendance worked: 0h 5m/i)).toBeInTheDocument();
    expect(screen.getByText(/some dashboard data could not be loaded/i)).toBeInTheDocument();
  });

  it('keeps a restored running timer after refresh when the active timer endpoint still sees it', async () => {
    const runningStartTime = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    localStorage.setItem('active_timer_snapshot', JSON.stringify({
      id: 120,
      start_time: runningStartTime,
      duration: 300,
      description: 'Restored timer',
      timer_slot: 'primary',
    }));

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockResolvedValue({
      data: {
        active_timer: null,
        today_entries: [],
        today_total_elapsed_duration: 300,
        all_time_total_elapsed_duration: 300,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_tasks_count: 1,
        total_tasks_count: 1,
      },
    });

    mocks.activeMock.mockReset();
    mocks.activeMock.mockResolvedValue({
      data: {
        id: 120,
        user_id: 1,
        project_id: null,
        task_id: null,
        start_time: runningStartTime,
        duration: 300,
        timer_slot: 'primary',
        created_at: runningStartTime,
        updated_at: runningStartTime,
        task: null,
      },
    });

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByText(/timer running/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(mocks.activeMock).toHaveBeenCalledWith({ timer_slot: 'primary' });
    });
    expect(localStorage.getItem('active_timer_snapshot')).not.toBeNull();
    expect(screen.queryByText(/previous running timer was not found and was cleared/i)).not.toBeInTheDocument();
  });

  it('keeps overtime context after reload when summary endpoints fail', async () => {
    const today = new Date().toISOString().split('T')[0];
    suppressAutoStart(1);
    setWorkedBaselineSnapshot(1, 32400, today);
    sessionStorage.clear();
    suppressAutoStart(1);

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockRejectedValue(new Error('Summary API down'));

    mocks.attendanceTodayMock.mockReset();
    mocks.attendanceTodayMock.mockRejectedValue(new Error('Attendance API down'));

    mocks.getTasksMock.mockReset();
    mocks.getTasksMock.mockRejectedValue(new Error('Tasks API down'));

    mocks.todayMock.mockReset();
    mocks.todayMock.mockResolvedValue({ data: { time_entries: [], total_duration: 0 } });

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByRole('button', { name: /start timer/i })).toBeInTheDocument();
    expect(screen.getByText(/timer paused/i)).toBeInTheDocument();
    expect(screen.getByText('01:00:00')).toBeInTheDocument();
    expect(screen.getByText(/today's attendance worked: 9h 0m/i)).toBeInTheDocument();
  });

  it('shows a leave-specific red error when timer start is blocked by approved leave', async () => {
    const user = userEvent.setup();

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockResolvedValue({
      data: {
        active_timer: null,
        today_entries: [],
        today_total_elapsed_duration: 0,
        all_time_total_elapsed_duration: 0,
        team_members_count: 4,
        new_members_this_week: 1,
        productivity_score: 82,
        active_tasks_count: 1,
        total_tasks_count: 1,
      },
    });

    mocks.startMock.mockReset();
    mocks.startMock.mockRejectedValue({
      response: {
        data: {
          error_code: 'ON_APPROVED_LEAVE',
          message: 'You are on approved leave today. Timer cannot start.',
        },
      },
    });

    renderWithProviders(<DesktopTimerDashboard />);

    await user.click(await screen.findByRole('button', { name: /start timer/i }));

    expect(await screen.findByText('You are on approved leave today. Timer cannot start.')).toBeInTheDocument();
  });
});
