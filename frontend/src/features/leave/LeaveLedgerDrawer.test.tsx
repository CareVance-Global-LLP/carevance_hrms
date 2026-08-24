import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

const ledger = vi.fn();

vi.mock('@/services/api', () => ({
  leaveTypeApi: {
    ledger: (...args: unknown[]) => ledger(...args),
  },
}));

import LeaveLedgerDrawer from './LeaveLedgerDrawer';

const cycle = { start_date: '2026-04-01', end_date: '2027-03-31' };

const paid = { id: 1, code: 'paid', name: 'Paid Leave' };

function entry(over: Record<string, unknown>) {
  return {
    id: 1,
    leave_type_id: 1,
    kind: 'accrual',
    units: 1.5,
    effective_on: '2026-04-30',
    leave_type: paid,
    ...over,
  };
}

beforeEach(() => {
  ledger.mockReset();
});

/**
 * The point of the ledger is that a balance can be expanded into the rows that
 * produced it. These hold the two things that would break that: a running
 * column that does not actually run, and a total that disagrees with the card
 * it is explaining.
 */
describe('leave ledger drawer', () => {
  it('carries a running balance down the rows', async () => {
    ledger.mockResolvedValue({
      data: {
        cycle,
        entries: [
          entry({ id: 1, kind: 'accrual', units: 1.5, effective_on: '2026-04-30' }),
          entry({ id: 2, kind: 'accrual', units: 1.5, effective_on: '2026-05-31' }),
          entry({ id: 3, kind: 'consumption', units: -1, effective_on: '2026-06-04' }),
        ],
        balance: { totals: { quota: 3, used: 1, remaining: 2 } },
      },
    });

    render(<LeaveLedgerDrawer open userId={7} onClose={vi.fn()} />);

    const consumed = await screen.findByText('Taken');
    const row = consumed.closest('tr')!;

    // 1.5 + 1.5 - 1: the arithmetic on screen is the arithmetic, so there is no
    // second calculation that could disagree with it.
    expect(within(row).getByText('-1')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('names the difference instead of quietly showing a number the card does not', async () => {
    ledger.mockResolvedValue({
      data: {
        cycle,
        entries: [
          entry({ id: 1, kind: 'accrual', units: 1, effective_on: '2026-04-30' }),
          entry({ id: 2, kind: 'consumption', units: -3, effective_on: '2026-05-04' }),
        ],
        balance: { totals: { quota: 1, used: 3, remaining: 0 } },
      },
    });

    render(<LeaveLedgerDrawer open userId={7} onClose={vi.fn()} />);

    // The balance cards floor at zero; the ledger does not. Saying so beats
    // showing two different numbers and letting somebody find the gap.
    expect(await screen.findByText(/balance card shows 0/i)).toBeInTheDocument();
  });

  it('separates an empty leave year from a failed load', async () => {
    ledger.mockRejectedValue(new Error('offline'));

    render(<LeaveLedgerDrawer open userId={7} onClose={vi.fn()} />);

    // "Nothing credited" and "could not load" mean opposite things to somebody
    // checking whether their leave arrived.
    expect(await screen.findByText(/could not load the breakdown/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing has been credited/i)).not.toBeInTheDocument();
  });

  it('does not fetch until it is opened', () => {
    render(<LeaveLedgerDrawer open={false} userId={7} onClose={vi.fn()} />);

    expect(ledger).not.toHaveBeenCalled();
  });
});
