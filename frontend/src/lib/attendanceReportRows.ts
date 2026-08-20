/**
 * One row of `GET /reports/attendance`, turned into the four numbers the
 * screen shows: owed, present, off, missed.
 *
 * The report used to work them out inline, in three separate useMemos, each
 * repeating the same sum:
 *
 *     absentDays = calendar_days_in_range - days_present - leave_days
 *
 * `calendar_days_in_range` is every day in the range, weekends included. Over a
 * 31-day month with 22 working days, somebody with flawless attendance came out
 * at nine absences and a 71% rate — below the 80% cut, so the same screen also
 * listed them as an attendance exception. Every weekly off in the product was
 * being reported as a day missed, on the one screen managers review people on.
 *
 * Three rules, and nothing in the UI re-decides them:
 *
 *   A DAY NOBODY WAS OWED IS NOT AN ABSENCE. Weekly offs and public holidays
 *   leave the denominator before anything is called missing.
 *
 *   THE SERVER'S ANSWER WINS. It resolved the employee's real WeeklyOffPolicy —
 *   six-day weeks, mid-week offs, alternate Saturdays — which a client holding
 *   only a date range cannot do. When `absent_days` is present it is used as
 *   sent, never recomputed.
 *
 *   AN OLD PAYLOAD DEGRADES, NEVER LIES. Without the schedule keys the sum
 *   falls back, but to one that still takes the weekend out first, so the worst
 *   case is the old approximation rather than the old error.
 *
 * Pure: no React, no clock, no formatting locale.
 */

/** Loose on purpose — an older deployment is missing keys, not malformed. */
export interface AttendanceReportRow {
  days_present?: number;
  leave_days?: number;
  calendar_days_in_range?: number;
  working_days_in_range?: number;
  attendance_rate?: number;
  weekend_dates?: unknown[];

  /** Present once the server resolves the real weekly-off policy. */
  weekly_off_source?: 'policy' | 'calendar_weekend' | string;
  weekly_off_days?: number;
  holiday_days?: number;
  expected_days?: number;
  scheduled_days_present?: number;
  absent_days?: number;
  scheduled_attendance_rate?: number;
}

export interface AttendanceRowSummary {
  /** Days this person was actually rostered for. */
  expectedDays: number;
  presentDays: number;
  leaveDays: number;
  weeklyOffDays: number;
  holidayDays: number;
  /** Rostered, already finished, and neither worked nor covered by leave. */
  absentDays: number;
  /** Present as a share of days owed, 0–100. */
  attendanceRate: number;
  /**
   * Did a real WeeklyOffPolicy decide the off days, or is this still the
   * Saturday/Sunday guess? The screen says which, rather than letting a reader
   * assume the stronger of the two.
   */
  isSchedulePolicyBacked: boolean;
}

export interface AttendanceRosterTotals extends Omit<AttendanceRowSummary, 'attendanceRate' | 'isSchedulePolicyBacked'> {
  employees: number;
  averageAttendanceRate: number;
  everyRowIsSchedulePolicyBacked: boolean;
}

const toCount = (value: unknown): number => {
  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
};

/** A key the server either sent as a number or did not send at all. */
const optionalCount = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;

  const parsed = Number(value);

  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
};

const rate = (present: number, expected: number): number =>
  expected > 0 ? Math.round((present / expected) * 10000) / 100 : 0;

export const summariseAttendanceRow = (row: AttendanceReportRow): AttendanceRowSummary => {
  const presentDays = toCount(row.days_present);
  const leaveDays = toCount(row.leave_days);
  const calendarDays = toCount(row.calendar_days_in_range);

  const serverAbsentDays = optionalCount(row.absent_days);
  const serverExpectedDays = optionalCount(row.expected_days);

  if (serverAbsentDays !== null && serverExpectedDays !== null) {
    const scheduledPresent = optionalCount(row.scheduled_days_present) ?? presentDays;

    return {
      expectedDays: serverExpectedDays,
      presentDays,
      leaveDays,
      weeklyOffDays: toCount(row.weekly_off_days),
      holidayDays: toCount(row.holiday_days),
      absentDays: serverAbsentDays,
      attendanceRate: optionalCount(row.scheduled_attendance_rate)
        ?? rate(scheduledPresent, serverExpectedDays),
      isSchedulePolicyBacked: row.weekly_off_source === 'policy',
    };
  }

  // --- the fallback, for a payload written before the schedule keys ---
  //
  // `weekend_dates` is the old Saturday/Sunday list. It is a guess, but it is
  // the guess the server itself was making, and subtracting it is strictly
  // closer than counting every Saturday as a day somebody failed to show up.
  const weekendDays = Array.isArray(row.weekend_dates) ? row.weekend_dates.length : null;
  const expectedDays = weekendDays !== null
    ? Math.max(0, calendarDays - weekendDays)
    : toCount(row.working_days_in_range) || calendarDays;

  return {
    expectedDays,
    presentDays,
    leaveDays,
    weeklyOffDays: weekendDays ?? Math.max(0, calendarDays - expectedDays),
    holidayDays: 0,
    absentDays: Math.max(0, expectedDays - presentDays - leaveDays),
    attendanceRate: optionalCount(row.attendance_rate) ?? rate(presentDays, expectedDays),
    isSchedulePolicyBacked: false,
  };
};

/**
 * The roster totals.
 *
 * The rate is AVERAGED across employees rather than recomputed from the
 * totals: a summed rate is meaningless, and a rate over pooled days quietly
 * weights the answer towards whoever was in the range longest.
 */
export const totalAttendanceRows = (rows: AttendanceReportRow[]): AttendanceRosterTotals => {
  const summaries = rows.map(summariseAttendanceRow);

  const sum = (pick: (summary: AttendanceRowSummary) => number): number =>
    summaries.reduce((carry, summary) => carry + pick(summary), 0);

  return {
    employees: summaries.length,
    expectedDays: sum((summary) => summary.expectedDays),
    presentDays: sum((summary) => summary.presentDays),
    leaveDays: sum((summary) => summary.leaveDays),
    weeklyOffDays: sum((summary) => summary.weeklyOffDays),
    holidayDays: sum((summary) => summary.holidayDays),
    absentDays: sum((summary) => summary.absentDays),
    averageAttendanceRate: summaries.length
      ? Math.round((sum((summary) => summary.attendanceRate) / summaries.length) * 100) / 100
      : 0,
    everyRowIsSchedulePolicyBacked: summaries.length > 0
      && summaries.every((summary) => summary.isSchedulePolicyBacked),
  };
};
