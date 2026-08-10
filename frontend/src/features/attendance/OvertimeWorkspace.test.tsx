import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OvertimeWorkspace from './OvertimeWorkspace';

const todayISO = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

const request = (over: Partial<Record<string, unknown>> = {}) => ({
  id: 1,
  user_id: 9,
  attendance_date: todayISO(),
  extra_seconds: 7200,
  message: 'Release ran late.',
  status: 'pending',
  created_at: new Date().toISOString(),
  user: { id: 9, name: 'Rohan Ghosh', email: 'rohan@example.com' },
  ...over,
});

const baseProps = {
  currentUserId: 1,
  canRequest: true,
  isLoading: false,
  submitting: false,
  onMonthNeeded: vi.fn(),
  fetchDayFor: vi.fn().mockResolvedValue(null),
  onSubmit: vi.fn().mockResolvedValue(true),
  onApprove: vi.fn(),
  onReject: vi.fn(),
};

describe('OvertimeWorkspace', () => {
  it('shows the picked day’s tracked time next to the request form', () => {
    render(
      <OvertimeWorkspace
        {...baseProps}
        requests={[]}
        canReview={() => false}
        dayLookup={() => ({ worked_seconds: 29400, is_weekend: false })}
      />
    );

    // 29400s = 8h 10m — the day arrives with the date.
    expect(screen.getByText(/You tracked/)).toBeInTheDocument();
    expect(screen.getByText(/8h 10m/)).toBeInTheDocument();
  });

  it('refuses a holiday and disables submission', () => {
    render(
      <OvertimeWorkspace
        {...baseProps}
        requests={[]}
        canReview={() => false}
        dayLookup={() => ({ is_holiday: true, holiday: { title: 'Independence Day' } })}
      />
    );

    expect(screen.getByText(/Independence Day/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Send for approval/ })).toBeDisabled();
  });

  it('previews the resulting day total and flags 12h+ days', () => {
    render(
      <OvertimeWorkspace
        {...baseProps}
        requests={[]}
        canReview={() => false}
        dayLookup={() => ({ worked_seconds: 11 * 3600 })}
      />
    );

    // 11h tracked + 2h chip = 13h → flagged.
    fireEvent.click(screen.getByRole('button', { name: '+2h' }));
    expect(screen.getByText('Day total becomes')).toBeInTheDocument();
    expect(screen.getByText(/flagged as a 12h\+ day/)).toBeInTheDocument();
  });

  it('submits the chip amount against the picked date', async () => {
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(
      <OvertimeWorkspace
        {...baseProps}
        onSubmit={onSubmit}
        requests={[]}
        canReview={() => false}
        dayLookup={() => ({ worked_seconds: 3600 })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '+30m' }));
    fireEvent.change(screen.getByLabelText('Message to approver'), { target: { value: 'Deploy overran' } });
    fireEvent.click(screen.getByRole('button', { name: /Send for approval/ }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ date: todayISO(), extraMinutes: 30, message: 'Deploy overran' });
  });

  it('asks the page to load a month it cannot see', () => {
    const onMonthNeeded = vi.fn();
    render(
      <OvertimeWorkspace
        {...baseProps}
        onMonthNeeded={onMonthNeeded}
        requests={[]}
        canReview={() => false}
        dayLookup={() => undefined}
      />
    );

    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-07-15' } });
    expect(onMonthNeeded).toHaveBeenCalledWith('2026-07');
  });

  it('lands reviewers on the inbox segment and shows the day arithmetic', async () => {
    const fetchDayFor = vi.fn().mockResolvedValue({ worked_seconds: 8 * 3600 + 600 });
    render(
      <OvertimeWorkspace
        {...baseProps}
        fetchDayFor={fetchDayFor}
        requests={[request()]}
        canReview={() => true}
        dayLookup={() => ({ worked_seconds: 0 })}
      />
    );

    expect(screen.getByRole('button', { name: /Needs my approval/ })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(fetchDayFor).toHaveBeenCalledWith(9, todayISO()));
    // 8h10m tracked + 2h requested = 10h 10m resulting.
    expect(await screen.findByText('Tracked that day')).toBeInTheDocument();
    expect(screen.getByText('10h 10m')).toBeInTheDocument();
  });

  it('says so plainly when the day has no tracked time', async () => {
    render(
      <OvertimeWorkspace
        {...baseProps}
        fetchDayFor={vi.fn().mockResolvedValue(null)}
        requests={[request()]}
        canReview={() => true}
        dayLookup={() => undefined}
      />
    );

    expect(await screen.findByText(/No tracked time recorded on that day/)).toBeInTheDocument();
  });

  it('sums approved overtime for the current month into the accrual strip', () => {
    render(
      <OvertimeWorkspace
        {...baseProps}
        requests={[
          request({ id: 1, status: 'approved', extra_seconds: 3600 }),
          request({ id: 2, status: 'approved', extra_seconds: 1800 }),
          request({ id: 3, status: 'pending', extra_seconds: 999999 }), // pending never counts
        ]}
        canReview={() => false}
        dayLookup={() => undefined}
      />
    );

    expect(screen.getByText('Approved overtime · this month')).toBeInTheDocument();
    expect(screen.getByText('1h 30m')).toBeInTheDocument();
  });
});
