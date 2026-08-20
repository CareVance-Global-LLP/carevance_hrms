/**
 * The shift allowance policy: what a night, and a weekend, are worth on top.
 *
 * The premium is earned by the OVERLAP between the shift and the policy's
 * night window, never by a "night shift" label. An 18:00-02:00 shift against a
 * 22:00-06:00 window measures 240 minutes, and the policy's minimum decides
 * whether that pays — which is why the editor shows the overlap in minutes
 * while the window is being typed.
 *
 * The window crosses midnight by definition, so it is instantiated on three
 * consecutive days around the shift and the overlaps summed. Anchoring it to
 * one day silently drops the half of a night shift past midnight, which is the
 * bug this domain keeps producing.
 *
 * Money is decimal end to end. Every amount here is computed in integer
 * hundredths and rounded ONCE, half up, at the boundary — the same rule
 * ShiftAllowanceEngine::round2 applies, and the reason a percentage premium
 * with no base amount returns null rather than zero: the premium is earned but
 * not quantified, and only a caller holding the salary structure can say what
 * it bites on.
 */
import { formatSpanMinutes, shiftCrossesMidnight } from '../shiftForm';

export type AllowanceType = 'none' | 'percentage' | 'fixed';

export const ALLOWANCE_TYPE_OPTIONS: ReadonlyArray<{ value: AllowanceType; label: string }> = [
  { value: 'none', label: 'Nothing' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'fixed', label: 'Fixed amount' },
];

export interface ShiftAllowanceDraft {
  name: string;
  description: string;
  night_allowance_type: AllowanceType;
  night_percentage: string;
  night_fixed: string;
  night_window_start: string;
  night_window_end: string;
  night_minimum_minutes_in_window: string;
  weekend_allowance_type: AllowanceType;
  weekend_percentage: string;
  weekend_fixed: string;
  is_default: boolean;
  is_active: boolean;
}

export const createEmptyShiftAllowanceDraft = (): ShiftAllowanceDraft => ({
  name: '',
  description: '',
  night_allowance_type: 'none',
  night_percentage: '0',
  night_fixed: '0',
  night_window_start: '',
  night_window_end: '',
  night_minimum_minutes_in_window: '0',
  weekend_allowance_type: 'none',
  weekend_percentage: '0',
  weekend_fixed: '0',
  is_default: false,
  is_active: true,
});

// ---------------------------------------------------------------------------
// Clock and decimal helpers
// ---------------------------------------------------------------------------

const clockMinutes = (value: string | null | undefined): number | null => {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(String(value ?? '').trim());
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
};

/** "22:00:00" -> "22:00"; anything unreadable -> null. */
export const toHHMM = (value: string | null | undefined): string | null => {
  const minutes = clockMinutes(value);
  if (minutes === null) {
    return null;
  }
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
};

