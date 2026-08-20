/**
 * Weekly off, as rules rather than seven booleans.
 *
 * "2nd and 4th Saturday" is near-universal in Indian companies and cannot be
 * said with a checkbox per weekday, so `day_rules` is a map of weekday to one
 * of three shapes — and the difference between two of them is the thing users
 * get wrong:
 *
 *   every        that weekday, every week.
 *
 *   ordinals     the nth occurrence WITHIN THE CALENDAR MONTH. "last" is the
 *                final occurrence, which is not the same rule as 5: August
 *                2026 has five Saturdays so they agree, February 2026 has four
 *                so a literal 5 matches nothing at all.
 *
 *   alternate    a CONTINUOUS every-nth-week count anchored to a real date,
 *                which does not reset at the month boundary. From 1 Aug 2026
 *                that gives Aug 1, 15, 29 then Sep 12 and 26 — where a
 *                month-ordinal rule would have said Sep 5 and 19.
 *
 * Everything here is pure, and it mirrors `WeeklyOffPolicy` on the server day
 * for day. That matters twice over: the pane previews the actual dates while
 * the rule is being edited, and the preview is worthless unless it is the same
 * arithmetic that will judge attendance.
 *
 * An absent weekday means a working day. That is the opposite of a shift's
 * `applicable_days` (where empty means "runs every day") and deliberately so —
 * the failure mode of guessing here is a whole organization marked absent.
 *
 * Dates are handled entirely in UTC on purpose. These are calendar dates with
 * no time attached; letting the browser's local zone touch them is how a
 * Saturday reads as a Friday for anyone west of Greenwich.
 */

export type IsoDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Ordinal = number | 'last';

export type WeeklyOffRule =
  | { mode: 'every' }
  | { mode: 'ordinals'; ordinals: Ordinal[] }
  | { mode: 'alternate'; interval_weeks: number; anchor_date: string | null };

export type WeeklyOffRuleMode = WeeklyOffRule['mode'];

export type WeeklyOffDayRules = Partial<Record<IsoDay, WeeklyOffRule>>;

export const WEEKDAYS: ReadonlyArray<{ iso: IsoDay; name: string; label: string; short: string }> = [
  { iso: 1, name: 'monday', label: 'Monday', short: 'Mon' },
  { iso: 2, name: 'tuesday', label: 'Tuesday', short: 'Tue' },
  { iso: 3, name: 'wednesday', label: 'Wednesday', short: 'Wed' },
  { iso: 4, name: 'thursday', label: 'Thursday', short: 'Thu' },
  { iso: 5, name: 'friday', label: 'Friday', short: 'Fri' },
  { iso: 6, name: 'saturday', label: 'Saturday', short: 'Sat' },
  { iso: 7, name: 'sunday', label: 'Sunday', short: 'Sun' },
];

/** The ordinals a month can hold, plus the "final occurrence" rule. */
export const ORDINAL_CHOICES: ReadonlyArray<Ordinal> = [1, 2, 3, 4, 5, 'last'];

export const weekdayLabel = (iso: IsoDay): string =>
  WEEKDAYS.find((day) => day.iso === iso)?.label ?? String(iso);

/** 1st, 2nd, 3rd, 4th … and "last" passed through as the word. */
export const ordinalLabel = (ordinal: Ordinal): string => {
  if (ordinal === 'last') {
    return 'last';
  }
  const value = Math.trunc(Number(ordinal));
  const tens = value % 100;
  if (tens >= 11 && tens <= 13) {
    return `${value}th`;
  }
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
};

/**
 * A weekday key, in any of the spellings the server reads: an ISO number
 * ("1" = Monday … "7" = Sunday, with "0" read as Sunday), a full name, or a
 * three- or two-letter abbreviation.
 */
export const isoDayFrom = (key: unknown): IsoDay | null => {
  if (typeof key === 'number' || (typeof key === 'string' && /^\d+$/.test(key.trim()))) {
    const number = Number(key);
    if (number === 0) {
      return 7;
    }
    return number >= 1 && number <= 7 ? (number as IsoDay) : null;
  }

  if (typeof key !== 'string') {
    return null;
  }

  const token = key.trim().toLowerCase();
  if (!token) {
    return null;
  }

  const match = WEEKDAYS.find(
    (day) => token === day.name || token === day.name.slice(0, 3) || token === day.name.slice(0, 2)
  );
  return match ? match.iso : null;
};

