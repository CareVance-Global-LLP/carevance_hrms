import { describe, expect, it } from 'vitest';
import {
  createEmptyShiftAllowanceDraft,
  describeShiftAllowancePolicy,
  nightMinutesInWindow,
  previewShiftAllowance,
  shiftAllowanceDraftToPayload,
  validateShiftAllowanceDraft,
} from './shiftAllowance';

describe('nightMinutesInWindow', () => {
  it('measures the overlap, not the label on the shift', () => {
    // An 18:00-02:00 shift is not "a night shift" to anybody's payroll — it
    // overlaps a 22:00-06:00 window by exactly four hours, and the policy's
    // minimum decides whether that pays.
    expect(nightMinutesInWindow('18:00', '02:00', '22:00', '06:00')).toBe(240);
  });

  it('measures the whole of a shift that sits inside the window', () => {
    expect(nightMinutesInWindow('22:00', '06:00', '22:00', '06:00')).toBe(480);
  });

  it('does not lose the half of a night shift that falls past midnight', () => {
    // The window has to be instantiated on the day before, the day itself and
    // the day after. Anchored to one day, this reads 120 instead of 420.
    expect(nightMinutesInWindow('20:00', '05:00', '22:00', '06:00')).toBe(420);
  });

  it('counts a shift that starts at midnight against the PREVIOUS day window', () => {
    // 00:00-06:00 on the attendance date sits entirely inside the window that
    // opened at 22:00 the night before. Instantiating the window only on the
    // attendance date reads this as zero and pays nothing for a whole night.
    expect(nightMinutesInWindow('00:00', '06:00', '22:00', '06:00')).toBe(360);
  });

  it('counts a shift that runs into the NEXT day window', () => {
    // 23:00-07:00 against a 00:00-06:00 window: the only instance that
    // overlaps opens the following midnight.
    expect(nightMinutesInWindow('23:00', '07:00', '00:00', '06:00')).toBe(360);
  });

  it('is zero for a day shift', () => {
    expect(nightMinutesInWindow('09:00', '18:00', '22:00', '06:00')).toBe(0);
  });

  it('handles a window that does not cross midnight', () => {
    expect(nightMinutesInWindow('08:00', '12:00', '09:00', '17:00')).toBe(180);
  });

  it('counts the whole shift when no window is configured', () => {
    // A policy that pays a night premium without saying what night is means
    // the shift itself is the night.
    expect(nightMinutesInWindow('09:00', '18:00', null, null)).toBe(540);
    expect(nightMinutesInWindow('22:00', '06:00', '', '')).toBe(480);
  });

  it('is null when the shift times cannot be read', () => {
    expect(nightMinutesInWindow('', '06:00', '22:00', '06:00')).toBeNull();
    expect(nightMinutesInWindow('22:00', 'six', '22:00', '06:00')).toBeNull();
  });
});

