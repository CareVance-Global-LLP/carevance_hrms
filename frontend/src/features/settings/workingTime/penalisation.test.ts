import { describe, expect, it } from 'vitest';
import {
  createEmptyPenalisationDraft,
  createHalfDayRung,
  describePenalisationPolicy,
  formatLeaves,
  penalisationDraftToPayload,
  previewPenalisation,
  rungForPercentWorked,
  sortLadder,
  validateHalfDayLadder,
  validatePenalisationDraft,
  type HalfDayRungDraft,
} from './penalisation';

const ladder = (...rungs: Array<[string, string]>): HalfDayRungDraft[] =>
  rungs.map(([percent, leaves]) => ({ percent, leaves }));

describe('sortLadder', () => {
  it('puts the rungs in ascending percent, which is the order they are read in', () => {
    // The server walks the ladder in sort_order and applies the FIRST rung the
    // day falls below. Out of order, a 25% day would be judged by the 50%
    // rung and cost half a day instead of a full one.
    expect(sortLadder(ladder(['50', '0.5'], ['25', '1']))).toEqual(
      ladder(['25', '1'], ['50', '0.5'])
    );
  });

  it('does not mutate the array it was given', () => {
    const original = ladder(['50', '0.5'], ['25', '1']);
    sortLadder(original);
    expect(original[0].percent).toBe('50');
  });
});

describe('rungForPercentWorked', () => {
  const bands = ladder(['25', '1'], ['50', '0.5']);

  it('applies the first rung the day falls below', () => {
    expect(rungForPercentWorked(bands, 10)?.percent).toBe('25');
    expect(rungForPercentWorked(bands, 40)?.percent).toBe('50');
  });

  it('is nothing when the day clears the top rung', () => {
    expect(rungForPercentWorked(bands, 60)).toBeNull();
    expect(rungForPercentWorked(bands, 100)).toBeNull();
  });

  it('is exclusive at the boundary, exactly as the server is', () => {
    // `percentWorked < rung` on the server. A day that works precisely 25% of
    // the shift is NOT below the 25% rung.
    expect(rungForPercentWorked(bands, 25)?.percent).toBe('50');
    expect(rungForPercentWorked(bands, 50)).toBeNull();
  });

  it('reads the rungs in ascending order however they were entered', () => {
    expect(rungForPercentWorked(ladder(['50', '0.5'], ['25', '1']), 10)?.percent).toBe('25');
  });

  it('is nothing when there is no ladder at all', () => {
    expect(rungForPercentWorked([], 10)).toBeNull();
  });
});

describe('validateHalfDayLadder', () => {
  it('accepts a well-formed descending ladder', () => {
    expect(validateHalfDayLadder(ladder(['25', '1'], ['50', '0.5']))).toEqual([]);
  });

  it('rejects a percent outside 0 to 100', () => {
    expect(validateHalfDayLadder(ladder(['120', '1'])).join(' ')).toContain('100');
    expect(validateHalfDayLadder(ladder(['-5', '1'])).length).toBe(1);
  });

  it('rejects values that are not numbers', () => {
    expect(validateHalfDayLadder(ladder(['half', '1'])).length).toBe(1);
    expect(validateHalfDayLadder(ladder(['25', 'one'])).length).toBe(1);
  });

  it('rejects two rungs at the same percent, because the second can never fire', () => {
    expect(validateHalfDayLadder(ladder(['25', '1'], ['25', '0.5'])).join(' ')).toContain('25');
  });

  it('flags a ladder where working less costs less', () => {
    // [{25%, 0.5}, {50%, 1.0}] deducts MORE from someone who worked more. It
    // is syntactically fine and semantically backwards, and the server has no
    // way to tell that apart from a deliberate rule.
    const problems = validateHalfDayLadder(ladder(['25', '0.5'], ['50', '1']));
    expect(problems.length).toBe(1);
    expect(problems[0]).toMatch(/less/i);
  });

  it('has nothing to say about an empty ladder', () => {
    expect(validateHalfDayLadder([])).toEqual([]);
  });
});

