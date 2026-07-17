import { useState, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { attendanceApi, attendanceTimeEditApi, timeEntryApi, dashboardApi, projectApi, taskApi } from '@/services/api';
import { breakTrackingApi } from '@/services/breakTrackingApi';
import { startTimerOfflineAware, stopTimerOfflineAware } from '@/services/offlineApiWrapper';
import {
  ACTIVE_TIMER_KEY,
  armAutoStart,
  canUseDesktopAutoStart,
  clearAutoStartArm,
  clearAutoStartSuppression,
  clearAutoStartSuppressionGlobal,
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
import { formatDuration } from '@/lib/formatters';
import { FeedbackBanner, PageLoadingState } from '@/components/ui/PageState';
import { OfflineBanner } from '@/components/desktop/OfflineStatusIndicator';
import { SelectInput } from '@/components/ui/FormField';
import {
  Calendar,
  CalendarDays,
  Clock,
  ClipboardList,
  Coffee,
  Hourglass,
  Pause,
  Play,
  TrendingUp,
  Users,
  UploadCloud,
} from 'lucide-react';
import { getTimeEntrySubtitle, getTimeEntryTitle } from '@/lib/timeEntryDisplay';
import type { TimeEntry } from '@/types';
import type { Project, Task } from '@/types';

// Part 2: explicit timer state machine. Illegal combinations of the old
// boolean guard flags (wasAutoStarted / justStoppedByIdle / hasRestoredSnapshot)
// are now structurally impossible because only one of these states is active.
type TimerState =
  | 'idle'
  | 'running'
  | 'paused_for_break'
  | 'stopped_by_idle'
  | 'syncing';

// How often the running display reconciles with the backend. The server can
// auto-stop a timer on its own (idle fallback); this keeps the visible timer
// from running away while still being cheap (one lightweight request).
const TIMER_RECONCILE_INTERVAL_MS = 15 * 1000;

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

const isAtOrAfterOfficeStartTime = (officeStartTime?: string | null): boolean => {
  if (!officeStartTime) return true;

  const now = new Date();
  const [hours, minutes] = officeStartTime.split(':').map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return true;

  const officeStart = new Date();
  officeStart.setHours(hours, minutes, 0, 0);

  return now >= officeStart;
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

// Adapt the offline-aware wrapper's result into the axios-like { data: {...} }
// shape that the rest of the timer code reads. When the action was buffered
// for offline sync we synthesize a local placeholder entry so the UI can keep
// rendering without crashing; the real record will land when the sync engine
// posts to the server.
const adaptTimerStartResult = (
  result: { success: boolean; data?: any; offline?: boolean; error?: string },
  fallback: { project_id?: number | null; task_id?: number | null; timer_slot?: 'primary' | 'secondary' },
) => {
  if (result.offline) {
    return {
      data: {
        id: `offline-${Date.now()}`,
        duration: 0,
        start_time: new Date().toISOString(),
        project_id: fallback.project_id ?? null,
        task_id: fallback.task_id ?? null,
        timer_slot: fallback.timer_slot || 'primary',
        description: '',
      },
    };
  }
  return { data: result.data };
};

const adaptTimerStopResult = (
  result: { success: boolean; data?: any; offline?: boolean; error?: string },
  fallback: { id?: number | string | null; timer_slot?: 'primary' | 'secondary' },
) => {
  if (result.offline) {
    return {
      data: {
        id: `offline-${Date.now()}`,
        duration: 0,
        end_time: new Date().toISOString(),
        timer_slot: fallback.timer_slot || 'primary',
        // Carry the active entry id forward so callers can still emit a
        // "stopped" event for the right logical entry.
        _fromActiveId: fallback.id ?? null,
      },
    };
  }
  return { data: result.data };
};

const toArrayPayload = <T,>(payload: unknown): T[] => {
  if (Array.isArray(payload)) {
    return payload as T[];
  }

  if (
    payload
    && typeof payload === 'object'
    && 'data' in payload
    && Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: T[] }).data;
  }

  return [];
};

export default function DesktopTimerDashboard() {
  const { user, organization } = useAuth();
  const userId = user?.id ?? null;
  const [activeTimer, setActiveTimer] = useState<TimeEntry | null>(null);
  const [liveDuration, setLiveDuration] = useState(0);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [todayTotal, setTodayTotal] = useState(0);
  const [allTimeTotal, setAllTimeTotal] = useState(0);
  const [allowedProjects, setAllowedProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(null);
  const [allowedTasks, setAllowedTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const [teamMembersCount, setTeamMembersCount] = useState(0);
  const [newMembersThisWeek, setNewMembersThisWeek] = useState(0);
  const [productivityScore, setProductivityScore] = useState(0);
  const [activeTasksCount, setActiveTasksCount] = useState(0);
  const [totalTasksCount, setTotalTasksCount] = useState(0);
  const [todayDeltaLabel, setTodayDeltaLabel] = useState('No change from yesterday');
  const [todayWorkSeconds, setTodayWorkSeconds] = useState(0);
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
  const [activeBreak, setActiveBreak] = useState<import('@/services/breakTrackingApi').BreakTime | null>(null);
  const [todayBreaks, setTodayBreaks] = useState<import('@/services/breakTrackingApi').BreakTime[]>([]);
  const [totalBreakSeconds, setTotalBreakSeconds] = useState(0);
  const [todayTrackSeconds, setTodayTrackSeconds] = useState(0);
  const [todayIdleSeconds, setTodayIdleSeconds] = useState(0);
  const [breakElapsed, setBreakElapsed] = useState(0);
  const [isBreakStarting, setIsBreakStarting] = useState(false);
  const [isBreakEnding, setIsBreakEnding] = useState(false);
  const hasRestoredSnapshotRef = useRef(false);
  const hasAttemptedAutoStartRef = useRef(false);
  const latestWorkedSecondsRef = useRef(0);
  const wasAutoStartedRef = useRef(false);
  const isFetchingRef = useRef(false);
  const fetchAbortControllerRef = useRef<AbortController | null>(null);
  const isTimerOperationInProgressRef = useRef(false);
  const justStoppedByIdleRef = useRef(false);
  // Guards the idle-stop popup so it fires exactly once per stopped timer id,
  // no matter which poll (fetchData or the reconcile poll) observes the stop
  // first. Reset when a genuinely new timer starts.
  const idleNoticeShownForRef = useRef<number | null>(null);
  // Part 2: single explicit source-of-truth state machine. Replaces the three
  // independent boolean guard refs (wasAutoStartedRef, justStoppedByIdleRef,
  // hasRestoredSnapshotRef) whose combinations were never exhaustively checked.
  const timerStateRef = useRef<TimerState>('idle');
  // Once a timer is running, its start_time is locked for that timer id. A
  // background "active_timer" API response with the same id must never
  // overwrite the displayed start_time, because the server can silently
  // refresh it and that is what reset the visible timer.
  const knownStartTimeRef = useRef<{ id: number; start_time: string } | null>(null);
  // Locked client-side epoch anchor for the running timer. The displayed
  // elapsed time is always extrapolated forward from THIS anchor, never
  // recomputed from a start_time that could be silently refreshed by an
  // unrelated API response.
  const startAnchorRef = useRef<number | null>(null);

  useEffect(() => {
    console.log('[Live Duration] Effect triggered', {
      hasActiveTimer: Boolean(activeTimer),
      activeTimerId: activeTimer?.id,
      activeTimerStartTime: activeTimer?.start_time,
      activeTimerDuration: activeTimer?.duration,
    });
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
        project_id: activeTimer.project_id ?? null,
        task_id: activeTimer.task_id ?? null,
        timer_slot: activeTimer.timer_slot ?? 'primary',
      })
    );

    const computeDuration = () => {
      const base = Number.isFinite(Number(activeTimer.duration)) ? Number(activeTimer.duration) : 0;
      // Single source of truth for elapsed time: trust the server's last-known
      // duration (base) and extrapolate forward from the locked client anchor.
      // We deliberately do NOT recompute elapsed from activeTimer.start_time,
      // because that value can be silently refreshed by an unrelated API
      // response and reset the visible timer.
      const anchorMs = startAnchorRef.current;
      if (!Number.isFinite(anchorMs)) {
        return base;
      }

      const elapsed = Math.floor((Date.now() - anchorMs) / 1000);
      // Use the larger of server-reported duration or client-extrapolated elapsed
      return Math.max(base, elapsed, 0);
    };

    setLiveDuration(computeDuration());

    const interval = setInterval(() => {
      setLiveDuration(computeDuration());
    }, 1000);

    return () => clearInterval(interval);
  }, [activeTimer?.id, activeTimer?.duration, activeTimer?.start_time]);

  // Reconciliation poll: while a timer is displayed as running, periodically
  // confirm with the backend that it is still running. The server can stop a
  // timer on its own (e.g. the server-side idle fallback `closeIdleRunningEntry`
  // auto-stops after the idle threshold) without the desktop hook emitting a
  // client event. Without this poll the local 1s counter would keep counting
  // forever — that is the "timer showed 14 minutes while I was idle" bug — and
  // only a manual refresh would reveal the timer had already ended.
  useEffect(() => {
    if (!activeTimer?.id) {
      return;
    }

    const runningTimerId = activeTimer.id;
    let cancelled = false;

    const reconcile = async () => {
      if (cancelled) return;
      let serverEntry: TimeEntry | null = null;
      try {
        const response = await timeEntryApi.active({ timer_slot: 'primary' });
        serverEntry = response.data || null;
      } catch {
        // Network blip — do not touch the display; try again next tick.
        return;
      }
      if (cancelled) return;

      // The `active` endpoint only returns timers whose end_time is NULL, so a
      // server-side idle auto-stop makes it return `null` (or a *different*
      // timer if a new one was started). Any of these means our displayed timer
      // is no longer the running one.
      const serverSaysStopped =
        !serverEntry ||
        serverEntry.id !== runningTimerId ||
        Boolean(serverEntry.end_time);

      if (!serverSaysStopped) {
        return;
      }

      // The backend no longer has this timer running. Reconcile the display so
      // it stops counting immediately instead of running away.
      console.warn('[Timer] Reconcile: backend reports running timer stopped; syncing display', {
        displayedTimerId: runningTimerId,
        serverEntryId: serverEntry?.id ?? null,
        serverEndTime: serverEntry?.end_time ?? null,
      });

      // Determine *why* it stopped. `active` never carries the stopped entry's
      // flags (it returns null once stopped), so fetch the specific entry by id
      // and read its authoritative `auto_stopped_for_idle` flag. This is the
      // fool-proof idle signal: it is the exact column the backend idle fallback
      // sets, regardless of whether the stop happened via the client event, the
      // real-time idle check, or the `active`-endpoint fallback.
      const stoppedForIdle = await wasStoppedForIdle(runningTimerId);
      if (cancelled) return;

      const finalWorkedSeconds = latestWorkedSecondsRef.current;
      setWorkedBaseSeconds(finalWorkedSeconds);
      setTodayTotal((current) => Math.max(current, finalWorkedSeconds));
      setTimerBaseSeconds(0);
      if (userId) {
        setWorkedBaselineSnapshot(userId, finalWorkedSeconds, attendanceToday?.attendance_date);
      }
      commitActiveTimer('reconcile:serverStopped', null, stoppedForIdle ? 'stopped_by_idle' : 'idle');
      setLiveDuration(0);
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      if (userId) {
        emitDesktopTimerStopped({ userId });
      }
      if (stoppedForIdle) {
        showIdleStopNotice(runningTimerId);
      }
    };

    const reconcileInterval = setInterval(() => {
      void reconcile();
    }, TIMER_RECONCILE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(reconcileInterval);
    };
  }, [activeTimer?.id, userId, attendanceToday?.attendance_date]);

  // Diagnostic wrapper around setActiveTimer. Part 2 requires us to identify
  // which code path resets the displayed timer's start_time during live
  // reproduction (start timer, wait ~1 min, observe reset). Every mutation of
  // the displayed timer now flows through here with a caller tag + stack, so
  // the exact trigger is visible in the console instead of guessed.
  const applyActiveTimer = (tag: string, entry: TimeEntry | null) => {
    if (entry) {
      console.warn('[ActiveTimer][set]', tag, {
        entryId: entry.id,
        start_time: entry.start_time,
        duration: entry.duration,
        stack: new Error().stack,
      });
    } else {
      console.warn('[ActiveTimer][clear]', tag, {
        stack: new Error().stack,
      });
    }
    setActiveTimer(entry);
  };

  // Authoritative mutation of the displayed timer. Enforces the Part 2 rule:
  // once a timer is running, its start_time is immutable for that timer id. If
  // a background sync returns the same timer id, any start_time it carries is
  // IGNORED in favor of the already-known value. Only a genuinely different
  // timer id may change the displayed start_time. Also drives the single
  // explicit state machine.
  const commitActiveTimer = (tag: string, entry: TimeEntry | null, nextState?: TimerState) => {
    if (entry) {
      const known = knownStartTimeRef.current;
      if (known && known.id === entry.id && known.start_time) {
        // Same timer id as the one we're already displaying: never let an
        // unrelated API response silently rewrite the start time.
        if (entry.start_time && entry.start_time !== known.start_time) {
          console.warn('[ActiveTimer][immutable] ignoring start_time from sync for same timer id', {
            tag,
            entryId: entry.id,
            incoming: entry.start_time,
            kept: known.start_time,
          });
          entry = { ...entry, start_time: known.start_time };
        }
        // Keep the existing anchor for this running timer.
      } else if (entry.start_time) {
        // New timer id (or first sighting): lock its start_time and anchor now.
        knownStartTimeRef.current = { id: entry.id, start_time: entry.start_time };
        const parsedAnchor = getStartTimeMs(entry.start_time);
        startAnchorRef.current = Number.isFinite(parsedAnchor) ? parsedAnchor : Date.now();
        // A genuinely new running timer: allow the idle notice to fire again for
        // this fresh session (the guard is keyed by the stopped timer id, but we
        // also clear it here so a restarted timer is never suppressed).
        idleNoticeShownForRef.current = null;
      }

      if (nextState) {
        timerStateRef.current = nextState;
      } else if (timerStateRef.current === 'idle' || timerStateRef.current === 'stopped_by_idle') {
        timerStateRef.current = 'running';
      }
    } else {
      knownStartTimeRef.current = null;
      startAnchorRef.current = null;
      timerStateRef.current = nextState ?? 'idle';
    }

    applyActiveTimer(tag, entry);
  };

  // Fool-proof idle-stop finalizer. Both the reconciliation poll and the main
  // fetchData poll can be the first to notice the backend auto-stopped the
  // running timer (there is an inherent race between the two). Rather than
  // duplicate the "show the idle popup" logic in each — and risk one path
  // clearing the timer before the other can show the message — both funnel the
  // transition through here. It is idempotent (guarded by idleNoticeShownRef)
  // and always reads the authoritative `auto_stopped_for_idle` flag from the
  // specific stopped entry, so the popup fires exactly once whenever the stop
  // was caused by idle, regardless of which poll won.
  const wasStoppedForIdle = async (stoppedTimerId: number): Promise<boolean> => {
    try {
      const response = await timeEntryApi.get(stoppedTimerId);
      const entry = response.data;
      return Boolean(entry && entry.end_time && (entry as any).auto_stopped_for_idle);
    } catch {
      return false;
    }
  };

  const showIdleStopNotice = (stoppedTimerId: number) => {
    if (idleNoticeShownForRef.current === stoppedTimerId) {
      return;
    }
    idleNoticeShownForRef.current = stoppedTimerId;
    timerStateRef.current = 'stopped_by_idle';
    setFeedback({
      tone: 'error',
      message: 'Your timer was stopped automatically because you were idle.',
    });
  };

  const syncTimerEntryLocally = (entry: TimeEntry | null) => {
    if (!entry) {
      return;
    }

    commitActiveTimer('syncTimerEntryLocally', entry);

    setTodayEntries((prev) => {
      const nextEntries = prev.some((current) => current.id === entry.id)
        ? prev.map((current) => (current.id === entry.id ? { ...current, ...entry } : current))
        : [entry, ...prev];

      return nextEntries;
    });
  };

  const fetchData = async () => {
    // Prevent concurrent fetch calls
    if (isFetchingRef.current) {
      console.log('[fetchData] Already fetching, skipping duplicate request');
      return;
    }
    
    // Cancel any previous fetch
    if (fetchAbortControllerRef.current) {
      fetchAbortControllerRef.current.abort();
    }
    
    fetchAbortControllerRef.current = new AbortController();
    isFetchingRef.current = true;
    
    let requestFailed = false;

    try {
      const [dashboardResult, projectsResult, tasksResult, attendanceResult, breakResult] = await Promise.allSettled([
        dashboardApi.summary(),
        projectApi.getAll(),
        taskApi.getAll({ timer_only: true, project_id: selectedProjectId ?? undefined }),
        attendanceApi.today(),
        breakTrackingApi.getToday(),
      ]);

      const projectsSucceeded = projectsResult.status === 'fulfilled';
      const dashboardSucceeded = dashboardResult.status === 'fulfilled';
      const tasksSucceeded = tasksResult.status === 'fulfilled';
      const attendanceSucceeded = attendanceResult.status === 'fulfilled';
      const breakSucceeded = breakResult.status === 'fulfilled';

      if (!dashboardSucceeded) {
        requestFailed = true;
        console.error('Failed to fetch dashboard summary:', dashboardResult.reason);
      }

      if (!projectsSucceeded) {
        requestFailed = true;
        console.error('Failed to fetch project options for timer:', projectsResult.reason);
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
      
      // Additional check: if API returns active timer but localStorage has different timer ID,
      // check if the API timer is actually running (no end_time). Only update if it's a valid running timer.
      if (dashboardSucceeded && activeFromApi && snapshot) {
        try {
          const parsedSnapshot = JSON.parse(snapshot);
          if (parsedSnapshot.id !== activeFromApi.id) {
            // Check if API timer is actually running (no end_time) and is from today
            const apiTimerDate = getEntryLocalDateString(activeFromApi.start_time);
            const isToday = apiTimerDate === getLocalDateString();
            const isRunning = !activeFromApi.end_time;
            
            if (isRunning && isToday) {
              console.log('[Timer] Timer ID mismatch - API has newer running timer. Updating to API timer.');
              // Update localStorage with the new timer from API
              localStorage.setItem(
                ACTIVE_TIMER_KEY,
                JSON.stringify({
                  id: activeFromApi.id,
                  start_time: activeFromApi.start_time,
                  duration: activeFromApi.duration ?? 0,
                  description: activeFromApi.description ?? '',
                  project_id: activeFromApi.project_id ?? null,
                  task_id: activeFromApi.task_id ?? null,
                  timer_slot: activeFromApi.timer_slot ?? 'primary',
                })
              );
            } else {
              console.log('[Timer] Timer ID mismatch - API timer is stopped or from different day. Ignoring API timer.', {
                isRunning,
                isToday,
                apiEndTime: activeFromApi.end_time,
              });
              // Clear the API timer since it's not actually running (likely stale cache)
              activeFromApi = null;
            }
          }
        } catch (e) {
          // Ignore parsing errors
        }
      }

      if (dashboardSucceeded) {
        // Check if timer was explicitly stopped locally (no ACTIVE_TIMER_KEY in localStorage)
        // but API still returns an active timer (stale cache). In this case, trust local state.
        const hasLocalTimerSnapshot = localStorage.getItem(ACTIVE_TIMER_KEY);
        const isTimerExplicitlyStopped = !hasLocalTimerSnapshot && activeFromApi;
        
        if (isTimerExplicitlyStopped) {
          console.log('[Timer] API returned active timer but local snapshot is cleared (timer was stopped). Ignoring API timer.');
          activeFromApi = null;
          // Clear the stale timer from API cache if possible. Use the
          // offline-aware wrapper so a network blip during this best-effort
          // cleanup never crashes the data fetch. If we are offline, the
          // stop is queued for the sync engine to handle on reconnect.
          try {
            await stopTimerOfflineAware({ timer_slot: 'primary' });
          } catch (e) {
            // Ignore errors, timer might already be stopped on the server.
          }
        }
        
        // Preserve auto-started timer if API hasn't caught up yet
        if (wasAutoStartedRef.current && !activeFromApi) {
          console.log('[Timer] Preserving auto-started timer while API catches up');
          wasAutoStartedRef.current = false;
        } else if (justStoppedByIdleRef.current && activeFromApi) {
          // API returned stale timer after idle stop - ignore it
          console.log('[Timer] Ignoring stale timer from API after idle stop');
          justStoppedByIdleRef.current = false;
        } else {
          // Capture the id of the timer we were displaying BEFORE we commit the
          // (possibly null) server state. If we were showing a running timer and
          // the server now reports none, the timer was stopped out from under us
          // — most commonly by the backend idle fallback. We check the stopped
          // entry's authoritative flag and, if it was idle, show the popup. This
          // makes the idle notice fool-proof even when fetchData (not the
          // reconcile poll) is the first to observe the stop.
          const previouslyDisplayedId = knownStartTimeRef.current?.id ?? null;
          const transitionedToStopped = Boolean(previouslyDisplayedId) && !activeFromApi;

          commitActiveTimer('fetchData:sync', activeFromApi);
          if (!activeFromApi) {
            localStorage.removeItem(ACTIVE_TIMER_KEY);
            setLiveDuration(0);
            justStoppedByIdleRef.current = false;
            if (transitionedToStopped && previouslyDisplayedId) {
              void wasStoppedForIdle(previouslyDisplayedId).then((stoppedForIdle) => {
                if (stoppedForIdle) {
                  showIdleStopNotice(previouslyDisplayedId);
                }
              });
            }
          } else {
            clearAutoStartArm(userId);
            clearAutoStartSuppression(userId);
            hasRestoredSnapshotRef.current = false;
            // Immediately compute live duration when timer is restored
            const base = Number.isFinite(Number(activeFromApi.duration)) ? Number(activeFromApi.duration) : 0;
            const startMs = getStartTimeMs(activeFromApi.start_time);
            if (Number.isFinite(startMs)) {
              const elapsed = Math.floor((Date.now() - startMs) / 1000);
              setLiveDuration(Math.max(base, elapsed, 0));
            } else {
              setLiveDuration(base);
            }
          }
        }

        setTodayEntries(data?.today_entries || []);
        setAllTimeTotal(Number(data?.all_time_total_elapsed_duration ?? data?.all_time_total_duration ?? 0) || 0);
        setSelectedTaskId(activeFromApi?.task_id || null);
        setSelectedProjectId((current) => activeFromApi?.project_id ?? current);
        setTeamMembersCount(Number(data?.team_members_count) || 0);
        setNewMembersThisWeek(Number(data?.new_members_this_week) || 0);
        setProductivityScore(Number(data?.productivity_score) || 0);
        setActiveTasksCount(Number(data?.active_tasks_count) || 0);
        setTotalTasksCount(Number(data?.total_tasks_count) || 0);
        setTodayTrackSeconds(Number(data?.today_track_time ?? 0) || 0);
        setTodayWorkSeconds(Number(data?.today_work_time ?? 0) || 0);
        setTodayIdleSeconds(Number(data?.today_idle_time ?? 0) || 0);

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
          setTodayWorkSeconds(Number(todayResponse.data?.work_time ?? 0) || 0);
          setTodayTotal((current) => Math.max(current, todayElapsedSeconds));
        } catch (fallbackError) {
          console.error('Failed to fetch today entries fallback:', fallbackError);
        }
      }

      if (projectsSucceeded) {
        const fetchedProjects = toArrayPayload<Project>(projectsResult.value.data);
        setAllowedProjects(fetchedProjects);
      }

      if (tasksSucceeded) {
        const fetchedTasks = toArrayPayload<Task>(tasksResult.value.data).filter((task) => task.status !== 'done');
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

      if (breakSucceeded) {
        const breakPayload = breakResult.value as { breaks: any[]; active_break: any; total_break_seconds: number };
        setActiveBreak(breakPayload.active_break ?? null);
        setTodayBreaks(breakPayload.breaks ?? []);
        setTotalBreakSeconds(Number(breakPayload.total_break_seconds ?? 0));
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
      isFetchingRef.current = false;
      fetchAbortControllerRef.current = null;
    }
  };

  useEffect(() => {
    hasAttemptedAutoStartRef.current = false;
    hasRestoredSnapshotRef.current = false;
    wasAutoStartedRef.current = false;
    setNotice('');
    setFeedback(null);
    commitActiveTimer('init:reset', null, 'idle');
    setTodayEntries([]);
    setTodayTotal(0);
    setAllTimeTotal(0);
    setAllowedProjects([]);
    setSelectedProjectId(null);
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
      commitActiveTimer('init:restoreSnapshot', restoredSnapshot, 'running');
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
      const finalWorkedSeconds = latestWorkedSecondsRef.current;
      setWorkedBaseSeconds(finalWorkedSeconds);
      setTodayTotal((current) => Math.max(current, finalWorkedSeconds));
      setTimerBaseSeconds(0);
      setWorkedBaselineSnapshot(userId, finalWorkedSeconds, attendanceToday?.attendance_date);
      setFeedback({ tone: 'error', message: pendingNotice });
      setNotice('');
      commitActiveTimer('idleStop:consumeNotice', null, 'stopped_by_idle');
      justStoppedByIdleRef.current = true;
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      emitDesktopTimerStopped({ userId });
      // Safety: reset flag after 30 seconds to prevent getting stuck
      setTimeout(() => {
        justStoppedByIdleRef.current = false;
      }, 30000);
    }

    const handleIdleAutoStop = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTimerIdleStopDetail>).detail;
      if (!detail || detail.userId !== userId) {
        return;
      }

      const finalWorkedSeconds = latestWorkedSecondsRef.current;
      setWorkedBaseSeconds(finalWorkedSeconds);
      setTodayTotal((current) => Math.max(current, finalWorkedSeconds));
      setTimerBaseSeconds(0);
      setWorkedBaselineSnapshot(userId, finalWorkedSeconds, attendanceToday?.attendance_date);
      setAttendanceToday((prev: any) => prev ? {
        ...prev,
        is_checked_in: false,
        worked_seconds: Math.max(Number(prev?.worked_seconds || 0), finalWorkedSeconds),
        check_out_at: new Date().toISOString(),
      } : prev);
      setFeedback({ tone: 'error', message: detail.message });
      setNotice('');
      commitActiveTimer('idleStop:event', null, 'stopped_by_idle');
      setLiveDuration(0);
      justStoppedByIdleRef.current = true;
      localStorage.removeItem(ACTIVE_TIMER_KEY);
      emitDesktopTimerStopped({ userId });
      // Safety: reset flag after 30 seconds to prevent getting stuck
      setTimeout(() => {
        justStoppedByIdleRef.current = false;
      }, 30000);
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

    // Only seed auto-start on initial mount, not on re-renders
    // This ensures auto-start is armed when user logs in
    seedDesktopLaunchAutoStart(userId);
    
    // Always arm auto-start when user logs in (even if previously seeded)
    // This ensures auto-start works after logout/login
    if (canUseDesktopAutoStart()) {
      armAutoStart(userId);
      console.log('[Timer Auto-Start] Armed auto-start for user:', userId);
    }
    
    // Reset the attempted flag when user changes (new login)
    hasAttemptedAutoStartRef.current = false;
  }, [user?.id, userId]);

  useEffect(() => {
    if (!userId || activeTimer) {
      return;
    }

    void fetchData();
  }, [selectedProjectId]);

  useEffect(() => {
    // Guard: don't retry auto-start after a failed attempt in this session
    if (hasAttemptedAutoStartRef.current) {
      return;
    }

    // Debug logging for auto-start troubleshooting
    console.log('[Timer Auto-Start] Checking conditions:', {
      isLoading,
      isTrackedTimerUser: isTrackedTimerUser(user),
      canUseDesktopAutoStart: canUseDesktopAutoStart(),
      activeTimer: !!activeTimer,
      hasAttemptedAutoStart: hasAttemptedAutoStartRef.current,
      isStarting,
      isAutoStartSuppressed: isAutoStartSuppressed(userId),
      isAutoStartArmed: isAutoStartArmed(userId),
      officeStartTime: (organization?.settings as any)?.attendance?.office_start_time,
    });

    if (isLoading) {
      console.log('[Timer Auto-Start] BLOCKED: isLoading is true');
      return;
    }
    
    if (!isTrackedTimerUser(user)) {
      console.log('[Timer Auto-Start] BLOCKED: User is not a tracked timer user');
      return;
    }
    
    if (!canUseDesktopAutoStart()) {
      console.log('[Timer Auto-Start] BLOCKED: Not running in desktop app (window.desktopTracker not found)');
      return;
    }

    // Only block auto-start if timer is actually running (has valid start_time)
    // Don't clear auto-start arm for stale snapshots - let fetchData verify first
    if (activeTimer?.start_time) {
      if (hasRestoredSnapshotRef.current) {
        console.log('[Timer Auto-Start] Stale snapshot present, letting fetchData verify before blocking auto-start');
        return;
      }
      console.log('[Timer Auto-Start] BLOCKED: Timer already running (has start_time), clearing auto-start state');
      clearAutoStartArm(userId);
      hasAttemptedAutoStartRef.current = true;
      return;
    }

    // If stale timer data exists (no start_time), wait for fetchData to clear it
    // Safety: if activeTimer has no valid id, treat as null (e.g. error response object)
    if (activeTimer && !activeTimer.start_time) {
      if (activeTimer.id) {
        console.log('[Timer Auto-Start] Stale timer data (no start_time), waiting for fetchData', { 
          activeTimerId: activeTimer.id
        });
        return;
      }
      // Re-arm auto-start in case it was cleared by fetchData finding stale data
      if (!isAutoStartArmed(userId)) {
        armAutoStart(userId);
        console.log('[Timer Auto-Start] Re-armed auto-start after clearing invalid timer data');
      }
    }

    if (isStarting) {
      console.log('[Timer Auto-Start] BLOCKED: Timer is currently starting');
      return;
    }
    
    if (isAutoStartSuppressed(userId)) {
      console.log('[Timer Auto-Start] BLOCKED: Auto-start is suppressed');
      hasAttemptedAutoStartRef.current = true;
      return;
    }
    
    if (!isAutoStartArmed(userId)) {
      console.log('[Timer Auto-Start] BLOCKED: Auto-start is not armed');
      hasAttemptedAutoStartRef.current = true;
      return;
    }

    const officeStartTime = (organization?.settings as any)?.attendance?.office_start_time;
    if (!isAtOrAfterOfficeStartTime(officeStartTime)) {
      console.log('[Timer Auto-Start] Before office start time:', officeStartTime);
      return;
    }

    console.log('[Timer Auto-Start] All conditions met, attempting auto-start');
    hasAttemptedAutoStartRef.current = true;
    void handleStartTimer(true);
  }, [activeTimer?.id, isLoading, isStarting, userId, organization?.settings?.attendance?.office_start_time]);

  const handleStartTimer = async (isAutoStart = false) => {
    if (isTimerOperationInProgressRef.current) {
      console.log('[handleStartTimer] Timer operation already in progress, skipping');
      return;
    }
    isTimerOperationInProgressRef.current = true;
    setIsStarting(true);
    setNotice(isAutoStart ? 'Starting your timer automatically...' : '');
    setFeedback(null);
    clearIdleAutoStopNotice(userId);
    try {
      const startedAtIso = new Date().toISOString();
      const startPayload: Record<string, any> = { timer_slot: 'primary' as const };
      if (!isAutoStart) {
        startPayload.project_id = selectedProjectId;
        startPayload.task_id = selectedTaskId;
      }
      const startResult = await startTimerOfflineAware({
        project_id: startPayload.project_id as number | null | undefined,
        task_id: startPayload.task_id as number | null | undefined,
        timer_slot: 'primary',
      });
      if (!startResult.success) {
        // Offline-save failure (rare). Treat the same as a network failure
        // for the user: tell them the change will be retried, suppress the
        // auto-start arm so we don't loop, and bail out of this attempt.
        const offlineError = startResult.error || (isAutoStart
          ? 'Could not auto-start the timer. The change will be retried when you reconnect.'
          : 'Failed to start timer. The change will be retried when you reconnect.');
        if (isAutoStart) {
          clearAutoStartArm(userId);
          suppressAutoStart(userId);
        }
        setFeedback({ tone: 'error', message: offlineError });
        setNotice('');
        return;
      }
      const response = adaptTimerStartResult(startResult, {
        project_id: startPayload.project_id as number | null | undefined,
        task_id: startPayload.task_id as number | null | undefined,
        timer_slot: 'primary',
      });
      clearAutoStartArm(userId);
      clearAutoStartSuppression(userId);
      clearAutoStartSuppressionGlobal(userId);
      setTimerBaseSeconds(Number(response.data.duration || 0));
      const resumedWorkedSeconds = Math.max(workedBaseSeconds, todayDisplaySeconds);
      setWorkedBaseSeconds(resumedWorkedSeconds);
      setWorkedBaselineSnapshot(userId, resumedWorkedSeconds, attendanceToday?.attendance_date);
      syncTimerEntryLocally(response.data);
      
      // Mark as auto-started so fetchData doesn't overwrite it
      if (isAutoStart) {
        wasAutoStartedRef.current = true;
      }

      // Sync the task status locally — the backend start endpoint already
      // moves it to in_progress via syncTaskStatusForTimer for employees.
      if (!isAutoStart && selectedTaskId) {
        setAllowedTasks((current) =>
          current.map((t) => (t.id === selectedTaskId ? { ...t, status: 'in_progress' } : t))
        );
      }

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
          project_id: response.data.project_id ?? null,
          task_id: response.data.task_id ?? null,
        })
      );
      if (userId) {
        emitDesktopTimerStarted({
          userId,
          entryId: response.data.id,
        });
      }
      setNotice(isAutoStart ? 'Timer started. Choose a task for the running session if needed.' : '');
    } catch (error: any) {
      const errorData = error?.response?.data;
      console.error('Error starting timer:', errorData || error);
      const errorCode = String(errorData?.error_code || '').trim();
      const errorMessage = String(errorData?.message || JSON.stringify(errorData) || '').trim();
      const isLeaveStartBlocked = errorCode === 'ON_APPROVED_LEAVE'
        || (/leave/i.test(errorMessage) && /timer\s+cannot\s+start/i.test(errorMessage));

      if (isAutoStart) {
        clearAutoStartArm(userId);
        suppressAutoStart(userId);
      }

      if (isLeaveStartBlocked) {
        setFeedback({
          tone: 'error',
          message: errorMessage || 'You are on leave today. Timer cannot start.',
        });
        setNotice('');
      } else {
        setFeedback({
          tone: 'error',
          message: errorMessage || (isAutoStart ? 'Could not auto-start the timer.' : 'Failed to start timer'),
        });
        setNotice('');
      }
    } finally {
      setIsStarting(false);
      isTimerOperationInProgressRef.current = false;
    }
  };

  const handleStopTimer = async () => {
    if (isTimerOperationInProgressRef.current) {
      console.log('[handleStopTimer] Timer operation already in progress, skipping');
      return;
    }
    isTimerOperationInProgressRef.current = true;
    try {
      setNotice('');
      clearAutoStartArm(userId);
      suppressAutoStart(userId);
      const stopResult = await stopTimerOfflineAware({
        timer_slot: (activeTimer?.timer_slot || 'primary') as 'primary' | 'secondary',
      });
      if (!stopResult.success) {
        // Offline stop save failed. Surface the error to the user but
        // still treat it as a stopped timer locally — the sync engine
        // will retry and reconcile the state.
        setFeedback({
          tone: 'error',
          message: stopResult.error || 'Failed to stop timer. The change will be retried when you reconnect.',
        });
        commitActiveTimer('handleStopTimer:offlineFail', null, 'idle');
        setTimerBaseSeconds(0);
        localStorage.removeItem(ACTIVE_TIMER_KEY);
        if (userId) {
          emitDesktopTimerStopped({ userId, entryId: activeTimer?.id ?? null });
        }
        return;
      }
      const response = adaptTimerStopResult(stopResult, {
        id: activeTimer?.id ?? null,
        timer_slot: (activeTimer?.timer_slot || 'primary') as 'primary' | 'secondary',
      });
      const stoppedEntry = response.data;
      const stoppedDuration = Number(stoppedEntry?.duration || 0);
      const nextWorkedSeconds = Math.max(
        todayDisplaySeconds,
        workedBaseSeconds + Math.max(0, stoppedDuration - timerBaseSeconds),
      );
      commitActiveTimer('handleStopTimer:success', null, 'idle');
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
    } catch (error) {
      const status = (error as any)?.response?.status;
      if (status === 404) {
        clearAutoStartArm(userId);
        suppressAutoStart(userId);
        commitActiveTimer('handleStopTimer:404', null, 'idle');
        localStorage.removeItem(ACTIVE_TIMER_KEY);
        setWorkedBaselineSnapshot(userId, todayDisplaySeconds, attendanceToday?.attendance_date);
        if (userId) {
          emitDesktopTimerStopped({
            userId,
            entryId: activeTimer?.id ?? null,
          });
        }
        return;
      }
      console.error('Error stopping timer:', error);
    } finally {
      isTimerOperationInProgressRef.current = false;
    }
  };

  const handleStartBreak = async (reason?: string) => {
    if (isBreakStarting) {
      return;
    }
    setIsBreakStarting(true);
    setFeedback(null);
    try {
      // Pause the work timer locally (the server also stops the primary
      // TimeEntry inside BreakTrackingController.start). Calling handleStopTimer
      // keeps local worked-seconds and snapshot state correct; the extra stop
      // API call is a safe no-op when the entry is already closed. handleStopTimer
      // manages isTimerOperationInProgressRef internally, so we don't set it here.
      if (activeTimer) {
        await handleStopTimer();
      }
      const result = await breakTrackingApi.startBreak(reason || undefined);
      setActiveBreak(result.break ?? null);
      setBreakElapsed(0);
      setNotice('Break started. Your work timer is paused.');
      // Re-sync so the is_break TimeEntry row appears in "Today's Time Entries".
      void fetchData();
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to start break.';
      setFeedback({ tone: 'error', message });
    } finally {
      setIsBreakStarting(false);
    }
  };

  const handleEndBreak = async () => {
    if (isBreakEnding) {
      return;
    }
    setIsBreakEnding(true);
    setFeedback(null);
    try {
      await breakTrackingApi.endBreak();
      setActiveBreak(null);
      setBreakElapsed(0);
      setNotice('Break ended. Resuming your work timer.');
      // Auto-resume the work timer with the previously selected context.
      // handleStartTimer manages isTimerOperationInProgressRef internally.
      await handleStartTimer();
      // Re-sync so the completed is_break row + totals refresh.
      void fetchData();
    } catch (error: any) {
      const message = error?.response?.data?.message || 'Failed to end break.';
      setFeedback({ tone: 'error', message });
    } finally {
      setIsBreakEnding(false);
    }
  };

  const handleProjectSelection = async (projectId: number | null) => {
    setSelectedProjectId(projectId);

    if (!activeTimer) {
      setSelectedTaskId(null);
      return;
    }

    // If the project hasn't changed, no action needed
    if (activeTimer.project_id === projectId) {
      return;
    }

    setIsUpdatingTimerContext(true);
    setNotice('');

    try {
      // Calculate the time worked on the current timer before switching
      const currentTimerDuration = Math.max(0, liveDuration - timerBaseSeconds);
      const nextWorkedSeconds = workedBaseSeconds + currentTimerDuration;
      const switchSlot = (activeTimer.timer_slot || 'primary') as 'primary' | 'secondary';

      // First, explicitly stop the current timer to create a completed entry
      // This ensures the time worked without a project is saved as a separate entry
      const stopResult = await stopTimerOfflineAware({ timer_slot: switchSlot });
      if (!stopResult.success) {
        // Offline-save failed. Roll back the optimistic UI change and surface
        // the error so the user can retry.
        setSelectedProjectId(activeTimer.project_id || null);
        setFeedback({
          tone: 'error',
          message: stopResult.error || 'Failed to switch project. The change will be retried when you reconnect.',
        });
        return;
      }
      const stoppedResponse = adaptTimerStopResult(stopResult, {
        id: activeTimer.id ?? null,
        timer_slot: switchSlot,
      });

      // Add the stopped entry to todayEntries so it shows in the list
      // This entry will display "No task selected" since it had no project/task
      if (stoppedResponse.data) {
        setTodayEntries((prev) => {
          const withoutCurrent = prev.filter((entry) => entry.id !== activeTimer.id);
          return [stoppedResponse.data, ...withoutCurrent];
        });
      }

      // Update attendance state to reflect the stopped timer
      setAttendanceToday((prev: any) => prev ? {
        ...prev,
        worked_seconds: Math.max(Number(prev?.worked_seconds || 0), nextWorkedSeconds),
      } : prev);

      // Start a fresh timer with the new project
      const startResult = await startTimerOfflineAware({
        project_id: projectId,
        task_id: null,
        timer_slot: switchSlot,
      });
      if (!startResult.success) {
        setSelectedProjectId(activeTimer.project_id || null);
        setFeedback({
          tone: 'error',
          message: startResult.error || 'Failed to start timer for the new project. The change will be retried when you reconnect.',
        });
        return;
      }
      const response = adaptTimerStartResult(startResult, {
        project_id: projectId,
        task_id: null,
        timer_slot: switchSlot,
      });

      setSelectedTaskId(null);

      // Update worked base to include the time from the previous timer
      // This ensures shift remaining calculation is accurate
      setWorkedBaseSeconds(nextWorkedSeconds);
      setTodayTotal((current) => Math.max(current, nextWorkedSeconds));
      setWorkedBaselineSnapshot(userId, nextWorkedSeconds, attendanceToday?.attendance_date);

      setTimerBaseSeconds(0);
      syncTimerEntryLocally(response.data);

      localStorage.setItem(
        ACTIVE_TIMER_KEY,
        JSON.stringify({
          id: response.data.id,
          start_time: response.data.start_time,
          duration: response.data.duration ?? 0,
          description: response.data.description ?? '',
          project_id: response.data.project_id ?? null,
          task_id: response.data.task_id ?? null,
        })
      );

      setNotice(projectId ? 'Project selected. Timer reset for the new project.' : 'Project cleared. Timer reset.');
    } catch (error: any) {
      console.error('Error updating timer project:', error);
      setSelectedProjectId(activeTimer.project_id || null);
      setNotice(error?.response?.data?.message || 'Failed to update the running timer project.');
    } finally {
      setIsUpdatingTimerContext(false);
    }
  };

  const handleTaskSelection = async (taskId: number | null) => {
    setSelectedTaskId(taskId);

    if (!activeTimer) {
      return;
    }

    // If the task hasn't changed, no action needed
    if (activeTimer.task_id === taskId) {
      return;
    }

    setIsUpdatingTimerContext(true);
    setNotice('');

    try {
      const nextTask = taskId ? allowedTasks.find((task) => task.id === taskId) || null : null;

      // If no project is selected, stop the current timer and start fresh
      // This preserves the "No task selected" time as a separate entry
      if (!activeTimer.project_id) {
        // Calculate the time worked on the current timer before switching
        const currentTimerDuration = Math.max(0, liveDuration - timerBaseSeconds);
        const nextWorkedSeconds = workedBaseSeconds + currentTimerDuration;
        const switchSlot = (activeTimer.timer_slot || 'primary') as 'primary' | 'secondary';

        // Stop the current timer to create a completed entry
        const stopResult = await stopTimerOfflineAware({ timer_slot: switchSlot });
        if (!stopResult.success) {
          setSelectedTaskId(activeTimer.task_id || null);
          setFeedback({
            tone: 'error',
            message: stopResult.error || 'Failed to switch task. The change will be retried when you reconnect.',
          });
          return;
        }
        const stoppedResponse = adaptTimerStopResult(stopResult, {
          id: activeTimer.id ?? null,
          timer_slot: switchSlot,
        });

        // Add the stopped entry to todayEntries so it shows in the list
        if (stoppedResponse.data) {
          setTodayEntries((prev) => {
            const withoutCurrent = prev.filter((entry) => entry.id !== activeTimer.id);
            return [stoppedResponse.data, ...withoutCurrent];
          });
        }

        // Update attendance state
        setAttendanceToday((prev: any) => prev ? {
          ...prev,
          worked_seconds: Math.max(Number(prev?.worked_seconds || 0), nextWorkedSeconds),
        } : prev);

        // Start a fresh timer with the new task
        const startResult = await startTimerOfflineAware({
          project_id: nextTask?.project_id ?? null,
          task_id: taskId,
          timer_slot: switchSlot,
        });
        if (!startResult.success) {
          setSelectedTaskId(activeTimer.task_id || null);
          setFeedback({
            tone: 'error',
            message: startResult.error || 'Failed to start timer for the new task. The change will be retried when you reconnect.',
          });
          return;
        }
        const response = adaptTimerStartResult(startResult, {
          project_id: nextTask?.project_id ?? null,
          task_id: taskId,
          timer_slot: switchSlot,
        });

        // Sync the task status locally
        if (nextTask) {
          setAllowedTasks((current) =>
            current.map((t) => (t.id === nextTask.id ? { ...t, status: 'in_progress' } : t))
          );
        }

        // Update worked base
        setWorkedBaseSeconds(nextWorkedSeconds);
        setTodayTotal((current) => Math.max(current, nextWorkedSeconds));
        setWorkedBaselineSnapshot(userId, nextWorkedSeconds, attendanceToday?.attendance_date);

        setTimerBaseSeconds(0);
        syncTimerEntryLocally(response.data);

        localStorage.setItem(
          ACTIVE_TIMER_KEY,
          JSON.stringify({
            id: response.data.id,
            start_time: response.data.start_time,
            duration: response.data.duration ?? 0,
            description: response.data.description ?? '',
            project_id: response.data.project_id ?? null,
            task_id: response.data.task_id ?? null,
          })
        );

        setNotice(taskId ? 'Task switched. Timer reset for the new task.' : 'Task cleared. Timer reset.');
      } else {
        // Project is already selected, just update the task on the SAME entry
        // This keeps the timer running without resetting
        const response = await timeEntryApi.update(activeTimer.id, {
          project_id: activeTimer.project_id,
          task_id: taskId,
        });

        // Sync the task status locally
        if (nextTask) {
          setAllowedTasks((current) =>
            current.map((t) => (t.id === nextTask.id ? { ...t, status: 'in_progress' } : t))
          );
        }

        syncTimerEntryLocally(response.data);
        setNotice(taskId ? 'Task updated for the running timer.' : 'Task cleared from the running timer.');
      }
    } catch (error: any) {
      console.error('Error switching timer task:', error);
      setSelectedTaskId(activeTimer.task_id || null);
      setNotice(error?.response?.data?.message || 'Failed to switch task for the running timer.');
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
  latestWorkedSecondsRef.current = todayDisplaySeconds;
  const timerDisplaySeconds = activeTimer ? liveDuration : 0;
  const remainingShiftSeconds = Math.max(0, shiftTargetSeconds - effectiveWorkedSeconds);
  const overtimeSeconds = Math.max(0, effectiveWorkedSeconds - shiftTargetSeconds);

  useEffect(() => {
    if (!activeBreak?.start_at) {
      setBreakElapsed(0);
      return;
    }
    const startMs = new Date(activeBreak.start_at).getTime();
    const tick = () => setBreakElapsed(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeBreak?.start_at]);
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

  const formatTime = (seconds: number) => {
    const safeSeconds = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = Math.floor(safeSeconds % 60);
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const selectedTask = availableTasks.find((task) => task.id === selectedTaskId) || activeTimer?.task || null;
  const currentWorkTitle = selectedTask?.title || (activeTimer ? getTimeEntryTitle(activeTimer) : 'No task selected');
  const currentWorkDescription = activeTimer?.description || selectedTask?.description || 'No description provided';
  const displayedEntries = activeTimer && !todayEntries.some((entry) => entry.id === activeTimer.id)
    ? [activeTimer, ...todayEntries]
    : todayEntries;
  const workEntries = displayedEntries.filter((entry) => !entry.is_break);

  if (isLoading) {
    return <PageLoadingState label="Loading dashboard..." />;
  }

  return (
    <main className="min-h-screen bg-slate-50 px-6 py-4 text-slate-950 animate-fade-in">
      <div className="mx-auto max-w-[1800px] space-y-3">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">
              Welcome back, {user?.name?.split(' ')[0] || 'there'}!
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Start the timer, review today's attendance progress, and keep your current activity in one place.
            </p>
          </div>
          <div className="inline-flex h-12 items-center gap-3 self-start rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 shadow-sm">
            <Calendar className="h-5 w-5 text-sky-600" />
            {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </div>
        </header>

        {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

        <OfflineBanner />

        <section className="grid grid-cols-1 gap-7 xl:grid-cols-[1.25fr_1fr]">
          <div className="rounded-lg border border-blue-100 bg-white p-5 shadow-sm">
            <div className={`inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-semibold uppercase ${
              activeBreak ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'
            }`}>
              <span className={`flex h-5 w-5 items-center justify-center rounded-full text-white ${
                activeBreak ? 'bg-amber-500' : 'bg-blue-600'
              }`}>
                <Play className="h-3 w-3 fill-current" />
              </span>
              {activeBreak ? 'On Break' : activeTimer ? 'Timer Running' : currentWorkedSeconds > 0 ? 'Timer Paused' : 'Desktop Timer'}
            </div>

            <div className="mt-4 text-center">
              <p className="text-sm font-medium text-slate-500">Current Session</p>
              <div className="mt-2 text-6xl font-semibold leading-none tracking-normal text-slate-950 2xl:text-7xl">
                {formatTime(timerDisplaySeconds)}
              </div>
              <div className="mt-6 flex flex-wrap justify-center gap-4">
                <button
                  type="button"
                  aria-label="Start timer"
                  onClick={() => void handleStartTimer()}
                  disabled={Boolean(activeTimer) || isStarting || isUpdatingTimerContext}
                  className="inline-flex h-11 min-w-36 items-center justify-center gap-3 rounded-lg bg-blue-600 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Play className="h-5 w-5 fill-current" />
                  Start
                </button>
                <button
                  type="button"
                  aria-label="Pause timer"
                  onClick={() => void handleStopTimer()}
                  disabled={!activeTimer || isStarting || isUpdatingTimerContext}
                  className="inline-flex h-11 min-w-36 items-center justify-center gap-3 rounded-lg border border-slate-200 bg-white px-5 text-base font-semibold text-blue-600 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Pause className="h-5 w-5 fill-current" />
                  Pause
                </button>
                {activeBreak ? (
                  <button
                    type="button"
                    aria-label="End break"
                    onClick={() => void handleEndBreak()}
                    disabled={isBreakEnding}
                    className="inline-flex h-11 min-w-36 items-center justify-center gap-3 rounded-lg bg-amber-500 px-5 text-base font-semibold text-white shadow-sm transition hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Coffee className="h-5 w-5" />
                    {isBreakEnding ? 'Ending…' : 'End Break'}
                  </button>
                ) : (
                  <button
                    type="button"
                    aria-label="Start break"
                    onClick={() => void handleStartBreak()}
                    disabled={isBreakStarting || isUpdatingTimerContext}
                    className="inline-flex h-11 min-w-36 items-center justify-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-5 text-base font-semibold text-amber-700 shadow-sm transition hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Coffee className="h-5 w-5" />
                    {isBreakStarting ? 'Starting…' : 'Start Break'}
                  </button>
                )}
              </div>
            </div>

            <div className="mx-auto mt-6 h-px max-w-4xl bg-slate-200" />
            <div className="mx-auto mt-4 grid max-w-3xl grid-cols-1 divide-y divide-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <div className="flex items-center justify-center gap-3 py-2.5 sm:pr-8">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <Clock className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm text-slate-500">Shift Remaining</p>
                  <p className="mt-0.5 text-lg font-semibold text-slate-950">{formatTime(remainingShiftSeconds)}</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-3 py-2.5 sm:px-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-50 text-violet-600">
                  <Hourglass className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm text-slate-500">Overtime Timer</p>
                  <p className="mt-0.5 text-lg font-semibold text-slate-950">{formatTime(overtimeSeconds)}</p>
                </div>
              </div>
              <div className="flex items-center justify-center gap-3 py-2.5 sm:pl-8">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-50 text-amber-600">
                  <Coffee className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-sm text-slate-500">Break Timer</p>
                  <p className="mt-0.5 text-lg font-semibold text-slate-950">{formatTime(breakElapsed)}</p>
                </div>
              </div>
            </div>

            <div className="mx-auto mt-4 h-px max-w-4xl bg-slate-200" />
            <div className="mt-3 flex flex-wrap items-center justify-center gap-4 text-sm text-slate-600">
              <span className="inline-flex items-center gap-2">
                <Clock className="h-5 w-5 text-slate-500" />
                All-time Tracked: {formatDuration(allTimeTotal)}
              </span>
              <span className="hidden h-5 w-px bg-slate-300 sm:inline-block" />
              <span className="inline-flex items-center gap-2">
                <Users className="h-5 w-5 text-slate-500" />
                Work Time: {formatDuration(todayWorkSeconds)}
              </span>
              <span className="hidden h-5 w-px bg-slate-300 sm:inline-block" />
              <span className="inline-flex items-center gap-2">
                <Clock className="h-5 w-5 text-slate-500" />
                Track Time: {formatDuration(todayTrackSeconds)}
              </span>
              <span className="hidden h-5 w-px bg-slate-300 sm:inline-block" />
              <span className="inline-flex items-center gap-2">
                <Hourglass className="h-5 w-5 text-slate-500" />
                Idle Time: {formatDuration(todayIdleSeconds)}
              </span>
              <span className="hidden h-5 w-px bg-slate-300 sm:inline-block" />
              <span className="inline-flex items-center gap-2">
                <Coffee className="h-5 w-5 text-slate-500" />
                Total break time: {formatDuration(totalBreakSeconds)}
              </span>
              {halfDayLeaveApplied ? <span className="text-blue-700">{leaveTodayLabel}, target {formatDuration(shiftTargetSeconds)}</span> : null}
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-4">
                <span className="flex h-14 w-14 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Calendar className="h-8 w-8" />
                </span>
                <div>
                  <p className="text-lg font-semibold text-slate-950">
                    {new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                  </p>
                  <p className="mt-1 text-sm text-slate-500">Good to see you today. Let's stay productive!</p>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">
                <span>{activeTimer ? 'Running Timer Context' : 'Select Work Context'}</span>
              </div>
              <SelectInput
                aria-label="Active timer project"
                value={selectedProjectId ?? ''}
                onChange={(e) => void handleProjectSelection(e.target.value ? Number(e.target.value) : null)}
                disabled={allowedProjects.length === 0 || isUpdatingTimerContext || isStarting}
                className="mt-4 h-12 border-slate-300 bg-white text-slate-700 shadow-none disabled:bg-slate-50 disabled:text-slate-500"
              >
                <option value="" className="text-gray-900">
                  {allowedProjects.length === 0 ? 'No projects available' : 'Choose project'}
                </option>
                {allowedProjects.map((project) => (
                  <option key={project.id} value={project.id} className="text-gray-900">
                    {project.name}
                  </option>
                ))}
              </SelectInput>
              <SelectInput
                aria-label="Active timer task"
                value={selectedTaskId ?? ''}
                onChange={(e) => void handleTaskSelection(e.target.value ? Number(e.target.value) : null)}
                disabled={availableTasks.length === 0 || isUpdatingTimerContext || isStarting}
                className="mt-3 h-12 border-slate-300 bg-white text-slate-700 shadow-none disabled:bg-slate-50 disabled:text-slate-500"
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
              <p className="mt-3 text-sm text-slate-500">
                {availableTasks.length === 0
                  ? 'No tasks are available for the selected project and your assigned access.'
                  : activeTimer
                    ? 'Only tasks allowed for your assigned groups and projects are listed here.'
                  : 'Pick a task before starting, or attach one after the timer is already running.'}
              </p>
            </div>

            <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-600">Current Work</p>
                  <p className="mt-4 truncate text-xl font-semibold text-slate-950">{currentWorkTitle}</p>
                  <p className="mt-1 truncate text-base text-slate-500">{currentWorkDescription}</p>
                </div>
                <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
                  <ClipboardList className="h-9 w-9" />
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={submitOvertimeProof}
              disabled={isSubmittingOvertime || overtimeSeconds <= 0}
              className="inline-flex h-14 w-full items-center justify-center gap-3 rounded-lg border border-blue-500 bg-white px-5 text-base font-semibold text-blue-600 shadow-sm transition hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <UploadCloud className="h-5 w-5" />
              {isSubmittingOvertime ? 'Sending...' : 'Send Overtime Proof to Admin'}
            </button>
            {notice ? <p className="text-sm text-slate-500">{notice}</p> : null}
          </div>
        </section>

        <section className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              label: 'Track Time',
              value: formatDuration(todayTrackSeconds),
              hint: 'Tracked time today',
              icon: Clock,
              tone: 'bg-blue-50 text-blue-600',
            },
            {
              label: 'Work Time',
              value: formatDuration(todayWorkSeconds),
              hint: halfDayLeaveApplied
                ? `Half day applied, target ${formatDuration(shiftTargetSeconds)}`
                : todayDisplaySeconds > todayTotal
                  ? 'Includes approved attendance edits'
                  : todayDeltaLabel,
              icon: Clock,
              tone: 'bg-emerald-50 text-emerald-600',
            },
            {
              label: 'Idle Time',
              value: formatDuration(todayIdleSeconds),
              hint: 'Idle within tracked time',
              icon: Hourglass,
              tone: 'bg-amber-50 text-amber-600',
            },
            {
              label: 'Break Time',
              value: formatDuration(totalBreakSeconds),
              hint: 'Total break today',
              icon: Hourglass,
              tone: 'bg-orange-50 text-orange-600',
            },
            { label: 'Active Tasks', value: activeTasksCount, hint: activeTasksHint, icon: CalendarDays, tone: 'bg-violet-50 text-violet-600' },
            { label: 'Team Members', value: teamMembersCount, hint: `${newMembersThisWeek} new this week`, icon: Users, tone: 'bg-emerald-50 text-emerald-600' },
            { label: 'Productivity', value: `${productivityScore}%`, hint: 'Based on working ratio this week', icon: TrendingUp, tone: 'bg-orange-50 text-orange-600' },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <div key={item.label} className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-base text-slate-500">{item.label}</p>
                    <p className="mt-4 text-3xl font-semibold text-slate-950">{item.value}</p>
                    <p className="mt-3 text-sm text-slate-500">{item.hint}</p>
                  </div>
                  <span className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full ${item.tone}`}>
                    <Icon className="h-7 w-7" />
                  </span>
                </div>
              </div>
            );
          })}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-xl font-semibold tracking-normal text-slate-950">Today's Time Entries</h2>
          <div className="mt-5 overflow-hidden rounded-none border border-slate-200">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-4 font-semibold">Project / Task</th>
                  <th className="px-4 py-4 font-semibold">Started</th>
                  <th className="px-4 py-4 font-semibold">Duration</th>
                  <th className="px-4 py-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {workEntries.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="h-44 px-4 py-8 text-center text-slate-500">
                      <div className="flex flex-col items-center justify-center">
                        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                          <ClipboardList className="h-8 w-8" />
                        </span>
                        <p className="mt-4 text-base font-semibold text-slate-700">No time entries recorded for today.</p>
                        <p className="mt-1 text-sm">Your time entries will appear here once you start tracking.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  workEntries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-t border-slate-200"
                    >
                      <td className="px-4 py-4 text-slate-700">
                        <p className="font-semibold text-slate-950">{getTimeEntryTitle(entry)}</p>
                        <p className="mt-1 text-sm text-slate-500">{getTimeEntrySubtitle(entry, 'No description provided')}</p>
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {(() => {
                          const ms = getStartTimeMs(entry.start_time);
                          return Number.isFinite(ms)
                            ? new Date(ms).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                            : '—';
                        })()}
                      </td>
                      <td className="px-4 py-4 text-slate-700">{formatDuration(entry.duration)}</td>
                      <td className="px-4 py-4 text-slate-700">
                        <span className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
                          entry.end_time ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'
                        }`}>
                          <span className={`h-2 w-2 rounded-full ${entry.end_time ? 'bg-slate-400' : 'bg-blue-600'}`} />
                          {entry.end_time ? 'Completed' : 'Running'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
                {workEntries.length > 0 ? (
                  <tr className="border-t border-slate-200">
                    <td colSpan={4} className="px-4 py-3 text-center text-sm text-slate-500">
                      No more time entries for today
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="flex items-center gap-2 text-xl font-semibold tracking-normal text-slate-950">
            <Coffee className="h-5 w-5 text-amber-500" />
            Today's Break Entries
          </h2>
          <div className="mt-5 overflow-hidden rounded-none border border-slate-200">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-slate-50 text-slate-700">
                <tr>
                  <th className="px-4 py-4 font-semibold">Break</th>
                  <th className="px-4 py-4 font-semibold">Started</th>
                  <th className="px-4 py-4 font-semibold">Duration</th>
                  <th className="px-4 py-4 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {todayBreaks.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="h-32 px-4 py-8 text-center text-slate-500">
                      No breaks recorded today
                    </td>
                  </tr>
                ) : (
                  todayBreaks.map((b) => (
                    <tr
                      key={b.id}
                      className="border-t border-slate-200 border-l-4 border-l-amber-400"
                    >
                      <td className="px-4 py-4 text-slate-700">
                        <p className="flex items-center gap-1.5 font-semibold text-amber-700">
                          <Coffee className="h-4 w-4" />
                          Break
                        </p>
                        <p className="mt-1 text-sm text-slate-500">Auto-logged break</p>
                        {b.reason ? <p className="mt-1 text-xs text-slate-400">{b.reason}</p> : null}
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {b.start_at
                          ? new Date(b.start_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                          : '—'}
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        {b.end_at ? formatDuration(b.duration_seconds) : 'running'}
                      </td>
                      <td className="px-4 py-4 text-slate-700">
                        <span className={`inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-medium ${
                          b.end_at ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700'
                        }`}>
                          <span className={`h-2 w-2 rounded-full ${b.end_at ? 'bg-slate-400' : 'bg-amber-500'}`} />
                          {b.end_at ? 'Completed' : 'Running'}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
