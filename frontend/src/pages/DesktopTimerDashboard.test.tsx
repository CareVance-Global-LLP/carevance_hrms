import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  armAutoStart,
  DESKTOP_TIMER_IDLE_RESOLVED_EVENT,
  setWorkedBaselineSnapshot,
  suppressAutoStart,
} from '@/lib/desktopTimerSession';
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
  getProjectsMock: vi.fn(),
  breaksTodayMock: vi.fn(),
  breakTypesMock: vi.fn(),
  startBreakMock: vi.fn(),
  endBreakMock: vi.fn(),
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
    projectApi: { getAll: mocks.getProjectsMock },
  };
});

/*
 * fetchData awaits projectApi.getAll() and breakTrackingApi.getToday() inside
 * the same Promise.allSettled as the endpoints above. Leaving them on the real
 * client meant every test in this file hit axios, took a connection refusal,
 * and then sat through the client's retry backoff — which outlasts the test
 * timeout, so the dashboard never left "Loading dashboard..." and all ten tests
 * failed on a harness gap rather than on anything the component did.
 */
vi.mock('@/services/breakTrackingApi', () => ({
  breakTrackingApi: {
    getToday: mocks.breaksTodayMock,
    getTypes: mocks.breakTypesMock,
    startBreak: mocks.startBreakMock,
    endBreak: mocks.endBreakMock,
  },
}));

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

    mocks.getProjectsMock.mockResolvedValue({ data: [] });
    mocks.breaksTodayMock.mockResolvedValue({ breaks: [], active_break: null, total_break_seconds: 0 });
    mocks.breakTypesMock.mockResolvedValue([]);
    mocks.startBreakMock.mockResolvedValue({ break: null });
    mocks.endBreakMock.mockResolvedValue({});
    mocks.stopMock.mockResolvedValue({ data: null });
    mocks.todayMock.mockResolvedValue({ data: { time_entries: [], total_duration: 0 } });
  });

  it('removes the project selector and splits the untasked stretch into its own entry', async () => {
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

    /*
     * Attaching a task to a timer that had none STOPS and restarts rather than
     * updating in place. Updating in place would retroactively relabel time
     * already worked without a task, so the untasked stretch stays its own
     * entry and the new task starts clean.
     *
     * The task's move to in_progress is no longer done from here: the start
     * endpoint does it server-side (TimeEntryController, for employees), and
     * asserting the old client-side call would have this test failing on
     * duplication that was correctly removed.
     */
    await waitFor(() => {
      expect(mocks.stopMock).toHaveBeenCalled();
      expect(mocks.startMock).toHaveBeenCalledWith(
        expect.objectContaining({ project_id: 7, task_id: 42 })
      );
    });
  });

  it('shows the empty task state when no allowed tasks are available', async () => {
    mocks.getTasksMock.mockReset();
    mocks.getTasksMock.mockResolvedValue({ data: [] });

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByText(/timer running/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /active timer task/i })).toBeDisabled();
    // The wording widened from "your assigned groups" to cover the project
    // filter as well - the empty list has two causes and used to name only one.
    expect(
      screen.getByText(/no tasks are available for the selected project and your assigned access/i)
    ).toBeInTheDocument();
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
    /*
     * The 15 minutes already worked survive the stop. That used to read
     * "Today's attendance worked: 0h 15m"; the figure now drives Shift
     * Remaining instead, so 8h target minus 15m worked is the same fact on the
     * surface that still shows it. "Work Time" is a DIFFERENT number - work net
     * of idle, off today_work_time in the summary - and asserting that one here
     * would pass on a fixture that never mentioned attendance at all.
     */
    expect(screen.getByText('07:45:00')).toBeInTheDocument();

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
    // Same fact, current surface: the worked figure drives Shift Remaining now
    // rather than a "today's attendance worked" line of its own. 8h target less
    // the hour already worked.
    expect(screen.getByText('07:00:00')).toBeInTheDocument();
    expect(localStorage.getItem('active_timer_snapshot')).toBeNull();
  });

  it('shows no shift countdown rather than a full shift when nothing has loaded yet', async () => {
    /*
     * The laptop-restart report: "I refresh and it says a whole 8 hour shift is
     * left, I refresh again and the proper time appears."
     *
     * The dashboard request fails — which is what a machine that is up before
     * its network does — and `setIsLoading(false)` runs in a `finally`, so the
     * spinner clears anyway. With no worked-time block and no persisted
     * baseline, the countdown used to render `8h - 0` and present it as fact.
     * Zero here means "nothing loaded", not "nothing worked".
     */
    suppressAutoStart(1);
    localStorage.clear();
    sessionStorage.clear();
    suppressAutoStart(1);

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockRejectedValue(new Error('Network Error'));
    mocks.attendanceTodayMock.mockReset();
    mocks.attendanceTodayMock.mockRejectedValue(new Error('Network Error'));
    // The recovery read fails too, so the countdown genuinely has no basis.
    mocks.todayMock.mockReset();
    mocks.todayMock.mockRejectedValue(new Error('Network Error'));

    renderWithProviders(<DesktopTimerDashboard />);

    expect(await screen.findByText('Shift Remaining')).toBeInTheDocument();
    expect(screen.queryByText('08:00:00')).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('recovers the countdown from time-entries/today when the dashboard carries no worked_time', async () => {
    // Same failure, but the smaller endpoint answers. The countdown must reach
    // the real figure on its own rather than waiting for a manual refresh.
    suppressAutoStart(1);
    localStorage.clear();
    sessionStorage.clear();
    suppressAutoStart(1);

    mocks.summaryMock.mockReset();
    mocks.summaryMock.mockResolvedValue({
      data: {
        active_timer: null,
        today_entries: [],
        today_total_elapsed_duration: 0,
        all_time_total_elapsed_duration: 0,
        team_members_count: 0,
        new_members_this_week: 0,
        productivity_score: 0,
        active_tasks_count: 0,
        total_tasks_count: 0,
      },
    });
    mocks.attendanceTodayMock.mockReset();
    mocks.attendanceTodayMock.mockResolvedValue({
      data: { shift_target_seconds: 28800, record: { worked_seconds: 0, is_checked_in: false, attendance_date: new Date().toISOString().split('T')[0] } },
    });
    mocks.todayMock.mockReset();
    mocks.todayMock.mockResolvedValue({
      data: {
        time_entries: [],
        total_duration: 0,
        worked_time: {
          worked_seconds: 3600,
          billed_seconds: 3600,
          remaining_seconds: 25200,
          overtime_seconds: 0,
          shift_target_seconds: 28800,
        },
      },
    });

    renderWithProviders(<DesktopTimerDashboard />);

    // 8h target minus the 1h the server billed.
    expect(await screen.findByText('07:00:00')).toBeInTheDocument();
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
    // 8h target less the two minutes held in the persisted baseline, which is
    // the whole point here: the backend still says zero, and the countdown must
    // not jump back to a full shift because of it.
    expect(screen.getByText('07:58:00')).toBeInTheDocument();
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
    // Same fact, current surface: 8h target less the five minutes worked. The
    // point is that a failed task-options request does not take the worked
    // total down with it.
    expect(screen.getByText('07:55:00')).toBeInTheDocument();
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
    // Nine hours held in the baseline against an eight-hour target, so the hour
    // of overtime survives all three endpoints being down. That is the fact
    // worth holding: a failed reload must not erase overtime already worked.
    expect(screen.getByText('01:00:00')).toBeInTheDocument();
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
  /*
   * The shift countdown against a running session.
   *
   * `serverWorkedTime` used to be read in the mount fetch and then refreshed
   * only when a timer STOPPED. For the whole length of a session the countdown
   * therefore advanced on raw client wall clock, while `billed_seconds` nets out
   * idle and unpaid breaks — so the two drifted apart by exactly the idle
   * accumulated since mount, and any reload rebased the display onto the server
   * figure and jumped Shift Remaining back up. Both tests below pin the reads
   * that close that window.
   */
  describe('shift countdown stays on the server figure', () => {
    // Mirrors WORKED_TIME_REFRESH_INTERVAL_MS in the component.
    const WORKED_TIME_POLL_MS = 30 * 1000;

    const runningTimer = (startTime: string) => ({
      id: 99,
      user_id: 1,
      project_id: null,
      task_id: null,
      start_time: startTime,
      duration: 60,
      timer_slot: 'primary',
      created_at: startTime,
      updated_at: startTime,
      task: null,
    });

    // The same route into a running session that "keeps a restored running
    // timer after refresh" uses: a snapshot the component restores immediately,
    // confirmed by the active-timer endpoint.
    const withRunningTimer = () => {
      const startTime = new Date(Date.now() - 60 * 1000).toISOString();

      localStorage.setItem('active_timer_snapshot', JSON.stringify({
        id: 99,
        start_time: startTime,
        duration: 60,
        description: 'Running timer',
        timer_slot: 'primary',
      }));

      mocks.summaryMock.mockReset();
      mocks.summaryMock.mockResolvedValue({
        data: {
          active_timer: null,
          today_entries: [],
          today_total_elapsed_duration: 60,
          all_time_total_elapsed_duration: 60,
          team_members_count: 4,
          new_members_this_week: 1,
          productivity_score: 82,
          active_tasks_count: 1,
          total_tasks_count: 1,
        },
      });

      mocks.activeMock.mockReset();
      mocks.activeMock.mockResolvedValue({ data: runningTimer(startTime) });
    };

    const workedTimeResponse = (billedSeconds: number) => ({
      data: {
        time_entries: [],
        total_duration: billedSeconds,
        worked_time: {
          worked_seconds: billedSeconds,
          billed_seconds: billedSeconds,
          shift_target_seconds: 28800,
          remaining_seconds: 28800 - billedSeconds,
          overtime_seconds: 0,
        },
      },
    });

    it('re-reads worked time on a cadence while a timer runs', async () => {
      withRunningTimer();
      mocks.todayMock.mockReset();
      mocks.todayMock.mockResolvedValue(workedTimeResponse(600));

      // Installed before the render, so the poll's interval is registered
      // against the fake clock and can actually be advanced. Installing after
      // mount leaves it on the real timer, where nothing this test does reaches
      // it.
      vi.useFakeTimers({ shouldAdvanceTime: true });
      try {
        renderWithProviders(<DesktopTimerDashboard />);

        expect(await screen.findByText(/timer running/i)).toBeInTheDocument();

        // Nothing polled worked time before the fix: `today` was reached only
        // from the mount path and from a stop, so this stayed flat for the whole
        // session no matter how long it ran.
        const callsWhileRunning = mocks.todayMock.mock.calls.length;

        await vi.advanceTimersByTimeAsync(WORKED_TIME_POLL_MS + 1000);

        expect(mocks.todayMock.mock.calls.length).toBeGreaterThan(callsWhileRunning);
      } finally {
        vi.useRealTimers();
      }
    });

    it('re-reads worked time as soon as an idle stretch is answered', async () => {
      withRunningTimer();
      mocks.todayMock.mockReset();
      mocks.todayMock.mockResolvedValue(workedTimeResponse(600));

      renderWithProviders(<DesktopTimerDashboard />);

      expect(await screen.findByText(/timer running/i)).toBeInTheDocument();
      const callsBeforeAnswer = mocks.todayMock.mock.calls.length;

      // Discarding an idle stretch is the largest single correction the server
      // ever makes, and the prompt that does it lives in another component. With
      // no signal between them the countdown counted straight through the
      // discarded time until the next reload — the "after the popup" report.
      mocks.todayMock.mockResolvedValue(workedTimeResponse(300));
      window.dispatchEvent(
        new CustomEvent(DESKTOP_TIMER_IDLE_RESOLVED_EVENT, {
          detail: { userId: 1, activityId: 7, outcome: 'discarded' },
        }),
      );

      await waitFor(() => {
        expect(mocks.todayMock.mock.calls.length).toBeGreaterThan(callsBeforeAnswer);
      });
    });
  });
});
