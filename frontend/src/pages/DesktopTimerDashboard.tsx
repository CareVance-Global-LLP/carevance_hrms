import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { attendanceApi, attendanceTimeEditApi, timeEntryApi, dashboardApi, taskApi } from '@/services/api';
import {
  ACTIVE_TIMER_KEY,
  canUseDesktopAutoStart,
  clearAutoStartArm,
  clearAutoStartSuppression,
  clearIdleAutoStopNotice,
  clearWorkedBaselineSnapshot,
  consumeIdleAutoStopNotice,
  DESKTOP_TIMER_IDLE_STOP_EVENT,
  emitDesktopTimerStarted,
  emitDesktopTimerStopped,
  getWorkedBaselineSnapshot,
  setWorkedBaselineSnapshot,
  type DesktopTimerIdleStopDetail,
  isAutoStartArmed,
  isAutoStartSuppressed,
  seedDesktopLaunchAutoStart,
  suppressAutoStart,
} from '@/lib/desktopTimerSession';
import { isTrackedTimerUser } from '@/lib/permissions';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';
import { SelectInput } from '@/components/ui/FormField';
import StatusBadge from '@/components/ui/StatusBadge';
import {
  Clock,
  Play,
  Pause,
  TrendingUp,
  Users,
  FolderKanban,
  Calendar,
  Building2,
} from 'lucide-react';
import { getTimeEntrySubtitle, getTimeEntryTitle } from '@/lib/timeEntryDisplay';
import type { TimeEntry } from '@/types';
import type { Task } from '@/types';

const getStartTimeMs = (startTime?: string) => {
  if (!startTime) return NaN;
  const parsed = new Date(startTime).getTime();
  if (Number.isFinite(parsed)) return parsed;
  const normalized = startTime.includes('T') ? startTime : startTime.replace(' ', 'T');
  return new Date(normalized).getTime();
};

const getLocalDateString = () => {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().split('T')[0];
};

const getEntryLocalDateString = (value?: string) => {
  const parsedMs = getStartTimeMs(value);
  if (!Number.isFinite(parsedMs)) {
    return '';
  }

  const date = new Date(parsedMs);
  const timezoneOffsetMs = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - timezoneOffsetMs).toISOString().split('T')[0];
};

const restoreTimerSnapshot = (
  userId: number | null,
  organizationId: number | null | undefined,
): TimeEntry | null => {
  if (isAutoStartSuppressed(userId)) {
    localStorage.removeItem(ACTIVE_TIMER_KEY);
    return null;
  }

  const rawSnapshot = localStorage.getItem(ACTIVE_TIMER_KEY);
  if (!rawSnapshot) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawSnapshot) as Partial<TimeEntry>;
    const entryId = Number(parsed.id);
    const duration = Number.isFinite(Number(parsed.duration)) ? Number(parsed.duration) : 0;
    const startTime = typeof parsed.start_time === 'string' ? parsed.start_time : '';

    if (!entryId || !startTime) {
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      return null;
    }

    if (getEntryLocalDateString(startTime) !== getLocalDateString()) {
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      return null;
    }

    return {
      id: entryId,
      user_id: userId ?? 0,
      organization_id: organizationId ?? 0,
      project_id: parsed.project_id ?? null,
      task_id: parsed.task_id ?? null,
      timer_slot: parsed.timer_slot ?? 'primary',
      start_time: startTime,
      end_time: undefined,
      duration,
      description: parsed.description ?? '',
      billable: true,
      is_manual: false,
      created_at: parsed.created_at ?? startTime,
      updated_at: parsed.updated_at ?? startTime,
      project: null,
      task: parsed.task ?? null,
    };
  } catch (error) {
    console.warn('Failed to restore timer snapshot:', error);
    localStorage.removeItem(ACTIVE_TIMER_KEY);
    return null;
  }
};