describe('previewPenalisation', () => {
  const draft = () => ({
    ...createEmptyPenalisationDraft(),
    name: 'Standard',
    grace_period_minutes: '15',
    half_day_rules: ladder(['25', '1'], ['50', '0.5']),
  });

  it('reads a full day inside the grace period as clear', () => {
    const preview = previewPenalisation(draft(), {
      shiftMinutes: 480,
      workedMinutes: 480,
      lateMinutes: 10,
    });

    expect(preview.isLate).toBe(false);
    expect(preview.leavesDeducted).toBe('0.00');
    expect(preview.deductedFrom).toBe('nothing');
    expect(preview.status).toBe('clear');
  });

  it('is late only past the grace period, not at it', () => {
    expect(
      previewPenalisation(draft(), { shiftMinutes: 480, workedMinutes: 480, lateMinutes: 15 })
        .isLate
    ).toBe(false);
    expect(
      previewPenalisation(draft(), { shiftMinutes: 480, workedMinutes: 480, lateMinutes: 16 })
        .isLate
    ).toBe(true);
  });

  it('deducts half a day for a short day that falls below the 50% rung', () => {
    const preview = previewPenalisation(draft(), {
      shiftMinutes: 480,
      workedMinutes: 210,
      lateMinutes: 0,
    });

    expect(preview.percentWorked).toBe('43.75');
    expect(preview.rungPercent).toBe('50');
    expect(preview.leavesDeducted).toBe('0.50');
    expect(preview.status).toBe('half_day');
    expect(preview.deductedFrom).toBe('leave balance');
  });

  it('sends the deduction to pay when the policy treats penalties as loss of pay', () => {
    const preview = previewPenalisation(
      { ...draft(), treat_penalties_as_lop: true },
      { shiftMinutes: 480, workedMinutes: 210, lateMinutes: 0 }
    );

    expect(preview.deductedFrom).toBe('loss of pay');
    expect(preview.lopDays).toBe('0.50');
  });

  it('never sends a zero deduction to pay', () => {
    const preview = previewPenalisation(
      { ...draft(), treat_penalties_as_lop: true },
      { shiftMinutes: 480, workedMinutes: 480, lateMinutes: 0 }
    );

    expect(preview.deductedFrom).toBe('nothing');
    expect(preview.lopDays).toBe('0.00');
  });

  it('treats a day under the no-show bar as a whole day, ahead of any rung', () => {
    const preview = previewPenalisation(
      { ...draft(), no_show_below_hours: '2' },
      { shiftMinutes: 480, workedMinutes: 90, lateMinutes: 0 }
    );

    expect(preview.isNoShow).toBe(true);
    expect(preview.status).toBe('no_show');
    expect(preview.leavesDeducted).toBe('1.00');
    // The 25% rung would also have said 1.00 — the point is that the no-show
    // reason is the one reported, so the person reading it knows which rule bit.
    expect(preview.rungPercent).toBeNull();
  });

  it('runs no no-show rule at all when the bar is blank, which is not a bar of zero', () => {
    const preview = previewPenalisation(draft(), {
      shiftMinutes: 480,
      workedMinutes: 0,
      lateMinutes: 0,
    });

    expect(preview.isNoShow).toBe(false);
    expect(preview.leavesDeducted).toBe('1.00'); // the 25% rung, not the no-show rule
  });

  it('waives the late penalty when the hours were completed and the policy says to', () => {
    const preview = previewPenalisation(
      { ...draft(), ignore_late_when_hours_met: true },
      { shiftMinutes: 480, workedMinutes: 480, lateMinutes: 60 }
    );

    expect(preview.isLate).toBe(true);
    expect(preview.lateWaivedBy).toBe('hours_met');
    expect(preview.lines.join(' ')).toMatch(/waived/i);
  });

  it('does not waive when the hours were not completed', () => {
    const preview = previewPenalisation(
      { ...draft(), ignore_late_when_hours_met: true },
      { shiftMinutes: 480, workedMinutes: 400, lateMinutes: 60 }
    );

    expect(preview.lateWaivedBy).toBeNull();
  });

  it('reports the exemption before the threshold, in the policy cycle', () => {
    const preview = previewPenalisation(
      { ...draft(), exemptions_per_cycle: '2', late_threshold: '3', cycle: 'monthly' },
      { shiftMinutes: 480, workedMinutes: 480, lateMinutes: 60 }
    );

    expect(preview.lines.join(' ')).toContain('2');
    expect(preview.lines.join(' ')).toContain('monthly');
  });

  it('has no percentage to report when nothing is rostered', () => {
    const preview = previewPenalisation(draft(), {
      shiftMinutes: 0,
      workedMinutes: 0,
      lateMinutes: 0,
    });

    expect(preview.percentWorked).toBeNull();
    expect(preview.leavesDeducted).toBe('0.00');
  });
});

