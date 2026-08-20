/**
 * The overtime policy: a basis, a threshold, a rounding rule, an approval gate
 * — and three INDEPENDENT scopes, each choosing pay or comp-off at its own
 * rate.
 *
 * Working Day, Weekly Off and Holiday are not three columns. Each is a row,
 * and a scope can hold several rows: an extended tier is another row with a
 * higher `applies_after_minutes`, and a festive rate is another row with a
 * validity window. That is why this file talks about "rates" rather than "the
 * multiplier".
 *
 * The order of operations is the part worth getting right, because every step
 * changes the answer and they do not commute:
 *
 *   worked - expected  ->  raw
 *   raw < minimum      ->  nothing accrues at all
 *   round(raw)         ->  the payable figure
 *   rate is chosen from the ROUNDED figure, not the raw one
 *
 * OvertimeEngine does exactly that, and the preview here mirrors it step for
 * step so the editor cannot promise a figure the engine will not produce.
 */
import { formatSpanMinutes } from '../shiftForm';

export type OvertimeScope = 'working_day' | 'weekly_off' | 'holiday';
export type OvertimeTreatment = 'pay' | 'comp_off';
export type OvertimeRounding = 'up' | 'down' | 'nearest';
export type OvertimeBasis = 'gross' | 'effective';

export const OVERTIME_SCOPES: ReadonlyArray<{
  value: OvertimeScope;
  label: string;
  hint: string;
}> = [
  {
    value: 'working_day',
    label: 'Working day',
    hint: 'Anything past the rostered hours on a normal day.',
  },
  {
    value: 'weekly_off',
    label: 'Weekly off',
    hint: 'A day the weekly-off policy makes off. Nothing is rostered, so every minute counts.',
  },
  {
    value: 'holiday',
    label: 'Holiday',
    hint: 'A declared holiday. Nothing is rostered, so every minute counts.',
  },
];

export const TREATMENT_OPTIONS: ReadonlyArray<{ value: OvertimeTreatment; label: string }> = [
  { value: 'pay', label: 'Pay' },
  { value: 'comp_off', label: 'Comp-off' },
];

export const ROUNDING_OPTIONS: ReadonlyArray<{ value: OvertimeRounding; label: string }> = [
  { value: 'nearest', label: 'Nearest' },
  { value: 'up', label: 'Up' },
  { value: 'down', label: 'Down' },
];

export const OVERTIME_BASIS_OPTIONS: ReadonlyArray<{ value: OvertimeBasis; label: string }> = [
  { value: 'gross', label: 'Gross hours' },
  { value: 'effective', label: 'Effective hours' },
];

export interface OvertimeScopeDraft {
  scope: OvertimeScope;
  treatment: OvertimeTreatment;
  multiplier: string;
  applies_after_minutes: string;
  effective_from: string;
  effective_to: string;
}

export const createOvertimeScopeRow = (scope: OvertimeScope): OvertimeScopeDraft => ({
  scope,
  treatment: 'pay',
  multiplier: '1.5',
  applies_after_minutes: '0',
  effective_from: '',
  effective_to: '',
});

export interface OvertimeDraft {
  name: string;
  description: string;
  hours_basis: OvertimeBasis;
  minimum_minutes_before_accrual: string;
  rounding: OvertimeRounding;
  rounding_increment_minutes: string;
  requires_approval: boolean;
  pay_code: string;
  scopes: OvertimeScopeDraft[];
  is_default: boolean;
  is_active: boolean;
}

export const createEmptyOvertimeDraft = (): OvertimeDraft => ({
  name: '',
  description: '',
  hours_basis: 'gross',
  minimum_minutes_before_accrual: '0',
  rounding: 'nearest',
  rounding_increment_minutes: '15',
  requires_approval: true,
  pay_code: '',
  // Deliberately empty. A policy that has not said what a weekly-off hour is
  // worth has not decided it is worth 2x, and seeding a rate would put a
  // number nobody chose in front of payroll.
  scopes: [],
  is_default: false,
  is_active: true,
});

