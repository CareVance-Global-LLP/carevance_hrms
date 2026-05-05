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
