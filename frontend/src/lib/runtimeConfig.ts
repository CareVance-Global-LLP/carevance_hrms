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
  VITE_IDLE_GUARD_INTERVAL_MS?: string;
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

  return isLocalHost ? 'http://localhost:8000/api' : `${origin}/api`;
};

export const apiUrl = resolveConfigValue(runtimeConfig.VITE_API_URL, import.meta.env.VITE_API_URL) || resolveDefaultApiUrl();

export const apiBaseUrl = apiUrl.replace(/\/api\/?$/, '');

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

export const idleAutoStopThresholdSeconds = resolveNumericConfigValue(
  runtimeConfig.VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS,
  import.meta.env.VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS,
  5 * 60,
  60
);

export const idleGuardIntervalMs = resolveNumericConfigValue(
  runtimeConfig.VITE_IDLE_GUARD_INTERVAL_MS,
  import.meta.env.VITE_IDLE_GUARD_INTERVAL_MS,
  10000,
  250
);
