import { describe, expect, it } from 'vitest';
import {
  decimalToInputValue,
  describeBurn,
  formatBudget,
  getProjectBurn,
  sortProjects,
} from './projectUtils';
import type { Project } from '@/types';

const project = (overrides: Partial<Project> = {}): Project =>
  ({
    id: 1,
    organization_id: 1,
    name: 'Website Redesign',
    color: '#EF4444',
    status: 'active',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tracked_seconds: 0,
    ...overrides,
  }) as Project;

const HOUR = 3600;

describe('getProjectBurn — hours budgets', () => {
  it('measures tracked time against the budget', () => {
    const burn = getProjectBurn(project({ budget: 100, tracked_seconds: 90 * HOUR }));

    expect(burn.budgetType).toBe('hours');
    expect(burn.percent).toBe(90);
    expect(burn.tone).toBe('warn');
    expect(burn.spentAmount).toBeNull();
    expect(burn.unavailable).toBeNull();
  });

  it('reports over-budget without capping the percentage', () => {
    const burn = getProjectBurn(project({ budget: 100, tracked_seconds: 110 * HOUR }));

    expect(burn.percent).toBe(110);
    expect(burn.tone).toBe('over');
  });

  it('treats a row with no budget_type as hours', () => {
    // Older cached responses predate the column; it defaults to 'hours'.
    const burn = getProjectBurn(project({ budget: 100, budget_type: undefined, tracked_seconds: 50 * HOUR }));

    expect(burn.budgetType).toBe('hours');
    expect(burn.percent).toBe(50);
  });
});

describe('getProjectBurn — amount budgets', () => {
  it('prices tracked time with the hourly rate', () => {
    const burn = getProjectBurn(
      project({ budget: 150000, budget_type: 'amount', hourly_rate: 1200, tracked_seconds: 10 * HOUR })
    );

    expect(burn.spentAmount).toBe(12000);
    expect(burn.percent).toBe(8);
    expect(burn.tone).toBe('good');
    expect(burn.unavailable).toBeNull();
  });

  it('keeps the budget but cannot compute usage without a rate', () => {
    const burn = getProjectBurn(
      project({ budget: 150000, budget_type: 'amount', hourly_rate: null, tracked_seconds: 10 * HOUR })
    );

    expect(burn.unavailable).toBe('no-rate');
    expect(burn.percent).toBeNull();
    expect(burn.spentAmount).toBeNull();
    // The figure is still known — only the percentage is missing.
    expect(burn.budgetValue).toBe(150000);
  });
});

describe('getProjectBurn — unset and malformed values', () => {
  it('reports no budget when there is none', () => {
    expect(getProjectBurn(project({ budget: null })).unavailable).toBe('no-budget');
    expect(getProjectBurn(project({ budget: undefined })).unavailable).toBe('no-budget');
  });

  it('treats zero and negative budgets as unset rather than dividing by them', () => {
    const zero = getProjectBurn(project({ budget: 0, tracked_seconds: 10 * HOUR }));
    const negative = getProjectBurn(project({ budget: '-5', tracked_seconds: 10 * HOUR }));

    expect(zero.unavailable).toBe('no-budget');
    expect(zero.percent).toBeNull();
    expect(negative.unavailable).toBe('no-budget');
    expect(negative.percent).toBeNull();
  });

  it('handles the decimal:2 strings the API actually returns', () => {
    // The server casts these decimal:2, so they arrive as "150000.00".
    const fromStrings = getProjectBurn(
      project({
        budget: '150000.00',
        budget_type: 'amount',
        hourly_rate: '1200.00',
        tracked_seconds: 10 * HOUR,
      })
    );
    const fromNumbers = getProjectBurn(
      project({ budget: 150000, budget_type: 'amount', hourly_rate: 1200, tracked_seconds: 10 * HOUR })
    );

    expect(fromStrings.percent).toBe(fromNumbers.percent);
    expect(fromStrings.spentAmount).toBe(fromNumbers.spentAmount);
    expect(fromStrings.budgetValue).toBe(150000);
  });
});

describe('formatBudget', () => {
  it('renders hours with separators and an h suffix', () => {
    expect(formatBudget(getProjectBurn(project({ budget: 150000 })))).toBe('1,50,000h');
  });

  it('renders amounts as currency', () => {
    expect(formatBudget(getProjectBurn(project({ budget: 150000, budget_type: 'amount' })))).toBe(
      '₹1,50,000'
    );
  });

  it('renders an em dash when there is no budget', () => {
    expect(formatBudget(getProjectBurn(project({ budget: null })))).toBe('—');
  });
});

describe('describeBurn', () => {
  it('distinguishes a missing budget from a missing rate', () => {
    expect(describeBurn('Alpha', getProjectBurn(project({ budget: null })))).toBe('Alpha: no budget set');
    expect(
      describeBurn('Alpha', getProjectBurn(project({ budget: 150000, budget_type: 'amount' })))
    ).toBe('Alpha: budget ₹1,50,000, no hourly rate set');
    expect(describeBurn('Alpha', getProjectBurn(project({ budget: 100, tracked_seconds: 50 * HOUR })))).toBe(
      'Alpha: 50% of budget used'
    );
  });
});

describe('sortProjects by burn', () => {
  it('ranks mixed units against each other and sinks the unmeasurable', () => {
    const overMoney = project({
      id: 1,
      name: 'Over money',
      budget: 10000,
      budget_type: 'amount',
      hourly_rate: 1000,
      tracked_seconds: 12 * HOUR, // ₹12,000 of a ₹10,000 budget = 120%
    });
    const underHours = project({
      id: 2,
      name: 'Under hours',
      budget: 100,
      tracked_seconds: 80 * HOUR, // 80%
    });
    const noBudget = project({ id: 3, name: 'No budget', budget: null });

    const sorted = sortProjects([noBudget, underHours, overMoney], 'burn');

    expect(sorted.map((item) => item.name)).toEqual(['Over money', 'Under hours', 'No budget']);
  });
});

describe('decimalToInputValue', () => {
  it('strips the trailing zeroes a decimal cast adds', () => {
    expect(decimalToInputValue('150000.00')).toBe('150000');
    expect(decimalToInputValue(1200)).toBe('1200');
    expect(decimalToInputValue('1200.50')).toBe('1200.5');
  });

  it('returns an empty string for anything unset', () => {
    expect(decimalToInputValue(null)).toBe('');
    expect(decimalToInputValue(undefined)).toBe('');
    expect(decimalToInputValue('')).toBe('');
  });
});
