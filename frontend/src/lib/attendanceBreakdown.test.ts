import { describe, expect, it } from 'vitest';
import {
  buildAttendanceBreakdown,
  type PersonAttendanceFacts,
} from '@/lib/attendanceBreakdown';

const sum = (slices: { value: number }[]) => slices.reduce((total, slice) => total + slice.value, 0);

const person = (over: Partial<PersonAttendanceFacts> & { userId: number }): PersonAttendanceFacts => ({
  hasAttendance: false,
  wasLate: false,
  hasApprovedLeave: false,
  ...over,
});

const valueOf = (result: ReturnType<typeof buildAttendanceBreakdown>, key: string) =>
  result.slices.find((slice) => slice.key === key)?.value;

describe('buildAttendanceBreakdown', () => {
  it('accounts for every employee exactly once', () => {
    const result = buildAttendanceBreakdown(
      [person({ userId: 1, wasLate: true, hasAttendance: true }), ...Array.from({ length: 3 }, (_, i) => person({ userId: 10 + i, hasApprovedLeave: true }))],
      92
    );

    expect(sum(result.slices)).toBe(92);
    expect(valueOf(result, 'absent')).toBe(88);
  });

  it('does not count a late employee as present twice', () => {
    /*
     * The original bug this module was written for. "Present" was on-time plus
     * late and sat beside a separate "Present Late" slice, so anyone late was
     * in the chart twice — which is what made the same 88 absent people read
     * as 96% on one widget and 98% on another.
     */
    const result = buildAttendanceBreakdown(
      [
        ...Array.from({ length: 4 }, (_, i) => person({ userId: i + 1, hasAttendance: true })),
        ...Array.from({ length: 2 }, (_, i) => person({ userId: 20 + i, hasAttendance: true, wasLate: true })),
        person({ userId: 30, hasApprovedLeave: true }),
      ],
      10
    );

    expect(sum(result.slices)).toBe(10);
    expect(result.slices.map((slice) => slice.value)).toEqual([4, 2, 1, 3]);
  });

  it('keeps percentages against the headcount totalling 100', () => {
    const result = buildAttendanceBreakdown(
      [person({ userId: 1, wasLate: true, hasAttendance: true }), ...Array.from({ length: 3 }, (_, i) => person({ userId: 10 + i, hasApprovedLeave: true }))],
      92
    );

    const percents = result.slices.map((slice) => slice.percent);
    expect(percents.reduce((total, value) => total + value, 0)).toBe(100);
  });

  it('resolves overlapping states by classifying each person once, without clamping', () => {
    /*
     * Replaces the old clamp. A person can hold an approved leave day and a
     * late punch inside the same range, and the previous fix let the inputs
     * exceed the headcount and then clamped the remainder to zero. Over a
     * multi-day range that overlap is the norm, not the exception, and the
     * clamp is what rendered "Absent 0" across a July in which most of the
     * org was absent most days. Classify each person once instead, and the
     * remainder cannot go negative in the first place.
     */
    const result = buildAttendanceBreakdown(
      Array.from({ length: 3 }, (_, i) =>
        person({ userId: i + 1, hasAttendance: true, wasLate: true, hasApprovedLeave: true })
      ),
      3
    );

    expect(valueOf(result, 'present_late')).toBe(3);
    expect(valueOf(result, 'on_leave')).toBe(0);
    expect(valueOf(result, 'absent')).toBe(0);
    expect(sum(result.slices)).toBe(3);
  });

  it('reports the real absent count for a range where most people were also late', () => {
    // The July shape from the audit: 79 late, 4 on time, leave overlapping
    // heavily with both. The old arithmetic gave 92-4-79-32 = -23 -> 0.
    const people = [
      ...Array.from({ length: 79 }, (_, i) =>
        person({ userId: i + 1, hasAttendance: true, wasLate: true, hasApprovedLeave: i < 25 })
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        person({ userId: 100 + i, hasAttendance: true, hasApprovedLeave: i < 2 })
      ),
      ...Array.from({ length: 5 }, (_, i) => person({ userId: 200 + i, hasApprovedLeave: true })),
      ...Array.from({ length: 4 }, (_, i) => person({ userId: 300 + i })),
    ];

    const result = buildAttendanceBreakdown(people, 92);

    expect(valueOf(result, 'present_late')).toBe(79);
    expect(valueOf(result, 'present_on_time')).toBe(4);
    expect(valueOf(result, 'on_leave')).toBe(5);
    expect(valueOf(result, 'absent')).toBe(4);
    expect(sum(result.slices)).toBe(92);
  });

  it('counts someone present on some days and on leave on others as present only', () => {
    const result = buildAttendanceBreakdown(
      [person({ userId: 1, hasAttendance: true, hasApprovedLeave: true })],
      1
    );

    expect(valueOf(result, 'present_on_time')).toBe(1);
    expect(valueOf(result, 'on_leave')).toBe(0);
  });

  it('treats people missing from the rows as absent rather than losing them', () => {
    const result = buildAttendanceBreakdown([person({ userId: 1, hasAttendance: true })], 10);

    expect(valueOf(result, 'present_on_time')).toBe(1);
    expect(valueOf(result, 'absent')).toBe(9);
  });

  it('treats an empty organisation as empty rather than dividing by it', () => {
    const result = buildAttendanceBreakdown([], 0);

    expect(sum(result.slices)).toBe(0);
    expect(result.slices).toHaveLength(4);
    expect(result.slices.every((slice) => slice.percent === 0)).toBe(true);
  });

  it('exposes present as on-time plus late so the KPI card and the chart agree', () => {
    const result = buildAttendanceBreakdown(
      [
        person({ userId: 1, hasAttendance: true }),
        person({ userId: 2, hasAttendance: true, wasLate: true }),
      ],
      4
    );

    expect(result.present).toBe(2);
    expect(result.presentPercent).toBe(50);
  });
});
