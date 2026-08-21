import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

const register = vi.fn();
const breaches = vi.fn();

vi.mock('@/services/api', () => ({
  statutoryApi: {
    register: (...args: unknown[]) => register(...args),
    breaches: (...args: unknown[]) => breaches(...args),
    limits: vi.fn(),
  },
}));

import OvertimeRegisterPage from './OvertimeRegisterPage';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const row = (over: Record<string, unknown> = {}) => ({
  user_id: 1,
  name: 'Ramesh',
  employee_code: 'EMP-1',
  date: '2026-06-10',
  scope: 'working_day',
  normal_minutes: 480,
  worked_minutes: 600,
  overtime_minutes: 120,
  payable_minutes: 120,
  pending_minutes: 0,
  multiplier: '2.00',
  configured_multiplier: '2.00',
  statutory_multiplier_floor: '2.00',
  is_below_statutory_floor: false,
  hourly_rate: '250.000000',
  amount: '1000.00',
  establishment_type: 'factory',
  ...over,
});

const emptyBreaches = {
  data: {
    from: '2026-06-01',
    to: '2026-06-30',
    employees: [],
    totals: { breaches: 0, employees_in_breach: 0, employees_not_assessed: 0 },
  },
};

beforeEach(() => {
  register.mockReset();
  breaches.mockReset();
  breaches.mockResolvedValue(emptyBreaches);
});

/**
 * The register is a statutory document, so the tests are about what it must
 * never quietly say: that unpriced overtime is worth nothing, that an
 * underpaying rate is fine, or that an unassessed workforce is compliant.
 */
describe('overtime register', () => {
  it('shows an unpriced row as having no rate rather than as zero', async () => {
    register.mockResolvedValue({
      data: {
        from: '2026-06-01',
        to: '2026-06-30',
        rows: [row({ amount: null, hourly_rate: null })],
        totals: { entries: 1, overtime_minutes: 120, pending_minutes: 0, rows_without_a_rate: 1 },
      },
    });

    render(
      <Providers>
        <OvertimeRegisterPage />
      </Providers>,
    );

    // "0.00" here reads as "overtime worked, nothing owed" — the opposite of
    // what is true when there is simply no rate to compute from.
    expect(await screen.findByText('no rate')).toBeInTheDocument();
    expect(screen.queryByText('0.00')).not.toBeInTheDocument();
    expect(screen.getByText(/no annual ctc/i)).toBeInTheDocument();
  });

  it('names the statutory rate on a row paying below it', async () => {
    register.mockResolvedValue({
      data: {
        from: '2026-06-01',
        to: '2026-06-30',
        rows: [row({ multiplier: '1.50', configured_multiplier: '1.50', is_below_statutory_floor: true })],
        totals: { entries: 1, overtime_minutes: 120, pending_minutes: 0, rows_without_a_rate: 0 },
      },
    });

    render(
      <Providers>
        <OvertimeRegisterPage />
      </Providers>,
    );

    // On the row itself, not only in a total: this is the document an
    // inspector reads line by line.
    expect(await screen.findByText(/law requires 2\.00/i)).toBeInTheDocument();
    expect(screen.getByText(/twice the ordinary rate/i)).toBeInTheDocument();
  });

  it('reports unassessed employees rather than letting an empty list read as clean', async () => {
    register.mockResolvedValue({
      data: {
        from: '2026-06-01',
        to: '2026-06-30',
        rows: [row()],
        totals: { entries: 1, overtime_minutes: 120, pending_minutes: 0, rows_without_a_rate: 0 },
      },
    });

    breaches.mockResolvedValue({
      data: {
        from: '2026-06-01',
        to: '2026-06-30',
        employees: [],
        totals: { breaches: 0, employees_in_breach: 0, employees_not_assessed: 12 },
      },
    });

    render(
      <Providers>
        <OvertimeRegisterPage />
      </Providers>,
    );

    // No breaches AND nobody checked are very different facts.
    expect(await screen.findByText(/not compliant/i)).toBeInTheDocument();
    expect(screen.getByText(/12 employees were/i)).toBeInTheDocument();
  });

  it('shows each breach with the provision it comes from', async () => {
    register.mockResolvedValue({
      data: {
        from: '2026-06-01',
        to: '2026-06-30',
        rows: [],
        totals: { entries: 0, overtime_minutes: 0, pending_minutes: 0, rows_without_a_rate: 0 },
      },
    });

    breaches.mockResolvedValue({
      data: {
        from: '2026-06-01',
        to: '2026-06-30',
        employees: [
          {
            user_id: 1,
            name: 'Ramesh',
            establishment_type: 'factory',
            breaches: [
              {
                type: 'daily_hours',
                period: '2026-06-10',
                limit_minutes: 540,
                actual_minutes: 600,
                excess_minutes: 60,
                citation: 'Factories Act 1948, s.54',
                summary: 'Worked beyond the daily limit of ordinary hours.',
              },
            ],
          },
        ],
        totals: { breaches: 1, employees_in_breach: 1, employees_not_assessed: 0 },
      },
    });

    render(
      <Providers>
        <OvertimeRegisterPage />
      </Providers>,
    );

    expect(await screen.findByText(/worked beyond the daily limit/i)).toBeInTheDocument();
    // "Says who" and "by how much", both on the row.
    expect(screen.getByText(/Factories Act 1948, s\.54/)).toBeInTheDocument();
    expect(screen.getByText(/over by 1h/)).toBeInTheDocument();
  });

  it('does not report an enforced floor as a violation', async () => {
    register.mockResolvedValue({
      data: {
        from: '2026-06-01',
        to: '2026-06-30',
        rows: [
          row({
            // The policy is low, the floor is being paid. `is_below_statutory_floor`
            // describes the POLICY, so it stays true — and a red "law requires
            // 2.00x" beside a rate of 2.00x reads as an unfixed violation when
            // it is in fact the protection doing its job.
            multiplier: '2.00',
            configured_multiplier: '1.50',
            is_below_statutory_floor: true,
            amount: '1000.00',
          }),
        ],
        totals: { entries: 1, overtime_minutes: 120, pending_minutes: 0, rows_without_a_rate: 0 },
      },
    });

    render(
      <Providers>
        <OvertimeRegisterPage />
      </Providers>,
    );

    expect(await screen.findByText(/statutory floor applied/i)).toBeInTheDocument();
    expect(screen.queryByText(/law requires/i)).not.toBeInTheDocument();

    // And the red tile must not keep counting a problem that has been fixed.
    expect(screen.getByText(/lifted to the statutory rate/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Below the statutory rate$/)).not.toBeInTheDocument();
  });
});