describe('formatLeaves', () => {
  it('always shows two decimals, because half a day is 0.50 not 0.5', () => {
    expect(formatLeaves(50)).toBe('0.50');
    expect(formatLeaves(100)).toBe('1.00');
    expect(formatLeaves(0)).toBe('0.00');
    expect(formatLeaves(125)).toBe('1.25');
  });
});

describe('validatePenalisationDraft', () => {
  it('requires a name', () => {
    expect(validatePenalisationDraft(createEmptyPenalisationDraft()).name).toBeTruthy();
  });

  it('rejects a grace period that is not a whole number of minutes', () => {
    const draft = { ...createEmptyPenalisationDraft(), name: 'x', grace_period_minutes: '7.5' };
    expect(validatePenalisationDraft(draft).grace_period_minutes).toBeTruthy();
  });

  it('rejects a no-show bar longer than a day', () => {
    const draft = { ...createEmptyPenalisationDraft(), name: 'x', no_show_below_hours: '30' };
    expect(validatePenalisationDraft(draft).no_show_below_hours).toBeTruthy();
  });

  it('accepts a blank no-show bar as "no rule"', () => {
    const draft = { ...createEmptyPenalisationDraft(), name: 'x', no_show_below_hours: '' };
    expect(validatePenalisationDraft(draft).no_show_below_hours).toBeUndefined();
  });

  it('carries the ladder problems through', () => {
    const draft = {
      ...createEmptyPenalisationDraft(),
      name: 'x',
      half_day_rules: ladder(['25', '1'], ['25', '0.5']),
    };
    expect(validatePenalisationDraft(draft).half_day_rules).toBeTruthy();
  });
});

describe('penalisationDraftToPayload', () => {
  it('sends the ladder sorted, numbered and as decimal strings', () => {
    const draft = {
      ...createEmptyPenalisationDraft(),
      name: '  Standard  ',
      grace_period_minutes: '15',
      half_day_rules: ladder(['50', '0.5'], ['25', '1']),
    };

    const payload = penalisationDraftToPayload(draft) as Record<string, unknown>;

    expect(payload.name).toBe('Standard');
    expect(payload.grace_period_minutes).toBe(15);
    expect(payload.half_day_rules).toEqual([
      { sort_order: 0, percent_of_shift_hours: '25.00', leaves_deducted: '1.00' },
      { sort_order: 1, percent_of_shift_hours: '50.00', leaves_deducted: '0.50' },
    ]);
  });

  it('sends a blank no-show bar as null, not zero', () => {
    // Zero is a real bar that nobody can fall under. Null is "no rule".
    const draft = { ...createEmptyPenalisationDraft(), name: 'x', no_show_below_hours: '' };
    expect((penalisationDraftToPayload(draft) as Record<string, unknown>).no_show_below_hours)
      .toBeNull();
  });

  it('sends an empty ladder as an empty array so the rungs can be cleared', () => {
    const draft = { ...createEmptyPenalisationDraft(), name: 'x', half_day_rules: [] };
    expect((penalisationDraftToPayload(draft) as Record<string, unknown>).half_day_rules)
      .toEqual([]);
  });
});

describe('describePenalisationPolicy', () => {
  it('leads with the rule, not the name', () => {
    expect(
      describePenalisationPolicy({
        grace_period_minutes: 15,
        late_rule_type: 'incident',
        late_threshold: '3.00',
        exemptions_per_cycle: 2,
        cycle: 'monthly',
      })
    ).toBe('15m grace · 3 late arrivals a month · 2 exempt');
  });

  it('says hours when the rule counts hours', () => {
    expect(
      describePenalisationPolicy({
        grace_period_minutes: 0,
        late_rule_type: 'hours',
        late_threshold: '1.50',
        exemptions_per_cycle: 0,
        cycle: 'weekly',
      })
    ).toBe('No grace · 1.5 late hours a week');
  });
});

describe('createHalfDayRung', () => {
  it('starts a new rung blank rather than guessing a band', () => {
    expect(createHalfDayRung()).toEqual({ percent: '', leaves: '' });
  });
});