const wholeNumber = (value: string | number, max: number): number | null => {
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

/** Hundredths of a rate, as an integer, so 1.5x never drifts. */
const toHundredths = (value: string | number | null | undefined): number | null => {
  const text = String(value ?? '').trim();
  if (text === '' || !/^\d*(\.\d+)?$/.test(text) || text === '.') {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

const decimalString = (hundredths: number): string =>
  `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;

/** "1.50" reads as a rate, not as a decimal. */
export const formatMultiplier = (value: string | number): string => {
  const text = String(value ?? '').trim();
  if (!text) {
    return '1x';
  }
  const trimmed = text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
  return `${trimmed}x`;
};

/**
 * Round overtime to the policy's increment.
 *
 * Mirrors OvertimeEngine::round, including the two edges that look like
 * oversights and are not: an increment of one or less rounds nothing, and an
 * exact multiple is returned untouched whatever the mode.
 */
export const roundOvertimeMinutes = (
  minutes: number,
  rounding: OvertimeRounding | string,
  increment: number
): number => {
  const value = Math.trunc(minutes);
  if (value <= 0 || increment <= 1) {
    return Math.max(0, value);
  }

  const step = Math.trunc(increment);
  const whole = Math.floor(value / step);
  const remainder = value % step;

  if (remainder === 0) {
    return value;
  }

  switch (String(rounding).trim().toLowerCase()) {
    case 'up':
      return (whole + 1) * step;
    case 'down':
      return whole * step;
    default:
      // Half up: 37 of 15 stays 30, 38 becomes 45.
      return remainder * 2 >= step ? (whole + 1) * step : whole * step;
  }
};

/** The rows belonging to one scope, in the order they were entered. */
export const scopeRowsFor = (
  scopes: readonly OvertimeScopeDraft[],
  scope: OvertimeScope
): OvertimeScopeDraft[] => scopes.filter((row) => row.scope === scope);

const withinWindow = (row: OvertimeScopeDraft, onDate: string | null): boolean => {
  if (!onDate) {
    return true;
  }
  const from = row.effective_from.trim();
  const to = row.effective_to.trim();
  if (from && onDate < from) {
    return false;
  }
  if (to && onDate > to) {
    return false;
  }
  return true;
};

/**
 * The rate in force for one scope, given how much overtime was actually
 * earned.
 *
 * Mirrors OvertimeEngine::rateFor: only tiers the overtime has REACHED are
 * eligible (`applies_after_minutes <= minutes`, inclusive), the highest such
 * tier wins, and a tie goes to the row created last — which for a draft means
 * the row further down the list.
 */
export const rateForScope = (
  scopes: readonly OvertimeScopeDraft[],
  scope: OvertimeScope,
  overtimeMinutes: number,
  onDate: string | null = null
): OvertimeScopeDraft | null => {
  const minutes = Math.max(0, Math.trunc(overtimeMinutes) || 0);

  let winner: OvertimeScopeDraft | null = null;
  let winningFloor = -1;

  for (const row of scopes) {
    if (row.scope !== scope || !withinWindow(row, onDate)) {
      continue;
    }
    const floor = wholeNumber(row.applies_after_minutes, Number.MAX_SAFE_INTEGER) ?? 0;
    if (floor > minutes) {
      continue;
    }
    if (floor >= winningFloor) {
      winner = row;
      winningFloor = floor;
    }
  }

  return winner;
};

// ---------------------------------------------------------------------------
// The worked example
// ---------------------------------------------------------------------------

export interface OvertimeExample {
  scope: OvertimeScope;
  workedMinutes: number;
  /** What the shift rosters. Ignored on a weekly off or a holiday. */
  expectedMinutes: number;
  approved: boolean;
  date?: string | null;
}

export interface OvertimePreview {
  scope: OvertimeScope;
  expectedMinutes: number;
  rawMinutes: number;
  qualifyingMinutes: number;
  roundedMinutes: number;
  multiplier: string;
  multiplierSource: 'policy_scope' | 'default';
  treatment: OvertimeTreatment;
  approvalState: 'not_required' | 'pending' | 'approved';
  isPayable: boolean;
  lines: string[];
}

export const previewOvertime = (
  draft: OvertimeDraft,
  example: OvertimeExample
): OvertimePreview => {
  const lines: string[] = [];

  const worked = Math.max(0, Math.trunc(example.workedMinutes) || 0);
  // Nothing is rostered on a weekly off or a holiday, so every minute worked
  // is overtime. Subtracting a shift length there would silently pay for four
  // hours of a Sunday and nothing for the first four.
  const expected = example.scope === 'working_day'
    ? Math.max(0, Math.trunc(example.expectedMinutes) || 0)
    : 0;

  const raw = Math.max(0, worked - expected);
  const minimum = wholeNumber(draft.minimum_minutes_before_accrual, 1440) ?? 0;
  const qualifying = raw > 0 && raw >= minimum ? raw : 0;
  const increment = wholeNumber(draft.rounding_increment_minutes, 240) ?? 1;
  const rounded = roundOvertimeMinutes(qualifying, draft.rounding, increment);

  lines.push(
    expected > 0
      ? `Worked ${formatSpanMinutes(worked)} against ${formatSpanMinutes(expected)} rostered — ${formatSpanMinutes(raw)} over.`
      : `Worked ${formatSpanMinutes(worked)} with nothing rostered — all of it is overtime.`
  );

  if (raw > 0 && qualifying === 0) {
    lines.push(
      `Below the ${formatSpanMinutes(minimum)} minimum, so no overtime accrues at all.`
    );
  } else if (rounded !== qualifying) {
    lines.push(
      `Rounded ${draft.rounding === 'nearest' ? 'to the nearest' : draft.rounding} `
        + `${formatSpanMinutes(increment)}: ${formatSpanMinutes(qualifying)} becomes ${formatSpanMinutes(rounded)}.`
    );
  }

  const rate = rateForScope(draft.scopes, example.scope, rounded, example.date ?? null);
  const scopeLabel = OVERTIME_SCOPES.find((item) => item.value === example.scope)?.label
    ?? example.scope;

  const multiplier = rate
    ? decimalString(toHundredths(rate.multiplier) ?? 100)
    : '1.00';
  const treatment: OvertimeTreatment = rate?.treatment ?? 'pay';

  if (rate) {
    lines.push(
      treatment === 'comp_off'
        ? `${scopeLabel}: banked as comp-off at ${formatMultiplier(multiplier)}.`
        : `${scopeLabel}: paid at ${formatMultiplier(multiplier)}.`
    );
  } else if (rounded > 0) {
    // Named plainly, because "no rate" is not "no overtime" — the engine falls
    // through to the shift's own multiplier, which is exactly the fallback
    // this policy layer exists to replace.
    lines.push(
      `This policy names no rate for a ${scopeLabel.toLowerCase()}, so the shift's own overtime multiplier answers, or 1x when it has none.`
    );
  }

  const approvalState: OvertimePreview['approvalState'] = !draft.requires_approval
    ? 'not_required'
    : example.approved
      ? 'approved'
      : 'pending';

  if (approvalState === 'pending' && rounded > 0) {
    lines.push('Only approved hours count, so nothing is payable until this day is approved.');
  }

  return {
    scope: example.scope,
    expectedMinutes: expected,
    rawMinutes: raw,
    qualifyingMinutes: qualifying,
    roundedMinutes: rounded,
    multiplier,
    multiplierSource: rate ? 'policy_scope' : 'default',
    treatment,
    approvalState,
    isPayable: rounded > 0 && approvalState !== 'pending',
    lines,
  };
};