describe('previewShiftAllowance', () => {
  const nightPolicy = () => ({
    ...createEmptyShiftAllowanceDraft(),
    name: 'Night premium',
    night_allowance_type: 'percentage' as const,
    night_percentage: '15',
    night_window_start: '22:00',
    night_window_end: '06:00',
    night_minimum_minutes_in_window: '300',
  });

  it('pays nothing when the overlap is below the minimum, and still reports the overlap', () => {
    const preview = previewShiftAllowance(nightPolicy(), {
      shiftStart: '18:00',
      shiftEnd: '02:00',
      isWeeklyOff: false,
      baseAmount: '30000',
    });

    expect(preview.nightMinutesInWindow).toBe(240);
    expect(preview.nightApplies).toBe(false);
    // Four hours of night below a five-hour minimum has to stay
    // distinguishable from no night at all.
    expect(preview.nightAmount).toBe('0.00');
    expect(preview.lines.join(' ')).toContain('4h');
  });

  it('pays once the overlap reaches the minimum', () => {
    const preview = previewShiftAllowance(nightPolicy(), {
      shiftStart: '22:00',
      shiftEnd: '06:00',
      isWeeklyOff: false,
      baseAmount: '30000',
    });

    expect(preview.nightMinutesInWindow).toBe(480);
    expect(preview.nightApplies).toBe(true);
    expect(preview.nightRate).toBe('15.00');
    expect(preview.nightAmount).toBe('4500.00');
  });

  it('still requires one minute inside the window when the minimum is zero', () => {
    // "Any overlap qualifies" is not "no overlap qualifies" — the server takes
    // max(1, minimum) for exactly this.
    const preview = previewShiftAllowance(
      { ...nightPolicy(), night_minimum_minutes_in_window: '0' },
      { shiftStart: '09:00', shiftEnd: '18:00', isWeeklyOff: false, baseAmount: '30000' }
    );

    expect(preview.nightMinutesInWindow).toBe(0);
    expect(preview.nightApplies).toBe(false);
  });

  it('quantifies a fixed premium without any base amount', () => {
    const preview = previewShiftAllowance(
      {
        ...nightPolicy(),
        night_allowance_type: 'fixed',
        night_fixed: '250',
        night_minimum_minutes_in_window: '0',
      },
      { shiftStart: '22:00', shiftEnd: '06:00', isWeeklyOff: false, baseAmount: '' }
    );

    expect(preview.nightAmount).toBe('250.00');
    expect(preview.totalAmount).toBe('250.00');
  });

  it('leaves a percentage premium unquantified with no base, rather than calling it zero', () => {
    // The premium is earned; only a caller holding the salary structure can
    // say what it bites on. Zero would be a lie in the other direction.
    const preview = previewShiftAllowance(nightPolicy(), {
      shiftStart: '22:00',
      shiftEnd: '06:00',
      isWeeklyOff: false,
      baseAmount: '',
    });

    expect(preview.nightApplies).toBe(true);
    expect(preview.nightRate).toBe('15.00');
    expect(preview.nightAmount).toBeNull();
    expect(preview.totalAmount).toBeNull();
  });

  it('rounds the money once, half up', () => {
    const preview = previewShiftAllowance(
      { ...nightPolicy(), night_percentage: '10', night_minimum_minutes_in_window: '0' },
      { shiftStart: '22:00', shiftEnd: '06:00', isWeeklyOff: false, baseAmount: '100.05' }
    );

    expect(preview.nightAmount).toBe('10.01');
  });

  it('pays the weekend premium only on a weekly off', () => {
    const draft = {
      ...createEmptyShiftAllowanceDraft(),
      name: 'Weekend',
      weekend_allowance_type: 'fixed' as const,
      weekend_fixed: '500',
    };

    expect(
      previewShiftAllowance(draft, {
        shiftStart: '09:00',
        shiftEnd: '18:00',
        isWeeklyOff: false,
        baseAmount: '',
      }).weekendApplies
    ).toBe(false);

    const off = previewShiftAllowance(draft, {
      shiftStart: '09:00',
      shiftEnd: '18:00',
      isWeeklyOff: true,
      baseAmount: '',
    });
    expect(off.weekendApplies).toBe(true);
    expect(off.weekendAmount).toBe('500.00');
  });

  it('adds the two premiums together', () => {
    const draft = {
      ...nightPolicy(),
      night_minimum_minutes_in_window: '0',
      weekend_allowance_type: 'fixed' as const,
      weekend_fixed: '500',
    };

    const preview = previewShiftAllowance(draft, {
      shiftStart: '22:00',
      shiftEnd: '06:00',
      isWeeklyOff: true,
      baseAmount: '30000',
    });

    expect(preview.nightAmount).toBe('4500.00');
    expect(preview.weekendAmount).toBe('500.00');
    expect(preview.totalAmount).toBe('5000.00');
  });

  it('pays nothing at all when the policy is configured to pay nothing', () => {
    const preview = previewShiftAllowance(createEmptyShiftAllowanceDraft(), {
      shiftStart: '22:00',
      shiftEnd: '06:00',
      isWeeklyOff: true,
      baseAmount: '30000',
    });

    expect(preview.nightApplies).toBe(false);
    expect(preview.weekendApplies).toBe(false);
    expect(preview.totalAmount).toBe('0.00');
  });
});

