export const DEFAULT_APP_TIMEZONE = 'Asia/Kolkata';

const FALLBACK_TIMEZONES = [
  DEFAULT_APP_TIMEZONE,
  'UTC',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Europe/London',
  'Asia/Dubai',
  'Australia/Sydney',
  'Australia/Perth',
];

export const resolveTimeZone = (value?: string | null) => {
  const candidate = String(value || '').trim();
  if (!candidate) {
    return DEFAULT_APP_TIMEZONE;
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_APP_TIMEZONE;
  }
};

export const COMMON_TIMEZONES = [
  DEFAULT_APP_TIMEZONE,
  'UTC',
  'America/New_York',
  'Europe/London',
  'Asia/Dubai',
  'Australia/Sydney',
];

/**
 * Legacy IANA zone names that browsers still report, mapped to their canonical
 * successor.
 *
 * Chrome resolves the Indian zone as `Asia/Calcutta`, the pre-1993 name. Every
 * picker in the app lists the canonical `Asia/Kolkata`, so an auto-detected
 * value never matched an option and the select rendered empty on a required
 * field — the browser and the list were naming the same zone differently.
 */
const TIMEZONE_ALIASES: Record<string, string> = {
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Asia/Chungking': 'Asia/Chongqing',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Ponape': 'Pacific/Pohnpei',
};

/** Canonicalise a zone id, leaving anything already canonical untouched. */
export const canonicalTimeZone = (value?: string | null): string => {
  const candidate = String(value || '').trim();
  if (!candidate) return DEFAULT_APP_TIMEZONE;
  return TIMEZONE_ALIASES[candidate] ?? candidate;
};

/** The browser's zone, canonicalised, falling back to the app default. */
export const detectTimeZone = (): string =>
  canonicalTimeZone(
    typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined
  );

export const getSupportedTimezones = () => {
  const supportedValuesOf = (Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  }).supportedValuesOf;

  const supported = typeof supportedValuesOf === 'function'
    ? supportedValuesOf('timeZone')
    : FALLBACK_TIMEZONES;

  const filtered = supported.filter((timezone) => !timezone.startsWith('Etc/'));
  const unique = Array.from(new Set([DEFAULT_APP_TIMEZONE, ...filtered]));

  return unique.sort((left, right) => {
    if (left === DEFAULT_APP_TIMEZONE) return -1;
    if (right === DEFAULT_APP_TIMEZONE) return 1;
    return left.localeCompare(right);
  });
};
