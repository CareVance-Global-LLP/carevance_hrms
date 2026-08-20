import { describe, expect, it } from 'vitest';
import {
  summariseAttendanceRow,
  totalAttendanceRows,
  type AttendanceReportRow,
} from './attendanceReportRows';

/**
 * The arithmetic behind the attendance report's headline numbers.
 *
 * It used to live inline in three separate useMemos in ReportsWorkspace, each
 * spelling out the same wrong sum:
 *
 *   absentDays = calendar_days_in_range - days_present - leave_days
 *
 * `calendar_days_in_range` is every day in the range, weekends included. Over a
 * 31-day month with 22 working days, somebody with flawless attendance came out
 * at nine absences and a 71% rate — under the 80% threshold, so they were also
 * listed as an attendance exception. Every weekly off in the product was
 * reported as a day missed.
 *
 * These tests sit on the three rules that fix it:
 *
 *   A DAY NOBODY WAS OWED IS NOT AN ABSENCE. Weekly offs and public holidays
 *   come out of the denominator before anything is called missing.
 *   THE SERVER'S ANSWER WINS. It resolved the real weekly-off policy; the
 *   client must not re-derive it from a weekend guess.
 *   AN OLD PAYLOAD DEGRADES, NEVER LIES. Without the schedule keys the sum
 *   falls back — but to one that still subtracts the weekend.
 */

const scheduled = (overrides: Partial<AttendanceReportRow> = {}): AttendanceReportRow => ({
  days_present: 22,
  leave_days: 0,
  calendar_days_in_range: 31,
  working_days_in_range: 22,
  attendance_rate: 70.97,
  weekly_off_source: 'policy',
  weekly_off_days: 5,
  holiday_days: 4,
  expected_days: 22,
  scheduled_days_present: 22,
  absent_days: 0,
  scheduled_attendance_rate: 100,
  ...overrides,
});

const legacy = (overrides: Partial<AttendanceReportRow> = {}): AttendanceReportRow => ({
  days_present: 22,
  leave_days: 0,
  calendar_days_in_range: 31,
  working_days_in_range: 22,
  attendance_rate: 70.97,
  weekend_dates: [
    '2026-08-01', '2026-08-02', '2026-08-08', '2026-08-09',
    '2026-08-15', '2026-08-16', '2026-08-22', '2026-08-23',
    '2026-08-29', '2026-08-30',
  ],
  ...overrides,
});

describe('summariseAttendanceRow — the server has already resolved the schedule', () => {
  it('never counts a weekly off as an absence', () => {
    const summary = summariseAttendanceRow(scheduled());

    expect(summary.absentDays).toBe(0);
    expect(summary.weeklyOffDays).toBe(5);
    expect(summary.expectedDays).toBe(22);
  });

  it('reports the rate against the days owed, not against the calendar', () => {
    const summary = summariseAttendanceRow(scheduled());

    expect(summary.attendanceRate).toBe(100);
    expect(summary.isSchedulePolicyBacked).toBe(true);
  });

  it('keeps the server absence count even when it disagrees with the naive sum', () => {
    // Two missed days inside a six-day week: the naive sum would say
    // 31 - 24 - 0 = 7, six of which are Sundays nobody was owed.
    const summary = summariseAttendanceRow(scheduled({
      days_present: 24,
      weekly_off_days: 5,
      holiday_days: 0,
      expected_days: 26,
      scheduled_days_present: 24,
      absent_days: 2,
      scheduled_attendance_rate: 92.31,
    }));

    expect(summary.absentDays).toBe(2);
    expect(summary.expectedDays).toBe(26);
    expect(summary.attendanceRate).toBe(92.31);
  });

  it('says so when the schedule is still the Saturday/Sunday guess', () => {
    const summary = summariseAttendanceRow(scheduled({ weekly_off_source: 'calendar_weekend' }));

    expect(summary.isSchedulePolicyBacked).toBe(false);
    // The numbers are still the server's — only the provenance differs.
    expect(summary.absentDays).toBe(0);
  });
});

describe('summariseAttendanceRow — an older payload degrades without lying', () => {
  it('subtracts the weekend before calling anything an absence', () => {
    const summary = summariseAttendanceRow(legacy());

    // 31 calendar days, 10 weekend days, 22 present, 0 leave.
    expect(summary.expectedDays).toBe(21);
    expect(summary.absentDays).toBe(0);
    expect(summary.weeklyOffDays).toBe(10);
    expect(summary.isSchedulePolicyBacked).toBe(false);
  });

  it('falls back to the working-day count when even the weekend dates are missing', () => {
    const summary = summariseAttendanceRow({
      days_present: 20,
      leave_days: 1,
      calendar_days_in_range: 31,
      working_days_in_range: 22,
      attendance_rate: 64.52,
    });

    expect(summary.expectedDays).toBe(22);
    expect(summary.absentDays).toBe(1);
  });

  it('never reports a negative absence count', () => {
    const summary = summariseAttendanceRow(legacy({ days_present: 25, leave_days: 4 }));

    expect(summary.absentDays).toBe(0);
  });

  it('reports zero rather than dividing by an empty range', () => {
    const summary = summariseAttendanceRow({
      days_present: 0,
      leave_days: 0,
      calendar_days_in_range: 0,
      working_days_in_range: 0,
    });

    expect(summary.expectedDays).toBe(0);
    expect(summary.attendanceRate).toBe(0);
    expect(summary.absentDays).toBe(0);
  });

  it('treats a completely empty row as zeroes rather than as NaN', () => {
    const summary = summariseAttendanceRow({});

    expect(summary.presentDays).toBe(0);
    expect(summary.absentDays).toBe(0);
    expect(summary.attendanceRate).toBe(0);
    expect(Number.isNaN(summary.attendanceRate)).toBe(false);
  });
});

describe('totalAttendanceRows — the roster totals', () => {
  it('sums the per-row figures rather than re-deriving them', () => {
    const totals = totalAttendanceRows([
      scheduled(),
      scheduled({ days_present: 24, expected_days: 26, scheduled_days_present: 24, absent_days: 2, scheduled_attendance_rate: 92.31, weekly_off_days: 5, holiday_days: 0 }),
    ]);

    expect(totals.employees).toBe(2);
    expect(totals.presentDays).toBe(46);
    expect(totals.expectedDays).toBe(48);
    expect(totals.weeklyOffDays).toBe(10);
    expect(totals.absentDays).toBe(2);
  });

  it('averages the rate across employees rather than summing it', () => {
    const totals = totalAttendanceRows([
      scheduled({ scheduled_attendance_rate: 100 }),
      scheduled({ scheduled_attendance_rate: 80 }),
    ]);

    expect(totals.averageAttendanceRate).toBe(90);
  });

  it('reports an empty roster as zeroes, not as NaN', () => {
    const totals = totalAttendanceRows([]);

    expect(totals.employees).toBe(0);
    expect(totals.averageAttendanceRate).toBe(0);
    expect(Number.isNaN(totals.averageAttendanceRate)).toBe(false);
  });

  it('flags the roster as still guessing when any employee has no policy behind them', () => {
    const totals = totalAttendanceRows([
      scheduled(),
      scheduled({ weekly_off_source: 'calendar_weekend' }),
    ]);

    expect(totals.everyRowIsSchedulePolicyBacked).toBe(false);
  });
});
