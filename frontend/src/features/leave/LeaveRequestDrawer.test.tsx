import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import LeaveRequestDrawer from '@/features/leave/LeaveRequestDrawer';
import type { LeaveCategoryBalance } from '@/features/leave/leaveUtils';

const CATEGORIES: LeaveCategoryBalance[] = [
  { code: 'casual', name: 'Casual', remaining: 4, annual_quota: 12, used: 8 },
  { code: 'sick', name: 'Sick', remaining: 0, annual_quota: 8, used: 8 },
];

const renderDrawer = (props: Partial<React.ComponentProps<typeof LeaveRequestDrawer>> = {}) =>
  render(
    <LeaveRequestDrawer
      open
      onClose={vi.fn()}
      categories={CATEGORIES}
      holidayDates={new Set(['2026-08-19'])}
      submitting={false}
      onSubmit={vi.fn().mockResolvedValue(true)}
      {...props}
    />
  );

/** Fixed 2026 dates keep the maths deterministic whatever day the suite runs. */
const setRange = (from: string, to?: string) => {
  fireEvent.change(screen.getByLabelText('From'), { target: { value: from } });
  if (to) fireEvent.change(screen.getByLabelText('To'), { target: { value: to } });
};

describe('LeaveRequestDrawer', () => {
  it('prices the range before submit, holidays and weekends excluded', () => {
    renderDrawer();
    // Mon 17 → Fri 21 with a holiday on the 19th.
    setRange('2026-08-17', '2026-08-21');

    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/1 holiday skipped/)).toBeInTheDocument();
    // Casual: 4 remaining → 0 after.
    expect(screen.getByText('4.0 → 0.0')).toBeInTheDocument();
  });

  it('refuses an overdraft and suggests unpaid instead of failing later', () => {
    renderDrawer();
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'sick' } });
    setRange('2026-08-17', '2026-08-18');
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'flu' } });

    expect(screen.getByText(/switch to Unpaid for the remaining 2.0 days/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  });

  it('blocks a range with no working days and says why', () => {
    renderDrawer();
    // Saturday and Sunday only.
    setRange('2026-08-15', '2026-08-16');
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'trip' } });

    expect(screen.getByText(/all weekend or holiday/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
  });

  it('requires a reason before submitting', () => {
    renderDrawer();
    setRange('2026-08-17', '2026-08-17');

    expect(screen.getByRole('button', { name: 'Submit request' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'errand' } });
    expect(screen.getByRole('button', { name: 'Submit request' })).toBeEnabled();
  });

  it('half day locks the range to one date and costs half a day', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Half day' }));
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-08-17' } });

    expect(screen.getByLabelText('To')).toBeDisabled();
    expect(screen.getByText('0.5')).toBeInTheDocument();
    expect(screen.getByText('4.0 → 3.5')).toBeInTheDocument();
  });

  it('submits the payload and closes on success', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    const onClose = vi.fn();
    renderDrawer({ onSubmit, onClose });

    setRange('2026-08-17', '2026-08-18');
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'family visit' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith({
        start_date: '2026-08-17',
        end_date: '2026-08-18',
        leave_type: 'full_day',
        leave_category: 'casual',
        reason: 'family visit',
      })
    );
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('stays open when the submit fails so nothing typed is lost', async () => {
    const onClose = vi.fn();
    renderDrawer({ onSubmit: vi.fn().mockResolvedValue(false), onClose });

    setRange('2026-08-17', '2026-08-17');
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit request' }));

    await waitFor(() => expect(onClose).not.toHaveBeenCalled());
  });
});