/** One rule, in any shape the server accepts, or null when it is unreadable. */
export const normalizeWeeklyOffRule = (rule: unknown): WeeklyOffRule | null => {
  if (rule === true) {
    return { mode: 'every' };
  }

  if (typeof rule === 'string') {
    const token = rule.trim().toLowerCase();
    return ['every', 'all', 'weekly'].includes(token) ? { mode: 'every' } : null;
  }

  if (Array.isArray(rule)) {
    return rule.length > 0 ? { mode: 'ordinals', ordinals: normalizeOrdinals(rule) } : null;
  }

  if (!rule || typeof rule !== 'object') {
    return null;
  }

  const shape = rule as Record<string, unknown>;
  if (!('mode' in shape)) {
    return null;
  }

  const mode = typeof shape.mode === 'string' ? shape.mode.trim().toLowerCase() : '';
  if (['every', 'all', 'weekly'].includes(mode)) {
    return { mode: 'every' };
  }
  if (mode === 'ordinals') {
    return {
      mode: 'ordinals',
      ordinals: Array.isArray(shape.ordinals) ? normalizeOrdinals(shape.ordinals) : [],
    };
  }
  if (mode === 'alternate') {
    const interval = Number(shape.interval_weeks ?? 2);
    const anchor = typeof shape.anchor_date === 'string' && shape.anchor_date.trim()
      ? shape.anchor_date.trim().slice(0, 10)
      : null;
    return {
      mode: 'alternate',
      interval_weeks: Number.isFinite(interval) && interval >= 1 ? Math.trunc(interval) : 2,
      anchor_date: anchor,
    };
  }

  return null;
};

const normalizeOrdinals = (values: unknown[]): Ordinal[] =>
  values
    .map((value): Ordinal | null => {
      if (typeof value === 'string' && value.trim().toLowerCase() === 'last') {
        return 'last';
      }
      const number = Number(value);
      return Number.isFinite(number) ? Math.trunc(number) : null;
    })
    .filter((value): value is Ordinal => value !== null);

/** Whatever came back from the API, turned into the map the form edits. */
export const normalizeDayRules = (raw: unknown): WeeklyOffDayRules => {
  if (!raw || typeof raw !== 'object') {
    return {};
  }

  const rules: WeeklyOffDayRules = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const iso = isoDayFrom(key);
    if (iso === null) {
      continue;
    }
    const rule = normalizeWeeklyOffRule(value);
    if (rule) {
      rules[iso] = rule;
    }
  }
  return rules;
};

/**
 * The `day_rules` body the API stores. Weekday NAMES, not numbers — a JSON
 * column gets read by humans, and "saturday" needs no key to decode.
 */
export const dayRulesToPayload = (rules: WeeklyOffDayRules): Record<string, unknown> => {
  const payload: Record<string, unknown> = {};
  for (const day of WEEKDAYS) {
    const rule = rules[day.iso];
    if (!rule) {
      continue;
    }
    if (rule.mode === 'every') {
      payload[day.name] = 'every';
    } else if (rule.mode === 'ordinals') {
      payload[day.name] = [...rule.ordinals];
    } else {
      payload[day.name] = {
        mode: 'alternate',
        interval_weeks: rule.interval_weeks,
        anchor_date: rule.anchor_date,
      };
    }
  }
  return payload;
};

// ---------------------------------------------------------------------------
// Calendar arithmetic
// ---------------------------------------------------------------------------

const parseIsoDate = (value: string): Date | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value ?? '').trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
};

const toIsoDate = (date: Date): string => date.toISOString().slice(0, 10);

const isoDayOfDate = (date: Date): IsoDay => (((date.getUTCDay() + 6) % 7) + 1) as IsoDay;

