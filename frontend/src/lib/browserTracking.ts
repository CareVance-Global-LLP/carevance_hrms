import type { BrowserTrackingConnection, BrowserTrackingEvent, BrowserTrackingState } from '@/types';

const SUPPORTED_BROWSER_NAMES = ['chrome', 'edge', 'brave', 'opera', 'vivaldi'] as const;

const DEFAULT_BROWSER_TRACKING_HEALTH_WINDOW_MS = 45 * 1000;

const cleanWebsiteTitle = (title?: string | null) => {
  const value = String(title || '').trim();
  if (!value) {
    return '';
  }

  return value
    .replace(/\s*[-|]\s*(google chrome|chrome|microsoft edge|edge|mozilla firefox|firefox|brave|opera|vivaldi)$/i, '')
    .replace(/^\(\d+\)\s*/, '')
    .trim();
};

export const isSupportedBrowserTrackingApp = (browserName?: string | null) => {
  const normalized = String(browserName || '').trim().toLowerCase();
  if (!normalized) {
    return false;
  }

  return SUPPORTED_BROWSER_NAMES.some((candidate) => normalized.includes(candidate));
};

export const buildBrowserTrackingEventSignature = (event: Pick<BrowserTrackingEvent, 'browser_name' | 'profile_key' | 'window_id' | 'tab_id' | 'url'>) => (
  [
    String(event.browser_name || '').trim().toLowerCase(),
    String(event.profile_key || '').trim(),
    Number.isFinite(Number(event.window_id)) ? Number(event.window_id) : '',
    Number.isFinite(Number(event.tab_id)) ? Number(event.tab_id) : '',
    String(event.url || '').trim(),
  ].join('|')
);

export const buildExactWebsiteDisplayName = (url?: string | null, title?: string | null) => {
  const cleanedTitle = cleanWebsiteTitle(title);
  if (cleanedTitle) {
    return cleanedTitle.slice(0, 255);
  }

  const rawUrl = String(url || '').trim();
  if (!rawUrl) {
    return 'Website';
  }

  try {
    const parsed = new URL(rawUrl);
    return parsed.hostname.replace(/^www\./, '').slice(0, 255) || 'Website';
  } catch {
    return rawUrl.slice(0, 255);
  }
};

export const isBrowserTrackingConnectionHealthy = (
  state?: BrowserTrackingState | null,
  now = Date.now(),
  healthWindowMs = DEFAULT_BROWSER_TRACKING_HEALTH_WINDOW_MS,
) => {
  if (!state?.ready) {
    return false;
  }

  const hasRecentlySeenConnection = Array.isArray(state.connections)
    && state.connections.some((connection: BrowserTrackingConnection) => {
      const lastSeenAtMs = Date.parse(String(connection.last_seen_at || connection.paired_at || ''));
      return Number.isFinite(lastSeenAtMs) && (now - lastSeenAtMs) <= healthWindowMs;
    });

  if (hasRecentlySeenConnection) {
    return true;
  }

  const lastEventAtMs = Date.parse(String(state.last_event_at || ''));
  return Number.isFinite(lastEventAtMs) && (now - lastEventAtMs) <= healthWindowMs;
};
