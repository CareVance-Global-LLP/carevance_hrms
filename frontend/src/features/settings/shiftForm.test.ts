import { describe, expect, it } from 'vitest';
import {
  SHIFT_DAY_OPTIONS,
  createEmptyShiftDraft,
  describeShiftWindow,
  formatSpanMinutes,
  shiftExpectedWorkSeconds,
  shiftSpanMinutes,
  toggleShiftDay,
  validateShiftDraft,
} from './shiftForm';

describe('shiftSpanMinutes', () => {
  it('measures a normal day', () => {
    expect(shiftSpanMinutes('09:00', '18:00')).toBe(540);
  });

  it('rolls a night shift forward to the next calendar day', () => {
    // 22:00 -> 06:00 is eight hours. Subtracting the two clock readings gives
    // minus sixteen, which is the whole reason bare TIME columns are not
    // arithmetic.
    expect(shiftSpanMinutes('22:00', '06:00')).toBe(480);
  });

  it('treats an identical start and end as a full twenty-four hours, not zero', () => {
    expect(shiftSpanMinutes('09:00', '09:00')).toBe(24 * 60);
  });

  it('accepts seconds on the wire and returns null for anything unparseable', () => {
    expect(shiftSpanMinutes('09:30:00', '18:00:00')).toBe(510);
    expect(shiftSpanMinutes('', '18:00')).toBeNull();
    expect(shiftSpanMinutes('nine', '18:00')).toBeNull();
    expect(shiftSpanMinutes('25:00', '18:00')).toBeNull();
    expect(shiftSpanMinutes('09:60', '18:00')).toBeNull();
  });
});

describe('shiftExpectedWorkSeconds', () => {
  it('takes the unpaid break out of the span', () => {
    // A 09:00-18:00 shift with an hour's break IS the eight-hour day the old
    // global constant assumed, which is why the constant looked right for so
    // long. A 09:00-18:00 with no break is nine.
    expect(shiftExpectedWorkSeconds('09:00', '18:00', 60)).toBe(8 * 3600);
    expect(shiftExpectedWorkSeconds('09:00', '18:00', 0)).toBe(9 * 3600);
  });

  it('works across midnight', () => {
    expect(shiftExpectedWorkSeconds('22:00', '06:00', 60)).toBe(7 * 3600);
  });

  it('is null when the times are not usable', () => {
    expect(shiftExpectedWorkSeconds('', '06:00', 60)).toBeNull();
  });

  it('never goes negative when the break swallows the shift', () => {
    expect(shiftExpectedWorkSeconds('09:00', '10:00', 120)).toBe(0);
  });
});

describe('formatSpanMinutes', () => {
  it('reads as hours and minutes', () => {
    expect(formatSpanMinutes(540)).toBe('9h');
    expect(formatSpanMinutes(510)).toBe('8h 30m');
    expect(formatSpanMinutes(45)).toBe('45m');
    expect(formatSpanMinutes(null)).toBe('--');
  });
});

describe('describeShiftWindow', () => {
  it('says out loud when the shift finishes on the next day', () => {
    expect(describeShiftWindow('22:00', '06:00')).toBe('22:00 to 06:00 the next day');
    expect(describeShiftWindow('09:00', '18:00')).toBe('09:00 to 18:00');
    expect(describeShiftWindow('09:00', '')).toBe('');
  });
});

describe('toggleShiftDay', () => {
  it('adds and removes, keeping the canonical week order', () => {
    expect(toggleShiftDay([], 'wednesday')).toEqual(['wednesday']);
    expect(toggleShiftDay(['wednesday'], 'monday')).toEqual(['monday', 'wednesday']);
    expect(toggleShiftDay(['monday', 'wednesday'], 'monday')).toEqual(['wednesday']);
  });

  it('offers the seven days starting on Monday', () => {
    expect(SHIFT_DAY_OPTIONS.map((day) => day.value)).toEqual([
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ]);
  });
});

describe('validateShiftDraft', () => {
  const valid = { ...createEmptyShiftDraft(), name: 'General', code: 'GEN' };

  it('accepts a complete draft', () => {
    expect(validateShiftDraft(valid)).toEqual({});
  });

  it('requires a name and a code', () => {
    const errors = validateShiftDraft({ ...valid, name: '  ', code: '' });
    expect(errors.name).toBeTruthy();
    expect(errors.code).toBeTruthy();
  });

  it('refuses a code the API would reject on length', () => {
    expect(validateShiftDraft({ ...valid, code: 'X'.repeat(51) }).code).toBeTruthy();
  });

  it('refuses unparseable times', () => {
    expect(validateShiftDraft({ ...valid, start_time: '' }).start_time).toBeTruthy();
    expect(validateShiftDraft({ ...valid, end_time: '99:99' }).end_time).toBeTruthy();
  });

  it('refuses a break longer than the shift, which would price the day at zero', () => {
    const errors = validateShiftDraft({ ...valid, start_time: '09:00', end_time: '10:00', break_minutes: '90' });
    expect(errors.break_minutes).toBeTruthy();
  });

  it('refuses negative or non-numeric minute fields', () => {
    expect(validateShiftDraft({ ...valid, break_minutes: '-5' }).break_minutes).toBeTruthy();
    expect(validateShiftDraft({ ...valid, grace_minutes: 'ten' }).grace_minutes).toBeTruthy();
  });

  it('accepts an empty day list, which means the shift runs every day', () => {
    expect(validateShiftDraft({ ...valid, applicable_days: [] })).toEqual({});
  });
});