const daysInMonth = (year: number, month: number): number =>
  new Date(Date.UTC(year, month, 0)).getUTCDate();

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ordinalOfMonth = (date: Date): number => Math.floor((date.getUTCDate() - 1) / 7) + 1;

const isLastOccurrenceInMonth = (date: Date): boolean =>
  date.getUTCDate() + 7 > daysInMonth(date.getUTCFullYear(), date.getUTCMonth() + 1);

const ruleMatches = (rule: WeeklyOffRule, date: Date): boolean => {
  if (rule.mode === 'every') {
    return true;
  }

  if (rule.mode === 'ordinals') {
    if (rule.ordinals.length === 0) {
      return false;
    }
    const ordinal = ordinalOfMonth(date);
    return rule.ordinals.some((wanted) =>
      wanted === 'last' ? isLastOccurrenceInMonth(date) : Number(wanted) === ordinal
    );
  }

  // Alternate. With no anchor the rule is inert — the day is simply never off.
  // Choosing an anchor on the policy's behalf would mark real people absent on
  // days they were told to work, and there is no safe guess.
  if (!rule.anchor_date) {
    return false;
  }
  const anchor = parseIsoDate(rule.anchor_date);
  if (!anchor) {
    return false;
  }
  const days = Math.round((date.getTime() - anchor.getTime()) / MS_PER_DAY);
  if (days < 0) {
    return false;
  }
  const interval = Math.max(1, Math.trunc(rule.interval_weeks || 2));
  return Math.floor(days / 7) % interval === 0;
};

/** Whether a calendar date is a weekly off under these rules. */
export const isWeeklyOffOn = (rules: WeeklyOffDayRules, isoDate: string): boolean => {
  const date = parseIsoDate(isoDate);
  if (!date) {
    return false;
  }
  const rule = rules[isoDayOfDate(date)];
  return rule ? ruleMatches(rule, date) : false;
};

export interface WeekdayOccurrence {
  date: string;
  ordinal: number;
  isLast: boolean;
  isOff: boolean;
}

/**
 * Every occurrence of one weekday in one month, with the ordinal it holds and
 * whether the rules make it off.
 *
 * This is the whole answer to the question the pane exists to make plain. "2nd
 * and 4th Saturday" is ambiguous until you can see that in August 2026 it
 * means the 8th and the 22nd, and that the 29th — the fifth, and the last —
 * is a working day.
 */
export const weekdayOccurrencesInMonth = (
  rules: WeeklyOffDayRules,
  iso: IsoDay,
  year: number,
  month: number
): WeekdayOccurrence[] => {
  const total = daysInMonth(year, month);
  const occurrences: WeekdayOccurrence[] = [];

  for (let day = 1; day <= total; day++) {
    const date = new Date(Date.UTC(year, month - 1, day));
    if (isoDayOfDate(date) !== iso) {
      continue;
    }
    occurrences.push({
      date: toIsoDate(date),
      ordinal: ordinalOfMonth(date),
      isLast: isLastOccurrenceInMonth(date),
      isOff: isWeeklyOffOn(rules, toIsoDate(date)),
    });
  }

  return occurrences;
};

/** Every off date in one month, across all the weekdays the policy names. */
export const offDatesInMonth = (
  rules: WeeklyOffDayRules,
  year: number,
  month: number
): string[] => {
  const total = daysInMonth(year, month);
  const dates: string[] = [];

  for (let day = 1; day <= total; day++) {
    const iso = toIsoDate(new Date(Date.UTC(year, month - 1, day)));
    if (isWeeklyOffOn(rules, iso)) {
      dates.push(iso);
    }
  }

  return dates;
};

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