/** Hundredths of a unit, or null when the text is not a number. */
export const toHundredths = (value: string | number | null | undefined): number | null => {
  const text = String(value ?? '').trim();
  if (text === '' || !/^\d*(\.\d+)?$/.test(text) || text === '.') {
    return null;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
};

export const formatAmount = (hundredths: number): string =>
  `${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;

/** "15.00" -> "15", "1.50" -> "1.5". Prose only, never a payload. */
const trimDecimal = (value: string | number): string => {
  const text = String(value ?? '').trim();
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text;
};

const MINUTES_PER_DAY = 24 * 60;

/**
 * Minutes of the shift that fall inside the night window.
 *
 * Null when the shift times cannot be read. With no window at all the whole
 * shift counts: a policy that pays a night premium without saying what night
 * is means the shift itself is the night.
 */
export const nightMinutesInWindow = (
  shiftStart: string,
  shiftEnd: string,
  windowStart: string | null,
  windowEnd: string | null
): number | null => {
  const start = clockMinutes(shiftStart);
  const end = clockMinutes(shiftEnd);
  if (start === null || end === null) {
    return null;
  }

  // The end belongs to the next day whenever it is not strictly after the
  // start — the same midnight roll Shift::spanMinutes applies.
  const shiftFrom = start;
  const shiftTo = end > start ? end : end + MINUTES_PER_DAY;

  const opensAt = clockMinutes(windowStart);
  const closesAt = clockMinutes(windowEnd);
  if (opensAt === null || closesAt === null) {
    return shiftTo - shiftFrom;
  }

  const windowSpan = closesAt > opensAt ? closesAt - opensAt : closesAt - opensAt + MINUTES_PER_DAY;
  if (windowSpan <= 0) {
    return 0;
  }

  let minutes = 0;
  for (const offset of [-1, 0, 1]) {
    const windowFrom = offset * MINUTES_PER_DAY + opensAt;
    const windowTo = windowFrom + windowSpan;
    const overlapFrom = Math.max(shiftFrom, windowFrom);
    const overlapTo = Math.min(shiftTo, windowTo);
    if (overlapTo > overlapFrom) {
      minutes += overlapTo - overlapFrom;
    }
  }

  return minutes;
};

// ---------------------------------------------------------------------------
// The worked example
// ---------------------------------------------------------------------------

export interface ShiftAllowanceExample {
  shiftStart: string;
  shiftEnd: string;
  isWeeklyOff: boolean;
  /** Blank means the caller does not hold the salary structure. */
  baseAmount: string;
}

export interface ShiftAllowancePreview {
  nightMinutesInWindow: number | null;
  nightApplies: boolean;
  nightType: AllowanceType;
  nightRate: string;
  /** Null when a percentage premium is earned but cannot be quantified. */
  nightAmount: string | null;
  weekendApplies: boolean;
  weekendType: AllowanceType;
  weekendRate: string;
  weekendAmount: string | null;
  totalAmount: string | null;
  lines: string[];
}

const rateFor = (type: AllowanceType, percentage: string, fixed: string): string => {
  if (type === 'percentage') {
    return formatAmount(toHundredths(percentage) ?? 0);
  }
  if (type === 'fixed') {
    return formatAmount(toHundredths(fixed) ?? 0);
  }
  return '0.00';
};

const amountFor = (type: AllowanceType, rate: string, baseHundredths: number | null): string | null => {
  if (type === 'fixed') {
    return rate;
  }
  if (type === 'percentage') {
    if (baseHundredths === null) {
      return null;
    }
    const percent = toHundredths(rate) ?? 0;
    // One rounding, half up, at this boundary — the same rule as round2().
    return formatAmount(Math.round((baseHundredths * percent) / 10000));
  }
  return '0.00';
};

const sumAmounts = (first: string | null, second: string | null): string | null => {
  if (first === null || second === null) {
    return null;
  }
  return formatAmount((toHundredths(first) ?? 0) + (toHundredths(second) ?? 0));
};

export const previewShiftAllowance = (
  draft: ShiftAllowanceDraft,
  example: ShiftAllowanceExample
): ShiftAllowancePreview => {
  const lines: string[] = [];

  const minutes = nightMinutesInWindow(
    example.shiftStart,
    example.shiftEnd,
    draft.night_window_start || null,
    draft.night_window_end || null
  );

  // A minimum of 0 still requires at least one minute inside the window:
  // "any overlap qualifies" is not "no overlap qualifies".
  const required = Math.max(1, Math.trunc(Number(draft.night_minimum_minutes_in_window || 0)) || 0);
  const nightApplies = draft.night_allowance_type !== 'none'
    && minutes !== null
    && minutes >= required;
  const weekendApplies = draft.weekend_allowance_type !== 'none' && example.isWeeklyOff;

  const nightType: AllowanceType = nightApplies ? draft.night_allowance_type : 'none';
  const weekendType: AllowanceType = weekendApplies ? draft.weekend_allowance_type : 'none';

  const nightRate = rateFor(nightType, draft.night_percentage, draft.night_fixed);
  const weekendRate = rateFor(weekendType, draft.weekend_percentage, draft.weekend_fixed);

  const baseHundredths = toHundredths(example.baseAmount);
  const nightAmount = amountFor(nightType, nightRate, baseHundredths);
  const weekendAmount = amountFor(weekendType, weekendRate, baseHundredths);

  if (minutes === null) {
    lines.push('Set a start and an end for the example shift to measure the overlap.');
  } else if (draft.night_allowance_type === 'none') {
    lines.push('No night premium is configured.');
  } else if (nightApplies) {
    lines.push(
      `${formatSpanMinutes(minutes)} of this shift falls in the night window — the premium applies.`
    );
  } else if (minutes > 0) {
    // Four hours of night below a five-hour minimum has to stay
    // distinguishable from no night at all.
    lines.push(
      `Only ${formatSpanMinutes(minutes)} of this shift falls in the night window, below the `
        + `${formatSpanMinutes(required)} minimum — no night premium.`
    );
  } else {
    lines.push('None of this shift falls in the night window — no night premium.');
  }

  if (weekendApplies) {
    lines.push('The day is a weekly off for this employee, so the weekend premium applies.');
  } else if (draft.weekend_allowance_type !== 'none') {
    lines.push('The day is not a weekly off for this employee, so the weekend premium does not apply.');
  }

  if ((nightAmount === null || weekendAmount === null)) {
    lines.push(
      'A percentage premium cannot be turned into an amount without the salary it applies to.'
    );
  }

  return {
    nightMinutesInWindow: minutes,
    nightApplies,
    nightType,
    nightRate,
    nightAmount,
    weekendApplies,
    weekendType,
    weekendRate,
    weekendAmount,
    totalAmount: sumAmounts(nightAmount, weekendAmount),
    lines,
  };
};

// ---------------------------------------------------------------------------
// Validation and payload
// ---------------------------------------------------------------------------

export type ShiftAllowanceDraftErrors = Partial<
  Record<
    | 'name'
    | 'night_percentage'
    | 'night_fixed'
    | 'night_window_start'
    | 'night_window_end'
    | 'night_minimum_minutes_in_window'
    | 'weekend_percentage'
    | 'weekend_fixed',
    string
  >
>;

export const validateShiftAllowanceDraft = (
  draft: ShiftAllowanceDraft
): ShiftAllowanceDraftErrors => {
  const errors: ShiftAllowanceDraftErrors = {};

  if (!draft.name.trim()) {
    errors.name = 'Give the policy a name people will recognise.';
  } else if (draft.name.trim().length > 255) {
    errors.name = 'Keep the name under 255 characters.';
  }

  const start = draft.night_window_start.trim();
  const end = draft.night_window_end.trim();
  if (start && toHHMM(start) === null) {
    errors.night_window_start = 'Enter the time the night window opens as HH:MM.';
  }
  if (end && toHHMM(end) === null) {
    errors.night_window_end = 'Enter the time the night window closes as HH:MM.';
  }
  // Half a window is worse than none: with only one end set the server reads
  // "no window", and the WHOLE shift counts as night.
  if (start && !end) {
    errors.night_window_end = 'Set both ends of the night window, or neither — with only one, the whole shift counts as night.';
  }
  if (end && !start) {
    errors.night_window_start = 'Set both ends of the night window, or neither — with only one, the whole shift counts as night.';
  }

  if (!/^\d+$/.test(draft.night_minimum_minutes_in_window.trim() || '0')
    || Number(draft.night_minimum_minutes_in_window || 0) > 1440) {
    errors.night_minimum_minutes_in_window = 'The minimum is a whole number of minutes, up to 1440.';
  }

  if (draft.night_allowance_type === 'percentage') {
    const percent = toHundredths(draft.night_percentage);
    if (percent === null || percent <= 0 || percent > 99999) {
      errors.night_percentage = 'Enter the night premium as a percentage above zero.';
    }
  }
  if (draft.night_allowance_type === 'fixed') {
    const fixed = toHundredths(draft.night_fixed);
    if (fixed === null || fixed <= 0) {
      errors.night_fixed = 'Enter the night premium as an amount above zero.';
    }
  }
  if (draft.weekend_allowance_type === 'percentage') {
    const percent = toHundredths(draft.weekend_percentage);
    if (percent === null || percent <= 0 || percent > 99999) {
      errors.weekend_percentage = 'Enter the weekend premium as a percentage above zero.';
    }
  }
  if (draft.weekend_allowance_type === 'fixed') {
    const fixed = toHundredths(draft.weekend_fixed);
    if (fixed === null || fixed <= 0) {
      errors.weekend_fixed = 'Enter the weekend premium as an amount above zero.';
    }
  }

  return errors;
};

export const shiftAllowanceDraftToPayload = (
  draft: ShiftAllowanceDraft
): Record<string, unknown> => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  night_allowance_type: draft.night_allowance_type,
  night_percentage: formatAmount(toHundredths(draft.night_percentage) ?? 0),
  night_fixed: formatAmount(toHundredths(draft.night_fixed) ?? 0),
  night_window_start: toHHMM(draft.night_window_start),
  night_window_end: toHHMM(draft.night_window_end),
  night_minimum_minutes_in_window: Number(draft.night_minimum_minutes_in_window || 0),
  weekend_allowance_type: draft.weekend_allowance_type,
  weekend_percentage: formatAmount(toHundredths(draft.weekend_percentage) ?? 0),
  weekend_fixed: formatAmount(toHundredths(draft.weekend_fixed) ?? 0),
  is_default: draft.is_default,
  is_active: draft.is_active,
});

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

export interface ShiftAllowancePolicySummaryLike {
  night_allowance_type: string;
  night_percentage: string | number;
  night_fixed: string | number;
  night_window_start: string | null;
  night_window_end: string | null;
  weekend_allowance_type: string;
  weekend_percentage: string | number;
  weekend_fixed: string | number;
}

/** The night window as a phrase that says which day the end falls on. */
export const describeNightWindow = (
  start: string | null,
  end: string | null
): string => {
  const from = toHHMM(start);
  const to = toHHMM(end);
  if (!from || !to) {
    return 'the whole shift';
  }
  return `between ${from} and ${to}${shiftCrossesMidnight(from, to) ? ' the next day' : ''}`;
};

export const describeShiftAllowancePolicy = (
  policy: ShiftAllowancePolicySummaryLike
): string => {
  const parts: string[] = [];

  if (policy.night_allowance_type === 'percentage') {
    parts.push(
      `Night ${trimDecimal(String(policy.night_percentage))}% `
        + describeNightWindow(policy.night_window_start, policy.night_window_end)
    );
  } else if (policy.night_allowance_type === 'fixed') {
    parts.push(
      `Night ${trimDecimal(String(policy.night_fixed))} fixed `
        + describeNightWindow(policy.night_window_start, policy.night_window_end)
    );
  }

  if (policy.weekend_allowance_type === 'percentage') {
    parts.push(`Weekend ${trimDecimal(String(policy.weekend_percentage))}%`);
  } else if (policy.weekend_allowance_type === 'fixed') {
    parts.push(`Weekend ${trimDecimal(String(policy.weekend_fixed))} fixed`);
  }

  return parts.length === 0 ? 'No premium configured' : parts.join(' · ');
};