describe('validateShiftAllowanceDraft', () => {
  it('requires a name', () => {
    expect(validateShiftAllowanceDraft(createEmptyShiftAllowanceDraft()).name).toBeTruthy();
  });

  it('refuses half a night window, because half a window means the whole shift', () => {
    const draft = {
      ...createEmptyShiftAllowanceDraft(),
      name: 'x',
      night_allowance_type: 'percentage' as const,
      night_percentage: '15',
      night_window_start: '22:00',
      night_window_end: '',
    };

    expect(validateShiftAllowanceDraft(draft).night_window_end).toBeTruthy();
  });

  it('accepts no window at all', () => {
    const draft = {
      ...createEmptyShiftAllowanceDraft(),
      name: 'x',
      night_allowance_type: 'percentage' as const,
      night_percentage: '15',
    };

    expect(validateShiftAllowanceDraft(draft)).toEqual({});
  });

  it('rejects a premium of nothing when the type says it pays', () => {
    const draft = {
      ...createEmptyShiftAllowanceDraft(),
      name: 'x',
      night_allowance_type: 'percentage' as const,
      night_percentage: '0',
    };

    expect(validateShiftAllowanceDraft(draft).night_percentage).toBeTruthy();
  });

  it('does not ask for a rate on a premium that is switched off', () => {
    const draft = { ...createEmptyShiftAllowanceDraft(), name: 'x' };
    expect(validateShiftAllowanceDraft(draft).night_percentage).toBeUndefined();
  });
});

describe('shiftAllowanceDraftToPayload', () => {
  it('sends decimal strings and a blank window as null', () => {
    const draft = {
      ...createEmptyShiftAllowanceDraft(),
      name: '  Night  ',
      night_allowance_type: 'percentage' as const,
      night_percentage: '15',
      night_minimum_minutes_in_window: '300',
    };

    const payload = shiftAllowanceDraftToPayload(draft) as Record<string, unknown>;

    expect(payload.name).toBe('Night');
    expect(payload.night_percentage).toBe('15.00');
    expect(payload.night_window_start).toBeNull();
    expect(payload.night_window_end).toBeNull();
    expect(payload.night_minimum_minutes_in_window).toBe(300);
  });

  it('sends the window as HH:MM', () => {
    const draft = {
      ...createEmptyShiftAllowanceDraft(),
      name: 'Night',
      night_window_start: '22:00:00',
      night_window_end: '06:00',
    };

    const payload = shiftAllowanceDraftToPayload(draft) as Record<string, unknown>;
    expect(payload.night_window_start).toBe('22:00');
    expect(payload.night_window_end).toBe('06:00');
  });
});

describe('describeShiftAllowancePolicy', () => {
  it('says what it pays and when', () => {
    expect(
      describeShiftAllowancePolicy({
        night_allowance_type: 'percentage',
        night_percentage: '15.00',
        night_fixed: '0.00',
        night_window_start: '22:00:00',
        night_window_end: '06:00:00',
        weekend_allowance_type: 'fixed',
        weekend_percentage: '0.00',
        weekend_fixed: '500.00',
      })
    ).toBe('Night 15% between 22:00 and 06:00 the next day · Weekend 500 fixed');
  });

  it('says plainly when it pays nothing', () => {
    expect(
      describeShiftAllowancePolicy({
        night_allowance_type: 'none',
        night_percentage: '0.00',
        night_fixed: '0.00',
        night_window_start: null,
        night_window_end: null,
        weekend_allowance_type: 'none',
        weekend_percentage: '0.00',
        weekend_fixed: '0.00',
      })
    ).toBe('No premium configured');
  });
});
