import { describe, expect, it } from 'vitest';
import {
  createEmptyOvertimeDraft,
  createOvertimeScopeRow,
  describeOvertimePolicy,
  formatMultiplier,
  overtimeDraftToPayload,
  previewOvertime,
  rateForScope,
  roundOvertimeMinutes,
  scopeRowsFor,
  validateOvertimeDraft,
  type OvertimeScopeDraft,
} from './overtime';

const scopeRow = (over: Partial<OvertimeScopeDraft>): OvertimeScopeDraft => ({
  ...createOvertimeScopeRow('working_day'),
  ...over,
});

describe('roundOvertimeMinutes', () => {
  it('rounds half up to the increment when the policy says nearest', () => {
    // 37 of 15 stays 30; 38 becomes 45. Same boundary as OvertimeEngine::round.
    expect(roundOvertimeMinutes(37, 'nearest', 15)).toBe(30);
    expect(roundOvertimeMinutes(38, 'nearest', 15)).toBe(45);
  });

  it('rounds strictly up or strictly down when told to', () => {
    expect(roundOvertimeMinutes(31, 'up', 15)).toBe(45);
    expect(roundOvertimeMinutes(44, 'down', 15)).toBe(30);
  });

  it('leaves an exact multiple alone whatever the mode', () => {
    expect(roundOvertimeMinutes(30, 'up', 15)).toBe(30);
    expect(roundOvertimeMinutes(30, 'down', 15)).toBe(30);
  });

  it('passes minutes straight through when there is nothing to round to', () => {
    expect(roundOvertimeMinutes(37, 'nearest', 1)).toBe(37);
    expect(roundOvertimeMinutes(37, 'nearest', 0)).toBe(37);
  });

  it('never returns a negative', () => {
    expect(roundOvertimeMinutes(-10, 'up', 15)).toBe(0);
    expect(roundOvertimeMinutes(0, 'up', 15)).toBe(0);
  });
});

describe('rateForScope', () => {
  const base = scopeRow({ scope: 'working_day', multiplier: '1.5', applies_after_minutes: '0' });
  const extended = scopeRow({ scope: 'working_day', multiplier: '2', applies_after_minutes: '120' });
  const weeklyOff = scopeRow({ scope: 'weekly_off', multiplier: '2', applies_after_minutes: '0' });

  it('reads only the scope asked for', () => {
    expect(rateForScope([base, weeklyOff], 'weekly_off', 60)?.multiplier).toBe('2');
  });

  it('takes the highest tier the overtime has actually reached', () => {
    expect(rateForScope([base, extended], 'working_day', 60)?.multiplier).toBe('1.5');
    expect(rateForScope([base, extended], 'working_day', 180)?.multiplier).toBe('2');
  });

  it('is inclusive at the tier boundary, as the server is', () => {
    expect(rateForScope([base, extended], 'working_day', 120)?.multiplier).toBe('2');
  });

  it('is nothing when no tier has been reached', () => {
    expect(rateForScope([extended], 'working_day', 60)).toBeNull();
    expect(rateForScope([], 'working_day', 600)).toBeNull();
  });

  it('honours a validity window on a temporary rate', () => {
    const festive = scopeRow({
      scope: 'working_day',
      multiplier: '3',
      applies_after_minutes: '0',
      effective_from: '2026-12-25',
      effective_to: '2026-12-26',
    });

    expect(rateForScope([base, festive], 'working_day', 60, '2026-12-25')?.multiplier).toBe('3');
    expect(rateForScope([base, festive], 'working_day', 60, '2026-12-27')?.multiplier).toBe('1.5');
    expect(rateForScope([base, festive], 'working_day', 60, '2026-12-24')?.multiplier).toBe('1.5');
  });

  it('treats an open-ended window as always in force', () => {
    expect(rateForScope([base], 'working_day', 60, '2030-01-01')?.multiplier).toBe('1.5');
  });
});

describe('scopeRowsFor', () => {
  it('groups the rows by scope in the order they were entered', () => {
    const rows = [
      scopeRow({ scope: 'holiday' }),
      scopeRow({ scope: 'working_day', multiplier: '1.5' }),
      scopeRow({ scope: 'working_day', multiplier: '2', applies_after_minutes: '120' }),
    ];

    expect(scopeRowsFor(rows, 'working_day').map((row) => row.multiplier)).toEqual(['1.5', '2']);
    expect(scopeRowsFor(rows, 'weekly_off')).toEqual([]);
  });
});

