import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import TeamLeaveBalances from '@/features/leave/TeamLeaveBalances';

const row = (over: Record<string, any> = {}) => ({
  user: { id: 1, name: 'Zara Khan', email: 'zara@example.com', department: 'Design', ...over.user },
  balance: {
    categories: [{ code: 'paid', name: 'Paid Leave', remaining: 17, annual_quota: 21, used: 4 }],
    unpaid: { used: 0 },
    ...over.balance,
  },
});

const renderPanel = (rows: any[]) =>
  render(<TeamLeaveBalances rows={rows} isLoading={false} onRefresh={vi.fn()} colorOf={() => '#5D969D'} />);

describe('TeamLeaveBalances', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('collapses departments so scroll does not grow with headcount', () => {
    renderPanel([
      row(),
      row({ user: { id: 2, name: 'Amit Kulkarni', department: 'Engineering' } }),
    ]);

    expect(screen.getByText('Design')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    // Nobody's row renders until a group is opened.
    expect(screen.queryByText('Zara Khan')).not.toBeInTheDocument();
  });

  it('expands a department on click and shows its members with bars', () => {
    renderPanel([row()]);

    fireEvent.click(screen.getByRole('button', { name: /Design/ }));
    expect(screen.getByText('Zara Khan')).toBeInTheDocument();
    expect(screen.getByText('Paid Leave')).toBeInTheDocument();
  });

  it('flags on the summary line when someone has a category at zero', () => {
    renderPanel([
      row({ balance: { categories: [{ code: 'paid', name: 'Paid Leave', remaining: 0, annual_quota: 21, used: 21 }], unpaid: { used: 0 } } }),
      row({ user: { id: 2, name: 'Amit Kulkarni', department: 'Design' } }),
    ]);

    // Readable without opening the group.
    expect(screen.getByText('1 with a category at zero')).toBeInTheDocument();
  });

  it('search cuts across groups and expands the matches', () => {
    renderPanel([
      row(),
      row({ user: { id: 2, name: 'Amit Kulkarni', department: 'Engineering' } }),
    ]);

    fireEvent.change(screen.getByLabelText('Search team balances'), { target: { value: 'amit' } });

    expect(screen.getByText('Amit Kulkarni')).toBeInTheDocument();
    expect(screen.queryByText('Design')).not.toBeInTheDocument();
  });

  it('groups people without a department explicitly', () => {
    renderPanel([row({ user: { id: 3, name: 'Lost Person', department: '' } })]);

    expect(screen.getByText('No department')).toBeInTheDocument();
  });
});
