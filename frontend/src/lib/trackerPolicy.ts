import {
  idleAutoStopThresholdSeconds,
  idleTrackThresholdSeconds,
  lockScreenAutoStopThresholdSeconds,
} from '@/lib/runtimeConfig';

/**
 * Tracker policy, as resolved by the server.
 *
 * The client used to hold its own idle thresholds in build-time env vars while
 * the server held a separate set in config. Nothing reconciled them, so a
 * client set below the server proposed stops the server rejected with 409
 * until it burned its three-attempt cap, and a client set above it left the
 * cron as the only rule that actually applied. The server is now the single
 * authority and ships the whole policy in the user payload.
 *
 * The env values survive only as a pre-hydration fallback: AuthContext
 * restores `user` from localStorage and the offline store before /auth/me
 * returns, and those cached payloads can predate this field.
 */
export type TrackerPrivacyPolicy = {
  /** Foreground apps whose screens are never captured, lowercased. */
  blocked_apps: string[];
  skip_on_private_browsing: boolean;
};

/**
 * What happens to an idle span when someone returns.
 *
 * 'prompt' is the fail-safe. An absent, unknown or malformed value resolves to
 * it rather than to either automatic answer: silently discarding someone's
 * time because a setting was mistyped is not a failure worth risking, and
 * silently keeping it is how a tracker stops being believed.
 */
export type IdleResolutionPolicy = 'prompt' | 'always_keep' | 'never_keep';

const IDLE_RESOLUTION_POLICIES: IdleResolutionPolicy[] = ['prompt', 'always_keep', 'never_keep'];

export const readIdleResolutionPolicy = (value: unknown): IdleResolutionPolicy =>
  IDLE_RESOLUTION_POLICIES.includes(value as IdleResolutionPolicy)
    ? (value as IdleResolutionPolicy)
    : 'prompt';

export type TrackerPolicy = {
  idle_track_threshold_seconds: number;
  idle_auto_stop_threshold_seconds: number;
  lock_auto_stop_threshold_seconds: number;
  capture_interval_minutes: number;
  idle_resolution_policy: IdleResolutionPolicy;
  screenshot_retention_days: number;
  privacy: TrackerPrivacyPolicy;
  /** Whether this organisation lets people see their own tracker record. */
  can_view_own_activity: boolean;
  /** Whether this organisation lets people delete their own captures. */
  can_delete_own_screenshots: boolean;
};

const FALLBACK_CAPTURE_INTERVAL_MINUTES = 10;
const FALLBACK_RETENTION_DAYS = 90;

/**
 * Bounds applied to whatever the server sends.
 *
 * Not defensive clutter: this value drives how quickly a person's timer is
 * stopped, and a malformed or truncated payload must never be able to make
 * that aggressive. Anything outside the band falls back rather than clamping,
 * so a bad value is visibly ignored instead of quietly halved.
 */
const MIN_IDLE_TRACK_SECONDS = 60;
const MIN_IDLE_AUTO_STOP_SECONDS = 300;
const MAX_IDLE_SECONDS = 3600;

const readSeconds = (value: unknown, floor: number, fallback: number): number => {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return fallback;

  const whole = Math.floor(seconds);
  if (whole < floor || whole > MAX_IDLE_SECONDS) return fallback;

  return whole;
};

const readPrivacy = (value: unknown): TrackerPrivacyPolicy => {
  const source = (value ?? {}) as Partial<TrackerPrivacyPolicy>;
  const apps = Array.isArray(source.blocked_apps) ? source.blocked_apps : [];

  return {
    blocked_apps: apps
      .map((app) => String(app ?? '').trim().toLowerCase())
      .filter(Boolean),
    // Defaults to ON. A privacy control that fails open is not a privacy
    // control — an absent or malformed field must not silently start
    // capturing private browsing sessions.
    skip_on_private_browsing: source.skip_on_private_browsing !== false,
  };
};

export type TrackerPolicyCarrier = {
  tracker_policy?: Partial<TrackerPolicy> | null;
  effective_monitoring_interval_minutes?: number | null;
  settings?: Record<string, any> | null;
} | null | undefined;

/**
 * Resolve the policy for a user payload, falling back per-field so a partial
 * or stale payload still yields a complete, usable policy.
 */
export const resolveTrackerPolicy = (user: TrackerPolicyCarrier): TrackerPolicy => {
  const served = (user?.tracker_policy ?? {}) as Partial<TrackerPolicy>;

  const idleTrack = readSeconds(
    served.idle_track_threshold_seconds,
    MIN_IDLE_TRACK_SECONDS,
    Math.max(MIN_IDLE_TRACK_SECONDS, idleTrackThresholdSeconds)
  );

  const idleAutoStop = readSeconds(
    served.idle_auto_stop_threshold_seconds,
    MIN_IDLE_AUTO_STOP_SECONDS,
    Math.max(MIN_IDLE_AUTO_STOP_SECONDS, idleAutoStopThresholdSeconds)
  );

  const capture = Number(
    served.capture_interval_minutes ?? user?.effective_monitoring_interval_minutes
    ?? user?.settings?.monitoring_interval_minutes
  );

  const retention = Number(served.screenshot_retention_days);

  return {
    idle_track_threshold_seconds: idleTrack,
    // Stopping before idle has been recorded would close a timer with no idle
    // span on record to justify it.
    idle_auto_stop_threshold_seconds: Math.max(idleAutoStop, idleTrack),
    lock_auto_stop_threshold_seconds: readSeconds(
      served.lock_auto_stop_threshold_seconds,
      MIN_IDLE_TRACK_SECONDS,
      Math.max(MIN_IDLE_TRACK_SECONDS, lockScreenAutoStopThresholdSeconds)
    ),
    capture_interval_minutes: Number.isFinite(capture) && capture > 0
      ? Math.floor(capture)
      : FALLBACK_CAPTURE_INTERVAL_MINUTES,
    idle_resolution_policy: readIdleResolutionPolicy(served.idle_resolution_policy),
    screenshot_retention_days: Number.isFinite(retention) && retention > 0
      ? Math.floor(retention)
      : FALLBACK_RETENTION_DAYS,
    privacy: readPrivacy(served.privacy),
    // Both default to false. A capability that fails open would hand every
    // organisation behaviour it never asked for — exposure of the record in
    // one case, a way to erase tracked time in the other.
    can_view_own_activity: served.can_view_own_activity === true,
    can_delete_own_screenshots:
      served.can_view_own_activity === true && served.can_delete_own_screenshots === true,
  };
};

/**
 * Does this foreground window fall under a capture-time privacy rule?
 *
 * Matched as a case-insensitive substring across both the application name and
 * the window title, so a rule of "1password" also covers "1Password 8" and a
 * browser tab titled "1Password — Vault".
 */
export const isCaptureBlockedContext = (
  policy: TrackerPolicy,
  context: { app?: string | null; title?: string | null } | null | undefined
): boolean => {
  if (!context) return false;

  const haystack = `${context.app ?? ''} ${context.title ?? ''}`.trim().toLowerCase();
  if (!haystack) return false;

  if (policy.privacy.blocked_apps.some((app) => haystack.includes(app))) {
    return true;
  }

  if (policy.privacy.skip_on_private_browsing) {
    return PRIVATE_BROWSING_MARKERS.some((marker) => haystack.includes(marker));
  }

  return false;
};

/**
 * Window-title markers browsers use for private sessions. Title text is the
 * only private-mode signal available from outside the browser.
 */
const PRIVATE_BROWSING_MARKERS = [
  'incognito',
  'inprivate',
  'private browsing',
  'private window',
];