// ---------------------------------------------------------------------------
// Validation and payload
// ---------------------------------------------------------------------------

export type OvertimeDraftErrors = Partial<
  Record<
    'name' | 'minimum_minutes_before_accrual' | 'rounding_increment_minutes' | 'pay_code' | 'scopes',
    string
  >
>;

export const validateOvertimeDraft = (draft: OvertimeDraft): OvertimeDraftErrors => {
  const errors: OvertimeDraftErrors = {};

  if (!draft.name.trim()) {
    errors.name = 'Give the policy a name people will recognise.';
  } else if (draft.name.trim().length > 255) {
    errors.name = 'Keep the name under 255 characters.';
  }

  if (wholeNumber(draft.minimum_minutes_before_accrual, 1440) === null) {
    errors.minimum_minutes_before_accrual = 'The minimum is a whole number of minutes, up to 1440.';
  }

  const increment = wholeNumber(draft.rounding_increment_minutes, 240);
  if (increment === null || increment < 1) {
    errors.rounding_increment_minutes = 'Round to between 1 and 240 minutes.';
  }

  if (draft.pay_code.trim().length > 255) {
    errors.pay_code = 'Keep the pay code under 255 characters.';
  }

  const problems: string[] = [];
  const floors = new Map<string, number>();

  draft.scopes.forEach((row, index) => {
    const position = index + 1;
    const multiplier = toHundredths(row.multiplier);
    if (multiplier === null || multiplier > 99999) {
      problems.push(`Rate ${position} needs a multiplier, such as 1.5.`);
      return;
    }
    const floor = wholeNumber(row.applies_after_minutes, 1440);
    if (floor === null) {
      problems.push(`Rate ${position} starts after a whole number of minutes, up to 1440.`);
      return;
    }
    const from = row.effective_from.trim();
    const to = row.effective_to.trim();
    if (from && to && to < from) {
      problems.push(`Rate ${position} ends before it starts.`);
      return;
    }

    const key = `${row.scope}:${floor}`;
    floors.set(key, (floors.get(key) ?? 0) + 1);
  });

  for (const [key, count] of floors) {
    if (count > 1) {
      const [scope, floor] = key.split(':');
      const label = OVERTIME_SCOPES.find((item) => item.value === scope)?.label ?? scope;
      problems.push(
        `Two ${label.toLowerCase()} rates both start after ${floor} minutes — only one of them can ever apply.`
      );
    }
  }

  if (problems.length > 0) {
    errors.scopes = problems.join(' ');
  }

  return errors;
};

