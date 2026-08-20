/**
 * The penalisation policy, and the half-day ladder that is its awkward half.
 *
 * Grace and late rules moved off the shift row because two teams on identical
 * timings can have different late rules. The part that does not fit a form
 * field at all is half-day: there is no single threshold in the documented
 * model, only an ORDERED LADDER of (percentage of shift hours worked) ->
 * (leaves deducted), read ascending, where the first rung the day falls BELOW
 * is the one that applies.
 *
 *   [{25%, 1.00}, {50%, 0.50}]
 *     worked 10%  -> below 25  -> a full day
 *     worked 40%  -> below 50  -> half a day
 *     worked 60%  -> clear
 *
 * Two consequences the editor has to enforce, because the server cannot tell
 * them from a deliberate rule:
 *
 *   - two rungs at the same percent means the second can never fire;
 *   - leaves must not RISE as the percent rises, or working more costs more.
 *
 * Everything here is pure so the pane can show a worked example while the rule
 * is typed. The arithmetic mirrors PenalisationEngine exactly — comparisons in
 * integer hundredths, the same exclusive `<` at each rung boundary, and the
 * same precedence of no-show over the ladder. A preview that disagreed with
 * the engine would be worse than no preview.
 */
import { formatSpanMinutes } from '../shiftForm';

export type LateRuleType = 'incident' | 'hours';
export type PenalisationCycle = 'weekly' | 'monthly';
export type HoursBasis = 'gross' | 'effective';

export const LATE_RULE_OPTIONS: ReadonlyArray<{ value: LateRuleType; label: string }> = [
  { value: 'incident', label: 'Late arrivals' },
  { value: 'hours', label: 'Late hours' },
];

export const CYCLE_OPTIONS: ReadonlyArray<{ value: PenalisationCycle; label: string }> = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
];

export const HOURS_BASIS_OPTIONS: ReadonlyArray<{ value: HoursBasis; label: string }> = [
  { value: 'effective', label: 'Effective hours' },
  { value: 'gross', label: 'Gross hours' },
];

/** One rung, held as the strings the inputs actually carry. */
export interface HalfDayRungDraft {
  percent: string;
  leaves: string;
}

export const createHalfDayRung = (): HalfDayRungDraft => ({ percent: '', leaves: '' });

export interface PenalisationDraft {
  name: string;
  description: string;
  grace_period_minutes: string;
  late_rule_type: LateRuleType;
  late_threshold: string;
  exemptions_per_cycle: string;
  cycle: PenalisationCycle;
  ignore_late_when_hours_met: boolean;
  hours_basis: HoursBasis;
  /** Blank means the organization runs no no-show rule, which is not a bar of zero. */
  no_show_below_hours: string;
  treat_penalties_as_lop: boolean;
  half_day_rules: HalfDayRungDraft[];
  is_default: boolean;
  is_active: boolean;
}

export const createEmptyPenalisationDraft = (): PenalisationDraft => ({
  name: '',
  description: '',
  grace_period_minutes: '0',
  late_rule_type: 'incident',
  late_threshold: '3',
  exemptions_per_cycle: '0',
  cycle: 'monthly',
  ignore_late_when_hours_met: false,
  hours_basis: 'effective',
  no_show_below_hours: '',
  treat_penalties_as_lop: false,
  half_day_rules: [],
  is_default: false,
  is_active: true,
});

// ---------------------------------------------------------------------------
// Decimal handling
//
// Hundredths of a unit, as integers, for the same reason the server holds these
// as decimals: 0.1 + 0.2 is not 0.3, and half a day of leave is a quantity
// somebody is paid on.
// ---------------------------------------------------------------------------