describe('previewOvertime', () => {
  const draft = () => ({
    ...createEmptyOvertimeDraft(),
    name: 'Standard',
    minimum_minutes_before_accrual: '30',
    rounding: 'nearest' as const,
    rounding_increment_minutes: '15',
    scopes: [
      scopeRow({ scope: 'working_day', multiplier: '1.5', applies_after_minutes: '0' }),
      scopeRow({ scope: 'weekly_off', multiplier: '2', applies_after_minutes: '0', treatment: 'comp_off' }),
    ],
  });

  it('measures a working day against the rostered hours', () => {
    const preview = previewOvertime(draft(), {
      scope: 'working_day',
      workedMinutes: 578,
      expectedMinutes: 480,
      approved: true,
    });

    expect(preview.rawMinutes).toBe(98);
    expect(preview.qualifyingMinutes).toBe(98);
    expect(preview.roundedMinutes).toBe(105);
    expect(preview.multiplier).toBe('1.50');
    expect(preview.treatment).toBe('pay');
  });

  it('drops everything below the minimum, rather than paying a five-minute overrun', () => {
    const preview = previewOvertime(draft(), {
      scope: 'working_day',
      workedMinutes: 500,
      expectedMinutes: 480,
      approved: true,
    });

    expect(preview.rawMinutes).toBe(20);
    expect(preview.qualifyingMinutes).toBe(0);
    expect(preview.roundedMinutes).toBe(0);
  });

  it('counts the whole day on a weekly off, where nothing was rostered', () => {
    const preview = previewOvertime(draft(), {
      scope: 'weekly_off',
      workedMinutes: 240,
      expectedMinutes: 480,
      approved: true,
    });

    expect(preview.expectedMinutes).toBe(0);
    expect(preview.rawMinutes).toBe(240);
    expect(preview.treatment).toBe('comp_off');
    expect(preview.multiplier).toBe('2.00');
  });

  it('falls back to 1x when the policy names no rate for that kind of day', () => {
    const preview = previewOvertime(draft(), {
      scope: 'holiday',
      workedMinutes: 240,
      expectedMinutes: 480,
      approved: true,
    });

    expect(preview.multiplier).toBe('1.00');
    expect(preview.multiplierSource).toBe('default');
    expect(preview.lines.join(' ')).toMatch(/holiday/i);
  });

  it('picks the extended tier off the ROUNDED minutes, the way the engine does', () => {
    const withTier = {
      ...draft(),
      scopes: [
        scopeRow({ scope: 'working_day', multiplier: '1.5', applies_after_minutes: '0' }),
        scopeRow({ scope: 'working_day', multiplier: '2', applies_after_minutes: '105' }),
      ],
    };

    const preview = previewOvertime(withTier, {
      scope: 'working_day',
      workedMinutes: 578,
      expectedMinutes: 480,
      approved: true,
    });

    // 98 raw rounds to 105, which is exactly where the second tier starts.
    expect(preview.roundedMinutes).toBe(105);
    expect(preview.multiplier).toBe('2.00');
    expect(preview.multiplierSource).toBe('policy_scope');
  });

  it('says the hours are not payable yet when approval is required and absent', () => {
    const preview = previewOvertime(draft(), {
      scope: 'working_day',
      workedMinutes: 578,
      expectedMinutes: 480,
      approved: false,
    });

    expect(preview.approvalState).toBe('pending');
    expect(preview.isPayable).toBe(false);
    expect(preview.lines.join(' ')).toMatch(/approv/i);
  });

  it('is payable without approval when the policy does not require it', () => {
    const preview = previewOvertime(
      { ...draft(), requires_approval: false },
      { scope: 'working_day', workedMinutes: 578, expectedMinutes: 480, approved: false }
    );

    expect(preview.approvalState).toBe('not_required');
    expect(preview.isPayable).toBe(true);
  });

  it('has no overtime at all when the day was short', () => {
    const preview = previewOvertime(draft(), {
      scope: 'working_day',
      workedMinutes: 400,
      expectedMinutes: 480,
      approved: true,
    });

    expect(preview.rawMinutes).toBe(0);
    expect(preview.roundedMinutes).toBe(0);
    expect(preview.isPayable).toBe(false);
  });
});

