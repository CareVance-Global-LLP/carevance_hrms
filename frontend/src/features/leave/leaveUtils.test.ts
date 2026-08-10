import { describe, expect, it } from 'vitest';
import {
  isWorkingDay,
  makeCategoryColorOf,
  overlappingApproved,
  spansOverlap,
  workingDaysBetween,
} from '@/features/leave/leaveUtils';

// 2026-08-17 is a Monday; 2026-08-15/16 and 22/23 are the weekends around it.
const NO_HOLIDAYS = new Set<string>();

describe('workingDaysBetween', () => {
  it('counts a Monday-to-Friday week as five days', () => {
    expect(workingDaysBetween('2026-08-17', '2026-08-21', NO_HOLIDAYS)).toEqual({
      days: 5,
      skippedWeekend: 0,
      skippedHoliday: 0,
    });
  });

  it('skips weekends inside the range', () => {
    // Fri 14th → Mon 17th spans one weekend.
    expect(workingDaysBetween('2026-08-14', '2026-08-17', NO_HOLIDAYS)).toEqual({
      days: 2,
      skippedWeekend: 2,
      skippedHoliday: 0,
    });
  });

  it('skips holidays and reports them separately from weekends', () => {
    const holidays = new Set(['2026-08-19']);
    expect(workingDaysBetween('2026-08-17', '2026-08-21', holidays)).toEqual({
      days: 4,
      skippedWeekend: 0,
      skippedHoliday: 1,
    });
  });

  it('returns zero for an inverted or unparseable range', () => {
    expect(workingDaysBetween('2026-08-21', '2026-08-17', NO_HOLIDAYS).days).toBe(0);
    expect(workingDaysBetween('garbage', '2026-08-21', NO_HOLIDAYS).days).toBe(0);
  });

  it('does not lock up on a runaway range', () => {
    const result = workingDaysBetween('2020-01-01', '2030-01-01', NO_HOLIDAYS);
    // Guarded at 400 iterations — the point is that it terminates.
    expect(result.days + result.skippedWeekend + result.skippedHoliday).toBeLessThanOrEqual(400);
  });
});

describe('isWorkingDay', () => {
  it('rejects weekends and holidays, accepts weekdays', () => {
    expect(isWorkingDay('2026-08-15', NO_HOLIDAYS)).toBe(false); // Saturday
    expect(isWorkingDay('2026-08-17', NO_HOLIDAYS)).toBe(true); // Monday
    expect(isWorkingDay('2026-08-17', new Set(['2026-08-17']))).toBe(false);
  });
});

describe('spansOverlap', () => {
  it('detects touching and containing spans, rejects disjoint ones', () => {
    expect(spansOverlap('2026-08-10', '2026-08-12', '2026-08-12', '2026-08-14')).toBe(true);
    expect(spansOverlap('2026-08-01', '2026-08-31', '2026-08-10', '2026-08-11')).toBe(true);
    expect(spansOverlap('2026-08-10', '2026-08-12', '2026-08-13', '2026-08-14')).toBe(false);
  });
});

describe('overlappingApproved', () => {
  const requests = [
    { status: 'approved', user: { id: 2, name: 'Zara' }, start_date: '2026-08-18', end_date: '2026-08-20' },
    { status: 'pending', user: { id: 3, name: 'Amit' }, start_date: '2026-08-18', end_date: '2026-08-20' },
    { status: 'approved', user: { id: 1, name: 'Me' }, start_date: '2026-08-18', end_date: '2026-08-20' },
    { status: 'approved', user: { id: 4, name: 'Priya' }, start_date: '2026-09-01', end_date: '2026-09-02' },
  ];

  it('returns only approved, overlapping requests from other people', () => {
    const overlaps = overlappingApproved(requests, '2026-08-19', '2026-08-19', 1);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0].user.name).toBe('Zara');
  });
});

describe('makeCategoryColorOf', () => {
  it('gives each category a stable colour and unpaid the debt colour', () => {
    const colorOf = makeCategoryColorOf([{ code: 'casual' }, { code: 'sick' }]);
    expect(colorOf('casual')).not.toBe(colorOf('sick'));
    expect(colorOf('CASUAL')).toBe(colorOf('casual'));
    expect(colorOf('unpaid')).toBe('#9E4045');
    expect(colorOf('unknown')).toBe('#6B757D');
  });
});