export const overtimeDraftToPayload = (draft: OvertimeDraft): Record<string, unknown> => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  hours_basis: draft.hours_basis,
  minimum_minutes_before_accrual: Number(draft.minimum_minutes_before_accrual || 0),
  rounding: draft.rounding,
  rounding_increment_minutes: Number(draft.rounding_increment_minutes || 1),
  requires_approval: draft.requires_approval,
  pay_code: draft.pay_code.trim() || null,
  is_default: draft.is_default,
  is_active: draft.is_active,
  // Always sent, even empty: the server replaces the whole rate set, so
  // omitting it would leave rates the editor has just removed in place.
  scopes: draft.scopes.map((row) => ({
    scope: row.scope,
    treatment: row.treatment,
    multiplier: decimalString(toHundredths(row.multiplier) ?? 100),
    applies_after_minutes: Number(row.applies_after_minutes || 0),
    effective_from: row.effective_from.trim() || null,
    effective_to: row.effective_to.trim() || null,
  })),
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

export interface OvertimePolicySummaryLike {
  hours_basis: string;
  minimum_minutes_before_accrual: number | string;
  rounding: string;
  rounding_increment_minutes: number | string;
  requires_approval: boolean;
}

export const describeOvertimePolicy = (policy: OvertimePolicySummaryLike): string => {
  const minimum = Math.max(0, Math.trunc(Number(policy.minimum_minutes_before_accrual || 0)) || 0);
  const increment = Math.max(0, Math.trunc(Number(policy.rounding_increment_minutes || 0)) || 0);

  const parts = [policy.hours_basis === 'gross' ? 'Gross hours' : 'Effective hours'];
  if (minimum > 0) {
    parts.push(`after ${minimum}m`);
  }
  parts.push(
    increment <= 1
      ? 'rounded to the minute'
      : `rounded ${policy.rounding === 'nearest' ? 'to the nearest' : `${policy.rounding} to`} ${increment}m`
  );
  parts.push(policy.requires_approval ? 'approval required' : 'no approval needed');

  return parts.join(' · ');
};
