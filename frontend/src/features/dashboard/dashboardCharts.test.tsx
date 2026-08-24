import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const summary = vi.fn();
const calendar = vi.fn();
const getAll = vi.fn();

vi.mock('@/services/api', () => ({
  attendanceApi: {
    summary: (...a: unknown[]) => summary(...a),
    calendar: (...a: unknown[]) => calendar(...a),
  },
  userApi: {
    getAll: () => getAll(),
  },
}));

import LiveBoard from './LiveBoard';
import ArrivalCurve from './ArrivalCurve';
import AttendanceHeatmap from './AttendanceHeatmap';
import PeopleMovement from './PeopleMovement';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const person = (
  id: number,
  name: string,
  over: Record<string, unknown> = {},
) => ({
  user: { id, name, email: `${id}@x.test`, role: 'employee' },
  present_days: 1,
  late_days: 0,
  late_minutes: 0,
  total_worked_seconds: 3600,
  is_checked_in: true,
  check_in_at: '2026-08-24T09:00:00',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  summary.mockResolvedValue({ data: { start_date: '2026-08-24', end_date: '2026-08-24', data: [] } });
  calendar.mockResolvedValue({ data: { month: '2026-08', user_id: 0, days: [] } });
  getAll.mockResolvedValue({ data: [] });
});

afterEach(() => vi.useRealTimers());

describe('live board', () => {
  it('puts the people who need attention at the top', async () => {
    summary.mockResolvedValue({
      data: {
        start_date: '2026-08-24',
        end_date: '2026-08-24',
        data: [
          person(1, 'Anita Working'),
          person(2, 'Zubin Late', { late_days: 1, late_minutes: 42, check_in_at: '2026-08-24T09:42:00' }),
          person(3, 'Bhavna Absent', { is_checked_in: false, check_in_at: null }),
        ],
      },
    });

    render(
      <Providers>
        <LiveBoard />
      </Providers>,
    );

    const rows = await screen.findAllByRole('row');
    // Row 0 is the header. Late first, then not-in, then working — an
    // alphabetical list would bury Zubin at the bottom.
    expect(rows[1]).toHaveTextContent('Zubin Late');
    expect(rows[2]).toHaveTextContent('Bhavna Absent');
    expect(rows[3]).toHaveTextContent('Anita Working');
  });

  it('reports its age rather than claiming to be live', async () => {
    summary.mockResolvedValue({
      data: { start_date: '2026-08-24', end_date: '2026-08-24', data: [person(1, 'Anita')] },
    });

    render(
      <Providers>
        <LiveBoard />
      </Providers>,
    );

    /*
     * BROADCAST_CONNECTION is `log` — there is no realtime transport — so a
     * "Live" badge here would be a claim the product cannot keep, on a board
     * somebody makes staffing calls from.
     */
    expect(await screen.findByText(/updated .* ago/i)).toBeInTheDocument();
    expect(screen.queryByText(/^live$/i)).not.toBeInTheDocument();
  });
});

describe('arrival curve', () => {
  it('names the busiest half hour', async () => {
    summary.mockResolvedValue({
      data: {
        start_date: '2026-08-24',
        end_date: '2026-08-24',
        data: [
          person(1, 'A', { check_in_at: '2026-08-24T08:35:00' }),
          person(2, 'B', { check_in_at: '2026-08-24T08:40:00' }),
          person(3, 'C', { check_in_at: '2026-08-24T08:55:00' }),
          person(4, 'D', { check_in_at: '2026-08-24T09:05:00', late_days: 1, late_minutes: 5 }),
        ],
      },
    });

    render(
      <Providers>
        <ArrivalCurve />
      </Providers>,
    );

    // Three of four arrived in the 08:30 bucket. Asserted on the emphasised
    // peak specifically - 08:30 is also the axis label, so a loose text match
    // passes for the wrong reason.
    expect(await screen.findByText(/busiest half hour/i)).toBeInTheDocument();
    const peak = document.querySelector('b.text-slate-700');
    expect(peak?.textContent).toBe('08:30');
    expect(screen.getByText(/4 in/)).toBeInTheDocument();
  });

  it('offers the transport reading when people cluster just after the bell', async () => {
    summary.mockResolvedValue({
      data: {
        start_date: '2026-08-24',
        end_date: '2026-08-24',
        data: [person(1, 'A', { check_in_at: '2026-08-24T09:05:00', late_days: 1, late_minutes: 5 })],
      },
    });

    render(
      <Providers>
        <ArrivalCurve />
      </Providers>,
    );

    // "Nine people were late" is a disciplinary fact; the distribution is what
    // distinguishes conduct from a bus timetable.
    expect(await screen.findByText(/transport, not conduct/i)).toBeInTheDocument();
  });

  it('says nobody has arrived rather than drawing an empty chart', async () => {
    render(
      <Providers>
        <ArrivalCurve />
      </Providers>,
    );

    expect(await screen.findByText(/nobody has punched in yet today/i)).toBeInTheDocument();
  });
});

describe('attendance heatmap', () => {
  it('marks a holiday as time off, never as a bad turnout', async () => {
    calendar.mockResolvedValue({
      data: {
        month: '2026-08',
        user_id: 0,
        days: [
          { date: '2026-08-03', status: 'present', is_weekend: false, late_minutes: 0, worked_seconds: 0, present_count: 80, late_count: 5, absent_count: 8, total_employees: 93 },
          { date: '2026-08-04', status: 'holiday', is_weekend: false, is_holiday: true, late_minutes: 0, worked_seconds: 0, present_count: 0, late_count: 0, absent_count: 0, total_employees: 93 },
        ],
      },
    });

    render(
      <Providers>
        <AttendanceHeatmap />
      </Providers>,
    );

    /*
     * A holiday has a 0% turnout by arithmetic. Shading it red would raise an
     * alarm on a day nobody was expected, and the second false alarm is the
     * one that teaches somebody to stop looking at the card.
     */
    const holiday = await screen.findByTitle(/2026-08-04 — Holiday/);
    expect(holiday.className).not.toMatch(/bg-red/);
    expect(screen.getByTitle(/2026-08-03 — 85 of 93 in/)).toBeInTheDocument();
  });
});

describe('people movement', () => {
  it('does not call somebody who joined this year an anniversary', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(new Date('2026-08-24T10:00:00'));

    getAll.mockResolvedValue({
      data: [
        {
          id: 1,
          name: 'Fresh Joiner',
          // Joined eight days ago. Their "anniversary" is 357 days away, and
          // a zero-year anniversary is not a thing to congratulate.
          employee_work_info: { joining_date: '2026-08-16', employment_status: 'probation' },
          employee_profile: {},
        },
        {
          id: 2,
          name: 'Real Anniversary',
          employee_work_info: { joining_date: '2023-08-28', employment_status: 'confirmed' },
          employee_profile: {},
        },
      ],
    });

    render(
      <Providers>
        <PeopleMovement />
      </Providers>,
    );

    expect(await screen.findByText(/Real Anniversary/)).toBeInTheDocument();
    expect(screen.queryByText(/Fresh Joiner —/)).not.toBeInTheDocument();

    // They do count as a recent joiner and as on probation, which are the
    // states somebody actually has to action.
    expect(screen.getByText(/joined in the last 6 months/i)).toBeInTheDocument();
  });

  it('says the fortnight is empty rather than showing a bare zero', async () => {
    render(
      <Providers>
        <PeopleMovement />
      </Providers>,
    );

    expect(
      await screen.findByText(/no birthdays or work anniversaries in the next two weeks/i),
    ).toBeInTheDocument();
  });
});
