import { describe, expect, it } from 'vitest';
import { describeDayOutcome, type DayOutcomePayload } from './attendanceDayOutcome';

/**
 * The helper turns one day of engine output into what a cell may say.
 *
 * Three things are load-bearing and each has a test sitting on it:
 *
 *   A weekly off is not an absence. The old calendar drew `status: 'none'` for
 *   both and the reader could not tell a day off from a day missed.
 *   Overtime awaiting approval is not overtime. Keka's rule is "only approved
 *   hours will be considered", and the way that goes wrong is never loud — it
 *   is unapproved hours quietly added to a total somebody then pays.
 *   A penalty always carries its reason. "Half day" with no working behind it
 *   is unusable the moment it is disputed, which is always.
 */

const day = (overrides: Partial<DayOutcomePayload> = {}): DayOutcomePayload => ({
  date: '2026-08-19',
  kind: 'working',
  is_evaluated: true,
  is_weekly_off: false,
  is_holiday: false,
  holiday_title: null,
  is_leave: false,
  leave_units: 0,
  is_absence: false,
  has_record: true,
  worked_seconds: 28800,
  penalisation: {
    status: 'clear',
    explanation: 'Nothing to report for 2026-08-19.',
    reasons: [],
    late: { is_late: false, late_seconds: 0, grace_period_minutes: 15 },
    hours: { worked_seconds: 28800, required_seconds: 28800, percent_of_shift: '100.00' },
    cost: { leaves_deducted: '0.00', is_lop: false, lop_days: '0.00', deduction_source: 'none' },
  },
  overtime: {
    scope: 'working_day',
    treatment: 'pay',
    approval_state: 'not_required',
    counted_minutes: 0,
    pending_minutes: 0,
    raw_minutes: 0,
    multiplier: '1.00',
  },
  ...overrides,
});

describe('describeDayOutcome — what kind of day it was', () => {
  it('calls a weekly off a weekly off, and never an absence', () => {
    const view = describeDayOutcome(day({ kind: 'weekly_off', is_weekly_off: true, has_record: false, worked_seconds: 0 }));

    expect(view.headline).toBe('Weekly off');
    expect(view.tone).toBe('off');
    expect(view.isWeeklyOff).toBe(true);
    expect(view.isAbsence).toBe(false);
  });

  it('calls a missed working day an absence, so the two never share a cell', () => {
    const view = describeDayOutcome(day({ is_absence: true, has_record: false, worked_seconds: 0 }));

    expect(view.headline).toBe('Absent');
    expect(view.tone).toBe('danger');
    expect(view.isAbsence).toBe(true);
  });

  it('names the holiday rather than saying "holiday"', () => {
    const view = describeDayOutcome(day({ kind: 'holiday', is_holiday: true, holiday_title: 'Independence Day' }));

    expect(view.headline).toBe('Independence Day');
    expect(view.tone).toBe('info');
  });

  it('separates a half-day leave from a full one', () => {
    expect(describeDayOutcome(day({ kind: 'leave', is_leave: true, leave_units: 0.5 })).headline).toBe('Half-day leave');
    expect(describeDayOutcome(day({ kind: 'leave', is_leave: true, leave_units: 1 })).headline).toBe('On leave');
  });

  it('says nothing at all about a day that has not happened', () => {
    const view = describeDayOutcome(day({ is_evaluated: false, has_record: false, worked_seconds: 0 }));

    expect(view.headline).toBe('');
    expect(view.tone).toBe('muted');
    expect(view.chips).toEqual([]);
  });
});

