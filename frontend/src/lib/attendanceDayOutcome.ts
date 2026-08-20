/**
 * One day of attendance, turned into what a cell is allowed to say.
 *
 * The engines behind `GET /attendance/day-outcomes` already decide correctly.
 * What kept going wrong was the last inch: the calendar drew the same grey cell
 * for a weekly off and for an unexplained absence, and it could say "half day"
 * without ever saying which rung fired or what it measured. A penalty whose
 * working is invisible is a penalty nobody can dispute, and attendance
 * penalties are disputed constantly.
 *
 * So this file holds three rules, and nothing else in the UI is allowed to
 * re-decide them:
 *
 *   A WEEKLY OFF IS NOT AN ABSENCE. `isWeeklyOff` and `isAbsence` are separate
 *   booleans and never both true, so no caller can collapse them by accident.
 *
 *   COUNTED OVERTIME AND PENDING OVERTIME ARE SEPARATE CHIPS. They are never
 *   summed here, and there is no accessor that returns a single total. Keka's
 *   rule is "only approved hours will be considered", and the way that goes
 *   wrong is never loud — it is unapproved hours quietly folded into a number
 *   somebody then pays.
 *
 *   A PENALTY ALWAYS CARRIES ITS REASON. The engine writes the sentence; this
 *   passes it through untouched. If it ever arrives empty, a reason is built
 *   from the figures rather than showing a verdict with nothing behind it.
 *
 * Pure: no React, no dates from `now`, no formatting locale. Everything it
 * needs arrives in the payload.
 */

export type DayOutcomeTone = 'clear' | 'info' | 'warning' | 'danger' | 'muted' | 'off';

export interface DayOutcomeChip {
  key: string;
  label: string;
  tone: DayOutcomeTone;
  /** The long form, for a title attribute. */
  title?: string;
}

/** The day as `GET /attendance/day-outcomes` returns it. Loose on purpose —
 *  an older payload is missing keys rather than malformed, and a missing key
 *  must degrade to silence rather than to a wrong verdict. */
export interface DayOutcomePayload {
  date?: string;
  kind?: 'holiday' | 'weekly_off' | 'leave' | 'working' | 'not_rostered' | string;
  is_evaluated?: boolean;
  is_weekly_off?: boolean;
  is_holiday?: boolean;
  holiday_title?: string | null;
  is_leave?: boolean;
  leave_units?: number;
  is_absence?: boolean;
  has_record?: boolean;
  worked_seconds?: number;
  penalisation?: {
    status?: string;
    explanation?: string;
    reasons?: Array<{ code?: string; message?: string }>;
    late?: { is_late?: boolean; late_seconds?: number; grace_period_minutes?: number };
    hours?: { worked_seconds?: number; required_seconds?: number | null; percent_of_shift?: string | null };
    cost?: { leaves_deducted?: string; is_lop?: boolean; lop_days?: string; deduction_source?: string };
  };
  overtime?: {
    scope?: string;
    treatment?: string;
    approval_state?: string;
    counted_minutes?: number;
    pending_minutes?: number;
    raw_minutes?: number;
    multiplier?: string;
  };
}

export interface DayOutcomeView {
  /** The single phrase the cell shows. Empty when there is nothing to say. */
  headline: string;
  tone: DayOutcomeTone;
  /** The sentence behind a penalty. Null when the day cost nothing. */
  reason: string | null;
  chips: DayOutcomeChip[];
  isWeeklyOff: boolean;
  isAbsence: boolean;
}

const SILENT: DayOutcomeView = {
  headline: '',
  tone: 'muted',
  reason: null,
  chips: [],
  isWeeklyOff: false,
  isAbsence: false,
};

/** "1h 30m", "4h 0m", "30m" — the compact form a chip has room for. */
export const formatOutcomeMinutes = (minutes: number): string => {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  return hours > 0 ? `${hours}h ${rest}m` : `${rest}m`;
};

/** "8h 00m" — the padded form the engine uses in its own sentences, so a
 *  reason built here reads like one that came from the engine. */
