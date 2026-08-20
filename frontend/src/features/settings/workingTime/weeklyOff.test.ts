import { describe, expect, it } from 'vitest';
import {
  createEmptyWeeklyOffDraft,
  dayRulesToPayload,
  describeWeeklyOffPolicy,
  describeWeeklyOffRule,
  isWeeklyOffOn,
  normalizeDayRules,
  normalizeWeeklyOffRule,
  offDatesInMonth,
  setDayRule,
  toggleOrdinal,
  validateWeeklyOffDraft,
  weeklyOffDraftToPayload,
  weekdayOccurrencesInMonth,
  type WeeklyOffDayRules,
} from './weeklyOff';

describe('normalizeWeeklyOffRule', () => {
  it('reads every shape the server accepts', () => {
    expect(normalizeWeeklyOffRule('every')).toEqual({ mode: 'every' });
    expect(normalizeWeeklyOffRule(true)).toEqual({ mode: 'every' });
    expect(normalizeWeeklyOffRule([2, 4])).toEqual({ mode: 'ordinals', ordinals: [2, 4] });
    expect(normalizeWeeklyOffRule(['last'])).toEqual({ mode: 'ordinals', ordinals: ['last'] });
    expect(
      normalizeWeeklyOffRule({ mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-01' })
    ).toEqual({ mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-01' });
  });

  it('rejects anything it cannot read rather than guessing a rule', () => {
    // Guessing here marks real people absent on days they were told to work.
    expect(normalizeWeeklyOffRule('sometimes')).toBeNull();
    expect(normalizeWeeklyOffRule([])).toBeNull();
    expect(normalizeWeeklyOffRule({ mode: 'lunar' })).toBeNull();
    expect(normalizeWeeklyOffRule(null)).toBeNull();
  });
});

describe('normalizeDayRules', () => {
  it('accepts weekday names, abbreviations and ISO numbers as keys', () => {
    const rules = normalizeDayRules({
      sunday: 'every',
      sat: [2, 4],
      '3': { mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-05' },
    });

    expect(rules[7]).toEqual({ mode: 'every' });
    expect(rules[6]).toEqual({ mode: 'ordinals', ordinals: [2, 4] });
    expect(rules[3]).toEqual({
      mode: 'alternate',
      interval_weeks: 2,
      anchor_date: '2026-08-05',
    });
  });

  it('reads "0" as Sunday, the way the server does', () => {
    expect(normalizeDayRules({ '0': 'every' })[7]).toEqual({ mode: 'every' });
  });

  it('drops keys and rules it cannot read instead of throwing', () => {
    expect(normalizeDayRules({ caturday: 'every', monday: 'whenever' })).toEqual({});
    expect(normalizeDayRules(null)).toEqual({});
  });
});

describe('dayRulesToPayload', () => {
  it('sends day names and the shapes the API validates', () => {
    const rules: WeeklyOffDayRules = {
      7: { mode: 'every' },
      6: { mode: 'ordinals', ordinals: [2, 4] },
      3: { mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-05' },
    };

    expect(dayRulesToPayload(rules)).toEqual({
      wednesday: { mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-05' },
      saturday: [2, 4],
      sunday: 'every',
    });
  });

  it('round-trips through the normaliser unchanged', () => {
    const rules: WeeklyOffDayRules = {
      6: { mode: 'ordinals', ordinals: [2, 'last'] },
      7: { mode: 'every' },
    };

    expect(normalizeDayRules(dayRulesToPayload(rules))).toEqual(rules);
  });

  it('is an empty object when nothing is off, never null', () => {
    // An absent key means "not off"; the server reads {} as "nothing is off",
    // and that has to be expressible or a policy could never be emptied.
    expect(dayRulesToPayload({})).toEqual({});
  });
});

describe('isWeeklyOffOn', () => {
  const everySunday: WeeklyOffDayRules = { 7: { mode: 'every' } };

  it('matches an every-week rule on that weekday only', () => {
    expect(isWeeklyOffOn(everySunday, '2026-08-16')).toBe(true); // Sunday
    expect(isWeeklyOffOn(everySunday, '2026-08-17')).toBe(false); // Monday
  });

  it('counts ordinals inside the calendar month, not the ISO week', () => {
    // August 2026 Saturdays: 1, 8, 15, 22, 29.
    const secondAndFourth: WeeklyOffDayRules = { 6: { mode: 'ordinals', ordinals: [2, 4] } };

    expect(isWeeklyOffOn(secondAndFourth, '2026-08-01')).toBe(false);
    expect(isWeeklyOffOn(secondAndFourth, '2026-08-08')).toBe(true);
    expect(isWeeklyOffOn(secondAndFourth, '2026-08-15')).toBe(false);
    expect(isWeeklyOffOn(secondAndFourth, '2026-08-22')).toBe(true);
    expect(isWeeklyOffOn(secondAndFourth, '2026-08-29')).toBe(false);
  });

  it('treats "last" as the final occurrence, which is not the same rule as 5', () => {
    const last: WeeklyOffDayRules = { 6: { mode: 'ordinals', ordinals: ['last'] } };
    const fifth: WeeklyOffDayRules = { 6: { mode: 'ordinals', ordinals: [5] } };

    // August 2026 has five Saturdays, so "last" and 5 agree.
    expect(isWeeklyOffOn(last, '2026-08-29')).toBe(true);
    expect(isWeeklyOffOn(fifth, '2026-08-29')).toBe(true);

    // February 2026 has four (7, 14, 21, 28) — "last" is the 28th and a
    // literal 5 matches nothing at all.
    expect(isWeeklyOffOn(last, '2026-02-28')).toBe(true);
    expect(isWeeklyOffOn(fifth, '2026-02-28')).toBe(false);
  });

  it('counts alternate weeks continuously from the anchor, across the month boundary', () => {
    const alternate: WeeklyOffDayRules = {
      6: { mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-01' },
    };

    expect(isWeeklyOffOn(alternate, '2026-08-01')).toBe(true);
    expect(isWeeklyOffOn(alternate, '2026-08-08')).toBe(false);
    expect(isWeeklyOffOn(alternate, '2026-08-15')).toBe(true);
    expect(isWeeklyOffOn(alternate, '2026-08-29')).toBe(true);
    // The count does NOT reset in September: a month-ordinal rule would have
    // said the 5th and 19th.
    expect(isWeeklyOffOn(alternate, '2026-09-05')).toBe(false);
    expect(isWeeklyOffOn(alternate, '2026-09-12')).toBe(true);
    expect(isWeeklyOffOn(alternate, '2026-09-26')).toBe(true);
  });

  it('is never off before the anchor date, and never off without one', () => {
    const anchored: WeeklyOffDayRules = {
      6: { mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-01' },
    };
    expect(isWeeklyOffOn(anchored, '2026-07-18')).toBe(false);

    const inert: WeeklyOffDayRules = {
      6: { mode: 'alternate', interval_weeks: 2, anchor_date: null },
    };
    expect(isWeeklyOffOn(inert, '2026-08-01')).toBe(false);
  });

  it('reads an absent day as a working day', () => {
    expect(isWeeklyOffOn({}, '2026-08-16')).toBe(false);
  });
});

describe('weekdayOccurrencesInMonth', () => {
  it('names every Saturday in the month and says which are off', () => {
    // This is the answer the pane has to show: "2nd and 4th Saturday" is the
    // rule people get wrong, and only the dates make it unambiguous.
    const rules: WeeklyOffDayRules = { 6: { mode: 'ordinals', ordinals: [2, 4] } };

    expect(weekdayOccurrencesInMonth(rules, 6, 2026, 8)).toEqual([
      { date: '2026-08-01', ordinal: 1, isLast: false, isOff: false },
      { date: '2026-08-08', ordinal: 2, isLast: false, isOff: true },
      { date: '2026-08-15', ordinal: 3, isLast: false, isOff: false },
      { date: '2026-08-22', ordinal: 4, isLast: false, isOff: true },
      { date: '2026-08-29', ordinal: 5, isLast: true, isOff: false },
    ]);
  });

  it('marks the last occurrence in a four-occurrence month', () => {
    const occurrences = weekdayOccurrencesInMonth({}, 6, 2026, 2);
    expect(occurrences.map((occurrence) => occurrence.date)).toEqual([
      '2026-02-07',
      '2026-02-14',
      '2026-02-21',
      '2026-02-28',
    ]);
    expect(occurrences[3].isLast).toBe(true);
    expect(occurrences[2].isLast).toBe(false);
  });
});

describe('offDatesInMonth', () => {
  it('lists every off date in the month across all the rules together', () => {
    const rules: WeeklyOffDayRules = {
      7: { mode: 'every' },
      6: { mode: 'ordinals', ordinals: [2, 4] },
    };

    expect(offDatesInMonth(rules, 2026, 8)).toEqual([
      '2026-08-02',
      '2026-08-08',
      '2026-08-09',
      '2026-08-16',
      '2026-08-22',
      '2026-08-23',
      '2026-08-30',
    ]);
  });
});

describe('describeWeeklyOffRule', () => {
  it('spells an ordinal rule out in words', () => {
    expect(describeWeeklyOffRule(6, { mode: 'ordinals', ordinals: [2, 4] })).toBe(
      '2nd and 4th Saturday of each month'
    );
    expect(describeWeeklyOffRule(6, { mode: 'ordinals', ordinals: [1, 3, 'last'] })).toBe(
      '1st, 3rd and last Saturday of each month'
    );
  });

  it('says every week when it is every week', () => {
    expect(describeWeeklyOffRule(7, { mode: 'every' })).toBe('Every Sunday');
  });

  it('names the anchor for an alternate rule, because the count starts there', () => {
    expect(
      describeWeeklyOffRule(6, { mode: 'alternate', interval_weeks: 2, anchor_date: '2026-08-01' })
    ).toBe('Every 2nd Saturday counting continuously from 2026-08-01');
    expect(
      describeWeeklyOffRule(6, { mode: 'alternate', interval_weeks: 3, anchor_date: '2026-08-01' })
    ).toBe('Every 3rd Saturday counting continuously from 2026-08-01');
  });

  it('says plainly that an unanchored alternate rule is never off', () => {
    expect(
      describeWeeklyOffRule(6, { mode: 'alternate', interval_weeks: 2, anchor_date: null })
    ).toBe('Never off — pick the first Saturday that is off to start the count');
  });
});

describe('describeWeeklyOffPolicy', () => {
  it('joins the days into one sentence', () => {
    expect(
      describeWeeklyOffPolicy({
        7: { mode: 'every' },
        6: { mode: 'ordinals', ordinals: [2, 4] },
      })
    ).toBe('2nd and 4th Saturday of each month; Every Sunday');
  });

  it('says nothing is off rather than returning an empty string', () => {
    expect(describeWeeklyOffPolicy({})).toBe('No days off — everyone works every day');
  });
});

describe('setDayRule and toggleOrdinal', () => {
  it('removes the day when the rule is null', () => {
    const rules = setDayRule({ 6: { mode: 'every' } }, 6, null);
    expect(rules).toEqual({});
  });

  it('keeps ordinals sorted with "last" at the end', () => {
    expect(toggleOrdinal([4], 2)).toEqual([2, 4]);
    expect(toggleOrdinal([2, 4], 'last')).toEqual([2, 4, 'last']);
    expect(toggleOrdinal([2, 4, 'last'], 4)).toEqual([2, 'last']);
  });
});

describe('validateWeeklyOffDraft', () => {
  it('requires a name', () => {
    const draft = createEmptyWeeklyOffDraft();
    expect(validateWeeklyOffDraft(draft).name).toBeTruthy();
  });

  it('refuses an ordinal rule with no ordinal picked', () => {
    const draft = { ...createEmptyWeeklyOffDraft(), name: 'Standard' };
    draft.day_rules = { 6: { mode: 'ordinals', ordinals: [] } };
    expect(validateWeeklyOffDraft(draft).day_rules).toBeTruthy();
  });

  it('refuses an alternate rule with no anchor, because it would silently never fire', () => {
    const draft = { ...createEmptyWeeklyOffDraft(), name: 'Standard' };
    draft.day_rules = { 6: { mode: 'alternate', interval_weeks: 2, anchor_date: null } };
    expect(validateWeeklyOffDraft(draft).day_rules).toContain('Saturday');
  });

  it('passes a policy that says something', () => {
    const draft = { ...createEmptyWeeklyOffDraft(), name: 'Standard' };
    draft.day_rules = { 7: { mode: 'every' }, 6: { mode: 'ordinals', ordinals: [2, 4] } };
    expect(validateWeeklyOffDraft(draft)).toEqual({});
  });
});

describe('weeklyOffDraftToPayload', () => {
  it('trims the name and sends the rules as day names', () => {
    const draft = {
      ...createEmptyWeeklyOffDraft(),
      name: '  Standard  ',
      description: ' ',
      day_rules: { 6: { mode: 'ordinals' as const, ordinals: [2, 4] } },
    };

    expect(weeklyOffDraftToPayload(draft)).toEqual({
      name: 'Standard',
      description: null,
      day_rules: { saturday: [2, 4] },
      is_default: false,
      is_active: true,
    });
  });

  it('sends an empty rule set so a policy can be emptied', () => {
    const draft = { ...createEmptyWeeklyOffDraft(), name: 'Standard' };
    expect((weeklyOffDraftToPayload(draft) as Record<string, unknown>).day_rules).toEqual({});
  });
});