describe('describeDayOutcome — what the day cost, and why', () => {
  it('carries the engine reason verbatim for a half day', () => {
    const explanation =
      'Worked 3h 12m of a 8h 00m shift (40.00%), below the 50.00% rung — 0.50 day deducted. '
      + 'The policy treats penalties as loss of pay.';

    const view = describeDayOutcome(day({
      worked_seconds: 11520,
      penalisation: {
        status: 'half_day',
        explanation,
        reasons: [{ code: 'half_day_rung', message: explanation }],
        late: { is_late: false, late_seconds: 0, grace_period_minutes: 15 },
        hours: { worked_seconds: 11520, required_seconds: 28800, percent_of_shift: '40.00' },
        cost: { leaves_deducted: '0.50', is_lop: true, lop_days: '0.50', deduction_source: 'lop' },
      },
    }));

    expect(view.headline).toBe('Half day');
    expect(view.tone).toBe('warning');
    expect(view.reason).toBe(explanation);
    expect(view.chips.map((chip) => chip.label)).toContain('LOP 0.50 day');
  });

  it('never shows a penalty without a reason', () => {
    const view = describeDayOutcome(day({
      penalisation: {
        status: 'no_show',
        explanation: '',
        reasons: [],
        late: { is_late: false, late_seconds: 0, grace_period_minutes: 0 },
        hours: { worked_seconds: 1800, required_seconds: 28800, percent_of_shift: '6.25' },
        cost: { leaves_deducted: '1.00', is_lop: true, lop_days: '1.00', deduction_source: 'lop' },
      },
    }));

    expect(view.headline).toBe('No show');
    expect(view.reason).toBe('Worked 0h 30m of 8h 00m — 6.25% of the shift.');
  });

  it('marks a deduction taken from the leave balance as such, not as loss of pay', () => {
    const view = describeDayOutcome(day({
      penalisation: {
        status: 'half_day',
        explanation: 'Below the 50.00% rung.',
        reasons: [{ code: 'half_day_rung', message: 'Below the 50.00% rung.' }],
        late: { is_late: false, late_seconds: 0, grace_period_minutes: 0 },
        hours: { worked_seconds: 11520, required_seconds: 28800, percent_of_shift: '40.00' },
        cost: { leaves_deducted: '0.50', is_lop: false, lop_days: '0.00', deduction_source: 'leave_balance' },
      },
    }));

    const labels = view.chips.map((chip) => chip.label);
    expect(labels).toContain('0.50 day off leave balance');
    expect(labels.some((label) => label.startsWith('LOP'))).toBe(false);
  });

  it('reports a late arrival that cost nothing as late, not as clear', () => {
    const view = describeDayOutcome(day({
      penalisation: {
        status: 'late',
        explanation: 'Arrived 09:47:00, 0h 47m past the 09:00 start and beyond the 15 minute grace (policy grace).',
        reasons: [{ code: 'late_arrival', message: 'Arrived 09:47:00 …' }],
        late: { is_late: true, late_seconds: 2820, grace_period_minutes: 15 },
        hours: { worked_seconds: 28800, required_seconds: 28800, percent_of_shift: '100.00' },
        cost: { leaves_deducted: '0.00', is_lop: false, lop_days: '0.00', deduction_source: 'none' },
      },
    }));

    expect(view.headline).toBe('Late');
    expect(view.tone).toBe('warning');
    expect(view.chips.map((chip) => chip.label)).toContain('47m late');
    expect(view.reason).toContain('15 minute grace');
  });
});

describe('describeDayOutcome — overtime, counted and pending kept apart', () => {
  it('marks overtime awaiting approval as pending, in its own chip', () => {
    const view = describeDayOutcome(day({
      overtime: {
        scope: 'working_day',
        treatment: 'pay',
        approval_state: 'pending',
        counted_minutes: 0,
        pending_minutes: 90,
        raw_minutes: 90,
        multiplier: '1.50',
      },
    }));

    const pending = view.chips.find((chip) => chip.key === 'overtime_pending');
    expect(pending).toBeDefined();
    expect(pending?.label).toBe('1h 30m OT awaiting approval');
    expect(pending?.tone).toBe('warning');
    expect(view.chips.find((chip) => chip.key === 'overtime_counted')).toBeUndefined();
  });

  it('marks approved overtime as counted, with its own tone', () => {
    const view = describeDayOutcome(day({
      overtime: {
        scope: 'working_day',
        treatment: 'pay',
        approval_state: 'approved',
        counted_minutes: 90,
        pending_minutes: 0,
        raw_minutes: 90,
        multiplier: '1.50',
      },
    }));

    const counted = view.chips.find((chip) => chip.key === 'overtime_counted');
    expect(counted?.label).toBe('1h 30m OT at 1.50x');
    expect(counted?.tone).toBe('clear');
    expect(view.chips.find((chip) => chip.key === 'overtime_pending')).toBeUndefined();
  });

  it('names the scope when the overtime is not an ordinary working day', () => {
    const view = describeDayOutcome(day({
      kind: 'weekly_off',
      is_weekly_off: true,
      overtime: {
        scope: 'weekly_off',
        treatment: 'comp_off',
        approval_state: 'not_required',
        counted_minutes: 240,
        pending_minutes: 0,
        raw_minutes: 240,
        multiplier: '2.00',
      },
    }));

    const counted = view.chips.find((chip) => chip.key === 'overtime_counted');
    expect(counted?.label).toBe('4h 0m weekly-off OT as comp-off');
  });

  it('never sums pending into counted, even when both carry minutes', () => {
    const view = describeDayOutcome(day({
      overtime: {
        scope: 'working_day',
        treatment: 'pay',
        approval_state: 'pending',
        counted_minutes: 30,
        pending_minutes: 60,
        raw_minutes: 90,
        multiplier: '1.50',
      },
    }));

    expect(view.chips.find((chip) => chip.key === 'overtime_counted')?.label).toBe('30m OT at 1.50x');
    expect(view.chips.find((chip) => chip.key === 'overtime_pending')?.label).toBe('1h 0m OT awaiting approval');
  });

  it('says nothing about overtime when none accrued', () => {
    const view = describeDayOutcome(day());

    expect(view.chips.some((chip) => chip.key.startsWith('overtime'))).toBe(false);
  });
});

describe('describeDayOutcome — degrading without the payload', () => {
  it('returns a muted, silent view when no outcome was loaded for the date', () => {
    const view = describeDayOutcome(undefined);

    expect(view.headline).toBe('');
    expect(view.tone).toBe('muted');
    expect(view.reason).toBeNull();
    expect(view.chips).toEqual([]);
    expect(view.isWeeklyOff).toBe(false);
    expect(view.isAbsence).toBe(false);
  });
});