const formatOutcomeSeconds = (seconds: number): string => {
  const total = Math.max(0, Math.round(Number(seconds) || 0));

  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, '0')}m`;
};

const SCOPE_WORDS: Record<string, string> = {
  weekly_off: 'weekly-off ',
  holiday: 'holiday ',
};

/** Statuses that cost something, or at least record a breach. */
const PENALISING = new Set(['late', 'half_day', 'full_day', 'no_show']);

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * The reason of last resort.
 *
 * Only reached when the engine sent a verdict with no sentence attached, which
 * should not happen — but a bare "No show" on a screen is worse than a reason
 * assembled from the same figures the verdict was made from.
 */
const reasonFromFigures = (day: DayOutcomePayload): string => {
  const worked = toNumber(day.penalisation?.hours?.worked_seconds ?? day.worked_seconds);
  const required = day.penalisation?.hours?.required_seconds;
  const percent = day.penalisation?.hours?.percent_of_shift;

  if (required === null || required === undefined) {
    return `Worked ${formatOutcomeSeconds(worked)}; no shift length is configured to measure it against.`;
  }

  const head = `Worked ${formatOutcomeSeconds(worked)} of ${formatOutcomeSeconds(toNumber(required))}`;

  return percent ? `${head} — ${percent}% of the shift.` : `${head}.`;
};

const overtimeChips = (day: DayOutcomePayload): DayOutcomeChip[] => {
  const overtime = day.overtime;
  if (!overtime) return [];

  const chips: DayOutcomeChip[] = [];
  const scopeWord = SCOPE_WORDS[String(overtime.scope || '')] ?? '';
  const counted = Math.max(0, Math.round(toNumber(overtime.counted_minutes)));
  const pending = Math.max(0, Math.round(toNumber(overtime.pending_minutes)));

  if (counted > 0) {
    const treatment = overtime.treatment === 'comp_off'
      ? ' as comp-off'
      : ` at ${overtime.multiplier || '1.00'}x`;

    chips.push({
      key: 'overtime_counted',
      label: `${formatOutcomeMinutes(counted)} ${scopeWord}OT${treatment}`,
      tone: 'clear',
      title: overtime.approval_state === 'approved'
        ? 'Approved overtime — counted.'
        : 'Overtime this policy counts without a separate approval.',
    });
  }

  // Deliberately a second chip rather than a bigger number on the first one.
  if (pending > 0) {
    chips.push({
      key: 'overtime_pending',
      label: `${formatOutcomeMinutes(pending)} ${scopeWord}OT awaiting approval`,
      tone: 'warning',
      title: 'Measured but not approved, so nothing counts yet and payroll may not use it.',
    });
  }

  return chips;
};

const costChips = (day: DayOutcomePayload): DayOutcomeChip[] => {
  const chips: DayOutcomeChip[] = [];
  const cost = day.penalisation?.cost;
  const late = day.penalisation?.late;

  if (late?.is_late) {
    chips.push({
      key: 'late',
      label: `${formatOutcomeMinutes(Math.round(toNumber(late.late_seconds) / 60))} late`,
      tone: 'warning',
      title: `Past the ${toNumber(late.grace_period_minutes)} minute grace.`,
    });
  }

  const lop = toNumber(cost?.lop_days);
  if (lop > 0) {
    chips.push({
      key: 'lop',
      label: `LOP ${cost?.lop_days} day`,
      tone: 'danger',
      title: 'Loss of pay — this reaches payroll.',
    });
  }

  const leaves = toNumber(cost?.leaves_deducted);
  if (leaves > 0 && cost?.deduction_source === 'leave_balance') {
    chips.push({
      key: 'leave_balance',
      label: `${cost?.leaves_deducted} day off leave balance`,
      tone: 'warning',
      title: 'The policy does not treat penalties as loss of pay, so this comes off the leave balance.',
    });
  }

  return chips;
};

/**
 * @param day the outcome for one date, or undefined when none was loaded —
 *   an unloaded month must look silent, never clear and never absent.
 */
export const describeDayOutcome = (day?: DayOutcomePayload | null): DayOutcomeView => {
  if (!day) return SILENT;

  // A day that has not finished has not been missed, so it says nothing at all.
  if (day.is_evaluated === false) {
    return { ...SILENT, isWeeklyOff: Boolean(day.is_weekly_off) };
  }

  const chips = [...costChips(day), ...overtimeChips(day)];
  const status = String(day.penalisation?.status || 'not_evaluated');
  const isWeeklyOff = Boolean(day.is_weekly_off);
  const isAbsence = Boolean(day.is_absence);

  const reason = PENALISING.has(status) || isAbsence
    ? (day.penalisation?.explanation?.trim() || reasonFromFigures(day))
    : null;

  const [headline, tone]: [string, DayOutcomeTone] = (() => {
    if (day.is_holiday) return [String(day.holiday_title || 'Holiday'), 'info'];
    if (isWeeklyOff) return ['Weekly off', 'off'];
    if (day.is_leave) return [toNumber(day.leave_units) < 1 ? 'Half-day leave' : 'On leave', 'info'];
    if (isAbsence) return ['Absent', 'danger'];

    switch (status) {
      case 'no_show': return ['No show', 'danger'];
      case 'full_day': return ['Full day lost', 'danger'];
      case 'half_day': return ['Half day', 'warning'];
      case 'late': return ['Late', 'warning'];
      case 'clear': return ['Present', 'clear'];
      default: return day.has_record ? ['Present', 'clear'] : ['', 'muted'];
    }
  })();

  return { headline, tone, reason, chips, isWeeklyOff, isAbsence };
};
