import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import DayOutcomeLedger from '@/features/attendance/DayOutcomeLedger';
import type { DayOutcomePayload } from '@/lib/attendanceDayOutcome';

/**
 * The ledger is the dispute surface: the list somebody opens when they are told
 * a day cost them something and want to know which rule said so.
 *
 * So it is not allowed to (a) show a verdict without its reason, (b) show a
 * weekly off as if it were a missed day, or (c) present overtime that nobody
 * approved next to overtime that was, without saying which is which.
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
    explanation: '',
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

const halfDay = day({
  date: '2026-08-12',
  worked_seconds: 11520,
  penalisation: {
    status: 'half_day',
    explanation: 'Worked 3h 12m of a 8h 00m shift (40.00%), below the 50.00% rung — 0.50 day deducted.',
    reasons: [{ code: 'half_day_rung', message: 'below the 50.00% rung' }],
    late: { is_late: false, late_seconds: 0, grace_period_minutes: 15 },
    hours: { worked_seconds: 11520, required_seconds: 28800, percent_of_shift: '40.00' },
    cost: { leaves_deducted: '0.50', is_lop: true, lop_days: '0.50', deduction_source: 'lop' },
  },
});

const pendingOvertimeDay = day({
  date: '2026-08-13',
  overtime: {
    scope: 'working_day',
    treatment: 'pay',
    approval_state: 'pending',
    counted_minutes: 0,
    pending_minutes: 90,
    raw_minutes: 90,
    multiplier: '1.50',
  },
});

const countedOvertimeDay = day({
  date: '2026-08-14',
  overtime: {
    scope: 'working_day',
    treatment: 'pay',
    approval_state: 'approved',
    counted_minutes: 60,
    pending_minutes: 0,
    raw_minutes: 60,
    multiplier: '1.50',
  },
});

const weeklyOff = day({ date: '2026-08-16', kind: 'weekly_off', is_weekly_off: true, has_record: false, worked_seconds: 0 });

describe('DayOutcomeLedger', () => {
  it('shows a penalised day with the reason the engine gave, not just the verdict', () => {
    render(<DayOutcomeLedger days={[halfDay]} isLoading={false} />);

    const row = screen.getByTestId('day-outcome-2026-08-12');
    expect(within(row).getByText('Half day')).toBeInTheDocument();
    expect(within(row).getByText(/below the 50\.00% rung/)).toBeInTheDocument();
    expect(within(row).getByText('LOP 0.50 day')).toBeInTheDocument();
  });

  it('keeps overtime awaiting approval visually apart from overtime that counts', () => {
    render(<DayOutcomeLedger days={[pendingOvertimeDay, countedOvertimeDay]} isLoading={false} />);

    const pending = within(screen.getByTestId('day-outcome-2026-08-13')).getByText('1h 30m OT awaiting approval');
    const counted = within(screen.getByTestId('day-outcome-2026-08-14')).getByText('1h 0m OT at 1.50x');

    expect(pending).toBeInTheDocument();
    expect(counted).toBeInTheDocument();
    // Different chips, different tone classes — never the same treatment.
    expect(pending.className).not.toBe(counted.className);
  });

  it('leaves out days that cost nothing, so the list is only what needs answering', () => {
    render(<DayOutcomeLedger days={[day(), halfDay, weeklyOff]} isLoading={false} />);

    expect(screen.queryByTestId('day-outcome-2026-08-19')).not.toBeInTheDocument();
    expect(screen.queryByTestId('day-outcome-2026-08-16')).not.toBeInTheDocument();
    expect(screen.getByTestId('day-outcome-2026-08-12')).toBeInTheDocument();
  });

  it('says so plainly when the month has nothing to answer for', () => {
    render(<DayOutcomeLedger days={[day(), weeklyOff]} isLoading={false} />);

    expect(screen.getByText(/nothing to answer for/i)).toBeInTheDocument();
  });

  it('counts an absence as something to answer for', () => {
    const absent = day({
      date: '2026-08-11',
      is_absence: true,
      has_record: false,
      worked_seconds: 0,
      penalisation: {
        status: 'not_evaluated',
        explanation: 'No shift runs for this employee on 2026-08-11, so no penalisation rule applies.',
        reasons: [],
        late: { is_late: false, late_seconds: 0, grace_period_minutes: 0 },
        hours: { worked_seconds: 0, required_seconds: 28800, percent_of_shift: '0.00' },
        cost: { leaves_deducted: '0.00', is_lop: false, lop_days: '0.00', deduction_source: 'none' },
      },
    });

    render(<DayOutcomeLedger days={[absent]} isLoading={false} />);

    const row = screen.getByTestId('day-outcome-2026-08-11');
    expect(within(row).getByText('Absent')).toBeInTheDocument();
  });
});
