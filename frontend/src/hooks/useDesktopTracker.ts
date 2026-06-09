import { useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { buildTrackedContextName, resolveExeDisplayName } from '@/lib/activityProductivity';
import {
  buildBrowserTrackingEventSignature,
  buildExactWebsiteDisplayName,
  isBrowserTrackingConnectionHealthy,
  isSupportedBrowserTrackingApp,
} from '@/lib/browserTracking';
import { idleAutoStopThresholdSeconds, idleGuardIntervalMs, idleTrackThresholdSeconds, lockScreenAutoStopThresholdSeconds } from '@/lib/runtimeConfig';
import { isTrackedTimerUser } from '@/lib/permissions';
import {
  DESKTOP_TIMER_STARTED_EVENT,
  DESKTOP_TIMER_STOPPED_EVENT,
  type DesktopTimerSessionDetail,
  emitDesktopTimerIdleStop,
  setIdleAutoStopNotice,
  suppressAutoStart,
} from '@/lib/desktopTimerSession';
import { activityApi, activitySessionApi, browserTrackingConnectionApi, screenshotApi, timeEntryApi } from '@/services/api';
import type {
  BrowserTrackingConnectionSyncRequest,
  BrowserTrackingEvent,
  BrowserTrackingState,
  DesktopDeviceIdentity,
  TimeEntry,
} from '@/types';

const ACTIVITY_TRACK_INTERVAL_MS = 1000;
const DEFAULT_SCREENSHOT_INTERVAL_MINUTES = 3;
const ALLOWED_SCREENSHOT_INTERVAL_MINUTES = [1, 3, 5, 10, 15, 30] as const;
const SCREENSHOT_CAPTURE_TIMEOUT_MS = 15 * 1000;
const SCREENSHOT_UPLOAD_TIMEOUT_MS = 30 * 1000;
const IDLE_THRESHOLD_SECONDS = idleTrackThresholdSeconds;
const IDLE_AUTO_STOP_THRESHOLD_SECONDS = Math.max(idleAutoStopThresholdSeconds, IDLE_THRESHOLD_SECONDS);
const IDLE_GUARD_INTERVAL_MS = idleGuardIntervalMs;
const LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS = lockScreenAutoStopThresholdSeconds;
const IDLE_STOP_API_TIMEOUT_MS = 15 * 1000;
const IDLE_STOP_MIN_INTERVAL_MS = 5 * 1000;
const IDLE_STOP_MAX_ATTEMPTS_PER_ENTRY = 3;
const RELIABLE_CONTEXT_REUSE_WINDOW_MS = 30000;
const MAX_PENDING_TRACKED_SECONDS = Math.max(1, Math.round(ACTIVITY_TRACK_INTERVAL_MS / 1000));
const EXACT_BROWSER_TRACKING_HEALTH_WINDOW_MS = 45 * 1000;
const BROWSER_TRACKING_HEALTH_SYNC_DEBOUNCE_MS = 5 * 1000;
const GENERIC_BROWSER_ACTIVITY_LABEL = 'browser activity';
const BROWSER_APP_KEYWORDS = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'safari', 'vivaldi'];
const SELF_TRACKER_KEYWORDS = ['carevance', 'carevance hrms', 'timetrackpro'];
const GENERIC_BROWSER_CONTEXT_PATTERNS = [
  /^new tab$/i,
  /^about:blank$/i,
  /^chrome:\/\/newtab\/?$/i,
  /^edge:\/\/newtab\/?$/i,
  /^google chrome$/i,
  /^microsoft edge$/i,
  /^mozilla firefox$/i,
  /^brave$/i,
  /^opera$/i,
  /^vivaldi$/i,
];

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string) => {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(`${label} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
};

const formatIdleDurationLabel = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes <= 0) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
};

const IDLE_AUTO_STOP_MESSAGE = `You were idle for ${formatIdleDurationLabel(IDLE_AUTO_STOP_THRESHOLD_SECONDS)}, so your timer was stopped.`;
const ACTIVITY_EVENTS: Array<keyof WindowEventMap> = [
  'mousemove',
  'mousedown',
  'mouseup',
  'keydown',
  'keyup',
  'click',
  'dblclick',
  'wheel',
  'scroll',
  'focus',
  'touchstart',
  'touchmove',
  'pointerdown',
  'pointermove',
];

let desktopTrackerRunSequence = 0;

const resolveScreenshotIntervalMs = (settings?: Record<string, any> | null) => {
  const rawInterval = Number(settings?.monitoring_interval_minutes);
  const intervalMinutes = ALLOWED_SCREENSHOT_INTERVAL_MINUTES.includes(
    rawInterval as (typeof ALLOWED_SCREENSHOT_INTERVAL_MINUTES)[number]
  )
    ? rawInterval
    : DEFAULT_SCREENSHOT_INTERVAL_MINUTES;

  return intervalMinutes * 60 * 1000;
};

type ActiveSegment = {
  activityId: number;
  durationSeconds: number;
  signature: string;
  kind: 'tracked' | 'idle';
  contextName?: string;
  activityType?: 'app' | 'url';
};

type ReliableTrackingContext = {
  contextName: string;
  activityType: 'app' | 'url';
  capturedAtMs: number;
  appFamily: string | null;
};

type ActiveDesktopSession = {
  sessionId: number;
  timeEntryId: number;
  signature: string;
  startedAt: string;
  startedAtMs: number;
  lastSeenAtMs: number;
};

type ActiveBrowserSession = {
  sessionId: number;
  timeEntryId: number;
  signature: string;
  startedAt: string;
  startedAtMs: number;
  lastSeenAtMs: number;
};

const isSelfTrackerContext = (context: { app?: string | null; title?: string | null; url?: string | null }) => {
  const haystack = [context.app, context.title, context.url]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join(' ');

  return SELF_TRACKER_KEYWORDS.some((keyword) => haystack.includes(keyword));
};

const isGenericBrowserContext = (contextName: string, activityType: 'app' | 'url') => {
  if (activityType !== 'url') {
    return false;
  }

  const normalized = String(contextName || '').trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return GENERIC_BROWSER_CONTEXT_PATTERNS.some((pattern) => pattern.test(normalized));
};

const resolveAppFamily = (appName: string, activityType: 'app' | 'url') => {
  const normalized = String(appName || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (activityType === 'url') {
    const browserKeyword = BROWSER_APP_KEYWORDS.find((keyword) => normalized.includes(keyword));
    return browserKeyword || 'browser';
  }

  return normalized;
};

const isBrowserAppName = (appName?: string | null) => {
  const normalized = String(appName || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return BROWSER_APP_KEYWORDS.some((keyword) => normalized.includes(keyword));
};

const isBrowserForegroundContext = (payload: DesktopForegroundWindowPayload) => {
  return Boolean(String(payload.url || '').trim()) || isBrowserAppName(payload.app);
};

const isReliableDesktopAppForegroundContext = (payload: DesktopForegroundWindowPayload) => {
  if (isBrowserForegroundContext(payload) || isSelfTrackerContext(payload)) {
    return false;
  }

  return Boolean(String(payload.app || '').trim() || String(payload.title || '').trim() || String(payload.description || '').trim());
};

const resolveForegroundCapturedAt = (payload: DesktopForegroundWindowPayload) => {
  const capturedAt = String(payload.captured_at || '').trim();

  return capturedAt || new Date().toISOString();
};

const resolveDesktopSessionSignature = (payload: DesktopForegroundWindowPayload) => (
  [
    String(payload.app || '').trim().toLowerCase(),
    String(payload.title || '').trim().toLowerCase(),
    String(payload.url || '').trim().toLowerCase(),
  ].join('|')
);

const EXPLORER_APP_KEYWORDS = ['explorer.exe', 'windows explorer', 'file explorer'];

const shouldPreferWindowTitleForDesktopApp = (appName?: string | null, windowTitle?: string | null) => {
  const normalizedAppName = String(appName || '').trim().toLowerCase();
  const normalizedWindowTitle = String(windowTitle || '').trim().toLowerCase();

  if (!normalizedWindowTitle) {
    return false;
  }

  if (EXPLORER_APP_KEYWORDS.some((keyword) => normalizedAppName.includes(keyword))) {
    return true;
  }

  return false;
};

const resolveDesktopSessionDisplayName = (payload: DesktopForegroundWindowPayload) => {
  const appName = String(payload.app || '').trim();
  const windowTitle = String(payload.title || '').trim();
  const description = String(payload.description || '').trim();

  // Prefer description (from PowerShell process metadata) for a human-readable name
  if (description) return description;

  const resolvedDisplayName = resolveExeDisplayName(appName);

  if (shouldPreferWindowTitleForDesktopApp(appName, windowTitle)) {
    return windowTitle;
  }

  return resolvedDisplayName || appName || windowTitle || 'Unknown App';
};

const resolveLatestBrowserTrackingSignalAt = (state?: BrowserTrackingState | null) => {
  const signalCandidates = [
    String(state?.last_event_at || '').trim(),
    ...(Array.isArray(state?.connections)
      ? state.connections.flatMap((connection) => [
          String(connection.last_seen_at || '').trim(),
          String(connection.paired_at || '').trim(),
        ])
      : []),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  if (!signalCandidates.length) {
    return null;
  }

  return signalCandidates
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
};

const buildBrowserTrackingHealthSyncPayload = (
  state: BrowserTrackingState,
  deviceIdentity: DesktopDeviceIdentity,
): BrowserTrackingConnectionSyncRequest => ({
  device_id: String(deviceIdentity.device_id || '').trim(),
  device_label: String(deviceIdentity.device_label || '').trim() || null,
  ready: Boolean(state.ready),
  last_error: String(state.last_error || '').trim() || null,
  last_event_at: resolveLatestBrowserTrackingSignalAt(state),
  connections: Array.isArray(state.connections)
    ? state.connections.map((connection) => ({
        browser_name: String(connection.browser_name || '').trim().toLowerCase(),
        profile_key: String(connection.profile_key || '').trim(),
        extension_origin: String(connection.extension_origin || '').trim() || null,
        extension_version: String(connection.extension_version || '').trim() || null,
        paired_at: String(connection.paired_at || '').trim() || null,
        last_seen_at: String(connection.last_seen_at || '').trim() || null,
      }))
        .filter((connection) => connection.browser_name && connection.profile_key)
        .sort((left, right) => (
          `${left.browser_name}|${left.profile_key}`.localeCompare(`${right.browser_name}|${right.profile_key}`)
        ))
    : [],
});

const buildBrowserTrackingHealthSyncSignature = (payload: BrowserTrackingConnectionSyncRequest) => JSON.stringify(payload);

export const useDesktopTracker = () => {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? null;
  const lastInputRef = useRef<number>(Date.now());
  const lastTickAtRef = useRef<number | null>(null);
  const activeSegmentRef = useRef<ActiveSegment | null>(null);
  const activeEntryRef = useRef<TimeEntry | null>(null);
  const activityIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleGuardIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const screenshotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dedicatedIdleStopIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingIdleRewindRef = useRef<Map<number, number>>(new Map());
  const lastAutoStoppedEntryIdRef = useRef<number | null>(null);
  const activeScreenshotEntryIdRef = useRef<number | null>(null);
  const idleStopInFlightRef = useRef(false);
  const idleStopBlockedUntilMsRef = useRef(0);
  const idleStopAttemptsPerEntryRef = useRef<Map<number, number>>(new Map());
  const lastIdleStopAttemptMsRef = useRef(0);
  const lastReliableTrackingContextRef = useRef<ReliableTrackingContext | null>(null);
  const pendingTrackedSecondsRef = useRef(0);
  const activeDesktopSessionRef = useRef<ActiveDesktopSession | null>(null);
  const activeBrowserSessionRef = useRef<ActiveBrowserSession | null>(null);
  const browserTrackingStateRef = useRef<BrowserTrackingState | null>(null);
  const exactBrowserHealthyUntilMsRef = useRef(0);
  const desktopDeviceIdentityRef = useRef<DesktopDeviceIdentity | null>(null);
  const pendingBrowserTrackingSyncStateRef = useRef<BrowserTrackingState | null>(null);
  const browserTrackingSyncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browserTrackingSyncSignatureRef = useRef<string | null>(null);
  const browserTrackingRealtimeSeenRef = useRef(false);
  const systemLockedAtMsRef = useRef<number | null>(null);
  const lockScreenAutoStopRevealPendingRef = useRef(false);
  const lockAutoStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTrackerIntervals = () => {
    if (activityIntervalRef.current !== null) {
      clearInterval(activityIntervalRef.current);
      activityIntervalRef.current = null;
    }

    if (idleGuardIntervalRef.current !== null) {
      clearInterval(idleGuardIntervalRef.current);
      idleGuardIntervalRef.current = null;
    }

    if (screenshotIntervalRef.current !== null) {
      clearInterval(screenshotIntervalRef.current);
      screenshotIntervalRef.current = null;
    }

    if (dedicatedIdleStopIntervalRef.current !== null) {
      clearInterval(dedicatedIdleStopIntervalRef.current);
      dedicatedIdleStopIntervalRef.current = null;
    }

  };

  const clearBrowserTrackingSyncTimeout = () => {
    if (browserTrackingSyncTimeoutRef.current !== null) {
      clearTimeout(browserTrackingSyncTimeoutRef.current);
      browserTrackingSyncTimeoutRef.current = null;
    }
  };

  const clearLockAutoStopTimeout = () => {
    if (lockAutoStopTimeoutRef.current !== null) {
      clearTimeout(lockAutoStopTimeoutRef.current);
      lockAutoStopTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    const markInput = () => {
      lastInputRef.current = Date.now();
      pendingIdleRewindRef.current.clear();
    };

    const markVisibleActivity = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        markInput();
      }
    };

    ACTIVITY_EVENTS.forEach((eventName) => {
      window.addEventListener(eventName, markInput);
    });
    document.addEventListener('visibilitychange', markVisibleActivity);

    return () => {
      ACTIVITY_EVENTS.forEach((eventName) => {
        window.removeEventListener(eventName, markInput);
      });
      document.removeEventListener('visibilitychange', markVisibleActivity);
    };
  }, []);

  useEffect(() => {
    const isTrackedUser = isTrackedTimerUser(user);
    const desktopApi = window.desktopTracker;
    const canCaptureScreenshots = typeof desktopApi?.captureScreenshot === 'function';
    if (!isAuthenticated || !isTrackedUser) {
      clearTrackerIntervals();
      activeSegmentRef.current = null;
      activeEntryRef.current = null;
      activeDesktopSessionRef.current = null;
      activeBrowserSessionRef.current = null;
      browserTrackingStateRef.current = null;
      exactBrowserHealthyUntilMsRef.current = 0;
      desktopDeviceIdentityRef.current = null;
      pendingBrowserTrackingSyncStateRef.current = null;
      browserTrackingSyncSignatureRef.current = null;
      browserTrackingRealtimeSeenRef.current = false;
      clearBrowserTrackingSyncTimeout();
      clearLockAutoStopTimeout();
      pendingIdleRewindRef.current.clear();
      lastAutoStoppedEntryIdRef.current = null;
      activeScreenshotEntryIdRef.current = null;
      idleStopInFlightRef.current = false;
      idleStopBlockedUntilMsRef.current = 0;
      idleStopAttemptsPerEntryRef.current.clear();
      lastIdleStopAttemptMsRef.current = 0;
      lastReliableTrackingContextRef.current = null;
      pendingTrackedSecondsRef.current = 0;
      systemLockedAtMsRef.current = null;
      lockScreenAutoStopRevealPendingRef.current = false;
      return;
    }

    const runId = ++desktopTrackerRunSequence;
    const isCurrentRun = () => desktopTrackerRunSequence === runId;
    const hasForegroundWindowBridge = typeof desktopApi?.onForegroundWindowChange === 'function';
    const screenshotIntervalMs = resolveScreenshotIntervalMs(user?.settings);
    let inFlight = false;
    let screenshotInFlight = false;
    clearTrackerIntervals();
    lastTickAtRef.current = Date.now();
    lastInputRef.current = Date.now();
    activeSegmentRef.current = null;
    activeEntryRef.current = null;
    activeDesktopSessionRef.current = null;
    activeBrowserSessionRef.current = null;
    browserTrackingStateRef.current = null;
    exactBrowserHealthyUntilMsRef.current = 0;
    desktopDeviceIdentityRef.current = null;
    pendingBrowserTrackingSyncStateRef.current = null;
    browserTrackingSyncSignatureRef.current = null;
    browserTrackingRealtimeSeenRef.current = false;
    clearBrowserTrackingSyncTimeout();
    pendingIdleRewindRef.current.clear();
    lastAutoStoppedEntryIdRef.current = null;
    activeScreenshotEntryIdRef.current = null;
    idleStopInFlightRef.current = false;
    idleStopBlockedUntilMsRef.current = 0;
    idleStopAttemptsPerEntryRef.current.clear();
    lastIdleStopAttemptMsRef.current = 0;
    lastReliableTrackingContextRef.current = null;
    pendingTrackedSecondsRef.current = 0;

    const syncScreenshotInterval = (timeEntryId: number | null) => {
      if (activeScreenshotEntryIdRef.current === timeEntryId) {
        return;
      }

      if (screenshotIntervalRef.current !== null) {
        clearInterval(screenshotIntervalRef.current);
        screenshotIntervalRef.current = null;
      }

      activeScreenshotEntryIdRef.current = timeEntryId;

      if (timeEntryId === null) {
        return;
      }

      if (!canCaptureScreenshots) {
        return;
      }

      screenshotIntervalRef.current = setInterval(() => {
        void captureScreenshotOnInterval();
      }, screenshotIntervalMs);
    };

    const clearTrackedActivitySegment = () => {
      if (activeSegmentRef.current?.kind === 'tracked') {
        activeSegmentRef.current = null;
      }

      pendingIdleRewindRef.current.clear();
    };

    const flushTrackerState = async (endedAt?: string) => {
      const resolvedEndedAt = endedAt || new Date().toISOString();
      await closeActiveDesktopSession(resolvedEndedAt);
      await closeActiveBrowserSession(resolvedEndedAt);
      activeSegmentRef.current = null;
      activeEntryRef.current = null;
      pendingIdleRewindRef.current.clear();
      pendingTrackedSecondsRef.current = 0;
      syncScreenshotInterval(null);
    };

    const getOrLoadActiveEntry = async () => {
      if (activeEntryRef.current?.id) {
        return activeEntryRef.current;
      }

      const active = await timeEntryApi.active({ timer_slot: 'primary' });
      const activeEntry = active.data;

      if (!activeEntry?.id) {
        activeEntryRef.current = null;
        syncScreenshotInterval(null);
        return null;
      }

      activeEntryRef.current = activeEntry;
      syncScreenshotInterval(activeEntry.id);

      const previousEntryId = lastAutoStoppedEntryIdRef.current;
      if (previousEntryId !== null && previousEntryId !== activeEntry.id) {
        idleStopAttemptsPerEntryRef.current.delete(previousEntryId);
      }
      lastAutoStoppedEntryIdRef.current = null;
      idleStopBlockedUntilMsRef.current = 0;

      return activeEntry;
    };

    const closeActiveDesktopSession = async (endedAt?: string) => {
      const activeDesktopSession = activeDesktopSessionRef.current;
      if (!activeDesktopSession) {
        return;
      }

      activeDesktopSessionRef.current = null;

      const parsedEndedAtMs = Date.parse(String(endedAt || ''));
      const endedAtMs = Number.isFinite(parsedEndedAtMs)
        ? Math.max(activeDesktopSession.startedAtMs, parsedEndedAtMs)
        : Date.now();
      const resolvedEndedAt = new Date(endedAtMs).toISOString();
      const durationSeconds = Math.max(1, Math.round((endedAtMs - activeDesktopSession.startedAtMs) / 1000));

      try {
        await activitySessionApi.update(activeDesktopSession.sessionId, {
          ended_at: resolvedEndedAt,
          duration_seconds: durationSeconds,
        });
      } catch (error) {
        console.error('Desktop tracker failed to close activity session:', error);
      }
    };

    const extendActiveDesktopSession = async (capturedAt: string) => {
      const activeDesktopSession = activeDesktopSessionRef.current;
      if (!activeDesktopSession) {
        return;
      }

      const parsedSeenAtMs = Date.parse(String(capturedAt || ''));
      if (!Number.isFinite(parsedSeenAtMs)) {
        return;
      }

      const seenAtMs = Math.max(activeDesktopSession.startedAtMs, parsedSeenAtMs);
      if (seenAtMs <= activeDesktopSession.lastSeenAtMs) {
        return;
      }

      activeDesktopSession.lastSeenAtMs = seenAtMs;
      const durationSeconds = Math.max(0, Math.round((seenAtMs - activeDesktopSession.startedAtMs) / 1000));

      try {
        await activitySessionApi.update(activeDesktopSession.sessionId, {
          ended_at: new Date(seenAtMs).toISOString(),
          duration_seconds: durationSeconds,
        });
      } catch (error) {
        console.error('Desktop tracker failed to extend activity session:', error);
      }
    };

    const markExactBrowserTrackingHealthy = (recordedAt?: string) => {
      const parsedRecordedAtMs = Date.parse(String(recordedAt || ''));
      const baseMs = Number.isFinite(parsedRecordedAtMs) ? parsedRecordedAtMs : Date.now();
      exactBrowserHealthyUntilMsRef.current = Math.max(
        exactBrowserHealthyUntilMsRef.current,
        baseMs + EXACT_BROWSER_TRACKING_HEALTH_WINDOW_MS
      );

      const currentState = browserTrackingStateRef.current;
      browserTrackingStateRef.current = {
        ready: currentState?.ready ?? true,
        local_url: currentState?.local_url ?? null,
        connections: currentState?.connections ?? [],
        pairing_code: currentState?.pairing_code ?? null,
        last_event_at: new Date(baseMs).toISOString(),
        last_error: currentState?.last_error ?? null,
      };
    };

    const hasHealthyExactBrowserTracking = (appName?: string | null, now = Date.now()) => {
      if (!isSupportedBrowserTrackingApp(appName)) {
        return false;
      }

      if (exactBrowserHealthyUntilMsRef.current > now) {
        return true;
      }

      return isBrowserTrackingConnectionHealthy(
        browserTrackingStateRef.current,
        now,
        EXACT_BROWSER_TRACKING_HEALTH_WINDOW_MS
      );
    };

    const ensureDesktopSessionStarted = async (payload: DesktopForegroundWindowPayload) => {
      const activeEntry = await getOrLoadActiveEntry();
      const capturedAt = resolveForegroundCapturedAt(payload);

      if (!activeEntry?.id) {
        await closeActiveDesktopSession(capturedAt);
        return;
      }

      const signature = resolveDesktopSessionSignature(payload);
      if (
        activeDesktopSessionRef.current
        && activeDesktopSessionRef.current.signature === signature
        && activeDesktopSessionRef.current.timeEntryId === activeEntry.id
      ) {
        await extendActiveDesktopSession(capturedAt);
        return;
      }

      await closeActiveDesktopSession(capturedAt);

      const displayName = resolveDesktopSessionDisplayName(payload);
      const appName = String(payload.app || '').trim() || displayName;
      const windowTitle = String(payload.title || '').trim() || displayName;
      const response = await activitySessionApi.create({
        time_entry_id: activeEntry.id,
        source: 'desktop',
        activity_kind: 'desktop_app',
        tool_type: 'software',
        display_name: displayName,
        app_name: appName,
        window_title: windowTitle,
        url: payload.url || null,
        started_at: capturedAt,
        confidence: 100,
      });

      const startedAtMs = Date.parse(capturedAt);
      activeDesktopSessionRef.current = {
        sessionId: response.data.id,
        timeEntryId: activeEntry.id,
        signature,
        startedAt: capturedAt,
        startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
        lastSeenAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
      };
    };

    const closeActiveBrowserSession = async (endedAt?: string) => {
      const activeBrowserSession = activeBrowserSessionRef.current;
      if (!activeBrowserSession) {
        return;
      }

      activeBrowserSessionRef.current = null;

      const parsedEndedAtMs = Date.parse(String(endedAt || ''));
      const endedAtMs = Number.isFinite(parsedEndedAtMs)
        ? Math.max(activeBrowserSession.startedAtMs, parsedEndedAtMs)
        : Date.now();
      const resolvedEndedAt = new Date(endedAtMs).toISOString();
      const durationSeconds = Math.max(1, Math.round((endedAtMs - activeBrowserSession.startedAtMs) / 1000));

      try {
        await activitySessionApi.update(activeBrowserSession.sessionId, {
          ended_at: resolvedEndedAt,
          duration_seconds: durationSeconds,
        });
      } catch (error) {
        console.error('Desktop tracker failed to close browser activity session:', error);
      }
    };

    const extendActiveBrowserSession = async (event: BrowserTrackingEvent) => {
      const activeBrowserSession = activeBrowserSessionRef.current;
      if (!activeBrowserSession) {
        return;
      }

      const parsedSeenAtMs = Date.parse(String(event.recorded_at || ''));
      if (!Number.isFinite(parsedSeenAtMs)) {
        return;
      }

      const seenAtMs = Math.max(activeBrowserSession.startedAtMs, parsedSeenAtMs);
      if (seenAtMs <= activeBrowserSession.lastSeenAtMs) {
        return;
      }

      activeBrowserSession.lastSeenAtMs = seenAtMs;
      const durationSeconds = Math.max(0, Math.round((seenAtMs - activeBrowserSession.startedAtMs) / 1000));

      try {
        await activitySessionApi.update(activeBrowserSession.sessionId, {
          ended_at: new Date(seenAtMs).toISOString(),
          duration_seconds: durationSeconds,
        });
      } catch (error) {
        console.error('Desktop tracker failed to extend browser activity session:', error);
      }
    };

    const syncBrowserTrackingHealth = async (state: BrowserTrackingState) => {
      const deviceIdentity = desktopDeviceIdentityRef.current;
      if (!userId || !deviceIdentity?.device_id) {
        return;
      }

      const payload = buildBrowserTrackingHealthSyncPayload(state, deviceIdentity);
      const nextSignature = buildBrowserTrackingHealthSyncSignature(payload);
      if (nextSignature === browserTrackingSyncSignatureRef.current) {
        return;
      }

      browserTrackingSyncSignatureRef.current = nextSignature;

      try {
        await browserTrackingConnectionApi.sync(payload);
      } catch (error) {
        browserTrackingSyncSignatureRef.current = null;
        console.warn('Desktop tracker browser tracking health sync failed:', error);
      }
    };

    const scheduleBrowserTrackingHealthSync = (
      state: BrowserTrackingState | null,
      options?: { immediate?: boolean },
    ) => {
      pendingBrowserTrackingSyncStateRef.current = state;
      clearBrowserTrackingSyncTimeout();

      if (!state) {
        return;
      }

      const delayMs = options?.immediate ? 0 : BROWSER_TRACKING_HEALTH_SYNC_DEBOUNCE_MS;
      browserTrackingSyncTimeoutRef.current = setTimeout(() => {
        browserTrackingSyncTimeoutRef.current = null;

        if (!isCurrentRun()) {
          return;
        }

        const latestState = pendingBrowserTrackingSyncStateRef.current;
        if (!latestState) {
          return;
        }

        void syncBrowserTrackingHealth(latestState);
      }, delayMs);
    };

    const applyBrowserTrackingState = async (
      state: BrowserTrackingState | null,
      options?: { immediateSync?: boolean },
    ) => {
      browserTrackingStateRef.current = state;
      pendingBrowserTrackingSyncStateRef.current = state;

      if (!state) {
        exactBrowserHealthyUntilMsRef.current = 0;
        return;
      }

      const nowMs = Date.now();
      const hasExactConnections = Array.isArray(state.connections) && state.connections.length > 0;
      const exactTrackingHealthy = hasExactConnections
        && isBrowserTrackingConnectionHealthy(state, nowMs, EXACT_BROWSER_TRACKING_HEALTH_WINDOW_MS);
      const latestSignalAt = resolveLatestBrowserTrackingSignalAt(state);

      if (exactTrackingHealthy && latestSignalAt) {
        markExactBrowserTrackingHealthy(latestSignalAt);
      } else if (!exactTrackingHealthy) {
        exactBrowserHealthyUntilMsRef.current = 0;
        await closeActiveBrowserSession(latestSignalAt || new Date(nowMs).toISOString());
      }

      scheduleBrowserTrackingHealthSync(state, {
        immediate: Boolean(options?.immediateSync || !exactTrackingHealthy || !state.ready || !hasExactConnections),
      });
    };

    const ensureBrowserSessionStarted = async (event: BrowserTrackingEvent) => {
      markExactBrowserTrackingHealthy(event.recorded_at);
      const activeEntry = await getOrLoadActiveEntry();

      if (!activeEntry?.id || !String(event.url || '').trim()) {
        await closeActiveBrowserSession(event.recorded_at);
        return;
      }

      const signature = buildBrowserTrackingEventSignature(event);
      if (
        activeBrowserSessionRef.current
        && activeBrowserSessionRef.current.signature === signature
        && activeBrowserSessionRef.current.timeEntryId === activeEntry.id
      ) {
        await extendActiveBrowserSession(event);
        return;
      }

      await closeActiveDesktopSession(event.recorded_at);
      await closeActiveBrowserSession(event.recorded_at);

      const response = await activitySessionApi.create({
        time_entry_id: activeEntry.id,
        source: 'browser_extension',
        activity_kind: 'website',
        tool_type: 'website',
        display_name: buildExactWebsiteDisplayName(event.url, event.title),
        app_name: String(event.browser_name || '').trim().toLowerCase() || null,
        window_title: String(event.title || '').trim() || null,
        url: String(event.url || '').trim(),
        started_at: event.recorded_at,
        confidence: 100,
        metadata: {
          profile_key: event.profile_key,
          tab_id: event.tab_id ?? null,
          window_id: event.window_id ?? null,
        },
      });

      const startedAtMs = Date.parse(String(event.recorded_at || ''));
      activeBrowserSessionRef.current = {
        sessionId: response.data.id,
        timeEntryId: activeEntry.id,
        signature,
        startedAt: event.recorded_at,
        startedAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
        lastSeenAtMs: Number.isFinite(startedAtMs) ? startedAtMs : Date.now(),
      };
    };

    const handleForegroundWindowChange = async (payload: DesktopForegroundWindowPayload) => {
      if (!isCurrentRun()) {
        return;
      }

      pendingTrackedSecondsRef.current = 0;
      clearTrackedActivitySegment();

      if (isReliableDesktopAppForegroundContext(payload)) {
        await closeActiveBrowserSession(resolveForegroundCapturedAt(payload));
        try {
          await ensureDesktopSessionStarted(payload);
        } catch (error) {
          console.error('Desktop tracker failed to start activity session:', error);
        }
        return;
      }

      await closeActiveDesktopSession(resolveForegroundCapturedAt(payload));
    };

    const handleBrowserTrackingEvent = async (event: BrowserTrackingEvent) => {
      if (!isCurrentRun()) {
        return;
      }

      pendingTrackedSecondsRef.current = 0;
      clearTrackedActivitySegment();
      markExactBrowserTrackingHealthy(event.recorded_at);

      if (event.kind === 'window-blurred' || event.kind === 'tab-closed') {
        await closeActiveBrowserSession(event.recorded_at);
        return;
      }

      if (!String(event.url || '').trim()) {
        await closeActiveBrowserSession(event.recorded_at);
        return;
      }

      try {
        await ensureBrowserSessionStarted(event);
      } catch (error) {
        console.error('Desktop tracker failed to start browser activity session:', error);
      }
    };

    const getIdleState = async (now: number) => {
      try {
        const idleSecondsSystem = Number(await desktopApi?.getSystemIdleSeconds?.());

        if (Number.isFinite(idleSecondsSystem)) {
          const safeIdleSecondsSystem = Math.max(0, Math.floor(idleSecondsSystem));

          return {
            idleSeconds: safeIdleSecondsSystem,
            lastActivityAtMs: Math.max(0, now - (safeIdleSecondsSystem * 1000)),
            contextName: null,
          };
        }
      } catch (error) {
        console.warn('Desktop tracker system idle lookup failed, falling back to page input activity.', error);
      }

      const idleSecondsFromInput = Math.max(0, Math.floor((now - lastInputRef.current) / 1000));

      return {
        idleSeconds: idleSecondsFromInput,
        lastActivityAtMs: lastInputRef.current,
        contextName: null,
      };
    };

    const rewindTrackedIdleWindow = async (recordedAt: string) => {
      const rewindPoints = Array.from(pendingIdleRewindRef.current.entries());
      pendingIdleRewindRef.current.clear();

      await Promise.all(rewindPoints.map(async ([activityId, baselineDuration]) => {
        if (baselineDuration > 0) {
          await activityApi.update(activityId, {
            duration: baselineDuration,
            recorded_at: recordedAt,
          });
          return;
        }

        await activityApi.delete(activityId);
      }));
    };

    const syncIdleActivitySnapshot = async (
      activeEntry: TimeEntry,
      idleSeconds: number,
      lastActivityAtMs: number,
      recordedAt: string,
      contextName?: string,
    ) => {
      const idleName = (`System Idle - ${contextName || 'Active Input'}`).slice(0, 255);
      const idleSignature = `${activeEntry.id}:idle:${lastActivityAtMs}`;

      if (activeSegmentRef.current?.kind !== 'idle') {
        if (pendingIdleRewindRef.current.size > 0) {
          await rewindTrackedIdleWindow(recordedAt);
        }
        activeSegmentRef.current = null;
      }

      const currentIdleSegment = activeSegmentRef.current;
      if (currentIdleSegment?.signature === idleSignature) {
        await activityApi.update(currentIdleSegment.activityId, {
          name: idleName,
          duration: idleSeconds,
          recorded_at: recordedAt,
        });
        if (activeSegmentRef.current?.kind === 'idle' && activeSegmentRef.current.signature === idleSignature) {
          activeSegmentRef.current.durationSeconds = idleSeconds;
        }
        return;
      }

      const response = await activityApi.create({
        time_entry_id: activeEntry.id,
        type: 'idle' as const,
        name: idleName,
        duration: idleSeconds,
        recorded_at: recordedAt,
      });
      activeSegmentRef.current = {
        activityId: response.data.id,
        durationSeconds: idleSeconds,
        signature: idleSignature,
        kind: 'idle',
      };
    };

    const attemptIdleAutoStop = async (
      activeEntry: TimeEntry,
      idleSeconds: number,
      lastActivityAtMs: number,
      recordedAt: string,
    ) => {
      if (!isCurrentRun()) {
        return false;
      }

      const now = Date.now();

      if (!activeEntry?.id || !Number.isFinite(idleSeconds) || idleSeconds < 0) {
        console.warn('[desktop-tracker] idle auto-stop skipped: invalid inputs', {
          entryId: activeEntry?.id,
          idleSeconds,
        });
        return false;
      }

      if (
        idleSeconds < IDLE_AUTO_STOP_THRESHOLD_SECONDS
        || lastAutoStoppedEntryIdRef.current === activeEntry.id
        || idleStopInFlightRef.current
        || now < idleStopBlockedUntilMsRef.current
        || (now - lastIdleStopAttemptMsRef.current) < IDLE_STOP_MIN_INTERVAL_MS
      ) {
        return false;
      }

      const priorAttempts = idleStopAttemptsPerEntryRef.current.get(activeEntry.id) ?? 0;
      if (priorAttempts >= IDLE_STOP_MAX_ATTEMPTS_PER_ENTRY) {
        console.warn('[desktop-tracker] idle auto-stop skipped: max attempts reached for entry', {
          session_id: activeEntry.id,
          attempts: priorAttempts,
        });
        return false;
      }

      idleStopInFlightRef.current = true;
      lastIdleStopAttemptMsRef.current = now;
      idleStopAttemptsPerEntryRef.current.set(activeEntry.id, priorAttempts + 1);

      let stopSucceeded = false;
      let errorStatus: number | undefined;
      let errorBody: unknown;

      try {
        console.info('[desktop-tracker] idle auto-stop requested', {
          session_id: activeEntry.id,
          employee_id: userId,
          timer_start_time: activeEntry.start_time,
          last_activity_time: new Date(lastActivityAtMs).toISOString(),
          idle_end_time: recordedAt,
          continuous_idle_duration: idleSeconds,
          timer_stop_reason: 'continuous_idle_threshold',
          attempt: priorAttempts + 1,
        });

        const stopPromise = timeEntryApi.stop({
          timer_slot: 'primary',
          auto_stopped_for_idle: true,
          idle_seconds: idleSeconds,
          last_activity_at: new Date(lastActivityAtMs).toISOString(),
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('idle_stop_timeout')), IDLE_STOP_API_TIMEOUT_MS);
        });
        await Promise.race([stopPromise, timeoutPromise]);

        lastAutoStoppedEntryIdRef.current = activeEntry.id;
        stopSucceeded = true;
      } catch (error: any) {
        errorStatus = error?.response?.status;
        errorBody = error?.response?.data;
        const isTimeout = error?.message === 'idle_stop_timeout';
        console.warn('[desktop-tracker] idle auto-stop failed', {
          session_id: activeEntry.id,
          status: errorStatus,
          isTimeout,
          errorMessage: error?.message,
          errorBody,
        });
      } finally {
        idleStopInFlightRef.current = false;
      }

      if (!stopSucceeded) {
        if (errorStatus === 404) {
          cleanupAfterIdleStop();
          return true;
        }

        if (errorStatus === 409) {
          const retryAfterSecondsRaw = Number((errorBody as any)?.retry_after_seconds);
          const retryAfterSeconds = Number.isFinite(retryAfterSecondsRaw)
            ? Math.max(1, Math.floor(retryAfterSecondsRaw))
            : 15;
          idleStopBlockedUntilMsRef.current = Date.now() + (retryAfterSeconds * 1000);

          if (activeSegmentRef.current?.kind === 'idle') {
            try {
              await activityApi.delete(activeSegmentRef.current.activityId);
            } catch (deleteError) {
              console.warn('Desktop tracker idle validation rewind failed:', deleteError);
            }
          }
          cleanupAfterIdleStop();
          console.info('[desktop-tracker] idle auto-stop rejected by backend validation', {
            session_id: activeEntry.id,
            employee_id: userId,
            timer_start_time: activeEntry.start_time,
            last_activity_time: new Date(lastInputRef.current).toISOString(),
            retry_after_seconds: retryAfterSeconds,
          });
          return true;
        }

        if (priorAttempts + 1 < IDLE_STOP_MAX_ATTEMPTS_PER_ENTRY) {
          const backoffMs = Math.min(30_000, 2_000 * Math.pow(2, priorAttempts));
          idleStopBlockedUntilMsRef.current = Date.now() + backoffMs;
          console.info('[desktop-tracker] idle auto-stop will retry after backoff', {
            session_id: activeEntry.id,
            attempt: priorAttempts + 1,
            backoffMs,
          });
        }
        return false;
      }

      cleanupAfterIdleStop();

      const idleDurationLabel = formatIdleDurationLabel(idleSeconds);

      if (typeof desktopApi?.showNotification === 'function') {
        try {
          await desktopApi.showNotification({
            id: Date.now(),
            title: 'Timer Stopped - Idle Detected',
            body: `You were idle for ${idleDurationLabel}. Your timer has been stopped.`,
            route: '/dashboard',
            type: 'idle_stop',
          });
        } catch (notificationError) {
          console.warn('[desktop-tracker] failed to show idle-stop notification:', notificationError);
        }
      } else if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Timer Stopped - Idle Detected', {
            body: `You were idle for ${idleDurationLabel}. Your timer has been stopped.`,
            tag: 'idle-auto-stop',
          });
        } catch (notificationError) {
          console.warn('[desktop-tracker] failed to show browser idle-stop notification:', notificationError);
        }
      }

      if (userId) {
        try {
          suppressAutoStart(userId);
          setIdleAutoStopNotice(userId, IDLE_AUTO_STOP_MESSAGE);
          emitDesktopTimerIdleStop({
            userId,
            message: IDLE_AUTO_STOP_MESSAGE,
          });
        } catch (eventError) {
          console.warn('[desktop-tracker] failed to emit idle-stop events:', eventError);
        }
      }

      if (typeof desktopApi?.revealWindow === 'function' && isCurrentRun()) {
        let isCurrentlyLocked = systemLockedAtMsRef.current !== null;
        if (!isCurrentlyLocked && typeof desktopApi?.getSystemLockState === 'function') {
          try {
            const lockState = await desktopApi.getSystemLockState();
            isCurrentlyLocked = Boolean(lockState?.locked || lockState?.state === 'locked' || lockState?.state === 'suspended');
          } catch {}
        }
        if (isCurrentlyLocked) {
          lockScreenAutoStopRevealPendingRef.current = true;
        } else {
          try {
            await desktopApi.revealWindow();
          } catch (revealError) {
            console.warn('[desktop-tracker] failed to reveal window:', revealError);
          }
        }
      }

      return true;
    };

    const cleanupAfterIdleStop = () => {
      activeSegmentRef.current = null;
      activeEntryRef.current = null;
      pendingIdleRewindRef.current.clear();
      pendingTrackedSecondsRef.current = 0;
      syncScreenshotInterval(null);
    };

    const tick = async () => {
      if (inFlight || !isCurrentRun()) return;
      const now = Date.now();
      const previousTickAt = lastTickAtRef.current ?? now;
      lastTickAtRef.current = now;
      inFlight = true;
      try {
        const active = await timeEntryApi.active({ timer_slot: 'primary' });
        const activeEntry = active.data;
        if (!activeEntry?.id) {
          await closeActiveDesktopSession(new Date(now).toISOString());
          await closeActiveBrowserSession(new Date(now).toISOString());
          activeSegmentRef.current = null;
          activeEntryRef.current = null;
          lastAutoStoppedEntryIdRef.current = null;
          pendingTrackedSecondsRef.current = 0;
          syncScreenshotInterval(null);
          return;
        }
        activeEntryRef.current = activeEntry;
        syncScreenshotInterval(activeEntry.id);

        if (systemLockedAtMsRef.current !== null && lockAutoStopTimeoutRef.current === null) {
          scheduleLockAutoStop();
        }

        const { idleSeconds, lastActivityAtMs, contextName: idleStateContextName } = await getIdleState(now);
        if (idleSeconds < IDLE_AUTO_STOP_THRESHOLD_SECONDS) {
          idleStopBlockedUntilMsRef.current = 0;
        }

        if (
          idleSeconds >= IDLE_AUTO_STOP_THRESHOLD_SECONDS
          && systemLockedAtMsRef.current !== null
          && !idleStopInFlightRef.current
          && lastAutoStoppedEntryIdRef.current !== activeEntry.id
          && (now - lastIdleStopAttemptMsRef.current) >= IDLE_STOP_MIN_INTERVAL_MS
        ) {
          console.info('[desktop-tracker] tick: forcing lock auto-stop', {
            idle_seconds: idleSeconds,
            session_id: activeEntry.id,
            locked_at_ms: systemLockedAtMsRef.current,
          });
          const recordedAt = new Date(now).toISOString();
          const stopped = await forceStopTimerForLock(activeEntry, idleSeconds, lastActivityAtMs, recordedAt);
          if (stopped) {
            lockScreenAutoStopRevealPendingRef.current = true;
          }
        }
        const trackedWindowEnd = Math.min(now, Math.max(lastActivityAtMs, previousTickAt));
        const trackedSecondsThisTick = Math.max(
          0,
          Math.round((trackedWindowEnd - previousTickAt) / 1000)
        );
        let activeContext = null;
        try {
          if (typeof desktopApi?.getActiveWindowContext === 'function') {
            activeContext = await desktopApi.getActiveWindowContext();
          }
        } catch (err) {
          console.warn('[usage] desktop active context fetch failed:', err);
        }
        const fallbackTitle = typeof document !== 'undefined' ? document.title : '';
        const recordedAt = new Date(now).toISOString();
        const rawAppName = String(activeContext?.app || '').trim();
        const rawUrl = String(activeContext?.url || '').trim();
        const rawIsBrowserApp = BROWSER_APP_KEYWORDS.some((keyword) => rawAppName.toLowerCase().includes(keyword));
        const exactBrowserTrackingHealthy = hasHealthyExactBrowserTracking(rawAppName, now);
        const rawContextName = buildTrackedContextName(activeContext || {});
        const rawActivityType: 'app' | 'url' = rawUrl || rawIsBrowserApp ? 'url' : 'app';
        const rawAppFamily = resolveAppFamily(rawAppName, rawActivityType);
        const hasReliableDesktopContext = Boolean(rawContextName)
          && !isSelfTrackerContext(activeContext || {})
          && !isGenericBrowserContext(rawContextName, rawActivityType);

        if (hasReliableDesktopContext) {
          lastReliableTrackingContextRef.current = {
            contextName: rawContextName,
            activityType: rawActivityType,
            capturedAtMs: now,
            appFamily: rawAppFamily,
          };
        }

        const isSelfTrackerRawContext = isSelfTrackerContext({
          app: rawAppName,
          title: String(activeContext?.title || '').trim(),
          url: rawUrl,
        });
        const isGenericBrowserSurface = isGenericBrowserContext(rawContextName || fallbackTitle, rawActivityType);
        const recentReliableTrackingContext = lastReliableTrackingContextRef.current
          && (now - lastReliableTrackingContextRef.current.capturedAtMs) <= RELIABLE_CONTEXT_REUSE_WINDOW_MS
            ? lastReliableTrackingContextRef.current
            : null;
        const compatibleReliableTrackingContext = !hasReliableDesktopContext
          && recentReliableTrackingContext
          && (
            isSelfTrackerRawContext
            || (
              rawAppFamily
              && recentReliableTrackingContext.appFamily
              && rawAppFamily === recentReliableTrackingContext.appFamily
              && isGenericBrowserSurface
            )
          )
            ? recentReliableTrackingContext
            : null;
        const genericBrowserTrackingContext = !hasReliableDesktopContext
          && !compatibleReliableTrackingContext
          && rawIsBrowserApp
          && isGenericBrowserSurface
            ? {
                contextName: GENERIC_BROWSER_ACTIVITY_LABEL,
                activityType: 'url' as const,
              }
            : null;
        const fallbackTrackingContext = compatibleReliableTrackingContext || genericBrowserTrackingContext;
        const resolvedTrackingContext = hasReliableDesktopContext
          ? {
              contextName: rawContextName,
              activityType: rawActivityType,
            }
          : fallbackTrackingContext;
        const contextName = resolvedTrackingContext?.contextName || fallbackTitle || 'Active Input';
        const activityType: 'app' | 'url' = resolvedTrackingContext?.activityType || 'app';
        const currentForegroundPayload: DesktopForegroundWindowPayload = {
          app: rawAppName || null,
          title: String(activeContext?.title || '').trim() || null,
          url: rawUrl || null,
          captured_at: recordedAt,
        };

        if (idleSeconds >= IDLE_THRESHOLD_SECONDS) {
          await closeActiveDesktopSession(new Date(lastActivityAtMs).toISOString());
          await closeActiveBrowserSession(new Date(lastActivityAtMs).toISOString());
          pendingTrackedSecondsRef.current = 0;
          await syncIdleActivitySnapshot(
            activeEntry,
            idleSeconds,
            lastActivityAtMs,
            recordedAt,
            idleStateContextName || contextName
          );

          if (await attemptIdleAutoStop(activeEntry, idleSeconds, lastActivityAtMs, recordedAt)) {
            return;
          }
        } else {
          if (
            hasForegroundWindowBridge
            && (
              isReliableDesktopAppForegroundContext(currentForegroundPayload)
              || (
                activityType === 'app'
                && (hasReliableDesktopContext || fallbackTrackingContext?.activityType === 'app')
              )
            )
          ) {
            pendingTrackedSecondsRef.current = 0;
            clearTrackedActivitySegment();

            if (
              isReliableDesktopAppForegroundContext(currentForegroundPayload)
            ) {
              try {
                await ensureDesktopSessionStarted(currentForegroundPayload);
              } catch (error) {
                console.error('Desktop tracker failed to recover activity session from polling context:', error);
              }
            }

            return;
          }

          if (exactBrowserTrackingHealthy && rawIsBrowserApp) {
            pendingTrackedSecondsRef.current = 0;
            clearTrackedActivitySegment();
            await closeActiveDesktopSession(recordedAt);
            return;
          }

          if (trackedSecondsThisTick <= 0) {
            return;
          }

          if (
            !hasReliableDesktopContext
            && !fallbackTrackingContext
            && isSelfTrackerRawContext
          ) {
            pendingTrackedSecondsRef.current = Math.min(
              MAX_PENDING_TRACKED_SECONDS,
              pendingTrackedSecondsRef.current + trackedSecondsThisTick
            );
            return;
          }

          // Close any orphaned desktop session when foreground is no longer a reliable desktop context
          await closeActiveDesktopSession(recordedAt);

          const attributedTrackedSeconds = trackedSecondsThisTick + pendingTrackedSecondsRef.current;
          pendingTrackedSecondsRef.current = 0;

          const payload = {
            time_entry_id: activeEntry.id,
            type: activityType,
            name: contextName,
            duration: attributedTrackedSeconds,
            recorded_at: recordedAt,
            app_name: rawAppName || undefined,
            window_title: String(activeContext?.title || '').trim() || undefined,
          };
          const signature = `${payload.time_entry_id}:${payload.type}:${payload.name}`;
          const currentSegment = activeSegmentRef.current;

          if (currentSegment?.kind === 'tracked' && currentSegment.signature === signature) {
            const baselineDuration = currentSegment.durationSeconds;
            const nextDuration = baselineDuration + attributedTrackedSeconds;
            await activityApi.update(currentSegment.activityId, {
              duration: nextDuration,
              recorded_at: recordedAt,
            });
            currentSegment.durationSeconds = nextDuration;
            if (!pendingIdleRewindRef.current.has(currentSegment.activityId)) {
              pendingIdleRewindRef.current.set(currentSegment.activityId, baselineDuration);
            }
          } else {
            const response = await activityApi.create(payload);
            activeSegmentRef.current = {
              activityId: response.data.id,
              durationSeconds: attributedTrackedSeconds,
              signature,
              kind: 'tracked',
              contextName: payload.name,
              activityType: payload.type,
            };
            pendingIdleRewindRef.current.set(response.data.id, 0);
          }
        }
      } catch (error) {
        console.error('Desktop tracker tick failed:', error);
      } finally {
        inFlight = false;
      }
    };

    const runIdleGuard = async () => {
      if (!isCurrentRun()) return;
      // Shared inFlight guard prevents the activity tick (1s) and idle guard
      // (configured interval, e.g. 1s) from racing on the same idle state
      // snapshot. Without this, both can call getIdleState and
      // syncIdleActivitySnapshot concurrently, double-emitting idle records.
      if (inFlight) return;
      inFlight = true;
      try {
        const activeEntry = activeEntryRef.current || await getOrLoadActiveEntry();
        if (!activeEntry?.id) {
          return;
        }

        if (systemLockedAtMsRef.current !== null && lockAutoStopTimeoutRef.current === null) {
          scheduleLockAutoStop();
        }

        const now = Date.now();
        const { idleSeconds, lastActivityAtMs, contextName: idleStateContextName } = await getIdleState(now);

        if (idleSeconds < IDLE_THRESHOLD_SECONDS) {
          idleStopBlockedUntilMsRef.current = 0;
          return;
        }

        if (idleSeconds >= IDLE_AUTO_STOP_THRESHOLD_SECONDS) {
          console.info('[desktop-tracker] runIdleGuard: idle exceeds auto-stop threshold', {
            idle_seconds: idleSeconds,
            threshold_seconds: IDLE_AUTO_STOP_THRESHOLD_SECONDS,
            session_id: activeEntry.id,
          });
        }

        if (idleSeconds < IDLE_AUTO_STOP_THRESHOLD_SECONDS) {
          idleStopBlockedUntilMsRef.current = 0;
        }

        const recordedAt = new Date(now).toISOString();
        const idleContextName = idleStateContextName || activeSegmentRef.current?.contextName || 'Active Input';
        await syncIdleActivitySnapshot(activeEntry, idleSeconds, lastActivityAtMs, recordedAt, idleContextName);
        await attemptIdleAutoStop(activeEntry, idleSeconds, lastActivityAtMs, recordedAt);
      } finally {
        inFlight = false;
      }
    };

    const forceStopTimerForLock = async (activeEntry: TimeEntry, idleSeconds: number, lastActivityAtMs: number, recordedAt: string) => {
      if (!isCurrentRun()) return false;
      if (!activeEntry?.id) return false;
      if (idleStopInFlightRef.current) {
        return false;
      }
      idleStopInFlightRef.current = true;
      try {
        console.info('[desktop-tracker] force stop timer for lock', {
          session_id: activeEntry.id,
          idle_seconds: idleSeconds,
        });
        const stopPromise = timeEntryApi.stop({
          timer_slot: 'primary',
          auto_stopped_for_idle: true,
          idle_seconds: idleSeconds,
          last_activity_at: new Date(lastActivityAtMs).toISOString(),
        });
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('lock_stop_timeout')), IDLE_STOP_API_TIMEOUT_MS);
        });
        await Promise.race([stopPromise, timeoutPromise]);
        lastAutoStoppedEntryIdRef.current = activeEntry.id;
        cleanupAfterIdleStop();
        console.info('[desktop-tracker] force stop succeeded', { session_id: activeEntry.id });
        return true;
      } catch (error: any) {
        const errorStatus = error?.response?.status;
        const errorBody = error?.response?.data;
        const isTimeout = error?.message === 'lock_stop_timeout';
        console.warn('[desktop-tracker] force stop failed', {
          session_id: activeEntry.id,
          status: errorStatus,
          isTimeout,
          errorMessage: error?.message,
          errorBody,
        });
        if (errorStatus === 404) {
          cleanupAfterIdleStop();
          return true;
        }
        return false;
      } finally {
        idleStopInFlightRef.current = false;
      }
    };

    const triggerLockScreenAutoStop = async (reason: 'lock_timeout' | 'lock_immediate') => {
      if (!isCurrentRun()) return;
      try {
        const activeEntry = activeEntryRef.current || await getOrLoadActiveEntry();
        if (!activeEntry?.id) {
          console.info('[desktop-tracker] lock screen auto-stop: no active entry');
          return;
        }
        const now = Date.now();
        const idleSeconds = Math.max(IDLE_AUTO_STOP_THRESHOLD_SECONDS, LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS);
        const lastActivityAtMs = lastInputRef.current || (now - idleSeconds * 1000);
        const recordedAt = new Date(now).toISOString();
        console.info('[desktop-tracker] lock screen auto-stop triggered', {
          reason,
          session_id: activeEntry.id,
          threshold_seconds: LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS,
        });
        const stopped = await forceStopTimerForLock(activeEntry, idleSeconds, lastActivityAtMs, recordedAt);
        if (stopped) {
          lockScreenAutoStopRevealPendingRef.current = true;
        }
      } catch (error) {
        console.warn('[desktop-tracker] lock screen auto-stop failed:', error);
      }
    };

    const scheduleLockAutoStop = () => {
      if (!isCurrentRun()) {
        console.info('[desktop-tracker] scheduleLockAutoStop: not current run');
        return;
      }
      if (lockAutoStopTimeoutRef.current !== null) {
        console.info('[desktop-tracker] scheduleLockAutoStop: already scheduled');
        return;
      }
      if (!Number.isFinite(LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS)
        || LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS < 5) {
        console.info('[desktop-tracker] scheduleLockAutoStop: invalid threshold', LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS);
        return;
      }
      const timeoutMs = LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS * 1000;
      console.info('[desktop-tracker] scheduleLockAutoStop: scheduling', { timeoutMs });
      try {
        const handle = setTimeout(() => {
          lockAutoStopTimeoutRef.current = null;
          void triggerLockScreenAutoStop('lock_timeout');
        }, timeoutMs);
        if (typeof handle === 'object' && handle && 'unref' in handle && typeof (handle as { unref?: () => void }).unref === 'function') {
          (handle as { unref: () => void }).unref();
        }
        lockAutoStopTimeoutRef.current = handle;
      } catch (error) {
        console.warn('[desktop-tracker] failed to schedule lock auto-stop:', error);
        lockAutoStopTimeoutRef.current = null;
      }
    };

    const applySystemLockState = async (payload?: DesktopSystemLockState | null) => {
      const lockedAt = payload?.locked_at ? Date.parse(payload.locked_at) : NaN;
      const recordedAt = payload?.recorded_at ? Date.parse(payload.recorded_at) : NaN;
      const isLocked = Boolean(payload?.locked || payload?.state === 'locked' || payload?.state === 'suspended');
      console.info('[desktop-tracker] system lock state event', {
        isLocked,
        state: payload?.state,
        locked: payload?.locked,
        locked_at: payload?.locked_at,
        threshold_seconds: LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS,
        activeEntry: activeEntryRef.current?.id || null,
      });

      if (isLocked) {
        const resolvedLockedAtMs = Number.isFinite(lockedAt) ? lockedAt : Date.now();
        if (systemLockedAtMsRef.current === null) {
          systemLockedAtMsRef.current = resolvedLockedAtMs;
        }
        clearLockAutoStopTimeout();
        scheduleLockAutoStop();
        try {
          await runIdleGuard();
        } catch (error) {
          console.warn('[desktop-tracker] runIdleGuard failed on lock:', error);
        }
        return;
      }

      if (
        systemLockedAtMsRef.current !== null
        && Number.isFinite(recordedAt)
        && recordedAt <= systemLockedAtMsRef.current
      ) {
        return;
      }

      const wasLocked = systemLockedAtMsRef.current !== null;
      systemLockedAtMsRef.current = null;
      clearLockAutoStopTimeout();

      if (wasLocked) {
        try {
          await runIdleGuard();
        } catch (error) {
          console.warn('[desktop-tracker] runIdleGuard failed on unlock:', error);
        }
      }

      if (lockScreenAutoStopRevealPendingRef.current) {
        lockScreenAutoStopRevealPendingRef.current = false;
        try {
          if (typeof desktopApi?.revealWindow === 'function') {
            await desktopApi.revealWindow();
          }
        } catch (error) {
          console.warn('[desktop-tracker] revealWindow failed on lock unlock:', error);
        }
        try {
          if (typeof desktopApi?.showNotification === 'function') {
            await desktopApi.showNotification({
              id: Date.now(),
              title: 'Timer Stopped - Idle Detected',
              body: IDLE_AUTO_STOP_MESSAGE,
              route: '/dashboard',
              type: 'idle_stop',
            });
          }
        } catch (error) {
          console.warn('[desktop-tracker] showNotification failed on lock unlock:', error);
        }
      }
    };

    const captureScreenshotOnInterval = async () => {
      if (screenshotInFlight || !isCurrentRun()) return;

      screenshotInFlight = true;
      try {
        const scheduledEntryId = activeScreenshotEntryIdRef.current;
        if (!scheduledEntryId) {
          return;
        }

        const active = await timeEntryApi.active({ timer_slot: 'primary' });
        const activeEntry = active.data;
        if (!activeEntry?.id) {
          activeEntryRef.current = null;
          syncScreenshotInterval(null);
          return;
        }
        activeEntryRef.current = activeEntry;

        await runIdleGuard();

        const currentActiveEntry = activeEntryRef.current;
        if (!currentActiveEntry?.id) {
          syncScreenshotInterval(null);
          return;
        }

        if (currentActiveEntry.id !== scheduledEntryId) {
          syncScreenshotInterval(currentActiveEntry.id);
          return;
        }

        const now = Date.now();
        if (!canCaptureScreenshots || typeof desktopApi?.captureScreenshot !== 'function') {
          return;
        }
        const screenshotDataUrl = await withTimeout(
          desktopApi.captureScreenshot(),
          SCREENSHOT_CAPTURE_TIMEOUT_MS,
          'Desktop screenshot capture'
        );
        if (!screenshotDataUrl) {
          return;
        }

        await withTimeout(
          screenshotApi.upload(activeEntry.id, screenshotDataUrl, `capture-${now}.png`),
          SCREENSHOT_UPLOAD_TIMEOUT_MS,
          'Desktop screenshot upload'
        );
      } catch (error) {
        console.error('Desktop tracker screenshot capture failed:', error);
      } finally {
        screenshotInFlight = false;
      }
    };

    const handleTimerStarted = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTimerSessionDetail>).detail;
      if (!detail || detail.userId !== userId || !detail.entryId || !isCurrentRun()) {
        return;
      }

      syncScreenshotInterval(detail.entryId);
    };

    const handleTimerStopped = (event: Event) => {
      const detail = (event as CustomEvent<DesktopTimerSessionDetail>).detail;
      if (!detail || detail.userId !== userId || !isCurrentRun()) {
        return;
      }

      void flushTrackerState(new Date().toISOString());
    };

    const handleTrackerFlush = (event: Event) => {
      const detail = (event as CustomEvent<{ promise?: Promise<void> }>).detail || {};
      detail.promise = flushTrackerState(new Date().toISOString());
    };

    const removeForegroundWindowChangeListener = hasForegroundWindowBridge && desktopApi
      ? desktopApi.onForegroundWindowChange((payload) => {
        void handleForegroundWindowChange(payload);
      })
      : undefined;
    const removeBrowserTrackingStateListener = desktopApi && typeof desktopApi.onBrowserTrackingState === 'function'
      ? desktopApi.onBrowserTrackingState((payload) => {
        browserTrackingRealtimeSeenRef.current = true;
        void applyBrowserTrackingState(payload);
      })
      : undefined;
    const removeBrowserTrackingEventListener = desktopApi && typeof desktopApi.onBrowserTrackingEvent === 'function'
      ? desktopApi.onBrowserTrackingEvent((payload) => {
        browserTrackingRealtimeSeenRef.current = true;
        void handleBrowserTrackingEvent(payload);
      })
      : undefined;
    const removeSystemLockStateListener = desktopApi && typeof desktopApi.onSystemLockState === 'function'
      ? desktopApi.onSystemLockState((payload) => {
        void applySystemLockState(payload);
      })
      : undefined;

    if (typeof desktopApi?.getSystemLockState === 'function') {
      try {
        void desktopApi.getSystemLockState().then((state) => {
          if (!isCurrentRun()) return;
          if (state && (state.locked || state.state === 'locked' || state.state === 'suspended')) {
            console.info('[desktop-tracker] initial lock state on mount: locked');
            void applySystemLockState(state);
          }
        }).catch(() => undefined);
      } catch {}
    }

    activityIntervalRef.current = setInterval(() => {
      void tick();
    }, ACTIVITY_TRACK_INTERVAL_MS);
    idleGuardIntervalRef.current = setInterval(() => {
      void runIdleGuard();
    }, IDLE_GUARD_INTERVAL_MS);

    const dedicatedIdleStopCheck = async () => {
      if (!isCurrentRun()) return;
      try {
        if (idleStopInFlightRef.current) return;
        const now = Date.now();
        const idleSeconds = Number(await desktopApi?.getSystemIdleSeconds?.()) || 0;
        if (!Number.isFinite(idleSeconds) || idleSeconds < IDLE_AUTO_STOP_THRESHOLD_SECONDS) {
          return;
        }
        const cachedEntry = activeEntryRef.current;
        if (cachedEntry?.id && lastAutoStoppedEntryIdRef.current === cachedEntry.id) return;
        if (cachedEntry?.id && (now - lastIdleStopAttemptMsRef.current) < IDLE_STOP_MIN_INTERVAL_MS) return;
        const active = await timeEntryApi.active({ timer_slot: 'primary' });
        if (!isCurrentRun()) return;
        const activeEntry = active.data;
        if (!activeEntry?.id) return;
        if (lastAutoStoppedEntryIdRef.current === activeEntry.id) return;
        activeEntryRef.current = activeEntry;
        const lastActivityAtMs = Math.max(0, now - (Math.floor(idleSeconds) * 1000));
        const recordedAt = new Date(now).toISOString();
        console.info('[desktop-tracker] dedicated idle stop check: forcing stop', {
          idle_seconds: Math.floor(idleSeconds),
          session_id: activeEntry.id,
        });
        const stopped = await forceStopTimerForLock(activeEntry, Math.floor(idleSeconds), lastActivityAtMs, recordedAt);
        if (stopped) {
          lockScreenAutoStopRevealPendingRef.current = true;
          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            void handleVisibilityReveal();
          }
        }
      } catch (error) {
        console.warn('[desktop-tracker] dedicated idle stop check failed:', error);
      }
    };
    const dedicatedIdleStopIntervalRef_current = setInterval(() => {
      void dedicatedIdleStopCheck();
    }, 15000);
    dedicatedIdleStopIntervalRef.current = dedicatedIdleStopIntervalRef_current;
    window.addEventListener(DESKTOP_TIMER_STARTED_EVENT, handleTimerStarted as EventListener);
    window.addEventListener(DESKTOP_TIMER_STOPPED_EVENT, handleTimerStopped as EventListener);
    window.addEventListener('desktop-tracker:flush', handleTrackerFlush as EventListener);

    const handleVisibilityReveal = async () => {
      if (!isCurrentRun()) return;
      if (!lockScreenAutoStopRevealPendingRef.current) return;
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      lockScreenAutoStopRevealPendingRef.current = false;
      try {
        if (typeof desktopApi?.revealWindow === 'function') {
          await desktopApi.revealWindow();
        }
      } catch (error) {
        console.warn('[desktop-tracker] revealWindow failed on visibility reveal:', error);
      }
      try {
        if (typeof desktopApi?.showNotification === 'function') {
          await desktopApi.showNotification({
            id: Date.now(),
            title: 'Timer Stopped - Idle Detected',
            body: IDLE_AUTO_STOP_MESSAGE,
            route: '/dashboard',
            type: 'idle_stop',
          });
        }
      } catch (error) {
        console.warn('[desktop-tracker] showNotification failed on visibility reveal:', error);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityReveal);
    window.addEventListener('focus', handleVisibilityReveal);
    window.addEventListener('mousemove', handleVisibilityReveal);
    window.addEventListener('keydown', handleVisibilityReveal);
    if (desktopApi && typeof desktopApi.getDesktopDeviceIdentity === 'function') {
      void desktopApi.getDesktopDeviceIdentity()
        .then((deviceIdentity) => {
          if (!isCurrentRun() || !deviceIdentity?.device_id) {
            return;
          }

          desktopDeviceIdentityRef.current = deviceIdentity;
          const currentState = pendingBrowserTrackingSyncStateRef.current || browserTrackingStateRef.current;
          if (currentState) {
            scheduleBrowserTrackingHealthSync(currentState, { immediate: true });
          }
        })
        .catch((error) => {
          console.warn('Desktop tracker device identity lookup failed:', error);
        });
    }
    if (desktopApi && typeof desktopApi.getBrowserTrackingState === 'function') {
      void desktopApi.getBrowserTrackingState()
        .then((state) => {
          if (!isCurrentRun() || !state || browserTrackingRealtimeSeenRef.current) {
            return;
          }

          void applyBrowserTrackingState(state, { immediateSync: true });
        })
        .catch((error) => {
          console.warn('Desktop tracker browser tracking state lookup failed:', error);
        });
    }
    void tick();

    return () => {
      clearTrackerIntervals();
      activeSegmentRef.current = null;
      activeEntryRef.current = null;
      activeDesktopSessionRef.current = null;
      activeBrowserSessionRef.current = null;
      browserTrackingStateRef.current = null;
      exactBrowserHealthyUntilMsRef.current = 0;
      desktopDeviceIdentityRef.current = null;
      pendingBrowserTrackingSyncStateRef.current = null;
      browserTrackingSyncSignatureRef.current = null;
      browserTrackingRealtimeSeenRef.current = false;
      clearBrowserTrackingSyncTimeout();
      pendingIdleRewindRef.current.clear();
      pendingTrackedSecondsRef.current = 0;
      activeScreenshotEntryIdRef.current = null;
      idleStopInFlightRef.current = false;
      idleStopBlockedUntilMsRef.current = 0;
      idleStopAttemptsPerEntryRef.current.clear();
      lastIdleStopAttemptMsRef.current = 0;
      lastReliableTrackingContextRef.current = null;
      if (typeof removeForegroundWindowChangeListener === 'function') {
        removeForegroundWindowChangeListener();
      }
      if (typeof removeBrowserTrackingStateListener === 'function') {
        removeBrowserTrackingStateListener();
      }
      if (typeof removeBrowserTrackingEventListener === 'function') {
        removeBrowserTrackingEventListener();
      }
      if (typeof removeSystemLockStateListener === 'function') {
        removeSystemLockStateListener();
      }
      window.removeEventListener(DESKTOP_TIMER_STARTED_EVENT, handleTimerStarted as EventListener);
      window.removeEventListener(DESKTOP_TIMER_STOPPED_EVENT, handleTimerStopped as EventListener);
      window.removeEventListener('desktop-tracker:flush', handleTrackerFlush as EventListener);
      document.removeEventListener('visibilitychange', handleVisibilityReveal);
      window.removeEventListener('focus', handleVisibilityReveal);
      window.removeEventListener('mousemove', handleVisibilityReveal);
      window.removeEventListener('keydown', handleVisibilityReveal);
      if (desktopTrackerRunSequence === runId) {
        desktopTrackerRunSequence += 1;
      }
    };
  }, [isAuthenticated, user, userId]);
};