describe('validateOvertimeDraft', () => {
  it('requires a name', () => {
    expect(validateOvertimeDraft(createEmptyOvertimeDraft()).name).toBeTruthy();
  });

  it('rejects a rounding increment outside 1 to 240', () => {
    const draft = { ...createEmptyOvertimeDraft(), name: 'x', rounding_increment_minutes: '0' };
    expect(validateOvertimeDraft(draft).rounding_increment_minutes).toBeTruthy();
  });

  it('rejects a multiplier that is not a number', () => {
    const draft = {
      ...createEmptyOvertimeDraft(),
      name: 'x',
      scopes: [scopeRow({ multiplier: 'double' })],
    };
    expect(validateOvertimeDraft(draft).scopes).toBeTruthy();
  });

  it('rejects a validity window that ends before it starts', () => {
    const draft = {
      ...createEmptyOvertimeDraft(),
      name: 'x',
      scopes: [scopeRow({ effective_from: '2026-12-26', effective_to: '2026-12-25' })],
    };
    expect(validateOvertimeDraft(draft).scopes).toBeTruthy();
  });

  it('rejects two rates for the same scope starting at the same minute', () => {
    const draft = {
      ...createEmptyOvertimeDraft(),
      name: 'x',
      scopes: [
        scopeRow({ scope: 'working_day', applies_after_minutes: '0' }),
        scopeRow({ scope: 'working_day', applies_after_minutes: '0' }),
      ],
    };
    expect(validateOvertimeDraft(draft).scopes).toBeTruthy();
  });

  it('accepts tiers at different minutes for the same scope', () => {
    const draft = {
      ...createEmptyOvertimeDraft(),
      name: 'x',
      scopes: [
        scopeRow({ scope: 'working_day', applies_after_minutes: '0' }),
        scopeRow({ scope: 'working_day', applies_after_minutes: '120' }),
      ],
    };
    expect(validateOvertimeDraft(draft)).toEqual({});
  });
});

describe('overtimeDraftToPayload', () => {
  it('sends multipliers as decimal strings and blank dates as null', () => {
    const draft = {
      ...createEmptyOvertimeDraft(),
      name: '  Standard  ',
      scopes: [scopeRow({ scope: 'weekly_off', multiplier: '2', treatment: 'comp_off' })],
    };

    const payload = overtimeDraftToPayload(draft) as Record<string, unknown>;

    expect(payload.name).toBe('Standard');
    expect(payload.scopes).toEqual([
      {
        scope: 'weekly_off',
        treatment: 'comp_off',
        multiplier: '2.00',
        applies_after_minutes: 0,
        effective_from: null,
        effective_to: null,
      },
    ]);
  });

  it('sends an empty scope list so every rate can be cleared', () => {
    const draft = { ...createEmptyOvertimeDraft(), name: 'x', scopes: [] };
    expect((overtimeDraftToPayload(draft) as Record<string, unknown>).scopes).toEqual([]);
  });

  it('sends a blank pay code as null rather than an empty string', () => {
    const draft = { ...createEmptyOvertimeDraft(), name: 'x', pay_code: '  ' };
    expect((overtimeDraftToPayload(draft) as Record<string, unknown>).pay_code).toBeNull();
  });
});

describe('formatMultiplier', () => {
  it('reads as a rate, not a decimal', () => {
    expect(formatMultiplier('1.50')).toBe('1.5x');
    expect(formatMultiplier('2.00')).toBe('2x');
    expect(formatMultiplier('1')).toBe('1x');
  });
});

describe('describeOvertimePolicy', () => {
  it('says the basis, the threshold, the rounding and the gate', () => {
    expect(
      describeOvertimePolicy({
        hours_basis: 'gross',
        minimum_minutes_before_accrual: 30,
        rounding: 'nearest',
        rounding_increment_minutes: 15,
        requires_approval: true,
      })
    ).toBe('Gross hours · after 30m · rounded to the nearest 15m · approval required');
  });

  it('drops the threshold when overtime accrues from the first minute', () => {
    expect(
      describeOvertimePolicy({
        hours_basis: 'effective',
        minimum_minutes_before_accrual: 0,
        rounding: 'up',
        rounding_increment_minutes: 30,
        requires_approval: false,
      })
    ).toBe('Effective hours · rounded up to 30m · no approval needed');
  });
});