/** Hundredths, or null when the text is not a number at all. */
export const toHundredths = (value: string | number | null | undefined): number | null => {
  const text = String(value ?? '').trim();
  if (text === '' || !/^-?\d*(\.\d+)?$/.test(text) || text === '.' || text === '-') {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

/** Hundredths back to the two-decimal string the API and the eye both want. */
export const formatLeaves = (hundredths: number): string => {
  const sign = hundredths < 0 ? '-' : '';
  const whole = Math.abs(Math.trunc(hundredths));
  return `${sign}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, '0')}`;
};

/** "3.00" -> "3", "1.50" -> "1.5". For prose, never for a payload. */
const trimDecimal = (value: string | number): string => {
  const text = String(value ?? '').trim();
  if (!text.includes('.')) {
    return text;
  }
  return text.replace(/0+$/, '').replace(/\.$/, '');
};

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * Ascending percent — the order the rungs are read in. Out of order, a 25% day
 * would be judged by the 50% rung and cost half a day instead of a full one.
 * Rungs whose percent is unreadable keep their position at the end, where the
 * validator can still point at them.
 */
export const sortLadder = (rungs: readonly HalfDayRungDraft[]): HalfDayRungDraft[] =>
  [...rungs].sort((a, b) => {
    const left = toHundredths(a.percent);
    const right = toHundredths(b.percent);
    if (left === null && right === null) {
      return 0;
    }
    if (left === null) {
      return 1;
    }
    if (right === null) {
      return -1;
    }
    return left - right;
  });

/**
 * The rung a day falls under, or null when it clears them all.
 *
 * Exclusive at the boundary, exactly as `PenalisationEngine::rungFor` is: a day
 * that works precisely 25% of the shift is not BELOW the 25% rung.
 */
export const rungForPercentWorked = (
  rungs: readonly HalfDayRungDraft[],
  percentWorked: number
): HalfDayRungDraft | null => rungForHundredths(rungs, Math.round(percentWorked * 100));

const rungForHundredths = (
  rungs: readonly HalfDayRungDraft[],
  percentHundredths: number
): HalfDayRungDraft | null => {
  for (const rung of sortLadder(rungs)) {
    const bar = toHundredths(rung.percent);
    if (bar === null) {
      continue;
    }
    if (percentHundredths < bar) {
      return rung;
    }
  }
  return null;
};

/** Everything wrong with a ladder, in the words the editor shows. */
export const validateHalfDayLadder = (rungs: readonly HalfDayRungDraft[]): string[] => {
  const problems: string[] = [];
  const readable: Array<{ percent: number; leaves: number }> = [];

  rungs.forEach((rung, index) => {
    const position = index + 1;
    const percent = toHundredths(rung.percent);
    const leaves = toHundredths(rung.leaves);

    if (percent === null || leaves === null) {
      problems.push(`Rung ${position} needs a percentage and a number of leaves.`);
      return;
    }
    if (percent < 0 || percent > 10000) {
      problems.push(`Rung ${position} is a percentage of the shift — keep it between 0 and 100.`);
      return;
    }
    if (leaves < 0 || leaves > 9999) {
      problems.push(`Rung ${position} deducts an impossible number of leaves.`);
      return;
    }

    readable.push({ percent, leaves });
  });

  const seen = new Map<number, number>();
  for (const rung of readable) {
    seen.set(rung.percent, (seen.get(rung.percent) ?? 0) + 1);
  }
  for (const [percent, count] of seen) {
    if (count > 1) {
      problems.push(
        `Two rungs sit at ${trimDecimal(formatLeaves(percent))}% — the second can never fire, `
          + 'because the first rung the day falls below is the one that applies.'
      );
    }
  }

  const ascending = [...readable].sort((a, b) => a.percent - b.percent);
  for (let index = 1; index < ascending.length; index++) {
    if (ascending[index].leaves > ascending[index - 1].leaves) {
      problems.push(
        `The ${trimDecimal(formatLeaves(ascending[index].percent))}% rung deducts more than the `
          + `${trimDecimal(formatLeaves(ascending[index - 1].percent))}% rung, so working less costs less. `
          + 'A lower band should never cost less than a higher one.'
      );
      break;
    }
  }

  return problems;
};

// ---------------------------------------------------------------------------
// The worked example
// ---------------------------------------------------------------------------

export interface PenalisationExample {
  /** Expected working minutes of the rostered shift, on the policy's basis. */
  shiftMinutes: number;
  workedMinutes: number;
  /** Minutes past the shift start the employee arrived. */
  lateMinutes: number;
}

export type PenalisationStatus =
  | 'not_evaluated'
  | 'clear'
  | 'late'
  | 'half_day'
  | 'full_day'
  | 'no_show';

export interface PenalisationPreview {
  status: PenalisationStatus;
  graceMinutes: number;
  isLate: boolean;
  lateWaivedBy: 'hours_met' | null;
  hoursMet: boolean;
  /** Two decimals, or null when nothing is rostered to measure against. */
  percentWorked: string | null;
  isNoShow: boolean;
  /** The rung's percent exactly as it was entered, or null when none applied. */
  rungPercent: string | null;
  leavesDeducted: string;
  lopDays: string;
  deductedFrom: 'nothing' | 'leave balance' | 'loss of pay';
  lines: string[];
}

/**
 * One day judged by this draft, for the preview beside the editor.
 *
 * Deliberately a single day: a cycle needs a month of attendance and the
 * editor has none, so the exemption count and the late threshold are REPORTED
 * rather than simulated. Pretending to know how many late arrivals the cycle
 * already holds would be the kind of confident wrong answer this preview
 * exists to prevent.
 */
export const previewPenalisation = (
  draft: PenalisationDraft,
  example: PenalisationExample
): PenalisationPreview => {
  const lines: string[] = [];

  const grace = Math.max(0, Math.trunc(Number(draft.grace_period_minutes || 0)) || 0);
  const shiftMinutes = Math.max(0, Math.trunc(example.shiftMinutes) || 0);
  const workedMinutes = Math.max(0, Math.trunc(example.workedMinutes) || 0);
  const lateMinutes = Math.max(0, Math.trunc(example.lateMinutes) || 0);

  const isLate = lateMinutes > grace;
  const percentHundredths = shiftMinutes > 0
    ? Math.floor((workedMinutes * 10000) / shiftMinutes)
    : null;
  const hoursMet = shiftMinutes > 0 && workedMinutes >= shiftMinutes;

  if (isLate) {
    lines.push(
      `Arrived ${formatSpanMinutes(lateMinutes)} late, past the `
        + `${grace === 0 ? 'zero' : formatSpanMinutes(grace)} grace.`
    );
  } else if (lateMinutes > 0) {
    lines.push(
      `Arrived ${formatSpanMinutes(lateMinutes)} late, inside the ${formatSpanMinutes(grace)} grace — not counted.`
    );
  }

  let lateWaivedBy: PenalisationPreview['lateWaivedBy'] = null;
  if (isLate && draft.ignore_late_when_hours_met && hoursMet) {
    lateWaivedBy = 'hours_met';
    lines.push(
      `Late penalty waived: the full ${formatSpanMinutes(shiftMinutes)} of ${draft.hours_basis} hours was completed.`
    );
  } else if (isLate) {
    const exemptions = Math.max(0, Math.trunc(Number(draft.exemptions_per_cycle || 0)) || 0);
    const threshold = trimDecimal(String(draft.late_threshold ?? '').trim() || '0');
    const unit = draft.late_rule_type === 'hours' ? 'late hours' : 'late arrivals';
    lines.push(
      exemptions > 0
        ? `Counts towards the ${draft.cycle} cycle. The first ${exemptions} are exempt; the penalty starts at ${threshold} ${unit}.`
        : `Counts towards the ${draft.cycle} cycle. The penalty starts at ${threshold} ${unit}.`
    );
  }

  const noShowHundredths = toHundredths(draft.no_show_below_hours);
  const noShowBarMinutes = noShowHundredths === null
    ? null
    : Math.round((noShowHundredths * 60) / 100);
  const isNoShow = noShowBarMinutes !== null && workedMinutes < noShowBarMinutes;

  let leavesHundredths = 0;
  let rung: HalfDayRungDraft | null = null;

  if (isNoShow && noShowBarMinutes !== null) {
    leavesHundredths = 100;
    lines.push(
      `Worked ${formatSpanMinutes(workedMinutes)}, below the ${formatSpanMinutes(noShowBarMinutes)} `
        + 'no-show bar — the day is treated as a no show and costs 1.00 day.'
    );
  } else if (percentHundredths !== null) {
    rung = rungForHundredths(draft.half_day_rules, percentHundredths);
    if (rung) {
      leavesHundredths = toHundredths(rung.leaves) ?? 0;
      lines.push(
        `Worked ${formatSpanMinutes(workedMinutes)} of a ${formatSpanMinutes(shiftMinutes)} shift `
          + `(${formatLeaves(percentHundredths)}%), below the ${trimDecimal(rung.percent)}% rung — `
          + `${formatLeaves(leavesHundredths)} day deducted.`
      );
    } else {
      lines.push(
        `Worked ${formatSpanMinutes(workedMinutes)} of a ${formatSpanMinutes(shiftMinutes)} shift `
          + `(${formatLeaves(percentHundredths)}%) — above every rung, so nothing is deducted.`
      );
    }
  } else {
    lines.push('Nothing is rostered for this day, so there is no shift length to measure against.');
  }

  const isLop = draft.treat_penalties_as_lop && leavesHundredths > 0;
  if (leavesHundredths > 0) {
    lines.push(
      isLop
        ? 'The policy treats penalties as loss of pay, so this comes off pay.'
        : 'The policy does not treat penalties as loss of pay, so this comes off the leave balance.'
    );
  }

  const status: PenalisationStatus = (() => {
    if (percentHundredths === null && !isNoShow) {
      return 'not_evaluated';
    }
    if (isNoShow) {
      return 'no_show';
    }
    if (leavesHundredths >= 100) {
      return 'full_day';
    }
    if (leavesHundredths > 0) {
      return 'half_day';
    }
    return isLate ? 'late' : 'clear';
  })();

  if (lines.length === 0) {
    lines.push('Nothing to penalise.');
  }

  return {
    status,
    graceMinutes: grace,
    isLate,
    lateWaivedBy,
    hoursMet,
    percentWorked: percentHundredths === null ? null : formatLeaves(percentHundredths),
    isNoShow,
    rungPercent: rung ? rung.percent.trim() : null,
    leavesDeducted: formatLeaves(leavesHundredths),
    lopDays: formatLeaves(isLop ? leavesHundredths : 0),
    deductedFrom: leavesHundredths === 0 ? 'nothing' : isLop ? 'loss of pay' : 'leave balance',
    lines,
  };
};

// ---------------------------------------------------------------------------
// Validation and payload
// ---------------------------------------------------------------------------

export type PenalisationDraftErrors = Partial<
  Record<
    | 'name'
    | 'grace_period_minutes'
    | 'late_threshold'
    | 'exemptions_per_cycle'
    | 'no_show_below_hours'
    | 'half_day_rules',
    string
  >
>;

const wholeNumber = (value: string, max: number): number | null => {
  const text = String(value ?? '').trim();
  if (text === '') {
    return 0;
  }
  if (!/^\d+$/.test(text)) {
    return null;
  }
  const parsed = Number(text);
  return parsed <= max ? parsed : null;
};

export const validatePenalisationDraft = (draft: PenalisationDraft): PenalisationDraftErrors => {
  const errors: PenalisationDraftErrors = {};

  if (!draft.name.trim()) {
    errors.name = 'Give the policy a name people will recognise.';
  } else if (draft.name.trim().length > 255) {
    errors.name = 'Keep the name under 255 characters.';
  }

  if (wholeNumber(draft.grace_period_minutes, 1440) === null) {
    errors.grace_period_minutes = 'Grace is a whole number of minutes, up to 1440.';
  }

  const threshold = toHundredths(draft.late_threshold);
  if (threshold === null || threshold < 0 || threshold > 999999) {
    errors.late_threshold = draft.late_rule_type === 'hours'
      ? 'Enter the number of late hours that triggers the penalty.'
      : 'Enter the number of late arrivals that triggers the penalty.';
  }

  if (wholeNumber(draft.exemptions_per_cycle, 999) === null) {
    errors.exemptions_per_cycle = 'Exemptions are a whole number per cycle, up to 999.';
  }

  const noShow = String(draft.no_show_below_hours ?? '').trim();
  if (noShow !== '') {
    const hundredths = toHundredths(noShow);
    if (hundredths === null || hundredths < 0 || hundredths > 2400) {
      errors.no_show_below_hours = 'The no-show bar is a number of hours between 0 and 24. Leave it blank to run no no-show rule.';
    }
  }

  const ladder = validateHalfDayLadder(draft.half_day_rules);
  if (ladder.length > 0) {
    errors.half_day_rules = ladder.join(' ');
  }

  return errors;
};

/** The request body, from a draft the validator has already passed. */
export const penalisationDraftToPayload = (draft: PenalisationDraft): Record<string, unknown> => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  grace_period_minutes: Number(draft.grace_period_minutes || 0),
  late_rule_type: draft.late_rule_type,
  late_threshold: formatLeaves(toHundredths(draft.late_threshold) ?? 0),
  exemptions_per_cycle: Number(draft.exemptions_per_cycle || 0),
  cycle: draft.cycle,
  ignore_late_when_hours_met: draft.ignore_late_when_hours_met,
  hours_basis: draft.hours_basis,
  // Blank is "no no-show rule". Zero is a real bar nobody can fall under, and
  // collapsing the two would silently switch the rule on.
  no_show_below_hours: String(draft.no_show_below_hours ?? '').trim() === ''
    ? null
    : formatLeaves(toHundredths(draft.no_show_below_hours) ?? 0),
  treat_penalties_as_lop: draft.treat_penalties_as_lop,
  is_default: draft.is_default,
  is_active: draft.is_active,
  // Always sent, even empty — the server replaces the whole ladder with what
  // it receives, so omitting it would leave the old rungs in place.
  half_day_rules: sortLadder(draft.half_day_rules).map((rung, index) => ({
    sort_order: index,
    percent_of_shift_hours: formatLeaves(toHundredths(rung.percent) ?? 0),
    leaves_deducted: formatLeaves(toHundredths(rung.leaves) ?? 0),
  })),
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

export interface PenalisationPolicySummaryLike {
  grace_period_minutes: number | string;
  late_rule_type: string;
  late_threshold: number | string;
  exemptions_per_cycle: number | string;
  cycle: string;
}

/** The list row: the rule first, because the name never says what it does. */
export const describePenalisationPolicy = (policy: PenalisationPolicySummaryLike): string => {
  const grace = Math.max(0, Math.trunc(Number(policy.grace_period_minutes || 0)) || 0);
  const threshold = trimDecimal(String(policy.late_threshold ?? '0'));
  const exemptions = Math.max(0, Math.trunc(Number(policy.exemptions_per_cycle || 0)) || 0);
  const per = policy.cycle === 'weekly' ? 'a week' : 'a month';

  const unit = policy.late_rule_type === 'hours'
    ? `${threshold} late hours`
    : `${threshold} late ${Number(threshold) === 1 ? 'arrival' : 'arrivals'}`;

  const parts = [grace === 0 ? 'No grace' : `${grace}m grace`, `${unit} ${per}`];
  if (exemptions > 0) {
    parts.push(`${exemptions} exempt`);
  }

  return parts.join(' · ');
};
