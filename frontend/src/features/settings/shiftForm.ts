/**
 * The pure half of the Shifts pane.
 *
 * Everything here is arithmetic and validation over the form's own strings, so
 * it can be tested without rendering Settings — which would mean mocking every
 * endpoint that screen loads, and an unmocked one retries three times and can
 * hold the run past its timeout.
 *
 * The one piece of real domain logic is the midnight roll. start_time and
 * end_time are wall-clock readings with no date attached: subtracting 22:00
 * from 06:00 gives minus sixteen hours, and a night shift is the case that
 * matters most. Every span here rolls the end forward a day when it is not
 * after the start, which is the same rule Shift::spanMinutes() applies on the
 * server. The two must agree, because the preview shown while typing has to be
 * the figure that gets saved.
 */

export type ShiftDay =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export const SHIFT_DAY_OPTIONS: ReadonlyArray<{ value: ShiftDay; label: string; short: string }> = [
  { value: 'monday', label: 'Monday', short: 'Mon' },
  { value: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { value: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { value: 'thursday', label: 'Thursday', short: 'Thu' },
  { value: 'friday', label: 'Friday', short: 'Fri' },
  { value: 'saturday', label: 'Saturday', short: 'Sat' },
  { value: 'sunday', label: 'Sunday', short: 'Sun' },
];

export const SHIFT_TYPE_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'morning', label: 'Morning' },
  { value: 'evening', label: 'Evening' },
  { value: 'night', label: 'Night' },
  { value: 'rotating', label: 'Rotating' },
] as const;

export type ShiftType = (typeof SHIFT_TYPE_OPTIONS)[number]['value'];

export interface ShiftDraft {
  name: string;
  code: string;
  type: ShiftType;
  description: string;
  start_time: string;
  end_time: string;
  break_minutes: string;
  grace_minutes: string;
  early_exit_grace_minutes: string;
  applicable_days: ShiftDay[];
  is_active: boolean;
}

export const createEmptyShiftDraft = (): ShiftDraft => ({
  name: '',
  code: '',
  type: 'general',
  description: '',
  start_time: '09:00',
  end_time: '18:00',
  break_minutes: '60',
  grace_minutes: '10',
  early_exit_grace_minutes: '10',
  applicable_days: [],
  is_active: true,
});

/** Minutes since midnight, or null when the value is not a real clock reading. */
const clockMinutes = (value: string): number | null => {
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

/**
 * The clock-in-to-clock-out length of the shift, breaks included.
 *
 * An end that is not after the start belongs to the next day — that is the
 * night shift, not an error. A start equal to the end is therefore a full
 * twenty-four hours, which is the only reading that keeps the rule consistent.
 */
export const shiftSpanMinutes = (start: string, end: string): number | null => {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) {
    return null;
  }
  return to - from; // REVERTED FOR EVIDENCE: no midnight roll
};

/** Whether the shift finishes on the calendar day after it starts. */
export const shiftCrossesMidnight = (start: string, end: string): boolean => {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) {
    return false;
  }
  return to <= from;
};

/**
 * Working seconds the shift is expected to produce: the span less the unpaid
 * break. This is the number that replaces the eight-hour constant, so it must
 * never be negative — a break longer than the shift is a data-entry mistake the
 * form catches, not a negative day.
 */
export const shiftExpectedWorkSeconds = (
  start: string,
  end: string,
  breakMinutes: number
): number | null => {
  const span = shiftSpanMinutes(start, end);
  if (span === null) {
    return null;
  }
  const unpaid = Number.isFinite(breakMinutes) ? Math.max(0, breakMinutes) : 0;
  return Math.max(0, span - unpaid) * 60;
};

export const formatSpanMinutes = (minutes: number | null): string => {
  if (minutes === null || !Number.isFinite(minutes)) {
    return '--';
  }
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
};

/**
 * A sentence, not two inputs. "22:00 to 06:00" alone leaves the reader to work
 * out which day the end falls on, and that is precisely the fact a night shift
 * turns on.
 */
export const describeShiftWindow = (start: string, end: string): string => {
  const from = clockMinutes(start);
  const to = clockMinutes(end);
  if (from === null || to === null) {
    return '';
  }
  const suffix = shiftCrossesMidnight(start, end) ? ' the next day' : '';
  return `${start.slice(0, 5)} to ${end.slice(0, 5)}${suffix}`;
};

/** Add or remove a day, always returning the canonical Monday-first order. */
export const toggleShiftDay = (days: readonly ShiftDay[], day: ShiftDay): ShiftDay[] => {
  const next = new Set(days);
  if (next.has(day)) {
    next.delete(day);
  } else {
    next.add(day);
  }
  return SHIFT_DAY_OPTIONS.map((option) => option.value).filter((value) => next.has(value));
};

export type ShiftDraftErrors = Partial<Record<keyof ShiftDraft, string>>;

const minuteField = (value: string, max: number): number | null => {
  const trimmed = String(value ?? '').trim();
  if (trimmed === '') {
    return 0;
  }
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed <= max ? parsed : null;
};

/**
 * Mirrors the server's rules so the form fails in the browser rather than
 * bouncing off a 422 with no field to point at. It is deliberately not the
 * authority — ShiftController validates the same things again, and the unique
 * code check can only happen there.
 */
export const validateShiftDraft = (draft: ShiftDraft): ShiftDraftErrors => {
  const errors: ShiftDraftErrors = {};

  if (!draft.name.trim()) {
    errors.name = 'Give the shift a name people will recognise.';
  } else if (draft.name.trim().length > 255) {
    errors.name = 'Keep the name under 255 characters.';
  }

  const code = draft.code.trim();
  if (!code) {
    errors.code = 'A short code is required — it is what the roster matches on.';
  } else if (code.length > 50) {
    errors.code = 'Keep the code under 50 characters.';
  }

  const span = shiftSpanMinutes(draft.start_time, draft.end_time);
  if (clockMinutes(draft.start_time) === null) {
    errors.start_time = 'Enter a start time as HH:MM.';
  }
  if (clockMinutes(draft.end_time) === null) {
    errors.end_time = 'Enter an end time as HH:MM.';
  }

  const breakMinutes = minuteField(draft.break_minutes, 720);
  if (breakMinutes === null) {
    errors.break_minutes = 'Break minutes must be a whole number up to 720.';
  } else if (span !== null && breakMinutes >= span) {
    errors.break_minutes = 'The break is at least as long as the shift, which leaves no working time.';
  }

  if (minuteField(draft.grace_minutes, 240) === null) {
    errors.grace_minutes = 'Grace minutes must be a whole number up to 240.';
  }
  if (minuteField(draft.early_exit_grace_minutes, 240) === null) {
    errors.early_exit_grace_minutes = 'Early-exit grace must be a whole number up to 240.';
  }

  return errors;
};

/** The request body the API expects, built from a validated draft. */
export const shiftDraftToPayload = (draft: ShiftDraft): Record<string, unknown> => ({
  name: draft.name.trim(),
  code: draft.code.trim(),
  type: draft.type,
  description: draft.description.trim() || null,
  start_time: draft.start_time.slice(0, 5),
  end_time: draft.end_time.slice(0, 5),
  break_duration_minutes: Number(draft.break_minutes || 0),
  grace_period_minutes: Number(draft.grace_minutes || 0),
  early_exit_grace_minutes: Number(draft.early_exit_grace_minutes || 0),
  // Empty means "runs every day" on both sides. Sending [] rather than
  // omitting it is what tells the server this was a deliberate clearing.
  applicable_days: draft.applicable_days,
  is_active: draft.is_active,
});