export default function DesktopTimerDashboard() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [liveDuration, setLiveDuration] = useState(0);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [allTimeTotal, setAllTimeTotal] = useState(0);
  const [allowedTasks, setAllowedTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [teamMembersCount, setTeamMembersCount] = useState(0);
  const [newMembersThisWeek, setNewMembersThisWeek] = useState(0);
  const [productivityScore, setProductivityScore] = useState(0);
  const [activeTasksCount, setActiveTasksCount] = useState(0);
  const [totalTasksCount, setTotalTasksCount] = useState(0);
  const [todayDeltaLabel, setTodayDeltaLabel] = useState('No change from yesterday');
  const [isLoading, setIsLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);
  const [attendanceToday, setAttendanceToday] = useState<any | null>(null);
  const [shiftTargetSeconds, setShiftTargetSeconds] = useState(8 * 3600);
  const [workedBaseSeconds, setWorkedBaseSeconds] = useState(0);
  const [timerBaseSeconds, setTimerBaseSeconds] = useState(0);
  const [isSubmittingOvertime, setIsSubmittingOvertime] = useState(false);
  const [isUpdatingTimerContext, setIsUpdatingTimerContext] = useState(false);
  const [notice, setNotice] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const hasRestoredSnapshotRef = useRef(false);
  const hasAttemptedAutoStartRef = useRef(false);

  useEffect(() => {
    if (!activeTimer) {
      setLiveDuration(0);
      return;
    }

    localStorage.setItem(
      ACTIVE_TIMER_KEY,
      JSON.stringify({
        id: activeTimer.id,
        start_time: activeTimer.start_time,
        duration: activeTimer.duration ?? 0,
        description: activeTimer.description ?? '',
        task_id: activeTimer.task_id ?? null,
        timer_slot: activeTimer.timer_slot ?? 'primary',
      })
    );

    const computeDuration = () => {
      const base = Number.isFinite(Number(activeTimer.duration)) ? Number(activeTimer.duration) : 0;
      const startMs = getStartTimeMs(activeTimer.start_time);
      if (!Number.isFinite(startMs)) {
        return base;
      }

      const elapsed = Math.floor((Date.now() - startMs) / 1000);
      return Math.max(base, elapsed, 0);
    };

    setLiveDuration(computeDuration());

    const interval = setInterval(() => {
      setLiveDuration(computeDuration());
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTimer?.id, activeTimer?.duration, activeTimer?.start_time]);

  const syncTimerEntryLocally = (entry: TimeEntry | null) => {
    setActiveTimer(entry);
    if (!entry) {
      return;
    }

    setTodayEntries((prev) => {
      const nextEntries = prev.some((current) => current.id === entry.id)
        ? prev.map((current) => (current.id === entry.id ? { ...current, ...entry } : current))
        : [entry, ...prev];

      return nextEntries;
    });
  };

  const fetchData = async () => {
    let requestFailed = false;

    try {
      const [dashboardResult, tasksResult, attendanceResult] = await Promise.allSettled([
        dashboardApi.summary(),
        taskApi.getAll({ timer_only: true }),
        attendanceApi.today(),
      ]);

      const dashboardSucceeded = dashboardResult.status === 'fulfilled';
      const tasksSucceeded = tasksResult.status === 'fulfilled';
      const attendanceSucceeded = attendanceResult.status === 'fulfilled';

      if (!dashboardSucceeded) {
        requestFailed = true;
        console.error('Failed to fetch dashboard summary:', dashboardResult.reason);
      }

      if (!tasksSucceeded) {
        requestFailed = true;
        console.error('Failed to fetch task options for timer:', tasksResult.reason);
      }

      if (!attendanceSucceeded) {
        requestFailed = true;
        console.error('Failed to fetch attendance summary:', attendanceResult.reason);
      }

      const data = dashboardSucceeded ? (dashboardResult.value.data as any) : null;
      const attendancePayload = attendanceSucceeded ? (attendanceResult.value.data as any) : null;
      let activeFromApi = data?.active_timer || null;
      const snapshot = dashboardSucceeded && !activeFromApi ? localStorage.getItem(ACTIVE_TIMER_KEY) : null;
      let todayElapsedSeconds = Number(data?.today_total_elapsed_duration ?? data?.today_total_duration ?? 0) || 0;

      if (dashboardSucceeded && !activeFromApi && snapshot) {
        try {
          const activeResponse = await timeEntryApi.active({ timer_slot: 'primary' });
          activeFromApi = activeResponse.data || null;
        } catch (activeError) {
          console.error('Failed to verify active timer after dashboard returned no running entry:', activeError);
        }
      }

      if (dashboardSucceeded) {
        setActiveTimer(activeFromApi);
        if (!activeFromApi) {
          localStorage.removeItem(ACTIVE_TIMER_KEY);
        } else {
          clearAutoStartArm(userId);
          clearAutoStartSuppression(userId);
          hasRestoredSnapshotRef.current = false;
        }

        setTodayEntries(data?.today_entries || []);
        setAllTimeTotal(Number(data?.all_time_total_elapsed_duration ?? data?.all_time_total_duration ?? 0) || 0);
        setSelectedTaskId(activeFromApi?.task_id || null);
        setTeamMembersCount(Number(data?.team_members_count) || 0);
        setNewMembersThisWeek(Number(data?.new_members_this_week) || 0);
        setProductivityScore(Number(data?.productivity_score) || 0);
        setActiveTasksCount(Number(data?.active_tasks_count) || 0);
        setTotalTasksCount(Number(data?.total_tasks_count) || 0);

        const pct = data?.today_change_percent;
        if (typeof pct === 'number') {
          setTodayDeltaLabel(`${pct >= 0 ? '+' : ''}${pct}% from yesterday`);
        } else {
          setTodayDeltaLabel(todayElapsedSeconds > 0 ? 'Started today' : 'No change from yesterday');
        }
      } else {
        try {
          const todayResponse = await timeEntryApi.today();
          const fallbackEntries = todayResponse.data?.time_entries ?? [];
          todayElapsedSeconds = Number(todayResponse.data?.total_duration ?? 0) || 0;
          setTodayEntries(fallbackEntries);
          setTodayTotal((current) => Math.max(current, todayElapsedSeconds));
        } catch (fallbackError) {
          console.error('Failed to fetch today entries fallback:', fallbackError);
        }
      }

      if (tasksSucceeded) {
        const fetchedTasks = (tasksResult.value.data || []).filter((task) => task.status !== 'done');
        setAllowedTasks(fetchedTasks);
        if (!dashboardSucceeded) {
          setActiveTasksCount(fetchedTasks.length);
          setTotalTasksCount(fetchedTasks.length);
        }
      }

      const attendanceRecord = attendancePayload?.record || attendanceToday || null;
      const attendanceDate = attendanceRecord?.attendance_date || getLocalDateString();
      if (attendanceSucceeded) {
        setAttendanceToday(attendanceRecord);
        setShiftTargetSeconds(Number(attendancePayload?.shift_target_seconds || attendanceRecord?.shift_target_seconds || 8 * 3600));
      }

      const attendanceWorkedSeconds = Number(attendanceRecord?.worked_seconds || 0);
      const persistedWorkedSeconds = getWorkedBaselineSnapshot(userId, attendanceDate);
      const resolvedWorkedSeconds = Math.max(attendanceWorkedSeconds, todayElapsedSeconds, persistedWorkedSeconds);
      setTodayTotal(Math.max(todayElapsedSeconds, persistedWorkedSeconds, attendanceWorkedSeconds));
      setWorkedBaseSeconds(resolvedWorkedSeconds);
      if (dashboardSucceeded) {
        setTimerBaseSeconds(Number(activeFromApi?.duration || 0));
      }

      if (resolvedWorkedSeconds > 0 || activeFromApi) {
        setWorkedBaselineSnapshot(userId, resolvedWorkedSeconds, attendanceDate);
      } else {
        clearWorkedBaselineSnapshot(userId);
      }

      if (dashboardSucceeded && !activeFromApi && snapshot && hasRestoredSnapshotRef.current) {
        hasRestoredSnapshotRef.current = false;
          setNotice(attendanceRecord?.is_checked_in
            ? 'Your previous running timer was not found and was cleared. Start it again if needed.'
            : 'A stale timer snapshot was cleared.');
      }
    } catch (error) {
      requestFailed = true;
      console.error('Error fetching data:', error);
    } finally {
      if (requestFailed) {
        setNotice((currentNotice) => currentNotice || 'Some dashboard data could not be loaded. Showing the latest available timer context.');
      }
      setIsLoading(false);
    }
  };

  useEffect(() => {
    hasAttemptedAutoStartRef.current = false;
    hasRestoredSnapshotRef.current = false;
    setNotice('');
    setFeedback(null);
    setActiveTimer(null);
    setTodayEntries([]);
    setTodayTotal(0);
    setAllTimeTotal(0);
    setAllowedTasks([]);
    setSelectedTaskId(null);

    if (!userId) {
      setIsLoading(false);
      return;
    }

    const persistedWorkedSeconds = getWorkedBaselineSnapshot(userId);
    if (persistedWorkedSeconds > 0) {
      setWorkedBaseSeconds(persistedWorkedSeconds);
      setTodayTotal(persistedWorkedSeconds);
    }

    const restoredSnapshot = restoreTimerSnapshot(userId, user?.organization_id);
    if (restoredSnapshot) {
      hasRestoredSnapshotRef.current = true;
      const restoredWorkedSeconds = Number(restoredSnapshot.duration || 0);
      const seededWorkedSeconds = Math.max(persistedWorkedSeconds, restoredWorkedSeconds);
      setActiveTimer(restoredSnapshot);
      setSelectedTaskId(restoredSnapshot.task_id || null);
      setTodayTotal(seededWorkedSeconds);
      setWorkedBaseSeconds(seededWorkedSeconds);
      setTimerBaseSeconds(restoredWorkedSeconds);
      setIsLoading(false);
    } else {
      setIsLoading(true);
    }

    void fetchData();
  }, [user?.organization_id, userId]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const pendingNotice = consumeIdleAutoStopNotice(userId);
    if (pendingNotice) {
      setFeedback({ tone: 'error', message: pendingNotice });
      setNotice('');
      setActiveTimer(null);
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      emitDesktopTimerStopped({ userId });
      void fetchData();
    }

    const handleIdleAutoStop = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTimerIdleStopDetail>).detail;
      if (!detail || detail.userId !== userId) {
        return;
      }

      setFeedback({ tone: 'error', message: detail.message });
      setNotice('');
      setActiveTimer(null);
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      emitDesktopTimerStopped({ userId });
      void fetchData();
    };

    window.addEventListener(DESKTOP_TIMER_IDLE_STOP_EVENT, handleIdleAutoStop as EventListener);

    return () => {
      window.removeEventListener(DESKTOP_TIMER_IDLE_STOP_EVENT, handleIdleAutoStop as EventListener);
    };
  }, [userId]);

  useEffect(() => {
    if (!activeTimer) {
      if (selectedTaskId && !allowedTasks.some((task) => task.id === selectedTaskId)) {
        setSelectedTaskId(null);
      }
      return;
    }

    setSelectedTaskId(activeTimer.task_id || null);
  }, [activeTimer?.id, activeTimer?.task_id, allowedTasks, selectedTaskId]);

  useEffect(() => {
    if (!isTrackedTimerUser(user) || !userId) {
      return;
    }

    seedDesktopLaunchAutoStart(userId);
  }, [user, userId]);

  useEffect(() => {
    if (isLoading || !isTrackedTimerUser(user) || !canUseDesktopAutoStart()) {
      return;
    }

    if (activeTimer) {
      clearAutoStartArm(userId);
      hasAttemptedAutoStartRef.current = true;
      return;
    }

    if (
      hasAttemptedAutoStartRef.current
      || isStarting
      || isAutoStartSuppressed(userId)
      || !isAutoStartArmed(userId)
    ) {
      return;
    }

    hasAttemptedAutoStartRef.current = true;
    void handleStartTimer(true);
  }, [activeTimer?.id, isLoading, isStarting, user, userId]);

  const handleStartTimer = async (isAutoStart = false) => {
    setIsStarting(true);
    setNotice(isAutoStart ? 'Starting your timer automatically...' : '');
    setFeedback(null);
    clearIdleAutoStopNotice(userId);
    try {
      const startedAtIso = new Date().toISOString();
      const response = await timeEntryApi.start({
        task_id: isAutoStart ? null : selectedTaskId,
        timer_slot: 'primary',
      });
      clearAutoStartArm(userId);
      clearAutoStartSuppression(userId);
      setTimerBaseSeconds(Number(response.data.duration || 0));
      const resumedWorkedSeconds = Math.max(workedBaseSeconds, todayDisplaySeconds);
      setWorkedBaseSeconds(resumedWorkedSeconds);
      setWorkedBaselineSnapshot(userId, resumedWorkedSeconds, attendanceToday?.attendance_date);
      syncTimerEntryLocally(response.data);
      setAttendanceToday((prev: any) => ({
        ...(prev || {}),
        attendance_date: prev?.attendance_date || getLocalDateString(),
        is_checked_in: true,
        check_in_at: prev?.check_in_at || startedAtIso,
      }));
      localStorage.setItem(
        ACTIVE_TIMER_KEY,
        JSON.stringify({
          id: response.data.id,
          start_time: response.data.start_time,
          duration: response.data.duration ?? 0,
          description: response.data.description ?? '',
        })
      );
      if (userId) {
        emitDesktopTimerStarted({
          userId,
          entryId: response.data.id,
        });
      }
      setNotice(isAutoStart ? 'Timer started. Choose a task for the running session if needed.' : '');
      await fetchData();
    } catch (error: any) {
      console.error('Error starting timer:', error);
      setNotice(error?.response?.data?.message || (isAutoStart ? 'Could not auto-start the timer.' : 'Failed to start timer'));
    } finally {
      setIsStarting(false);
    }
  };

  const handleStopTimer = async () => {
    try {
      setNotice('');
      clearAutoStartArm(userId);
      suppressAutoStart(userId);
      const response = await timeEntryApi.stop({ timer_slot: (activeTimer?.timer_slot || 'primary') as 'primary' | 'secondary' });
      const stoppedEntry = response.data;
      const stoppedDuration = Number(stoppedEntry?.duration || 0);
      const nextWorkedSeconds = Math.max(
        todayDisplaySeconds,
        workedBaseSeconds + Math.max(0, stoppedDuration - timerBaseSeconds),
      );
      setActiveTimer(null);
      setTimerBaseSeconds(0);
      setWorkedBaseSeconds(nextWorkedSeconds);
      setTodayTotal((current) => Math.max(current, nextWorkedSeconds));
      setAttendanceToday((prev: any) => prev ? {
        ...prev,
        is_checked_in: false,
        worked_seconds: Math.max(Number(prev?.worked_seconds || 0), nextWorkedSeconds),
        check_out_at: stoppedEntry?.end_time || new Date().toISOString(),
      } : prev);
      setWorkedBaselineSnapshot(userId, nextWorkedSeconds, attendanceToday?.attendance_date);
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      if (userId) {
        emitDesktopTimerStopped({
          userId,
          entryId: stoppedEntry?.id ?? activeTimer?.id ?? null,
        });
      }

      if (stoppedEntry) {
        setTodayEntries((prev) => {
          const withoutCurrent = prev.filter((entry) => entry.id !== stoppedEntry.id);
          const nextEntries = [stoppedEntry, ...withoutCurrent];
          const nextTotal = nextEntries.reduce((sum, entry) => {
            const duration = Number.isFinite(Number(entry.duration)) ? Number(entry.duration) : 0;
            return sum + duration;
          }, 0);
          setTodayTotal(nextTotal);
          return nextEntries;
        });
      } else {
        const todayResponse = await timeEntryApi.today();
        setTodayEntries(todayResponse.data.time_entries);
        setTodayTotal(todayResponse.data.total_duration);
      }
      await fetchData();
    } catch (error) {
      const status = (error as any)?.response?.status;
      if (status === 404) {
        clearAutoStartArm(userId);
        suppressAutoStart(userId);
        setActiveTimer(null);
        localStorage.removeItem(ACTIVE_TIMER_KEY);
        setWorkedBaselineSnapshot(userId, todayDisplaySeconds, attendanceToday?.attendance_date);
        if (userId) {
          emitDesktopTimerStopped({
            userId,
            entryId: activeTimer?.id ?? null,
          });
        }
        await fetchData();
        return;
      }
      console.error('Error stopping timer:', error);
    }
  };

  const handleTaskSelection = async (taskId: number | null) => {
    setSelectedTaskId(taskId);

    if (!activeTimer) {
      return;
    }

    setIsUpdatingTimerContext(true);
    setNotice('');

    try {
      const nextTask = taskId ? allowedTasks.find((task) => task.id === taskId) || null : null;
      const response = await timeEntryApi.update(activeTimer.id, {
        project_id: nextTask?.project_id ?? null,
        task_id: taskId,
      });

      if (nextTask && nextTask.status !== 'in_progress') {
        await taskApi.updateStatus(nextTask.id, 'in_progress');
        setAllowedTasks((current) =>
          current.map((task) => (task.id === nextTask.id ? { ...task, status: 'in_progress' } : task))
        );
      }

      syncTimerEntryLocally(response.data);
      setNotice(taskId ? 'Task updated for the running timer and moved to In Progress.' : 'Task cleared from the running timer.');
    } catch (error: any) {
      console.error('Error updating timer task:', error);
      setSelectedTaskId(activeTimer.task_id || null);
      setNotice(error?.response?.data?.message || 'Failed to update the running timer task.');
    } finally {
      setIsUpdatingTimerContext(false);
    }
  };

  const currentWorkedSeconds = Math.max(
    0,
    workedBaseSeconds + (activeTimer ? Math.max(0, liveDuration - timerBaseSeconds) : 0)
  );
  const effectiveWorkedSeconds = Math.max(currentWorkedSeconds, todayTotal);
  const todayDisplaySeconds = effectiveWorkedSeconds;
  const timerDisplaySeconds = activeTimer ? liveDuration : 0;
  const remainingShiftSeconds = Math.max(0, shiftTargetSeconds - effectiveWorkedSeconds);
  const overtimeSeconds = Math.max(0, effectiveWorkedSeconds - shiftTargetSeconds);
  const halfDayLeaveApplied = Boolean(
    attendanceToday?.has_half_day_leave_today
    || attendanceToday?.leave_type === 'half_day'
    || attendanceToday?.record?.leave_type === 'half_day'
  );
  const leaveTodayLabel = attendanceToday?.leave_today?.label || attendanceToday?.leave_label || 'Half day leave applied today';
  const availableTasks = allowedTasks.filter((task) => task.status !== 'done');
  const activeTasksHint = `${totalTasksCount} total task${totalTasksCount === 1 ? '' : 's'}`;

  const submitOvertimeProof = async () => {
    if (overtimeSeconds <= 0) {
      setNotice('Overtime has not started yet.');
      return;
    }

    setIsSubmittingOvertime(true);
    setNotice('');
    try {
      const todayDate = attendanceToday?.attendance_date || getLocalDateString();
      await attendanceTimeEditApi.create({
        attendance_date: todayDate,
        extra_minutes: Math.ceil(overtimeSeconds / 60),
        worked_seconds: effectiveWorkedSeconds,
        overtime_seconds: overtimeSeconds,
        message: `Auto overtime proof from dashboard timer. Overtime: ${formatDuration(overtimeSeconds)}.`,
      });
      setNotice(`Overtime proof sent to admin. Worked: ${formatDuration(effectiveWorkedSeconds)}, Overtime: ${formatDuration(overtimeSeconds)}.`);
    } catch (error: any) {
      setNotice(error?.response?.data?.message || 'Failed to submit overtime proof.');
    } finally {
      setIsSubmittingOvertime(false);
    }
  };

  const formatDuration = (seconds: number) => {
    const safeSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    return `${hours}h ${minutes}m`;
  };

  const formatTime = (seconds: number) => {
    const safeSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  if (isLoading) {
    return <PageLoadingState label="Loading dashboard..." />;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        eyebrow="Workspace overview"
        title={`Welcome back, ${user?.name?.split(' ')[0]}!`}
        description="Start the timer, review today's attendance progress, and keep your current activity in one place."
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 shadow-sm">
            <Calendar className="h-4 w-4 text-sky-700" />
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        }
      />

      <div className="overflow-hidden rounded-lg bg-[linear-gradient(135deg,#020617_0%,#0f172a_28%,#0369a1_76%,#22d3ee_100%)] p-6 text-white shadow-sm">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="mb-1 text-sm font-medium text-cyan-100/80">
              {activeTimer ? 'Timer Running' : currentWorkedSeconds > 0 ? 'Timer Paused' : 'Desktop timer'}
            </p>
            <div className="text-4xl font-semibold tracking-[-0.05em] sm:text-5xl">
              {formatTime(timerDisplaySeconds)}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-white/10 px-3 py-3">
                <p className="text-xs text-cyan-100/70">Shift Remaining</p>
                <p className="font-semibold">{formatTime(remainingShiftSeconds)}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white/10 px-3 py-3">
                <p className="text-xs text-cyan-100/70">Overtime Timer</p>
                <p className="font-semibold">{formatTime(overtimeSeconds)}</p>
              </div>
            </div>
            {activeTimer?.description && (
              <p className="mt-3 text-sm text-cyan-50/90">{activeTimer.description}</p>
            )}
            {activeTimer?.task?.title && (
              <p className="mt-1 text-sm text-cyan-50/90">Task: {activeTimer.task.title}</p>
            )}
            {activeTimer?.task?.group?.name && (
              <p className="mt-1 text-sm text-cyan-50/90">Group: {activeTimer.task.group.name}</p>
            )}
            {activeTimer && !activeTimer?.task?.title ? (
              <p className="mt-3 text-sm text-cyan-50/90">Choose a task from your assigned groups for this running timer.</p>
            ) : null}
          </div>
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <StatusBadge tone={activeTimer ? 'success' : 'info'} className="border-slate-200 bg-white/10 text-white">
              {isUpdatingTimerContext ? 'Updating timer' : activeTimer ? 'Live session' : 'Ready to start'}
            </StatusBadge>
            <Button
              onClick={() => (activeTimer ? handleStopTimer() : handleStartTimer())}
              aria-label={activeTimer ? 'Pause timer' : 'Start timer'}
              disabled={isStarting || isUpdatingTimerContext}
              variant="secondary"
              size="lg"
              className={`h-16 w-16 rounded-full border-0 px-0 ${
                activeTimer ? 'bg-white text-white hover:bg-white' : 'bg-white text-primary-700 hover:bg-sky-50'
              }`}
            >
              {activeTimer ? <Pause className="h-8 w-8" /> : <Play className="ml-1 h-8 w-8" />}
            </Button>
          </div>
        </div>

        {feedback ? (
          <div className="mt-5">
            <FeedbackBanner tone={feedback.tone} message={feedback.message} />
          </div>
        ) : null}

        <div className="mt-5">
          <div className="rounded-lg border border-slate-200 bg-white/10 p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.24em] text-cyan-100/70">
              <Building2 className="h-3.5 w-3.5" />
              <p>{activeTimer ? 'Running Timer Task' : 'Select Task'}</p>
            </div>
            <SelectInput
              aria-label="Active timer task"
              value={selectedTaskId ?? ''}
              onChange={(e) => void handleTaskSelection(e.target.value ? Number(e.target.value) : null)}
              disabled={availableTasks.length === 0 || isUpdatingTimerContext || isStarting}
              className="mt-3 border-slate-200 bg-white text-slate-950 shadow-none focus:border-white focus:bg-white focus:ring-white/30 disabled:bg-white disabled:text-slate-500"
            >
              <option value="" className="text-gray-900">
                {availableTasks.length === 0 ? 'No tasks available for your group' : 'Choose task'}
              </option>
              {availableTasks.map((task) => (
                <option key={task.id} value={task.id} className="text-gray-900">
                  {task.group?.name ? `${task.title} - ${task.group.name}` : task.title}
                </option>
              ))}
            </SelectInput>
            <p className="mt-2 text-xs text-cyan-100/75">
              {availableTasks.length === 0
                ? 'No tasks are currently available for your assigned groups.'
                : activeTimer
                  ? 'Only tasks you are allowed to work on are listed here.'
                  : 'Pick a task before starting, or attach one after the timer is already running.'}
            </p>
          </div>
        </div>

        <div className="mt-4 text-sm text-cyan-50/85">
          Total elapsed (all sessions): {formatDuration(allTimeTotal)} | Today's attendance worked: {formatDuration(currentWorkedSeconds)}
          {halfDayLeaveApplied ? (
            <>
              {' | '}
              <span className="font-semibold text-rose-200 underline decoration-rose-300/70 underline-offset-4">
                {leaveTodayLabel}, target {formatDuration(shiftTargetSeconds)}
              </span>
            </>
          ) : null}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            onClick={submitOvertimeProof}
            disabled={isSubmittingOvertime || overtimeSeconds <= 0}
            variant="secondary"
            size="sm"
            className="bg-white text-primary-700 hover:bg-sky-50"
          >
            {isSubmittingOvertime ? 'Sending...' : 'Send Overtime Proof to Admin'}
          </Button>
          {notice ? <span className="text-xs text-cyan-50">{notice}</span> : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Today's Time"
          value={formatDuration(todayDisplaySeconds)}
          hint={
            halfDayLeaveApplied
              ? `Half day applied, target ${formatDuration(shiftTargetSeconds)}`
              : todayDisplaySeconds > todayTotal
                ? 'Includes approved attendance edits'
                : todayDeltaLabel
          }
          icon={Clock}
          accent="sky"
        />
        <MetricCard label="Active Tasks" value={activeTasksCount} hint={activeTasksHint} icon={FolderKanban} accent="violet" />
        <MetricCard label="Team Members" value={teamMembersCount} hint={`${newMembersThisWeek} new this week`} icon={Users} accent="emerald" />
        <MetricCard label="Productivity" value={`${productivityScore}%`} hint="Based on working ratio this week" icon={TrendingUp} accent="amber" />
      </div>

      <SurfaceCard className="overflow-hidden">
        <div className="border-b border-slate-200 p-5">
          <h2 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Today's Time Entries</h2>
        </div>
        <div className="divide-y divide-slate-200/80">
          {todayEntries.length === 0 ? (
            <div className="p-8 text-center text-slate-500">
              <Clock className="mx-auto mb-3 h-12 w-12 text-slate-300" />
              <p>No time entries yet today</p>
              <p className="text-sm">Start tracking to see your entries here</p>
            </div>
          ) : (
            todayEntries.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-4 p-4 transition hover:bg-slate-50">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
                    <Clock className="h-5 w-5 text-slate-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-950">{getTimeEntryTitle(entry)}</p>
                    <p className="truncate text-sm text-slate-500">{getTimeEntrySubtitle(entry, 'No description')}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="font-medium text-slate-950">{formatDuration(entry.duration)}</p>
                  <p className="text-sm text-slate-500">
                    {new Date(entry.start_time).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
