import { useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { buildTrackedContextName, resolveExeDisplayName } from '@/lib/activityProductivity';
import { idleGuardIntervalMs } from '@/lib/runtimeConfig';
import { idleStopWarningSecondsRemaining } from '@/lib/idleStopWarning';
import { pushIdlePopupState } from '@/lib/idlePopupBridge';
import { resolveBrowserUrlForContext } from '@/lib/inferredBrowserUrl';
import { isCaptureBlockedContext, resolveTrackerPolicy } from '@/lib/trackerPolicy';
import { isTrackedTimerUser } from '@/lib/permissions';
import {
  DESKTOP_TIMER_STARTED_EVENT,
  DESKTOP_TIMER_STOPPED_EVENT,
  type DesktopTimerSessionDetail,
  emitDesktopTimerIdleStop,
  setIdleAutoStopNotice,
  emitIdleReturnPrompt,
  emitIdleStopWarning,
  suppressAutoStart,
  suppressAutoStartGlobally,
} from '@/lib/desktopTimerSession';
import { activityApi, activitySessionApi, screenshotApi, timeEntryApi } from '@/services/api';
import type {
  DesktopDeviceIdentity,
  ScreenshotCaptureHealth,
  TimeEntry,
} from '@/types';
import { reportSilentError } from '@/lib/reportSilentError';
import { newSessionLocalId } from './desktopSessionIdentity';
import { createPendingSessionQueue, type PendingSession } from './pendingSessionQueue';

const ACTIVITY_TRACK_INTERVAL_MS = 1000;
// Matches the server's system default (config/screenshots.php). This is only a
// last-resort fallback now: the server resolves the effective interval
// (per-user override -> org default -> system default) and sends it down.
/*
 * Capture cadence used to be jittered by +/-10%, so a "1 minute" setting fired
 * anywhere between 54 and 66 seconds. That was removed at the product owner's
 * request (13 Aug 2026) in favour of an exact, verifiable interval — see
 * nextCaptureDelayMs.
 *
 * What the jitter bought is worth stating, because an exact cadence gives it
 * up: screenshots now land at predictable moments, which someone who wants to
 * be unobserved can learn and work around, and every device sharing an interval
 * and a start time uploads in lockstep rather than spread across the period.
 * Neither is a correctness problem, and the phase still varies per person
 * because the anchor is their own timer start.
 */
// How long capture may continue against a cached active entry while the server
// is unreachable, before pausing until the timer is confirmed again.
const SCREENSHOT_OFFLINE_GRACE_MS = 10 * 60 * 1000;
const SCREENSHOT_CAPTURE_TIMEOUT_MS = 15 * 1000;
const SCREENSHOT_UPLOAD_TIMEOUT_MS = 30 * 1000;
// After this many consecutive capture failures we surface a real notification
// to the user instead of staying silent (previously: silent forever).
const SCREENSHOT_FAILURE_NOTIFY_AFTER = 3;
// After this many consecutive failures we additionally report the broken state
// to the admin/Monitoring side via the activity heartbeat so it's visible there.
const SCREENSHOT_FAILURE_REPORT_AFTER = 3;
const SCREENSHOT_FAILURE_REPORT_DEBOUNCE_MS = 5 * 60 * 1000;
const IDLE_GUARD_INTERVAL_MS = idleGuardIntervalMs;
const IDLE_STOP_API_TIMEOUT_MS = 15 * 1000;
const IDLE_STOP_MIN_INTERVAL_MS = 5 * 1000;
const IDLE_STOP_MAX_ATTEMPTS_PER_ENTRY = 3;
const RELIABLE_CONTEXT_REUSE_WINDOW_MS = 30000;
// Much shorter than the window above, and deliberately so. That one covers the
// user clicking into the tracker's own window, where continuing to attribute
// time to what they were just doing is correct. This one covers the browser
// sitting on a generic surface ("New Tab"), where continuing to bill the last
// known site is only a guess — and a guess that goes stale almost immediately.
// Reusing it for a full 30s attributed half a minute of Instagram to someone
// staring at a blank tab.
const GENERIC_BROWSER_CONTEXT_REUSE_WINDOW_MS = 2000;
const MAX_PENDING_TRACKED_SECONDS = Math.max(1, Math.round(ACTIVITY_TRACK_INTERVAL_MS / 1000));
const EXACT_BROWSER_TRACKING_HEALTH_WINDOW_MS = 45 * 1000;
const BROWSER_TRACKING_HEALTH_SYNC_DEBOUNCE_MS = 5 * 1000;
const GENERIC_BROWSER_ACTIVITY_LABEL = 'browser activity';
const BROWSER_APP_KEYWORDS = ['chrome', 'edge', 'firefox', 'brave', 'opera', 'safari', 'vivaldi'];
const SELF_TRACKER_KEYWORDS = ['carevance', 'carevance hrms', 'timetrackpro'];
/*
 * Shell surfaces that own the foreground for a moment during a window switch:
 * the desktop itself, the Alt-Tab overlay, the taskbar's search popup. Windows
 * hands them the foreground between the outgoing and incoming window, and
 * `get-windows` reports them with a real process name and an EMPTY title.
 *
 * They are only ever transients — a titled Explorer window is a real folder the
 * person opened, and stays trackable. Recorded live on 14 Aug 2026, mid-switch:
 *   {"app":"Windows Explorer","title":"","record":true}
 * arriving between Chrome and VS Code, which closed the genuine session that
 * had just opened.
 */
const TRANSIENT_SHELL_APP_KEYWORDS = [
  'windows explorer',
  'explorer',
  'task switching',
  'shell infrastructure host',
  'windows shell experience host',
  'searchhost',
  'search application',
];

const isTransientShellForegroundContext = (payload: { app?: string | null; title?: string | null }) => {
  // A title means a real window. Only the untitled case is the shell transient.
  if (String(payload.title || '').trim()) {
    return false;
  }

  const appName = String(payload.app || '').trim().toLowerCase();
  if (!appName) {
    return false;
  }

  return TRANSIENT_SHELL_APP_KEYWORDS.some((keyword) => appName.includes(keyword));
};

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

/**
 * How long to wait before the next capture, against a fixed schedule.
 *
 * Captures are due at `anchorMs + n * intervalMs`, so the delay is measured
 * from the schedule rather than from when the previous capture happened to
 * finish. Re-arming with a fresh full interval after each capture added that
 * capture's own duration — screenshot, encode and upload — to every period, so
 * a "1 minute" cadence drifted a few seconds further behind on every cycle and
 * the timestamps were never round.
 *
 * Always returns a slot strictly in the future. If a cycle overruns its period
 * (a slow upload, a suspended machine) the missed slots are skipped rather than
 * fired back-to-back, so the tracker never bursts to catch up.
 *
 * Exported for tests: it is the whole timing contract, and it is pure.
 */
export const nextCaptureDelayMs = (anchorMs: number, nowMs: number, intervalMs: number): number => {
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) return 0;

  /*
   * A clock that moved backwards re-anchors rather than honouring the old
   * schedule. Keeping the schedule would mean waiting the interval PLUS the
   * size of the jump — an hour's correction would open an hour-long hole in
   * the capture record, which is far worse than one period landing off-grid.
   */
  if (nowMs <= anchorMs) return intervalMs;

  const nextSlot = Math.floor((nowMs - anchorMs) / intervalMs) + 1;

  // Always within (0, intervalMs]: never negative, never a gap longer than the
  // configured period.
  return anchorMs + nextSlot * intervalMs - nowMs;
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
  // null while the create is still queued: the session is real and locally
  // known, but the server has not issued an id yet, so there is nothing to
  // PATCH. The queued create carries started_at, so nothing is lost.
  sessionId: number | null;
  // The exact object sitting in pendingSessionQueueRef while sessionId is
  // null, so closeActiveDesktopSession can stamp ended_at directly onto it
  // before it drains. Without this the row inserts open and the server
  // fabricates a duration for it against whatever session starts next
  // (closeConflictingOpenSessions) — see the amendment on this task.
  pendingPayload: PendingSession | null;
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

/**
 * Is this the tracker looking at itself?
 *
 * Two genuinely self cases, and both are identified by WHAT the window is
 * rather than by what its title says:
 *
 *   - the Electron tracker window, which the desktop reports as
 *     `is_self_window` by asking Electron whether it holds focus;
 *   - the CareVance web app open in a browser, matched on this page's own
 *     origin.
 *
 * It used to match the product name against the window title, which dropped
 * any window that merely MENTIONED CareVance. Measured on 13 Aug 2026: Visual
 * Studio Code never once appeared in the timeline on this machine, because the
 * project folder is called CareVance_Hrms_IDE and every VS Code title carried
 * it. The same silence would swallow an email about CareVance, a support
 * ticket, a spreadsheet named CareVance_Report.xlsx, or a tab on the company's
 * own marketing site — a customer's real work, invisible.
 *
 * The app NAME is still matched, because the tracker's own process is
 * legitimately identified that way when the focus flag is unavailable.
 */
const isSelfTrackerContext = (context: {
  app?: string | null;
  title?: string | null;
  url?: string | null;
  inferred_url?: string | null;
  is_self_window?: boolean | null;
}) => {
  if (context.is_self_window) {
    return true;
  }

  const appName = String(context.app || '').trim().toLowerCase();
  if (appName && SELF_TRACKER_KEYWORDS.some((keyword) => appName.includes(keyword))) {
    return true;
  }

  /*
   * Nothing below this line applies to a browser.
   *
   * In a browser the title and the URL describe the PAGE, not the program.
   * An employee reading the CareVance web app in Chrome is doing real work —
   * checking a payslip, filing leave — and it belongs on their timeline. The
   * tracker looking at itself is the Electron window, which `is_self_window`
   * and the app-name check above already identify exactly.
   *
   * Treating page content as app identity also made the exclusion arbitrary:
   * a tab titled "Home | Dashboard" was recorded while "CareVance HRMS
   * Workspace" was not, for the very same page. Worse, it dropped time
   * mid-visit — the session opened, the SPA navigated, and the next poll read
   * the new title as the tracker itself and closed it.
   */
  if (isBrowserAppName(context.app)) {
    return false;
  }

  const url = String(context.inferred_url || context.url || '').trim().toLowerCase();
  const selfOrigin = typeof window !== 'undefined'
    ? String(window.location?.origin || '').trim().toLowerCase()
    : '';
  if (url && selfOrigin && url.startsWith(selfOrigin)) {
    return true;
  }

  /*
   * Title matched at the START only, never anywhere inside it.
   *
   * The app's own page announces itself as "CareVance HRMS Workspace", so a
   * prefix is enough to recognise it in a browser. A substring match is what
   * caused the damage: "useDesktopTracker.ts - CareVance_Hrms_IDE - Visual
   * Studio Code" contains the product name two thirds of the way through and
   * was being discarded as though the tracker were looking at itself.
   */
  const title = String(context.title || '').trim().toLowerCase();

  return SELF_TRACKER_KEYWORDS.some((keyword) => title.startsWith(keyword));
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
  if (
    isBrowserForegroundContext(payload)
    || isSelfTrackerContext(payload)
    || isTransientShellForegroundContext(payload)
  ) {
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
    /*
     * The inferred URL is part of the identity of a session, not decoration.
     * `url` is always null on Windows, so without this a navigation between
     * two pages that happen to share a title — common within one site — would
     * be treated as the same session and keep the first page's URL for both.
     */
    String(payload.inferred_url || '').trim().toLowerCase(),
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


export const useDesktopTracker = () => {
  const { user, isAuthenticated } = useAuth();
  const userId = user?.id ?? null;
  const lastInputRef = useRef<number>(Date.now());
  const lastTickAtRef = useRef<number | null>(null);
  const activeSegmentRef = useRef<ActiveSegment | null>(null);
  const activeEntryRef = useRef<TimeEntry | null>(null);
  const activityIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleGuardIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Holds a setTimeout handle: the capture chain re-arms itself each period so
  // every period can carry its own jitter.
  const screenshotIntervalRef = useRef<number | null>(null);
  // When the last screenshot actually landed, used to suppress the
  // capture-on-restart burst.
  const lastScreenshotCaptureAtRef = useRef(0);
  // Most recent foreground window, refreshed by the 1s activity tick and read
  // by the capture-time privacy check.
  const lastForegroundContextRef = useRef<{ app?: string | null; title?: string | null } | null>(null);
  // The idle span currently awaiting an answer. Held from the moment idle is
  // recorded until the person comes back and is asked what it was, so the
  // prompt can name a duration and point at the row it belongs to.
  const unansweredIdleRef = useRef<{ activityId: number; idleSeconds: number } | null>(null);
  /*
   * Whether a countdown is currently on screen. Without it the "cleared" event
   * would fire on every tick of every non-idle second, which is almost all of
   * them.
   */
  const idleStopWarningShownRef = useRef(false);
  const dedicatedIdleStopIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pendingIdleRewindRef = useRef<Map<number, number>>(new Map());
  const lastAutoStoppedEntryIdRef = useRef<number | null>(null);
  const activeScreenshotEntryIdRef = useRef<number | null>(null);
  const screenshotFailureCountRef = useRef(0);
  const lastScreenshotFailureReasonRef = useRef<string | null>(null);
  const lastScreenshotFailureSinceRef = useRef<string | null>(null);
  const lastScreenshotFailureGuidanceRef = useRef<string | null>(null);
  const lastScreenshotFailureReportMsRef = useRef(0);
  const screenshotPermissionNotifiedRef = useRef(false);
  const idleStopInFlightRef = useRef(false);
  const idleStopBlockedUntilMsRef = useRef(0);
  // Which entry the current back-off belongs to, so reloading the SAME entry
  // does not discard a back-off the server just asked us to honour.
  const idleStopBlockedForEntryIdRef = useRef<number | null>(null);
  const idleStopAttemptsPerEntryRef = useRef<Map<number, number>>(new Map());
  const lastIdleStopAttemptMsRef = useRef(0);
  const lastReliableTrackingContextRef = useRef<ReliableTrackingContext | null>(null);
  const pendingTrackedSecondsRef = useRef(0);
  const activeDesktopSessionRef = useRef<ActiveDesktopSession | null>(null);
  // ~8 hours of switching at one session per 10s, then oldest-first drop.
  const pendingSessionQueueRef = useRef(createPendingSessionQueue({ maxSize: 3000 }));
  /*
   * Mirrors the queue to disk after every change.
   *
   * Unsent sessions used to live in renderer memory alone, so quitting during
   * an outage lost the app/website timeline for that whole stretch. The main
   * process debounces the write, so a burst of application switches costs one
   * flush rather than one per switch.
   */
  const persistPendingSessions = useCallback(() => {
    const save = window.desktopTracker?.savePendingSessions;
    if (typeof save !== 'function') return;

    try {
      void save(pendingSessionQueueRef.current.snapshot());
    } catch (error) {
      reportSilentError('desktop-tracker', error);
    }
  }, []);
  // Last dropped total already reported, so the tick reports a loss once
  // instead of every second for as long as the count stays above zero.
  const reportedDroppedSessionCountRef = useRef(0);
  const desktopDeviceIdentityRef = useRef<DesktopDeviceIdentity | null>(null);
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
      clearTimeout(screenshotIntervalRef.current);
      screenshotIntervalRef.current = null;
    }

    if (dedicatedIdleStopIntervalRef.current !== null) {
      clearInterval(dedicatedIdleStopIntervalRef.current);
      dedicatedIdleStopIntervalRef.current = null;
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
    console.info('[desktop-tracker] tracker effect init', {
      isAuthenticated,
      userId: user?.id ?? null,
      hasDesktopBridge: Boolean(desktopApi),
      canCaptureScreenshots: typeof desktopApi?.captureScreenshot === 'function',
      monitoringIntervalMinutes: Number(user?.effective_monitoring_interval_minutes) || Number(user?.settings?.monitoring_interval_minutes) || null,
    });
    if (!isAuthenticated || !isTrackedUser) {
      clearTrackerIntervals();
      activeSegmentRef.current = null;
      activeEntryRef.current = null;
      activeDesktopSessionRef.current = null;
      desktopDeviceIdentityRef.current = null;
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
      screenshotFailureCountRef.current = 0;
      lastScreenshotFailureReasonRef.current = null;
      lastScreenshotFailureSinceRef.current = null;
      lastScreenshotFailureGuidanceRef.current = null;
      lastScreenshotFailureReportMsRef.current = 0;
      screenshotPermissionNotifiedRef.current = false;
      return;
    }
    const runId = ++desktopTrackerRunSequence;
    const isCurrentRun = () => desktopTrackerRunSequence === runId;
    const hasForegroundWindowBridge = typeof desktopApi?.onForegroundWindowChange === 'function';

    /*
     * Policy comes from the server, per run.
     *
     * These deliberately shadow the module-level constants of the same name,
     * which are now only a pre-hydration fallback inside resolveTrackerPolicy.
     * The client used to own these thresholds outright while the server owned
     * a separate copy, with nothing keeping them in step — a client set below
     * the server proposed idle stops that were rejected with 409 until it
     * exhausted its three-attempt cap.
     *
     * The effect re-runs on `user`, so a policy change reaches the tracker as
     * soon as a fresh payload lands — but AuthContext calls /auth/me only
     * during bootstrap, so in practice that means a reload or a fresh sign-in.
     * An admin who changes someone's capture interval mid-session will not see
     * it take effect until then, which is why every admin surface says so.
     */
    const trackerPolicy = resolveTrackerPolicy(user);
    const IDLE_THRESHOLD_SECONDS = trackerPolicy.idle_track_threshold_seconds;
    const IDLE_AUTO_STOP_THRESHOLD_SECONDS = trackerPolicy.idle_auto_stop_threshold_seconds;
    const LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS = trackerPolicy.lock_auto_stop_threshold_seconds;
    const IDLE_AUTO_STOP_MESSAGE =
      `You were idle for ${formatIdleDurationLabel(IDLE_AUTO_STOP_THRESHOLD_SECONDS)}, so your timer was stopped.`;

    const screenshotIntervalMs = trackerPolicy.capture_interval_minutes * 60 * 1000;
    let inFlight = false;
    let screenshotInFlight = false;
    // How long we may keep capturing against a CACHED active entry after the
    // server stopped confirming it. Without a bound, a network outage let the
    // tracker keep taking screenshots indefinitely — including after the timer
    // had been stopped server-side or from another device — and queue them all
    // for upload against an already-closed entry.
    let lastConfirmedActiveEntryAt = Date.now();
    clearTrackerIntervals();
    lastTickAtRef.current = Date.now();
    lastInputRef.current = Date.now();
    activeSegmentRef.current = null;
    activeEntryRef.current = null;
    activeDesktopSessionRef.current = null;
    desktopDeviceIdentityRef.current = null;
    pendingIdleRewindRef.current.clear();
    lastAutoStoppedEntryIdRef.current = null;
    activeScreenshotEntryIdRef.current = null;
    idleStopInFlightRef.current = false;
    idleStopBlockedUntilMsRef.current = 0;
    idleStopAttemptsPerEntryRef.current.clear();
    lastIdleStopAttemptMsRef.current = 0;
    lastReliableTrackingContextRef.current = null;
    pendingTrackedSecondsRef.current = 0;
    screenshotFailureCountRef.current = 0;
    lastScreenshotFailureReasonRef.current = null;
    lastScreenshotFailureSinceRef.current = null;
    lastScreenshotFailureGuidanceRef.current = null;
    lastScreenshotFailureReportMsRef.current = 0;
    screenshotPermissionNotifiedRef.current = false;

    const syncScreenshotInterval = (timeEntryId: number | null) => {
      if (activeScreenshotEntryIdRef.current === timeEntryId) {
        return;
      }

      if (screenshotIntervalRef.current !== null) {
        clearTimeout(screenshotIntervalRef.current);
        screenshotIntervalRef.current = null;
      }

      activeScreenshotEntryIdRef.current = timeEntryId;

      if (timeEntryId === null) {
        return;
      }

      // Re-evaluate the desktop bridge lazily instead of trusting the value
      // captured once when the effect first ran. The preload bridge can be
      // attached slightly after this hook mounts, and the earlier one-shot
      // `canCaptureScreenshots` check would then permanently (and silently)
      // disable screenshots for the whole session.
      const liveDesktopApi = window.desktopTracker;
      const canCaptureNow = typeof liveDesktopApi?.captureScreenshot === 'function';
      if (!canCaptureNow) {
        console.warn('[desktop-tracker] screenshot interval NOT started: desktop capture bridge unavailable', {
          timeEntryId,
          hasDesktopTracker: Boolean(liveDesktopApi),
          captureType: typeof liveDesktopApi?.captureScreenshot,
        });
        return;
      }

      /*
       * The schedule is anchored, not relative.
       *
       * Every capture is due at `anchor + n * interval`, and each timer is set
       * from that schedule rather than "one full interval from now". Chaining a
       * fresh interval after each capture completed meant every period silently
       * carried the capture's own cost — grab, encode, upload — so the gap
       * between screenshots was always longer than the configured one and grew
       * further out of step the longer a timer ran.
       *
       * When the immediate shot below is suppressed, the anchor is the capture
       * that already landed, so the next one still falls exactly one interval
       * after it rather than one interval after this restart.
       */
      const msSinceLastCapture = Date.now() - lastScreenshotCaptureAtRef.current;
      const captureNow = msSinceLastCapture >= screenshotIntervalMs;
      const anchorMs = captureNow ? Date.now() : lastScreenshotCaptureAtRef.current;

      console.info('[desktop-tracker] screenshot interval started', {
        timeEntryId,
        intervalMs: screenshotIntervalMs,
        anchorMs,
      });

      const scheduleNextCapture = () => {
        screenshotIntervalRef.current = setTimeout(() => {
          void captureScreenshotOnInterval().finally(() => {
            // Only keep the chain alive while this entry is still the one the
            // interval belongs to; syncScreenshotInterval(null) must stop it.
            if (activeScreenshotEntryIdRef.current === timeEntryId) {
              scheduleNextCapture();
            }
          });
        }, nextCaptureDelayMs(anchorMs, Date.now(), screenshotIntervalMs)) as unknown as number;
      };

      scheduleNextCapture();

      // Capture once immediately on (re)start. Timers can be short-lived or
      // restart before the first interval tick fires, so relying solely on the
      // interval means a session may produce zero screenshots. The capture
      // function is idempotent-guarded (screenshotInFlight) so this cannot
      // overlap with an interval tick.
      //
      // Suppressed when a capture already landed within the current period:
      // restarts (timer restart, snapshot restore, id mismatch) rebuild this
      // interval, and firing the immediate shot every time produced bursts well
      // above the configured rate.
      if (captureNow) {
        void captureScreenshotOnInterval();
      } else {
        console.info('[desktop-tracker] immediate capture suppressed; one already landed this period', {
          timeEntryId,
          msSinceLastCapture,
        });
      }
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

      // Only clear the back-off when this is genuinely a DIFFERENT timer.
      // Clearing it unconditionally meant that after the server answered 409
      // "recent activity, retry in N seconds", the very next tick reloaded the
      // same entry, wiped the back-off, and immediately retried — so the client
      // hammered stop in a loop instead of waiting as instructed.
      if (idleStopBlockedForEntryIdRef.current !== activeEntry.id) {
        idleStopBlockedUntilMsRef.current = 0;
        idleStopBlockedForEntryIdRef.current = null;
      }

      return activeEntry;
    };

    /*
     * Every desktop-session mutation runs through one queue.
     *
     * Serialising only creation was not enough: a close from any of the other
     * call sites could land between a create and the next create, null the
     * ref, and leave the just-created row closed at its own start time. That
     * is the zero-length duplicate seen live — ids 125 and 126, identical
     * titles, identical start times, the first at dur=0.
     */
    let desktopSessionQueue: Promise<unknown> = Promise.resolve();

    const queueDesktopSessionOp = <T,>(op: () => Promise<T>): Promise<T> => {
      const next = desktopSessionQueue.catch(() => {}).then(op);
      // Swallowed on the stored handle only; the returned promise still
      // rejects so callers keep their own error handling.
      desktopSessionQueue = next.catch(() => {});
      return next;
    };

    const closeActiveDesktopSession = (endedAt?: string) =>
      queueDesktopSessionOp(() => closeActiveDesktopSessionExclusive(endedAt));

    const closeActiveDesktopSessionExclusive = async (endedAt?: string) => {
      const activeDesktopSession = activeDesktopSessionRef.current;
      if (!activeDesktopSession) {
        return;
      }

      const parsedEndedAtMs = Date.parse(String(endedAt || ''));
      const endedAtMs = Number.isFinite(parsedEndedAtMs)
        ? Math.max(activeDesktopSession.startedAtMs, parsedEndedAtMs)
        : Date.now();
      const resolvedEndedAt = new Date(endedAtMs).toISOString();

      if (activeDesktopSession.sessionId === null) {
        // Never reached the server. Its create is still queued — stamp the
        // close time onto the same object sitting in the queue so it drains
        // already closed. Left as the started_at seeded when it was built,
        // the server would insert it open and closeConflictingOpenSessions
        // would fabricate a duration against whatever session starts next.
        if (activeDesktopSession.pendingPayload) {
          activeDesktopSession.pendingPayload.ended_at = resolvedEndedAt;
        }
        activeDesktopSessionRef.current = null;
        return;
      }

      activeDesktopSessionRef.current = null;

      // max(0), not max(1) — see closeActiveBrowserSession.
      const durationSeconds = Math.max(0, Math.round((endedAtMs - activeDesktopSession.startedAtMs) / 1000));

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

      if (activeDesktopSession.sessionId === null) {
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

    /**
     * Whether the desktop agent — rather than the extension — owns the browser
     * currently in front.
     *
     * The same precedence the foreground watcher applies, named once so the
     * per-second tick cannot drift from it. It did drift: the watcher was
     * taught to open a session for a browser with no extension connected, but
     * the tick still read every browser as "not a reliable desktop context"
     * and closed that session again. A browser session is therefore opened by
     * the watcher and extended by nothing, so it keeps the placeholder
     * ended_at it was seeded with. Measured 13 Aug 2026: Chrome held the
     * foreground for 28 unbroken seconds and was stored as dur=0.
     */
    const desktopAgentOwnsBrowserForeground = (payload: DesktopForegroundWindowPayload) =>
      !isSelfTrackerContext(payload)
      && isBrowserForegroundContext(payload);

    const ensureDesktopSessionStarted = (payload: DesktopForegroundWindowPayload) =>
      queueDesktopSessionOp(() => startDesktopSessionExclusive(payload));

    const startDesktopSessionExclusive = async (payload: DesktopForegroundWindowPayload) => {
      const activeEntry = await getOrLoadActiveEntry();
      const capturedAt = resolveForegroundCapturedAt(payload);

      if (!activeEntry?.id) {
        // Raw, not queued: this already holds the queue slot.
        await closeActiveDesktopSessionExclusive(capturedAt);
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

      await closeActiveDesktopSessionExclusive(capturedAt);

      /*
       * Same precedence as the tick. A desktop_app session for a browser can
       * now carry a URL, but only when the extension is not the authority for
       * that browser, and the confidence travels with it so a host inferred
       * from an Edge address bar never reads like a confirmed visit.
       */
      const payloadIsBrowser = BROWSER_APP_KEYWORDS.some(
        (keyword) => String(payload.app || '').toLowerCase().includes(keyword)
      );
      const sessionUrl = resolveBrowserUrlForContext({
        context: payload,
        isBrowser: payloadIsBrowser,
      });

      const displayName = resolveDesktopSessionDisplayName(payload);
      const appName = String(payload.app || '').trim() || displayName;
      const windowTitle = String(payload.title || '').trim() || displayName;

      /*
       * A browser we resolved a URL for is a WEBSITE visit, not an app session.
       *
       * This path opens sessions for browsers now that the desktop agent reads
       * URLs itself, and it was stamping them desktop_app/software like any
       * other window. Reports name the tool from the domain but take its type
       * from here, so the two categories came out inverted: wikipedia.org was
       * listed as an application and excluded from the Websites filter, while
       * "google chrome" — the browser — appeared under Websites.
       *
       * The URL is the test, not the app name. A browser sitting on a blank tab
       * with nothing readable stays an app session, which is what it is.
       */
      const isWebsiteVisit = payloadIsBrowser && Boolean(sessionUrl.url);

      const pending: PendingSession = {
        time_entry_id: activeEntry.id,
        source: 'desktop',
        activity_kind: isWebsiteVisit ? 'website' : 'desktop_app',
        tool_type: isWebsiteVisit ? 'website' : 'software',
        display_name: displayName,
        app_name: appName,
        window_title: windowTitle,
        url: sessionUrl.url,
        started_at: capturedAt,
        // Belt and braces: if closeActiveDesktopSession never gets a chance
        // to stamp the real close time (see below), draining this seeded
        // value inserts a zero-length row instead of an open one. Zero-length
        // understates; open lets the server fabricate a duration against
        // whatever session starts next — worse.
        ended_at: capturedAt,
        // 100 for an app or an exact page; lower when the URL is only a host
        // read out of an address bar.
        confidence: sessionUrl.url ? sessionUrl.confidence : 100,
        local_id: newSessionLocalId(),
        device_id: desktopDeviceIdentityRef.current?.device_id ?? null,
      };

      const startedAtMs = Date.parse(capturedAt);
      const resolvedStartedAtMs = Number.isFinite(startedAtMs) ? startedAtMs : Date.now();

      let sessionId: number | null = null;
      let pendingPayload: PendingSession | null = null;
      try {
        const response = await activitySessionApi.create(pending);
        sessionId = response.data.id;
      } catch (error) {
        // The session still happened. Queue it and keep local state so the
        // segment is not lost; the tick below retries it. Keep the same
        // object reference so closeActiveDesktopSession can stamp ended_at
        // onto the item actually sitting in the queue.
        pendingSessionQueueRef.current.enqueue(pending);
        persistPendingSessions();
        pendingPayload = pending;
        reportSilentError('desktop-tracker', error);
      }

      activeDesktopSessionRef.current = {
        sessionId,
        pendingPayload,
        timeEntryId: activeEntry.id,
        signature,
        startedAt: capturedAt,
        startedAtMs: resolvedStartedAtMs,
        lastSeenAtMs: resolvedStartedAtMs,
      };
    };

    // Builds the device-level screenshot capture health block that gets
    // piggybacked onto the browser-tracking heartbeat so a silently failing
    // capture becomes visible on the admin Monitoring dashboard.
    const getScreenshotCaptureHealth = (): ScreenshotCaptureHealth | null => {
      const failures = screenshotFailureCountRef.current;
      const reason = lastScreenshotFailureReasonRef.current;
      if (failures <= 0) {
        return null;
      }

      if (reason === 'screen_permission_denied') {
        return {
          status: 'denied',
          since: lastScreenshotFailureSinceRef.current,
          reason,
          guidance: lastScreenshotFailureGuidanceRef.current,
        };
      }

      return {
        status: 'failing',
        since: lastScreenshotFailureSinceRef.current,
        reason: reason || 'no_usable_source',
      };
    };

    const reportScreenshotCaptureFailure = (
      result: { reason: string; guidance?: string } | null,
    ) => {
      const reason = result?.reason ?? 'no_usable_source';
      const guidance = result?.guidance ?? undefined;
      const now = Date.now();

      if (screenshotFailureCountRef.current === 0) {
        lastScreenshotFailureSinceRef.current = new Date(now).toISOString();
      }
      screenshotFailureCountRef.current += 1;
      lastScreenshotFailureReasonRef.current = reason;
      lastScreenshotFailureGuidanceRef.current = guidance ?? null;

      console.warn('[desktop-tracker] screenshot capture failed', {
        consecutiveFailures: screenshotFailureCountRef.current,
        reason,
      });

      // Surface to the user after a small number of repeated failures.
      if (screenshotFailureCountRef.current >= SCREENSHOT_FAILURE_NOTIFY_AFTER) {
        if (typeof desktopApi?.showNotification === 'function') {
          const body = reason === 'screen_permission_denied'
            ? (guidance
              ? `Screenshots aren't being captured. ${guidance}`
              : 'Screenshots aren\'t being captured because screen-recording permission is denied.')
            : 'Screenshots aren\'t being captured. Check that screen recording is allowed for this app.';
          try {
            void desktopApi.showNotification({
              id: Date.now(),
              title: 'Screenshot Capture Unavailable',
              body,
              route: '/dashboard',
              type: 'screenshot_capture_failed',
            });
          } catch (notificationError) {
            console.warn('[desktop-tracker] failed to show screenshot failure notification:', notificationError);
          }
        }

        // On macOS, also guide the user to the exact setting once. Bringing the
        // window forward is the whole action, so it is guarded on revealWindow
        // itself — it used to be gated behind the browser extension's guide
        // helper existing, which had nothing to do with it and silently skipped
        // the reveal once that helper was gone.
        if (reason === 'screen_permission_denied' && !screenshotPermissionNotifiedRef.current) {
          screenshotPermissionNotifiedRef.current = true;
          if (typeof desktopApi?.revealWindow === 'function') {
            try {
              void desktopApi.revealWindow();
            } catch (error) { reportSilentError('desktop-tracker', error); }
          }
        }
      }

    };

    const reportScreenshotCaptureSuccess = () => {
      // Recorded unconditionally: syncScreenshotInterval uses it to suppress the
      // capture-on-restart burst, and that must work even when nothing had failed.
      lastScreenshotCaptureAtRef.current = Date.now();

      if (screenshotFailureCountRef.current === 0) {
        return;
      }

      screenshotFailureCountRef.current = 0;
      lastScreenshotFailureReasonRef.current = null;
      lastScreenshotFailureGuidanceRef.current = null;
      lastScreenshotFailureSinceRef.current = null;
      screenshotPermissionNotifiedRef.current = false;

    };

    const handleForegroundWindowChange = async (payload: DesktopForegroundWindowPayload) => {
      if (!isCurrentRun()) {
        return;
      }

      pendingTrackedSecondsRef.current = 0;
      clearTrackedActivitySegment();

      /*
       * Browsers used to be refused here outright, on the basis that the
       * extension owns website sessions. The extension is optional, so when it
       * is not connected that left browser time recorded as NOTHING — not a
       * fallback row, not an app row. Measured on 13 Aug 2026: every
       * activity_session ever written on this install was a transient system
       * window (Explorer, the Alt-Tab overlay, Snipping Tool), because those
       * were the only foreground windows that were not a browser.
       *
       * The desktop agent can now read the URL itself, so a browser without a
       * healthy extension is recorded here instead of discarded.
       * resolveBrowserUrlForContext still yields to the extension whenever it
       * IS healthy, so the two can never both write the same timeline.
       */
      /*
       * Ignored outright, rather than recorded or treated as "nothing is in
       * front". Windows gives the shell the foreground for a beat during a
       * switch, and acting on that closed the session belonging to the window
       * the person was actually using. Returning leaves the current session
       * running, which is what was true the moment before and the moment
       * after.
       */
      if (isTransientShellForegroundContext(payload)) {
        return;
      }

      const foregroundIsBrowser = isBrowserForegroundContext(payload);

      const shouldRecordHere = isSelfTrackerContext(payload)
        ? false
        : foregroundIsBrowser
          ? true
          : isReliableDesktopAppForegroundContext(payload);

      if (shouldRecordHere) {
        if (!foregroundIsBrowser) {
        }
        try {
          await ensureDesktopSessionStarted(payload);
        } catch (error) {
          console.error('Desktop tracker failed to start activity session:', error);
        }
        return;
      }

      await closeActiveDesktopSession(resolveForegroundCapturedAt(payload));
    };

    const getIdleState = async (now: number) => {
      // Resolve the bridge live each call. The reference captured when the
      // effect first ran can be undefined (preload not yet attached, or a
      // renderer reload from SPA routing), and falling back to DOM-input idle
      // makes the user look permanently idle whenever they work in any other
      // application — the tracker window receives no keyboard/mouse events.
      const liveDesktopApi = window.desktopTracker ?? desktopApi;
      try {
        const rawIdle = await liveDesktopApi?.getSystemIdleSeconds?.();
        const idleSecondsSystem = Number(rawIdle);

        if (Number.isFinite(idleSecondsSystem)) {
          const safeIdleSecondsSystem = Math.max(0, Math.floor(idleSecondsSystem));

          return {
            idleSeconds: safeIdleSecondsSystem,
            lastActivityAtMs: Math.max(0, now - (safeIdleSecondsSystem * 1000)),
            contextName: null,
            source: 'system' as const,
          };
        }

        // The bridge exists but returned a non-numeric value — surface this
        // loudly because it silently degrades into unreliable input-based idle.
        console.warn('[desktop-tracker] system idle lookup returned non-numeric value; falling back to page input', {
          rawIdle,
          hasBridge: Boolean(liveDesktopApi),
          hasGetter: typeof liveDesktopApi?.getSystemIdleSeconds,
        });
      } catch (error) {
        console.warn('Desktop tracker system idle lookup failed, falling back to page input activity.', error);
      }

      // Fallback path. On the desktop this hook runs inside an Electron window
      // that almost never has DOM focus while the user works in other apps, so
      // `lastInputRef` (updated only by in-window DOM events) makes a busy user
      // look permanently idle. That previously auto-stopped timers and killed
      // the screenshot interval. Only trust DOM input when this is a real
      // browser tab (no desktop bridge at all); inside the desktop shell, fail
      // safe to "active" so we never wrongly stop tracking when the OS idle
      // bridge is briefly unavailable.
      const isDesktopShell = typeof window.desktopTracker !== 'undefined';
      if (isDesktopShell) {
        return {
          idleSeconds: 0,
          lastActivityAtMs: now,
          contextName: null,
          source: 'assumed-active' as const,
        };
      }

      const idleSecondsFromInput = Math.max(0, Math.floor((now - lastInputRef.current) / 1000));

      return {
        idleSeconds: idleSecondsFromInput,
        lastActivityAtMs: lastInputRef.current,
        contextName: null,
        source: 'input' as const,
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
          const rewindRecordedAt = new Date(lastActivityAtMs).toISOString();
          await rewindTrackedIdleWindow(rewindRecordedAt);
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
          if (unansweredIdleRef.current?.activityId === activeSegmentRef.current.activityId) {
            unansweredIdleRef.current.idleSeconds = idleSeconds;
          }
        }
        return;
      }

      let response;
      try {
        response = await activityApi.create({
          time_entry_id: activeEntry.id,
          type: 'idle' as const,
          name: idleName,
          duration: idleSeconds,
          recorded_at: recordedAt,
        });
      } catch (activityError: any) {
        if (window.desktopTracker?.saveActivityOffline) {
          const { saveActivityOffline: saveOffline } = await import('@/services/offlineService');
          await saveOffline(
            userId || 0,
            'idle',
            recordedAt,
            { name: idleName, duration: idleSeconds }
          ).catch((e: Error) => console.warn('[Tracker] Offline activity save failed:', e));
          return;
        }
        throw activityError;
      }
      activeSegmentRef.current = {
        activityId: response.data.id,
        durationSeconds: idleSeconds,
        signature: idleSignature,
        kind: 'idle',
      };
      unansweredIdleRef.current = { activityId: response.data.id, idleSeconds };
    };

    /**
     * Tell the user their timer was stopped for idle.
     *
     * Shared so every stop path says the same thing. forceStopTimerForLock (the
     * dedicated 15s idle check and the lock-screen timeout) had no notification
     * at all — the only path it touched was gated on
     * document.visibilityState === 'visible', which is never true when the
     * screen is locked. That is why timers sometimes just stopped with no
     * explanation.
     */
    const notifyIdleAutoStop = async (idleSeconds: number) => {
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
        return;
      }

      if ('Notification' in window && Notification.permission === 'granted') {
        try {
          new Notification('Timer Stopped - Idle Detected', {
            body: `You were idle for ${idleDurationLabel}. Your timer has been stopped.`,
            tag: 'idle-auto-stop',
          });
        } catch (notificationError) {
          console.warn('[desktop-tracker] failed to show browser idle-stop notification:', notificationError);
        }
      }
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
          idleStopBlockedForEntryIdRef.current = activeEntry.id;

          // Reset attempt counter on 409 — the backend said "try again later",
          // not "permanently denied". Without this, the client permanently gives
          // up after IDLE_STOP_MAX_ATTEMPTS_PER_ENTRY (3) retries.
          idleStopAttemptsPerEntryRef.current.set(activeEntry.id, 0);

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

      /*
       * The countdown reached zero, so replace it with the outcome rather than
       * letting "stops in 0 seconds" sit there. This is also the one message a
       * returning person most needs: the OS notification behind it may well
       * have been dismissed or missed entirely while they were away.
       */
      pushIdlePopupState({ mode: 'stopped', idleSeconds });

      await notifyIdleAutoStop(idleSeconds);

      if (userId) {
        try {
          suppressAutoStart(userId);
          suppressAutoStartGlobally(userId);
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
          } catch (error) { reportSilentError('desktop-tracker', error); }
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
          activeSegmentRef.current = null;
          activeEntryRef.current = null;
          lastAutoStoppedEntryIdRef.current = null;
          pendingTrackedSecondsRef.current = 0;
          syncScreenshotInterval(null);
          return;
        }
        
        // Only update activeEntryRef if:
        // 1. We don't have a cached entry (timer just started)
        // 2. The API entry matches our cached entry (timer continuing)
        // This prevents stale API data from overriding locally stopped timer
        const cachedEntry = activeEntryRef.current;
        if (!cachedEntry?.id) {
          // No cached entry, use API entry (timer just started)
          activeEntryRef.current = activeEntry;
          console.log('[desktop-tracker] Timer started from API', { entryId: activeEntry.id });
        } else if (cachedEntry.id === activeEntry.id) {
          // API matches cached entry, update with fresh data
          activeEntryRef.current = activeEntry;
        } else {
          // API entry ID doesn't match cached entry - timer was restarted or stale data
          console.log('[desktop-tracker] Timer ID mismatch in tick', {
            cached_id: cachedEntry.id,
            api_id: activeEntry.id,
          });
          // Trust the newer entry (higher ID usually means newer)
          if (activeEntry.id > cachedEntry.id) {
            activeEntryRef.current = activeEntry;
            console.log('[desktop-tracker] Updated to newer timer from API');
          }
          // Otherwise keep cached entry - it might be a stale API response
        }
        
        syncScreenshotInterval(activeEntryRef.current?.id || null);

        // Retry anything a network blip lost. Safe to repeat: every queued
        // session carries (local_id, device_id) and the server resolves a
        // replay to the row it already created.
        void (async () => { await pendingSessionQueueRef.current.drain(async (p) => {
          // Read before the await: closeActiveDesktopSession can stamp the
          // real close time onto this same object while the create is in
          // flight, and by then the payload on the wire already carries the
          // seeded zero-length value.
          const sentEndedAt = p.ended_at ?? null;
          const response = await activitySessionApi.create(p);

          // An empty 2xx body yields undefined here, which would pass the
          // `sessionId === null` guards on the close and extend paths and
          // PATCH /activity-sessions/undefined. Nothing to adopt or amend.
          const sessionId = response?.data?.id;
          if (!Number.isFinite(sessionId)) {
            return;
          }

          const laterEndedAt = p.ended_at ?? null;
          if (laterEndedAt && laterEndedAt !== sentEndedAt) {
            // The user switched away mid-request, so the row the server just
            // created still holds the seeded ended_at === started_at. The
            // adoption branch below cannot fix it: closeActiveDesktopSession
            // already cleared activeDesktopSessionRef, so no PATCH would ever
            // follow and the segment would land as zero seconds — which
            // ActivityFeedService::mapSession drops entirely (end <= start).
            await activitySessionApi.update(sessionId, { ended_at: laterEndedAt });
            return;
          }

          // If this payload is still the live session's, adopt the id the
          // server just issued so the normal close path can PATCH the real
          // end time. Without this the row keeps the seeded zero-length
          // ended_at forever, because sessionId stays null and both the
          // close and extend paths short-circuit on it.
          const active = activeDesktopSessionRef.current;
          if (active && active.pendingPayload === p) {
            active.sessionId = sessionId;
            active.pendingPayload = null;
          }
        }, now);
          // Written back after every drain so sends that succeeded stop being
          // replayed, and a queue emptied by a reconnect is emptied on disk too.
          persistPendingSessions();
        })();

        // Every eviction path — an unidentifiable device, the retry window,
        // overflow — throws away time an employee actually worked, and this
        // data feeds ProductivityPayrollService. Unreported it is
        // indistinguishable from time never tracked. Report on change only:
        // this runs every second.
        const droppedSessionCount = pendingSessionQueueRef.current.droppedCount();
        if (droppedSessionCount > reportedDroppedSessionCountRef.current) {
          const newlyDropped = droppedSessionCount - reportedDroppedSessionCountRef.current;
          reportedDroppedSessionCountRef.current = droppedSessionCount;
          const reasons = pendingSessionQueueRef.current.droppedReasons();
          reportSilentError(
            'desktop-tracker',
            new Error(
              `dropped ${newlyDropped} unsent activity session(s); ${droppedSessionCount} total `
              + `(no_device_id=${reasons.no_device_id}, `
              + `retry_window_exceeded=${reasons.retry_window_exceeded}, `
              + `overflow=${reasons.overflow})`
            )
          );
        }

        if (systemLockedAtMsRef.current !== null && lockAutoStopTimeoutRef.current === null) {
          scheduleLockAutoStop();
        }

        const { idleSeconds, lastActivityAtMs, contextName: idleStateContextName, source: idleSource } = await getIdleState(now);
        console.debug('[desktop-tracker] tick idle', {
          idleSeconds,
          source: idleSource,
          autoStopThreshold: IDLE_AUTO_STOP_THRESHOLD_SECONDS,
          entryId: activeEntry.id,
        });
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
            // Remembered for the capture-time privacy check, which must not
            // issue a lookup of its own: this tick already runs every second,
            // so the value is never more than a second stale, and a second
            // call would double the IPC traffic for no extra accuracy.
            lastForegroundContextRef.current = activeContext;
          }
        } catch (err) {
          console.warn('[usage] desktop active context fetch failed:', err);
        }
        const fallbackTitle = typeof document !== 'undefined' ? document.title : '';
        const recordedAt = new Date(now).toISOString();
        const rawAppName = String(activeContext?.app || '').trim();
        const rawIsBrowserApp = BROWSER_APP_KEYWORDS.some((keyword) => rawAppName.toLowerCase().includes(keyword));
        /*
         * On Windows the platform never fills `url` — get-windows only does
         * that on macOS — so without this a browser with no extension produced
         * a title and nothing else. The desktop agent now reads the URL out of
         * the browser's own UI, and this decides whether that reading is
         * allowed to count: never over a healthy extension, which owns website
         * sessions, and never for a non-browser window.
         */
        const resolvedBrowserUrl = resolveBrowserUrlForContext({
          context: activeContext,
          isBrowser: rawIsBrowserApp,
        });
        const rawUrl = resolvedBrowserUrl.url ?? '';
        /*
         * Named from the URL we just resolved, not only the platform one.
         *
         * `activeContext.url` is filled by get-windows, which supplies it on
         * macOS alone — on Windows it is always null, so this fell through to
         * the window title and reports were labelling browser rows with the raw
         * title. It showed up as one Chrome row reading "Wikipedia" beside an
         * Edge row reading "Fetch API - Web APIs | MDN and 1 more page -
         * Profile 1 - Microsoft Edge": same run, same kind of visit, named two
         * different ways depending on whether a URL happened to be available.
         */
        const rawContextName = buildTrackedContextName({
          ...(activeContext || {}),
          url: rawUrl || activeContext?.url || null,
        });
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
        const contextAgeMs = lastReliableTrackingContextRef.current
          ? now - lastReliableTrackingContextRef.current.capturedAtMs
          : Number.POSITIVE_INFINITY;
        const compatibleReliableTrackingContext = !hasReliableDesktopContext
          && recentReliableTrackingContext
          && (
            isSelfTrackerRawContext
            || (
              rawAppFamily
              && recentReliableTrackingContext.appFamily
              && rawAppFamily === recentReliableTrackingContext.appFamily
              && isGenericBrowserSurface
              // Generic browser surfaces get the short window, not the 30s one.
              && contextAgeMs < GENERIC_BROWSER_CONTEXT_REUSE_WINDOW_MS
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
        // Deliberately NOT falling back to `fallbackTitle` (document.title).
        // When no reliable external context is available, that is the tracker's
        // OWN window, so the row claimed the user was working in the HRMS app
        // when we in fact had no idea what they were doing. "Active Input" is
        // the honest label: input was detected, the application was not
        // identified.
        const contextName = resolvedTrackingContext?.contextName || 'Active Input';
        const activityType: 'app' | 'url' = resolvedTrackingContext?.activityType || 'app';
        /*
         * Shaped exactly like the payload the foreground watcher sends.
         *
         * The desktop session signature is app|title|url|inferred_url, and
         * this tick used to put a resolved browser URL in `url` while the
         * watcher put the same URL in `inferred_url`. Two different signatures
         * for one window, so whichever ran second closed the other's session
         * and opened its own — measured live as byte-identical rows seconds
         * apart, the first left at zero length.
         */
        const currentForegroundPayload: DesktopForegroundWindowPayload = {
          app: rawAppName || null,
          title: String(activeContext?.title || '').trim() || null,
          url: String(activeContext?.url || '').trim() || null,
          inferred_url: activeContext?.inferred_url ?? null,
          inferred_url_source: activeContext?.inferred_url_source ?? null,
          inferred_url_confidence: activeContext?.inferred_url_confidence ?? null,
          is_self_window: activeContext?.is_self_window ?? false,
          captured_at: recordedAt,
        };

        /*
         * Warn before taking the timer away.
         *
         * Emitted every tick so the countdown moves, and once with null when
         * input resumes so the UI can clear itself. Sits outside the idle
         * branch below because the person may already be back — that is
         * exactly the case that has to clear the warning.
         */
        const warningSecondsRemaining = idleStopWarningSecondsRemaining(
          idleSeconds,
          IDLE_AUTO_STOP_THRESHOLD_SECONDS
        );
        if (warningSecondsRemaining !== null || idleStopWarningShownRef.current) {
          emitIdleStopWarning({ secondsRemaining: warningSecondsRemaining, idleSeconds });
          /*
           * And to the shell, which shows the same countdown as a real
           * always-on-top window. Driven off the same value on the same tick
           * so the two can never disagree; on the web, or an installed build
           * too old to have the popup, this is a no-op and the in-app notice
           * remains the only UI.
           */
          pushIdlePopupState(
            warningSecondsRemaining !== null
              ? { mode: 'warning', secondsRemaining: warningSecondsRemaining, idleSeconds }
              : null
          );
          idleStopWarningShownRef.current = warningSecondsRemaining !== null;
        }

        if (idleSeconds >= IDLE_THRESHOLD_SECONDS) {
          await closeActiveDesktopSession(new Date(lastActivityAtMs).toISOString());
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
          /*
           * Back from idle. Ask rather than decide.
           *
           * The timer never stopped, so those minutes are already counted —
           * which makes "keep" a no-op and "discard" the action that moves
           * time. That is the reverse of the auto-stop path, where the tail
           * was already rewound off the entry before anyone was asked.
           */
          const unanswered = unansweredIdleRef.current;
          if (unanswered && unanswered.idleSeconds >= IDLE_THRESHOLD_SECONDS) {
            unansweredIdleRef.current = null;
            emitIdleReturnPrompt({
              userId: userId || 0,
              activityId: unanswered.activityId,
              idleSeconds: unanswered.idleSeconds,
              timerRunning: true,
            });

            /*
             * The question, in front of whatever they came back to. Only when
             * the organization actually leaves the choice open — under
             * always_keep or never_keep the server has already resolved the
             * span, and putting an always-on-top window in someone's way to
             * offer a choice that no longer exists is worse than silence.
             * IdleReturnPrompt reports those as a toast instead.
             */
            if (trackerPolicy.idle_resolution_policy === 'prompt') {
              pushIdlePopupState({
                mode: 'return',
                idleSeconds: unanswered.idleSeconds,
                activityId: unanswered.activityId,
              });
            }
          }

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

          /*
           * Extended here, and deliberately without returning.
           *
           * The watcher only fires when the foreground CHANGES, so a browser
           * left in front for half a minute produces exactly one event. Only
           * this tick runs every second, which makes it the sole thing that
           * can grow the session. Falling through afterwards is what keeps the
           * url activity rows below intact — those are what the website
           * reports read, and returning early here would silently empty them.
           */
          if (desktopAgentOwnsBrowserForeground(currentForegroundPayload)) {
            try {
              await ensureDesktopSessionStarted(currentForegroundPayload);
            } catch (error) {
              console.error('Desktop tracker failed to extend browser activity session:', error);
            }
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

          // Close any orphaned desktop session when foreground is no longer a
          // reliable desktop context. A browser this agent owns is not
          // orphaned — it was just extended above, and closing it here is
          // exactly what truncated every browser visit to zero seconds.
          if (
            !desktopAgentOwnsBrowserForeground(currentForegroundPayload)
            // A shell transient is not the person leaving the window they were
            // using; it is Windows passing the foreground along mid-switch.
            && !isTransientShellForegroundContext(currentForegroundPayload)
          ) {
            await closeActiveDesktopSession(recordedAt);
          }

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
      } catch {
        // Offline or network error — idle guard can't reach the server.
        // This is expected and non-fatal; the next interval tick will retry.
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

      // Honour the server's back-off. attemptIdleAutoStop sets this when the
      // backend answers 409 "recent activity detected, retry in N seconds", but
      // this path ignored it — so the 15s dedicated check and the lock-screen
      // timeout kept hammering stop while the server was actively asking them
      // not to, producing several stop requests for a single idle event.
      if (Date.now() < idleStopBlockedUntilMsRef.current) {
        return false;
      }

      idleStopInFlightRef.current = true;
      try {
        console.info('[desktop-tracker] force stop timer for lock', {
          session_id: activeEntry.id,
          idle_seconds: idleSeconds,
        });

        // Flush the final idle figure BEFORE stopping.
        //
        // The idle activity row is a rolling record that the 1-second tick keeps
        // updating (180 -> 181 -> ... -> 300). This path is reached by the 15s
        // dedicated check and the lock-screen timeout — neither of which runs
        // that tick, and the OS throttles it hard once the machine is genuinely
        // idle. So the row used to be left frozen at whatever it was created
        // with, typically 180, and reports showed 3 minutes of idle for a
        // 5-minute absence with the remainder silently counted as work.
        try {
          await syncIdleActivitySnapshot(
            activeEntry,
            idleSeconds,
            lastActivityAtMs,
            recordedAt,
            activeSegmentRef.current?.contextName || 'Active Input',
          );
        } catch (idleSyncError) {
          // Never block the stop on this: an inaccurate idle figure is far less
          // damaging than a timer that keeps running.
          console.warn('[desktop-tracker] failed to flush final idle snapshot before stop:', idleSyncError);
        }

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
        // Same notice attemptIdleAutoStop raises. Without it this path stopped
        // the timer silently.
        await notifyIdleAutoStop(idleSeconds);
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

        // Same 409 back-off contract attemptIdleAutoStop implements: the server
        // is telling us it saw recent activity and to retry in N seconds.
        if (errorStatus === 409) {
          const retryAfterSecondsRaw = Number((errorBody as any)?.retry_after_seconds);
          const retryAfterSeconds = Number.isFinite(retryAfterSecondsRaw)
            ? Math.max(1, Math.floor(retryAfterSecondsRaw))
            : 15;
          idleStopBlockedUntilMsRef.current = Date.now() + (retryAfterSeconds * 1000);
          idleStopBlockedForEntryIdRef.current = activeEntry.id;
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

        let activeEntry: TimeEntry | null = null;
        try {
          const active = await timeEntryApi.active({ timer_slot: 'primary' });
          activeEntry = active.data;
          if (activeEntry?.id) {
            activeEntryRef.current = activeEntry;
            lastConfirmedActiveEntryAt = Date.now();
          }
        } catch (error: any) {
          const status = Number(error?.response?.status || 0);

          // An auth failure is not "offline". The session is gone, so the
          // cached entry proves nothing and we must not keep capturing the
          // user's screen against it.
          if (status === 401 || status === 403) {
            console.warn('[Tracker] Screenshot capture stopped: session rejected.');
            syncScreenshotInterval(null);
            return;
          }

          // Any other explicit 4xx is a definite answer from the server too.
          if (status >= 400 && status < 500) {
            console.warn('[Tracker] Screenshot capture skipped: server rejected the active-entry check.', status);
            return;
          }

          // Genuine network/5xx failure: fall back to the cached entry, but only
          // for a bounded grace window. Don't tear down the interval — a single
          // transient failure must not reset the cadence — just stop capturing
          // once we have gone too long without confirmation.
          if (Date.now() - lastConfirmedActiveEntryAt > SCREENSHOT_OFFLINE_GRACE_MS) {
            console.warn('[Tracker] Screenshot capture paused: no active-entry confirmation within the grace window.');
            return;
          }

          activeEntry = activeEntryRef.current;
        }
        if (!activeEntry?.id) {
          // No active entry right now. Do NOT tear down the interval here: a
          // single transient/empty `active` response would otherwise reset the
          // whole screenshot cadence (and re-fire the immediate capture),
          // producing the "only the first screenshot ever lands" symptom. The
          // periodic tick() owns interval lifecycle and will stop it cleanly
          // when the timer has genuinely ended.
          return;
        }

        // NOTE: idle handling is intentionally NOT invoked here. Idle has its
        // own dedicated interval and runs inside tick(); calling runIdleGuard()
        // from the capture path coupled screenshot cadence to idle evaluation
        // and could tear down / rebuild this very interval mid-cycle.

        if (activeEntry.id !== scheduledEntryId) {
          // The active timer changed since this interval was scheduled. Let the
          // tick() lifecycle re-point the interval; just skip this capture.
          return;
        }

        const now = Date.now();
        const liveDesktopApi = window.desktopTracker ?? desktopApi;
        if (typeof liveDesktopApi?.captureScreenshot !== 'function') {
          console.warn('[desktop-tracker] screenshot tick skipped: capture bridge unavailable', {
            scheduledEntryId,
            hasDesktopTracker: Boolean(window.desktopTracker),
          });
          return;
        }
        /*
         * Capture-time privacy check, immediately before the capture itself.
         *
         * A screenshot is a full-resolution picture of whatever happens to be
         * on screen — a password vault, personal banking, someone else's
         * medical leave request. Asking what is in the foreground first, and
         * skipping the shot entirely when it matches an organisation rule, is
         * data minimisation at the only point where it actually costs nothing:
         * the pixels are never read, so there is nothing to blur, store or
         * later have to justify.
         *
         * Skipping is silent by design. Logging "we skipped your password
         * manager" would record the very fact the rule exists to avoid.
         */
        if (isCaptureBlockedContext(trackerPolicy, lastForegroundContextRef.current)) {
          // Treated as a completed period so the next capture is scheduled
          // normally — a blocked window must not make the tracker retry in a
          // tight loop until the user moves off it.
          lastScreenshotCaptureAtRef.current = Date.now();
          return;
        }

        let captureResult: DesktopScreenshotCaptureResult;
        try {
          captureResult = await withTimeout(
            liveDesktopApi.captureScreenshot(),
            SCREENSHOT_CAPTURE_TIMEOUT_MS,
            'Desktop screenshot capture'
          );
        } catch (captureError: any) {
          console.warn('[desktop-tracker] screenshot capture threw', {
            error: captureError?.message || String(captureError),
          });
          reportScreenshotCaptureFailure(null);
          return;
        }

        // Structured result: explicitly handle failure reasons instead of
        // silently returning on a falsy value.
        if (!captureResult || !captureResult.ok) {
          const failure = (!captureResult || captureResult.ok)
            ? null
            : (captureResult as { ok: false; reason: string; guidance?: string });
          reportScreenshotCaptureFailure({
            reason: failure?.reason ?? 'no_usable_source',
            guidance: failure?.guidance,
          });
          return;
        }

        const screenshotDataUrl = captureResult.dataUrl;
        reportScreenshotCaptureSuccess();

        try {
          await withTimeout(
            screenshotApi.upload(activeEntry.id, screenshotDataUrl, `capture-${now}.png`),
            SCREENSHOT_UPLOAD_TIMEOUT_MS,
            'Desktop screenshot upload'
          );
        } catch (uploadError: any) {
          /*
           * "The server said no" and "there is no network" are different
           * failures and must not share a retry path.
           *
           * Every upload error used to be queued offline, so a 422 on a
           * malformed capture was retried ten times before the queue gave up
           * on it — and until the queue learned to drop exhausted records, it
           * sat at the head of the queue blocking everything behind it. A
           * definite answer from the server is final; only a transport
           * failure is worth buffering.
           */
          const status = Number(uploadError?.response?.status || 0);
          const serverAnswered = status >= 400 && status < 500;

          if (serverAnswered) {
            console.warn('[Tracker] Screenshot rejected by the server; not queueing.', {
              status,
              entryId: activeEntry.id,
            });
            return;
          }

          if (window.desktopTracker?.saveScreenshotOffline) {
            const { saveScreenshotOffline } = await import('@/services/offlineService');
            await saveScreenshotOffline(
            userId || 0,
              screenshotDataUrl,
              new Date(now).toISOString(),
              activeEntry.id
            ).catch((e: Error) => console.warn('[Tracker] Offline screenshot save failed:', e));
          } else {
            throw uploadError;
          }
        }
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
      } catch (error) { reportSilentError('desktop-tracker', error); }
    }

    activityIntervalRef.current = setInterval(() => {
      void tick();
    }, ACTIVITY_TRACK_INTERVAL_MS);
    idleGuardIntervalRef.current = setInterval(() => {
      void runIdleGuard();
    }, IDLE_GUARD_INTERVAL_MS);

    const dedicatedIdleStopCheck = async () => {
      if (!isCurrentRun()) return;
      // Take the SAME lock tick() and runIdleGuard() use. This check only held
      // idleStopInFlightRef, so it could run concurrently with them and race to
      // stop the same timer.
      if (inFlight) return;
      inFlight = true;
      try {
        if (idleStopInFlightRef.current) return;
        const now = Date.now();
        const idleSeconds = Number(await desktopApi?.getSystemIdleSeconds?.()) || 0;
        if (!Number.isFinite(idleSeconds) || idleSeconds < IDLE_AUTO_STOP_THRESHOLD_SECONDS) {
          return;
        }
        const cachedEntry = activeEntryRef.current;
        // If no cached entry, timer was likely stopped - don't check API to avoid stale data
        if (!cachedEntry?.id) {
          console.log('[desktop-tracker] No cached active entry, skipping idle stop check');
          return;
        }
        if (cachedEntry?.id && lastAutoStoppedEntryIdRef.current === cachedEntry.id) return;
        if (cachedEntry?.id && (now - lastIdleStopAttemptMsRef.current) < IDLE_STOP_MIN_INTERVAL_MS) return;
        const active = await timeEntryApi.active({ timer_slot: 'primary' });
        if (!isCurrentRun()) return;
        const activeEntry = active.data;
        if (!activeEntry?.id) return;
        if (lastAutoStoppedEntryIdRef.current === activeEntry.id) return;
        // Only update activeEntryRef if the API entry ID matches our cached entry
        // This prevents stale API data from overriding locally stopped timer
        if (activeEntry.id === cachedEntry.id) {
          activeEntryRef.current = activeEntry;
        } else {
          console.log('[desktop-tracker] API active entry ID mismatch, using cached entry', {
            cached_id: cachedEntry.id,
            api_id: activeEntry.id,
          });
        }
        const lastActivityAtMs = Math.max(0, now - (Math.floor(idleSeconds) * 1000));
        const recordedAt = new Date(now).toISOString();
        console.info('[desktop-tracker] dedicated idle stop check: forcing stop', {
          idle_seconds: Math.floor(idleSeconds),
          session_id: cachedEntry.id,
        });
        const stopped = await forceStopTimerForLock(cachedEntry, Math.floor(idleSeconds), lastActivityAtMs, recordedAt);
        if (stopped) {
          lockScreenAutoStopRevealPendingRef.current = true;
          if (typeof document === 'undefined' || document.visibilityState === 'visible') {
            void handleVisibilityReveal();
          }
        }
      } catch (error) {
        console.warn('[desktop-tracker] dedicated idle stop check failed:', error);
      } finally {
        inFlight = false;
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
        })
        .catch((error) => {
          console.warn('Desktop tracker device identity lookup failed:', error);
        });
    }
    /*
     * Sessions left unsent by a previous run come back before the first tick,
     * so the drain below picks them up ahead of anything recorded now and the
     * timeline replays in the order it happened. Restoring appends through
     * enqueue, so the device_id guard still applies to whatever was on disk.
     */
    if (typeof desktopApi?.loadPendingSessions === 'function') {
      void desktopApi.loadPendingSessions()
        .then((stored) => {
          if (!isCurrentRun() || !Array.isArray(stored) || stored.length === 0) return;

          pendingSessionQueueRef.current.restore(stored as PendingSession[]);
          console.log(`[desktop-tracker] Restored ${stored.length} unsent session(s) from disk`);
        })
        .catch((error) => { reportSilentError('desktop-tracker', error); });
    }

    void tick().then(() => {
      if (!activeEntryRef.current?.id) {
        try {
          const snapshot = localStorage.getItem('active_timer_snapshot');
          if (snapshot) {
            const parsed = JSON.parse(snapshot) as TimeEntry;

            // Freshness check. This snapshot used to be trusted unconditionally,
            // so a stale one started capturing the user's screen on app launch —
            // including the immediate one-shot — before the server had confirmed
            // any timer was running. A snapshot whose start is older than the
            // idle auto-stop threshold cannot describe a live timer.
            const startedAtMs = parsed?.start_time ? new Date(parsed.start_time).getTime() : NaN;
            const isFresh = Number.isFinite(startedAtMs)
              && Date.now() - startedAtMs < IDLE_AUTO_STOP_THRESHOLD_SECONDS * 1000;

            if (parsed?.id && isFresh) {
              activeEntryRef.current = parsed;
              syncScreenshotInterval(parsed.id);
            } else if (parsed?.id) {
              console.info('[desktop-tracker] ignoring stale active_timer_snapshot; awaiting server confirmation');
              localStorage.removeItem('active_timer_snapshot');
            }
          }
        } catch (error) { reportSilentError('desktop-tracker', error); }
      }
    });

    return () => {
      clearTrackerIntervals();
      clearLockAutoStopTimeout();
      activeSegmentRef.current = null;
      activeEntryRef.current = null;
      activeDesktopSessionRef.current = null;
      desktopDeviceIdentityRef.current = null;
      pendingIdleRewindRef.current.clear();
      pendingTrackedSecondsRef.current = 0;
      activeScreenshotEntryIdRef.current = null;
      idleStopInFlightRef.current = false;
      idleStopBlockedUntilMsRef.current = 0;
      idleStopAttemptsPerEntryRef.current.clear();
      lastIdleStopAttemptMsRef.current = 0;
      lastReliableTrackingContextRef.current = null;
      systemLockedAtMsRef.current = null;
      lockScreenAutoStopRevealPendingRef.current = false;
      if (typeof removeForegroundWindowChangeListener === 'function') {
        removeForegroundWindowChangeListener();
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
