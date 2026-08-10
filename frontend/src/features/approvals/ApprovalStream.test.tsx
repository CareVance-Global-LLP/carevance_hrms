import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ApprovalStream, { ageInDays, type StreamCard } from './ApprovalStream';

const card = (over: Partial<StreamCard>): StreamCard => ({
  id: 1,
  kind: 'leave',
  submittedAt: new Date().toISOString(),
  description: 'A reason.',
  employeeName: 'Zara Khan',
  employeeEmail: 'zara@example.com',
  status: 'pending',
  onApprove: vi.fn().mockResolvedValue(undefined),
  onReject: vi.fn().mockResolvedValue(undefined),
  ...over,
});

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const baseProps = {
  filter: 'all' as const,
  onFilterChange: vi.fn(),
  view: 'pending' as const,
  onViewChange: vi.fn(),
  visibleKinds: ['leave', 'time-edit', 'resignation', 'payroll-lock'] as const,
  isLoading: false,
  busy: false,
  onAction: vi.fn(),
  onBulk: vi.fn(),
};

describe('ApprovalStream', () => {
  it('shows every pending kind in one stream with per-kind counts on the chips', () => {
    render(
      <ApprovalStream
        {...baseProps}
        visibleKinds={[...baseProps.visibleKinds]}
        pending={[
          card({ id: 1, kind: 'leave', employeeName: 'Zara Khan' }),
          card({ id: 2, kind: 'time-edit', employeeName: 'Rohan Ghosh', attendanceDate: '2026-08-13', extraSeconds: 7200 }),
          card({ id: 3, kind: 'resignation', employeeName: 'Harsh Kapoor', lastWorkingDate: '2026-09-12' }),
        ]}
        history={[]}
      />
    );

    // All three render without switching any section.
    expect(screen.getByText('Zara Khan')).toBeInTheDocument();
    expect(screen.getByText('Rohan Ghosh')).toBeInTheDocument();
    expect(screen.getByText('Harsh Kapoor')).toBeInTheDocument();

    const everything = screen.getByRole('button', { name: /Everything/ });
    expect(within(everything).getByText('3')).toBeInTheDocument();
  });

  it('orders pending oldest-first so the longest-waiting request is on top', () => {
    render(
      <ApprovalStream
        {...baseProps}
        visibleKinds={[...baseProps.visibleKinds]}
        pending={[
          card({ id: 1, employeeName: 'Fresh Today', submittedAt: daysAgo(0) }),
          card({ id: 2, employeeName: 'Waiting Longest', submittedAt: daysAgo(5) }),
        ]}
        history={[]}
      />
    );

    const names = screen.getAllByText(/Fresh Today|Waiting Longest/).map((el) => el.textContent);
    expect(names[0]).toBe('Waiting Longest');
  });

  it('bulk-approves exactly the selected cards', () => {
    const onBulk = vi.fn();
    const first = card({ id: 1, employeeName: 'Zara Khan' });
    const second = card({ id: 2, kind: 'time-edit', employeeName: 'Rohan Ghosh' });

    render(
      <ApprovalStream
        {...baseProps}
        visibleKinds={[...baseProps.visibleKinds]}
        onBulk={onBulk}
        pending={[first, second]}
        history={[]}
      />
    );

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select request from Zara Khan' }));
    fireEvent.click(screen.getByRole('button', { name: /Approve all/ }));

    expect(onBulk).toHaveBeenCalledTimes(1);
    const [cards, decision] = onBulk.mock.calls[0];
    expect(decision).toBe('approve');
    expect(cards).toHaveLength(1);
    expect(cards[0].employeeName).toBe('Zara Khan');
  });

  it('shows coverage on pending leave rows', () => {
    render(
      <ApprovalStream
        {...baseProps}
        visibleKinds={[...baseProps.visibleKinds]}
        pending={[card({ id: 1, startDate: '2026-08-18', endDate: '2026-08-20', userId: 9 })]}
        history={[]}
        coverageFor={() => ({ count: 2, label: '2 teammates already off in this span' })}
      />
    );

    expect(screen.getByText('2 teammates already off in this span')).toBeInTheDocument();
  });

  it('blocks self-approval on payroll locks but leaves reject available', () => {
    render(
      <ApprovalStream
        {...baseProps}
        visibleKinds={[...baseProps.visibleKinds]}
        pending={[card({ id: 1, kind: 'payroll-lock', employeeName: 'Payroll · August', isSelfApproval: true, title: 'Pay Group — 2026-08' })]}
        history={[]}
      />
    );

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('history rows carry a status pill and no checkboxes', () => {
    render(
      <ApprovalStream
        {...baseProps}
        visibleKinds={[...baseProps.visibleKinds]}
        view="history"
        pending={[]}
        history={[
          card({ id: 1, status: 'approved', onApprove: undefined, onReject: undefined, reviewedAt: daysAgo(1), reviewerName: 'Admin' }),
        ]}
      />
    );

    expect(screen.getByText('approved')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('expands a row to reveal the description', () => {
    render(
      <ApprovalStream
        {...baseProps}
        visibleKinds={[...baseProps.visibleKinds]}
        pending={[card({ id: 1, description: 'Family function in Jaipur.' })]}
        history={[]}
      />
    );

    expect(screen.queryByText('Family function in Jaipur.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('Family function in Jaipur.')).toBeInTheDocument();
  });

  it('ageInDays clamps invalid dates to zero', () => {
    expect(ageInDays('nonsense')).toBe(0);
    expect(ageInDays(daysAgo(3))).toBe(3);
  });
});
