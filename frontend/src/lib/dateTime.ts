import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';

const ISO_DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const NAIVE_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;
const HAS_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

export const parseApiDate = (value?: string | number | Date | null) => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  }

  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return null;
  }

  if (ISO_DATE_ONLY_PATTERN.test(raw)) {
    const parsed = new Date(`${raw}T00:00:00`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const normalized = raw.includes(' ') && !raw.includes('T')
    ? raw.replace(' ', 'T')
    : raw;

  const candidate = NAIVE_DATE_TIME_PATTERN.test(normalized) && !HAS_TIMEZONE_PATTERN.test(normalized)
    ? `${normalized}Z`
    : normalized;

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const getStartTimeMs = (value?: string | number | Date | null) => {
  const parsed = parseApiDate(value);
  return parsed ? parsed.getTime() : NaN;
};

export const formatDate = (
  value?: string | number | Date | null,
  timezone = DEFAULT_APP_TIMEZONE,
  locale = 'en-US'
) => {
  const parsed = parseApiDate(value);
  if (!parsed) return 'Today';

  return parsed.toLocaleDateString(locale, {
    timeZone: resolveTimeZone(timezone),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
};

export const formatTime = (
  value?: string | number | Date | null,
  timezone = DEFAULT_APP_TIMEZONE,
  locale = 'en-US'
) => {
  const parsed = parseApiDate(value);
  if (!parsed) return 'Not recorded';

  return parsed.toLocaleTimeString(locale, {
    timeZone: resolveTimeZone(timezone),
    hour: 'numeric',
    minute: '2-digit',
  });
};

export const formatDateTime = (
  value?: string | number | Date | null,
  timezone = DEFAULT_APP_TIMEZONE,
  locale = 'en-US',
  emptyLabel = 'Not recorded'
) => {
  const parsed = parseApiDate(value);
  if (!parsed) return emptyLabel;

  return parsed.toLocaleString(locale, {
    timeZone: resolveTimeZone(timezone),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};
