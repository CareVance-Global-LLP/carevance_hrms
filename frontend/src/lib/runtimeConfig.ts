type AppRuntimeConfig = {
  VITE_API_URL?: string;
  VITE_WEB_APP_URL?: string;
  VITE_DESKTOP_DOWNLOAD_URL?: string;
  VITE_DESKTOP_DOWNLOAD_LABEL?: string;
  VITE_SALES_EMAIL?: string;
  VITE_SUPPORT_EMAIL?: string;
  VITE_GA_MEASUREMENT_ID?: string;
  VITE_PLAUSIBLE_DOMAIN?: string;
  VITE_POSTHOG_KEY?: string;
  VITE_POSTHOG_HOST?: string;
  VITE_GOOGLE_OAUTH_ENABLED?: string;
  VITE_IDLE_TRACK_THRESHOLD_SECONDS?: string;
  VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS?: string;
  VITE_LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS?: string;
  VITE_IDLE_GUARD_INTERVAL_MS?: string;
  VITE_PAYROLL_ENABLED?: string;
  VITE_DEV_MODE_NAVIGATION?: string;
  VITE_REVERB_APP_KEY?: string;
  VITE_REVERB_HOST?: string;
  VITE_REVERB_PORT?: string;
  VITE_REVERB_SCHEME?: string;
};

const runtimeConfig: AppRuntimeConfig =
  typeof window !== 'undefined' ? window.__APP_CONFIG__ || {} : {};

const resolveConfigValue = (runtimeValue?: string, buildValue?: string) => {
  const runtimeCandidate = runtimeValue?.trim();
  if (runtimeCandidate) {
    return runtimeCandidate;
  }

  const buildCandidate = buildValue?.trim();
  if (buildCandidate) {
    return buildCandidate;
  }

  return '';
};

const resolveBooleanConfigValue = (
  runtimeValue: string | undefined,
  buildValue: string | undefined,
  fallback = false
) => {
  const candidate = resolveConfigValue(runtimeValue, buildValue).toLowerCase();

  if (candidate === '') {
    return fallback;
  }

  if (['1', 'true', 'yes', 'on'].includes(candidate)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(candidate)) {
    return false;
  }

  return fallback;
};

const resolveNumericConfigValue = (
  runtimeValue: string | undefined,
  buildValue: string | undefined,
  fallback: number,
  minimum: number
) => {
  const candidate = resolveConfigValue(runtimeValue, buildValue);
  if (candidate === '') {
    return fallback;
  }

  const parsed = Number(candidate);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(minimum, Math.floor(parsed));
};

const resolveDefaultApiUrl = () => {
  if (typeof window === 'undefined') {
    return 'http://localhost:8000/api';
  }

  const { hostname, origin } = window.location;
  const isLocalHost = ['localhost', '127.0.0.1'].includes(hostname);

  return isLocalHost ? '/api' : `${origin}/api`;
};

export const apiUrl = resolveConfigValue(runtimeConfig.VITE_API_URL, import.meta.env.VITE_API_URL) || resolveDefaultApiUrl();

export const apiBaseUrl = apiUrl.replace(/\/api\/?$/, '');

/*
 * Real-time transport (Reverb).
 *
 * Resolved the same way as everything else here, so one build serves every
 * environment and the deployed container injects values through
 * window.__APP_CONFIG__ rather than needing a rebuild.
 *
 * The app key is the gate. When it is absent the client does not attempt a
 * socket at all and stays on its polling path — which is what makes a local
 * checkout with no `php artisan reverb:start` behave exactly as it did before
 * real-time existed, rather than spending every page load retrying a
 * connection that was never going to succeed. It is a public identifier, not a
 * secret; the secret stays on the server and signs the auth response.
 */
export const reverbAppKey = resolveConfigValue(
  runtimeConfig.VITE_REVERB_APP_KEY,
  import.meta.env.VITE_REVERB_APP_KEY
);

const isLoopbackHost = () =>
  typeof window !== 'undefined' &&
  ['localhost', '127.0.0.1'].includes(window.location.hostname);

export const reverbHost =
  resolveConfigValue(runtimeConfig.VITE_REVERB_HOST, import.meta.env.VITE_REVERB_HOST) ||
  (typeof window !== 'undefined' ? window.location.hostname : 'localhost');

export const reverbScheme =
  resolveConfigValue(runtimeConfig.VITE_REVERB_SCHEME, import.meta.env.VITE_REVERB_SCHEME) ||
  (isLoopbackHost() ? 'http' : 'https');

