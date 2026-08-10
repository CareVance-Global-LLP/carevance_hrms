/**
 * Shared date and category helpers for the leave feature.
 *
 * Every date here is a local calendar date handled as a `YYYY-MM-DD` string.
 * `Date#toISOString` is deliberately avoided: it converts to UTC first, which
 * shifts a local midnight in IST back to the previous day and quietly moves
 * every boundary of a leave request.
 */

export interface LeaveCategoryBalance {
  code: string;
  name: string;
  remaining: number;
  annual_quota: number;
  used: number;
}

export const toISODate = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

export const parseISODate = (value: string): Date | null => {
  const [y, m, d] = String(value || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

export const addDays = (date: Date, days: number): Date => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const isWeekend = (date: Date): boolean => date.getDay() === 0 || date.getDay() === 6;

export interface WorkingDaysResult {
  days: number;
  skippedWeekend: number;
  skippedHoliday: number;
}

/**
 * Working days in an inclusive range: Mon–Fri minus known holidays. This is a
 * preview of what the server will deduct, not the deduction itself — the
 * server's `consumed_breakdown` stays authoritative at submit.
 */
export function workingDaysBetween(
  fromISO: string,
  toISO: string,
  holidayDates: ReadonlySet<string>
): WorkingDaysResult {
  const from = parseISODate(fromISO);
  const to = parseISODate(toISO);
  const result: WorkingDaysResult = { days: 0, skippedWeekend: 0, skippedHoliday: 0 };

  if (!from || !to || to < from) return result;

  // A runaway range (someone typing a year by hand) should not lock the UI.
  const cursor = new Date(from);
  for (let guard = 0; guard < 400 && cursor <= to; guard += 1) {
    if (isWeekend(cursor)) {
      result.skippedWeekend += 1;
    } else if (holidayDates.has(toISODate(cursor))) {
      result.skippedHoliday += 1;
    } else {
      result.days += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return result;
}

/** A single working day, for half-day requests. */
export const isWorkingDay = (iso: string, holidayDates: ReadonlySet<string>): boolean => {
  const date = parseISODate(iso);
  if (!date) return false;
  return !isWeekend(date) && !holidayDates.has(iso);
};

/** ISO date strings compare correctly as strings — no Date parsing needed. */
export const spansOverlap = (aFrom: string, aTo: string, bFrom: string, bTo: string): boolean =>
  aFrom <= bTo && bFrom <= aTo;

/**
 * Approved absences that intersect a span, excluding the requester — the
 * coverage picture an approver needs before saying yes.
 */
export function overlappingApproved(
  requests: ReadonlyArray<any>,
  fromISO: string,
  toISO: string,
  excludeUserId: number | null
): any[] {
  return requests.filter((item) => {
    if (item?.status !== 'approved') return false;
    const userId = Number(item?.user?.id ?? item?.user_id ?? 0);
    if (excludeUserId !== null && userId === excludeUserId) return false;
    return spansOverlap(String(item.start_date || ''), String(item.end_date || ''), fromISO, toISO);
  });
}

/*
 * Category colours cycle a small brand-family palette so dynamic policies
 * (categories come from the org's leave policy, not a fixed enum) still get
 * stable, distinguishable colours. Unpaid is always the debt colour.
 *
 * These are rendered as inline styles (a tinted chip plus matching label), so
 * they cannot resolve through the CSS token layer and need an explicit dark
 * set. The dark values are the same hues lifted until they clear 4.5:1 against
 * a dark card; the light values are unchanged.
 */
const CATEGORY_PALETTE = ['#5D969D', '#C8923A', '#10B981', '#8DC3C9', '#886226'];
const CATEGORY_PALETTE_DARK = ['#7FB6BD', '#EBB861', '#4FBF8B', '#A5D4DA', '#D3A44C'];

const UNPAID = { light: '#9E4045', dark: '#E0776A' };
const FALLBACK = { light: '#6B757D', dark: '#9AA8B0' };

export function makeCategoryColorOf(
  categories: ReadonlyArray<{ code?: string }>,
  theme: 'light' | 'dark' = 'light'
): (code?: string | null) => string {
  const isDark = theme === 'dark';
  const palette = isDark ? CATEGORY_PALETTE_DARK : CATEGORY_PALETTE;
  const byCode = new Map<string, string>();
  categories.forEach((category, index) => {
    byCode.set(String(category.code || '').toLowerCase(), palette[index % palette.length]);
  });

  return (code) => {
    const key = String(code || '').toLowerCase();
    if (key === 'unpaid') return isDark ? UNPAID.dark : UNPAID.light;
    return byCode.get(key) ?? (isDark ? FALLBACK.dark : FALLBACK.light);
  };
}