const joinWithAnd = (parts: string[]): string => {
  if (parts.length === 0) {
    return '';
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
};

/** One rule as a sentence somebody can check against what they were told. */
export const describeWeeklyOffRule = (iso: IsoDay, rule: WeeklyOffRule): string => {
  const day = weekdayLabel(iso);

  if (rule.mode === 'every') {
    return `Every ${day}`;
  }

  if (rule.mode === 'ordinals') {
    if (rule.ordinals.length === 0) {
      return `Never off — pick which ${day}s are off`;
    }
    return `${joinWithAnd(rule.ordinals.map(ordinalLabel))} ${day} of each month`;
  }

  if (!rule.anchor_date) {
    // Said plainly because the rule is silently inert otherwise: the day looks
    // configured and never comes off.
    return `Never off — pick the first ${day} that is off to start the count`;
  }

  const interval = Math.max(1, Math.trunc(rule.interval_weeks || 2));
  return `Every ${ordinalLabel(interval)} ${day} counting continuously from ${rule.anchor_date}`;
};

/** The whole policy in one line, for the list row. */
export const describeWeeklyOffPolicy = (rules: WeeklyOffDayRules): string => {
  const parts = WEEKDAYS.filter((day) => rules[day.iso]).map((day) =>
    describeWeeklyOffRule(day.iso, rules[day.iso] as WeeklyOffRule)
  );

  return parts.length === 0 ? 'No days off — everyone works every day' : parts.join('; ');
};

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

/** Set or clear one weekday's rule, without mutating the map given. */
export const setDayRule = (
  rules: WeeklyOffDayRules,
  iso: IsoDay,
  rule: WeeklyOffRule | null
): WeeklyOffDayRules => {
  const next: WeeklyOffDayRules = { ...rules };
  if (rule === null) {
    delete next[iso];
  } else {
    next[iso] = rule;
  }
  return next;
};

/** Add or remove one ordinal, keeping numbers ascending and "last" at the end. */
export const toggleOrdinal = (ordinals: readonly Ordinal[], ordinal: Ordinal): Ordinal[] => {
  const has = ordinals.some((value) => value === ordinal);
  const next = has
    ? ordinals.filter((value) => value !== ordinal)
    : [...ordinals, ordinal];

  const numbers = next
    .filter((value): value is number => value !== 'last')
    .sort((a, b) => a - b);
  const last = next.includes('last') ? (['last'] as Ordinal[]) : [];

  return [...numbers, ...last];
};

export interface WeeklyOffDraft {
  name: string;
  description: string;
  day_rules: WeeklyOffDayRules;
  is_default: boolean;
  is_active: boolean;
}

export const createEmptyWeeklyOffDraft = (): WeeklyOffDraft => ({
  name: '',
  description: '',
  day_rules: {},
  is_default: false,
  is_active: true,
});

/** The request body, from a draft the validator has already passed. */
export const weeklyOffDraftToPayload = (draft: WeeklyOffDraft): Record<string, unknown> => ({
  name: draft.name.trim(),
  description: draft.description.trim() || null,
  // Always sent, even empty: the server replaces the whole rule set, so
  // omitting it would leave days off that the editor has just cleared.
  day_rules: dayRulesToPayload(draft.day_rules),
  is_default: draft.is_default,
  is_active: draft.is_active,
});

export type WeeklyOffDraftErrors = Partial<Record<'name' | 'day_rules', string>>;

/**
 * The rules the browser can check. The server checks the same shapes again —
 * this exists so a rule that would never fire is caught before it is saved
 * and quietly does nothing for a month.
 */
export const validateWeeklyOffDraft = (draft: WeeklyOffDraft): WeeklyOffDraftErrors => {
  const errors: WeeklyOffDraftErrors = {};

  if (!draft.name.trim()) {
    errors.name = 'Give the policy a name people will recognise.';
  } else if (draft.name.trim().length > 255) {
    errors.name = 'Keep the name under 255 characters.';
  }

  const problems: string[] = [];
  for (const day of WEEKDAYS) {
    const rule = draft.day_rules[day.iso];
    if (!rule) {
      continue;
    }
    if (rule.mode === 'ordinals' && rule.ordinals.length === 0) {
      problems.push(`Pick which ${day.label}s are off, or turn ${day.label} off entirely.`);
    }
    if (rule.mode === 'alternate' && !rule.anchor_date) {
      problems.push(
        `Pick the first ${day.label} that is off — without it the count has nothing to start from and ${day.label} is never off.`
      );
    }
  }

  if (problems.length > 0) {
    errors.day_rules = problems.join(' ');
  }

  return errors;
};
