import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeaveRequestsPanel from '@/features/leave/LeaveRequestsPanel';

const request = (over: Record<string, unknown> = {}) => ({
  id: 1,
  user: { id: 2, name: 'Zara Khan' },
  start_date: '2026-08-18',
  end_date: '2026-08-20',
  leave_type: 'full_day',
  leave_category: 'casual',
  status: 'pending',
  reason: null,
  revoke_status: null,
  consumed_breakdown: [],
  ...over,
});

const renderPanel = (requests: any[], props: Partial<React.ComponentProps<typeof LeaveRequestsPanel>> = {}) =>
  render(
    <LeaveRequestsPanel
      requests={requests}
      currentUserId={1}
      hasApprovalPowers
      isLoading={false}
      canReview={() => true}
      canRequestRevoke={() => false}
      isAdmin={false}
      onApprove={vi.fn()}
      onReject={vi.fn()}
      onRequestRevoke={vi.fn()}
      onApproveRevoke={vi.fn()}
      onRejectRevoke={vi.fn()}
      formatCategoryLabel={(code) => String(code || '')}
      colorOf={() => '#5D969D'}
      renderEscalate={() => null}
      {...props}
    />
  );

describe('LeaveRequestsPanel', () => {
  it('separates the approval inbox from history and defaults to it for approvers', () => {
    renderPanel([
      request({ id: 1, status: 'pending' }),
      request({ id: 2, status: 'approved', user: { id: 3, name: 'Amit Kulkarni' } }),
      request({ id: 3, status: 'pending', user: { id: 1, name: 'Me' } }),
    ]);

    // Inbox = pending, reviewable, not my own request.
    expect(screen.getByRole('button', { name: /Needs my approval/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Zara Khan')).toBeInTheDocument();
    expect(screen.queryByText('Amit Kulkarni')).not.toBeInTheDocument();
    expect(screen.queryByText('Me')).not.toBeInTheDocument();
  });

  it('hides the inbox segment from people who cannot approve', () => {
    renderPanel([request()], { hasApprovalPowers: false });

    expect(screen.queryByRole('button', { name: /Needs my approval/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Mine/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('warns the approver when teammates are already off in the same span', () => {
    renderPanel([
      request({ id: 1, status: 'pending' }),
      request({ id: 2, status: 'approved', user: { id: 4, name: 'Priya Shah' }, start_date: '2026-08-19', end_date: '2026-08-19' }),
    ]);

    expect(screen.getByText(/1 teammate already off in this span/)).toBeInTheDocument();
    expect(screen.getByText(/Priya/)).toBeInTheDocument();
  });

  it('reassures the approver when nobody else is off', () => {
    renderPanel([request()]);

    expect(screen.getByText('Nobody else off in this span')).toBeInTheDocument();
  });

  it('fires the approve handler from the card', () => {
    const onApprove = vi.fn();
    renderPanel([request()], { onApprove });

    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledWith(1);
  });

  it('celebrates an empty inbox instead of rendering a blank box', () => {
    renderPanel([request({ status: 'approved' })]);

    expect(screen.getByText('Nothing waiting on you')).toBeInTheDocument();
  });
});
