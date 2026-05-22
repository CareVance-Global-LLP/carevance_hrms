/**
 * Common formatting utilities used across the application
 * Consolidated to avoid duplication across components
 */

// Date formatting
export const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const todayIso = () => toIsoDate(new Date());

// Time duration formatting (compact: 2h 30m)
export const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

// Detailed duration with seconds (always shows seconds)
export const formatDurationDetailed = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return `${hours}h ${minutes}m ${secs}s`;
};

// Smart duration (shows only non-zero parts, includes seconds)
export const formatDurationSmart = (seconds: number) => {
  const safe = Math.max(0, Math.floor(Number.isFinite(Number(seconds)) ? Number(seconds) : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) {
    return secs > 0 ? `${hours}h ${minutes}m ${secs}s` : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
  }

  return `${secs}s`;
};

// Clock format (HH:MM:SS)
export const formatTimerClock = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

// Currency formatting (INR)
export const formatCurrency = (amount: number, currency = 'INR') => {
  return new Intl.NumberFormat('en-IN', { 
    style: 'currency', 
    currency, 
    maximumFractionDigits: 0 
  }).format(Number(amount || 0));
};

// Percentage formatting
export const formatPercent = (value: number, decimals = 0) => {
  const safe = Number.isFinite(value) ? value : 0;
  if (decimals === 0) return `${Math.round(safe)}%`;
  return `${safe.toFixed(decimals)}%`;
};

// Number formatting with commas
export const formatNumber = (value: number) => {
  return new Intl.NumberFormat('en-IN').format(Number(value || 0));
};

// Date range utilities
export interface DateRange {
  startDate: string;
  endDate: string;
}

export const dateInRange = (value: string | null | undefined, range: DateRange) => {
  if (!value) return false;
  const date = String(value).slice(0, 10);
  return date >= range.startDate && date <= range.endDate;
};

export const rangesOverlap = (
  startValue: string | null | undefined, 
  endValue: string | null | undefined, 
  range: DateRange
) => {
  if (!startValue && !endValue) return false;
  const start = String(startValue || endValue).slice(0, 10);
  const end = String(endValue || startValue).slice(0, 10);
  return start <= range.endDate && end >= range.startDate;
};

export const clampIsoDateToToday = (value: string | null | undefined) => {
  const normalized = String(value || '').slice(0, 10);
  const today = todayIso();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return today;
  return normalized > today ? today : normalized;
};

export const normalizeCustomRange = (customRange: DateRange): DateRange => {
  const safeStart = clampIsoDateToToday(customRange.startDate || todayIso());
  const safeEnd = clampIsoDateToToday(customRange.endDate || safeStart);
  return safeStart <= safeEnd
    ? { startDate: safeStart, endDate: safeEnd }
    : { startDate: safeEnd, endDate: safeStart };
};

// String utilities
export const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const humanizeAction = (action?: string | null) =>
  String(action || 'activity')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

// Array utilities
export const safeArray = <T,>(value: unknown): T[] => 
  Array.isArray(value) ? value as T[] : [];

// Date enumeration utilities
export const enumerateDateRange = (range: DateRange) => {
  const dates: Date[] = [];
  const cursor = new Date(`${range.startDate}T00:00:00`);
  const end = new Date(`${range.endDate}T00:00:00`);
  while (cursor <= end && dates.length < 62) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

export const enumerateMonths = (range: DateRange) => {
  const months: string[] = [];
  const cursor = new Date(`${range.startDate.slice(0, 7)}-01T00:00:00`);
  const end = new Date(`${range.endDate.slice(0, 7)}-01T00:00:00`);
  while (cursor <= end && months.length < 24) {
    months.push(toIsoDate(cursor).slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
};
