/**
 * The one way the dashboard splits a population by attendance status.
 *
 * Every chart that divides people by attendance must use this, because the bug
 * it exists to prevent is two widgets disagreeing about the same number.
 * Measured 17 Aug 2026: the overview chart listed "Present" (which already
 * included the late people) beside a separate "Present Late" slice and left out
 * on-leave entirely, so 88 absent out of 92 read as 96% on the KPI card and 98%
 * in the chart directly below it.
 *
 * That first fix took four pre-counted totals and clamped their sum to the
 * headcount before taking the remainder. It held for a single day and broke for
 * every range. Over a fortnight the same person is late on Tuesday, on time on
 * Wednesday and on leave on Thursday, so the four inputs overlap by
 * construction; the clamp turned a negative remainder into a confident zero.
 * Measured 18 Aug 2026 across July: 92 - 4 - 79 - 32 = -23, rendered as
 * "Absent 0" for a month in which most of the organisation was absent most
 * days, while the chart beside it divided the same 79 late people by the
 * overlapping sum of 115 and printed 69% against the card's 86%.
 *
 * So this takes people rather than counts, and puts each person in exactly one
 * bucket. The remainder cannot go negative because nobody is counted twice, and
 * every percentage divides by the same headcount.
 */

/** What the range says about one person. Each flag means "on at least one day". */
export interface PersonAttendanceFacts {
  userId: number;
  /** Present on at least one day in the range. */
  hasAttendance: boolean;
  /** Arrived late on at least one day in the range. */
  wasLate: boolean;
  /** Holds approved leave overlapping the range. */
  hasApprovedLeave: boolean;
}

export type AttendanceSliceKey = 'present_on_time' | 'present_late' | 'on_leave' | 'absent';

export interface AttendanceBreakdownSlice {
  key: AttendanceSliceKey;
  label: string;
  value: number;
  /** Against the headcount, so the four always total 100. */
  percent: number;
}

export interface AttendanceBreakdown {
  slices: AttendanceBreakdownSlice[];
  /** On-time plus late. The KPI card's "Present". */
  present: number;
  presentPercent: number;
  totalEmployees: number;
}

/**
 * Precedence, highest first. Attendance outranks leave because someone who
 * turned up did turn up, whatever else the range holds for them; and late
 * outranks on-time because the question the card answers is "did this person
 * ever arrive late", not "were they usually punctual".
 */
const classify = (person: PersonAttendanceFacts): AttendanceSliceKey => {
  if (person.hasAttendance && person.wasLate) return 'present_late';
  if (person.hasAttendance) return 'present_on_time';
  if (person.hasApprovedLeave) return 'on_leave';
  return 'absent';
};

/**
 * Round percentages so they still total 100.
 *
 * Rounding each independently drifts — three equal thirds round to 33 and lose
 * a point — and a legend that reads 99% next to a full bar looks broken. Give
 * every slice its floor, then hand the leftover points to the largest
 * fractional parts.
 */
const distributePercentages = (values: number[], total: number): number[] => {
  if (total <= 0) return values.map(() => 0);

  const exact = values.map((value) => (value / total) * 100);
  const floors = exact.map(Math.floor);
  let remaining = 100 - floors.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((left, right) => right.fraction - left.fraction);

  const result = [...floors];
  for (const { index } of order) {
    if (remaining <= 0) break;
    result[index] += 1;
    remaining -= 1;
  }

  return result;
};

export function buildAttendanceBreakdown(
  people: PersonAttendanceFacts[],
  totalEmployees: number
): AttendanceBreakdown {
  const headcount = Math.max(0, Math.trunc(totalEmployees) || 0);

  const counted: Record<AttendanceSliceKey, number> = {
    present_on_time: 0,
    present_late: 0,
    on_leave: 0,
    absent: 0,
  };

  const seen = new Set<number>();
  for (const person of people) {
    if (seen.has(person.userId)) continue;
    seen.add(person.userId);
    counted[classify(person)] += 1;
  }

  /*
   * Anyone the rows never mentioned is absent, not missing. The rows come from
   * the attendance report, which only returns people it has something to say
   * about — so without this a quiet department would simply vanish from the
   * chart rather than showing up as the absence it is.
   */
  const accountedFor = counted.present_on_time + counted.present_late + counted.on_leave;
  counted.absent = Math.max(counted.absent, headcount - accountedFor);

  const ordered: Array<{ key: AttendanceSliceKey; label: string }> = [
    { key: 'present_on_time', label: 'Present on time' },
    { key: 'present_late', label: 'Present Late' },
    { key: 'on_leave', label: 'On leave' },
    { key: 'absent', label: 'Absent' },
  ];

  const values = ordered.map((slice) => counted[slice.key]);
  const percents = distributePercentages(values, headcount);

  const present = counted.present_on_time + counted.present_late;

  return {
    slices: ordered.map((slice, index) => ({
      key: slice.key,
      label: slice.label,
      value: values[index],
      percent: percents[index],
    })),
    present,
    presentPercent: headcount > 0 ? Math.round((present / headcount) * 100) : 0,
    totalEmployees: headcount,
  };
}
