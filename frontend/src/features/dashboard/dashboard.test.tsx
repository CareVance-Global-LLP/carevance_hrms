import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

const todaySummary = vi.fn();
const pendingCounts = vi.fn();
const headcountSeries = vi.fn();
const getDashboardAttention = vi.fn();

vi.mock('@/services/api', () => ({
  opsDashboardApi: {
    todaySummary: () => todaySummary(),
    pendingCounts: () => pendingCounts(),
    headcountSeries: () => headcountSeries(),
  },
  payrollApi: {
    getDashboardAttention: () => getDashboardAttention(),
  },
}));

import AttentionStrip from './AttentionStrip';
import TodayCensus from './TodayCensus';
import ShiftCoverage from './ShiftCoverage';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    // An unmocked endpoint otherwise retries three times and can hold the page
    // empty past the assertion timeout, which reads as a render bug.
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

const snapshot = (over: Record<string, unknown> = {}) => ({
  data: {
    data: {
      date: '2026-08-24',
      headcount: 93,
      present_on_time: { count: 71, user_ids: [] },
      late: { count: 9, user_ids: [], total_minutes: 247 },
      on_leave: { count: 7, user_ids: [], half_day: 2 },
      rostered_absent: { count: 6, user_ids: [] },
      working_now: { count: 64, user_ids: [] },
      roster: { published: true, rostered: 87, rest_day: 4, not_rostered: 2 },
      ...over,
    },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  todaySummary.mockResolvedValue(snapshot());
  headcountSeries.mockResolvedValue({
    data: { data: { from: '2025-09-01', to: '2026-08-31', current_headcount: 93, months: [] } },
  });
  pendingCounts.mockResolvedValue({
    data: { data: { leave: 14, time_edits: 0, resignations: 0, reimbursements: 4, filings_overdue: 2, total: 20 } },
  });
  getDashboardAttention.mockResolvedValue({
    data: { success: true, attention: { missing_bank_details: 7, missing_pan_uan: 0 } },
  });
});

/**
 * The rules that make these numbers worth trusting.
 *
 * Each test here corresponds to a way a dashboard lies: a zero that means
 * "not counted", a green tick nobody checked, or an absence figure computed
 * against a roster that was never published.
 */
describe('attention strip', () => {
  it('does not render a chip whose count is zero', async () => {
    render(
      <Providers>
        <AttentionStrip />
      </Providers>,
    );

    // Present with a count.
    expect(await screen.findByText(/leave approvals/i)).toBeInTheDocument();

    /*
     * Zero-count queues are omitted entirely. Eight zeroes teach somebody to
     * stop reading the one band on the page that must never be skimmed.
     */
    expect(screen.queryByText(/time-edit requests/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/resignations/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/missing pan or uan/i)).not.toBeInTheDocument();
  });

  it('says so plainly when nothing is waiting', async () => {
    pendingCounts.mockResolvedValue({
      data: { data: { leave: 0, time_edits: 0, resignations: 0, reimbursements: 0, filings_overdue: 0, total: 0 } },
    });
    getDashboardAttention.mockResolvedValue({ data: { success: true, attention: {} } });
    todaySummary.mockResolvedValue(snapshot({ rostered_absent: { count: 0, user_ids: [] } }));

    render(
      <Providers>
        <AttentionStrip />
      </Providers>,
    );

    expect(await screen.findByText(/nothing is waiting on you/i)).toBeInTheDocument();
  });

  it('treats a null count as not-counted rather than as zero', async () => {
    // A null means the table is absent on this tenant. Rendering it as "0
    // waiting" would be a false all-clear on a queue nobody can see.
    pendingCounts.mockResolvedValue({
      data: { data: { leave: null, time_edits: null, resignations: null, reimbursements: null, filings_overdue: null, total: 0 } },
    });
    getDashboardAttention.mockResolvedValue({ data: { success: true, attention: {} } });

    render(
      <Providers>
        <AttentionStrip />
      </Providers>,
    );

    // The roster chip still shows, so the strip is rendering; the null-backed
    // queues simply are not there.
    expect(await screen.findByText(/rostered, not in/i)).toBeInTheDocument();
    expect(screen.queryByText(/leave approvals/i)).not.toBeInTheDocument();
  });

  it('omits the payroll chips when the caller is not allowed to see them', async () => {
    // A 403. An admin without payroll rights must be told nothing, not told
    // there is no payroll work.
    getDashboardAttention.mockRejectedValue({ response: { status: 403 } });

    render(
      <Providers>
        <AttentionStrip />
      </Providers>,
    );

    expect(await screen.findByText(/leave approvals/i)).toBeInTheDocument();
    expect(screen.queryByText(/no bank account/i)).not.toBeInTheDocument();
  });
});

describe('today census', () => {
  it('shows the six figures with their splits', async () => {
    render(
      <Providers>
        <TodayCensus />
      </Providers>,
    );

    expect(await screen.findByText('93')).toBeInTheDocument();
    expect(screen.getByText('71')).toBeInTheDocument();
    expect(screen.getByText(/247 minutes in total/i)).toBeInTheDocument();
    expect(screen.getByText(/2 half-day/i)).toBeInTheDocument();
  });

  it('says absence is unchecked when no roster is published, rather than showing zero', async () => {
    todaySummary.mockResolvedValue(
      snapshot({
        rostered_absent: { count: 0, user_ids: [] },
        roster: { published: false, rostered: 0, rest_day: 0, not_rostered: 93 },
      }),
    );

    render(
      <Providers>
        <TodayCensus />
      </Providers>,
    );

    /*
     * The distinction the whole tile exists for. A green "0 absent" on a
     * tenant that never published a roster is a number nobody checked.
     */
    expect(await screen.findByText(/no roster/i)).toBeInTheDocument();
    expect(screen.getByText(/publish a roster to check absence/i)).toBeInTheDocument();
  });
});

describe('shift coverage', () => {
  it('keeps rest days and unrostered people out of the absence figure', async () => {
    render(
      <Providers>
        <ShiftCoverage />
      </Providers>,
    );

    expect(await screen.findByText(/rostered off \(rest day\)/i)).toBeInTheDocument();
    expect(screen.getByText(/not rostered at all/i)).toBeInTheDocument();

    // Three separate questions, never merged into one "absent" number.
    expect(screen.getByText(/not turned up/i)).toBeInTheDocument();
  });

  it('refuses to imply coverage when nothing was published', async () => {
    todaySummary.mockResolvedValue(
      snapshot({ roster: { published: false, rostered: 0, rest_day: 0, not_rostered: 93 } }),
    );

    render(
      <Providers>
        <ShiftCoverage />
      </Providers>,
    );

    expect(await screen.findByText(/no roster is published for today/i)).toBeInTheDocument();
    expect(screen.getByText(/different from nobody being absent/i)).toBeInTheDocument();
  });
});