// Reverb's own default is 8080 and that is what `reverb:start` binds locally.
// Deployed, the socket comes through Caddy on 443 alongside everything else,
// which is also why wss needs no certificate work of its own.
export const reverbPort = resolveNumericConfigValue(
  runtimeConfig.VITE_REVERB_PORT,
  import.meta.env.VITE_REVERB_PORT,
  isLoopbackHost() ? 8080 : 443,
  1
);

export const realtimeEnabled = reverbAppKey !== '';

export const webAppUrl =
  resolveConfigValue(runtimeConfig.VITE_WEB_APP_URL, import.meta.env.VITE_WEB_APP_URL) ||
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

export const desktopDownloadUrl =
  resolveConfigValue(runtimeConfig.VITE_DESKTOP_DOWNLOAD_URL, import.meta.env.VITE_DESKTOP_DOWNLOAD_URL) ||
  `${apiBaseUrl}/api/downloads/desktop/windows`;

export const desktopDownloadLabel =
  resolveConfigValue(runtimeConfig.VITE_DESKTOP_DOWNLOAD_LABEL, import.meta.env.VITE_DESKTOP_DOWNLOAD_LABEL) ||
  'Download for Windows';

export const salesContactEmail =
  resolveConfigValue(runtimeConfig.VITE_SALES_EMAIL, import.meta.env.VITE_SALES_EMAIL) ||
  'aayushborwal.carevanceglobal@gmail.com';

export const supportContactEmail =
  resolveConfigValue(runtimeConfig.VITE_SUPPORT_EMAIL, import.meta.env.VITE_SUPPORT_EMAIL) ||
  'mavliribaz.carevanceglobal@gmail.com';

export const gaMeasurementId = resolveConfigValue(
  runtimeConfig.VITE_GA_MEASUREMENT_ID,
  import.meta.env.VITE_GA_MEASUREMENT_ID
);

export const plausibleDomain = resolveConfigValue(
  runtimeConfig.VITE_PLAUSIBLE_DOMAIN,
  import.meta.env.VITE_PLAUSIBLE_DOMAIN
);

export const posthogKey = resolveConfigValue(
  runtimeConfig.VITE_POSTHOG_KEY,
  import.meta.env.VITE_POSTHOG_KEY
);

export const posthogHost =
  resolveConfigValue(runtimeConfig.VITE_POSTHOG_HOST, import.meta.env.VITE_POSTHOG_HOST) ||
  'https://app.posthog.com';

export const googleOAuthEnabled = resolveBooleanConfigValue(
  runtimeConfig.VITE_GOOGLE_OAUTH_ENABLED,
  import.meta.env.VITE_GOOGLE_OAUTH_ENABLED,
  false
);

export const idleTrackThresholdSeconds = resolveNumericConfigValue(
  runtimeConfig.VITE_IDLE_TRACK_THRESHOLD_SECONDS,
  import.meta.env.VITE_IDLE_TRACK_THRESHOLD_SECONDS,
  3 * 60,
  30
);

/*
 * Kept in step with the server's config/time_tracking.php default, which was
 * raised from 5 to 15 minutes on 13 Aug 2026. This value is only the
 * pre-hydration fallback — the server is the authority and ships the resolved
 * policy on the user payload (see trackerPolicy.ts) — but a fallback that
 * disagrees with the server means the first moments of a session run a
 * different rule from the rest of it.
 */
export const idleAutoStopThresholdSeconds = resolveNumericConfigValue(
  runtimeConfig.VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS,
  import.meta.env.VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS,
  15 * 60,
  60
);

export const lockScreenAutoStopThresholdSeconds = resolveNumericConfigValue(
  runtimeConfig.VITE_LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS,
  import.meta.env.VITE_LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS,
  5 * 60,
  30
);

export const payrollEnabled = resolveBooleanConfigValue(
  runtimeConfig.VITE_PAYROLL_ENABLED,
  import.meta.env.VITE_PAYROLL_ENABLED,
  false
);

export const devModeNavigation = (() => {
  // Check localStorage first for development override
  if (typeof window !== 'undefined' && localStorage.getItem('devModeNavigation') === 'true') {
    return true;
  }
  
  // Fall back to environment variables
  return resolveBooleanConfigValue(
    runtimeConfig.VITE_DEV_MODE_NAVIGATION,
    import.meta.env.VITE_DEV_MODE_NAVIGATION,
    false
  );
})();

export const idleGuardIntervalMs = resolveNumericConfigValue(
  runtimeConfig.VITE_IDLE_GUARD_INTERVAL_MS,
  import.meta.env.VITE_IDLE_GUARD_INTERVAL_MS,
  10000,
  250
);
