import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import GlobalCommandBar from './GlobalCommandBar';
import { searchAskApi } from '@/services/api';

vi.mock('@/services/api', () => ({
  searchAskApi: { ask: vi.fn(), summary: vi.fn() },
  searchApi: {
    search: vi.fn().mockResolvedValue({ data: { results: [] } }),
    // GlobalCommandBar debounces a real call to searchApi.query on every
    // keystroke, AI mode included. Left off the mock it is `undefined` and the
    // debounce timer throws inside a setTimeout, where nothing catches it.
    query: vi.fn().mockResolvedValue({ data: { data: [] } }),
  },
}));

// useAuth throws outside an AuthProvider, and usePlan reads through it, so the
// palette cannot mount at all without this. Same shape as Layout.test.tsx.
vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1 },
    organization: { id: 1, plan_code: 'basic_payroll', max_seats: 50, subscription_status: 'active' },
    logout: vi.fn(),
    token: 'test-token',
  }),
}));

const answer = {
  plan: { entity: 'payroll', metric: 'avg_net_pay', group_by: 'department', filters: {}, sort: null, limit: 20 },
  columns: [
    { key: 'department', label: 'Department', type: 'text' as const },
    { key: 'avg_net_pay', label: 'Avg net pay', type: 'money' as const },
  ],
  rows: [{ department: 'Engineering', avg_net_pay: '91575.93' }],
  notes: [], summary: null, truncated: false,
};

function setup() {
  return render(
    <MemoryRouter>
      <GlobalCommandBar open onClose={() => {}} navigation={[]} />
    </MemoryRouter>,
  );
}

describe('GlobalCommandBar AI mode', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the table before the summary arrives', async () => {
    (searchAskApi.ask as ReturnType<typeof vi.fn>).mockResolvedValue({ data: answer });
    // Summary never settles — the table must not wait on it.
    (searchAskApi.summary as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    setup();

    await userEvent.click(screen.getByRole('button', { name: /ai mode/i }));
    await userEvent.type(screen.getByRole('combobox'), 'avg net pay by department{Enter}');

    await waitFor(() => expect(screen.getByText('₹91,575.93')).toBeInTheDocument());
  });

  it('adds the summary when it lands', async () => {
    (searchAskApi.ask as ReturnType<typeof vi.fn>).mockResolvedValue({ data: answer });
    (searchAskApi.summary as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: { summary: 'Engineering leads on net pay.' },
    });
    setup();

    await userEvent.click(screen.getByRole('button', { name: /ai mode/i }));
    await userEvent.type(screen.getByRole('combobox'), 'avg net pay{Enter}');

    await waitFor(() => expect(screen.getByText('Engineering leads on net pay.')).toBeInTheDocument());
  });

  it('keeps the table when the summary fails', async () => {
    (searchAskApi.ask as ReturnType<typeof vi.fn>).mockResolvedValue({ data: answer });
    (searchAskApi.summary as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('502'));
    setup();

    await userEvent.click(screen.getByRole('button', { name: /ai mode/i }));
    await userEvent.type(screen.getByRole('combobox'), 'avg net pay{Enter}');

    await waitFor(() => expect(screen.getByText('₹91,575.93')).toBeInTheDocument());
    expect(screen.queryByTestId('ai-summary')).not.toBeInTheDocument();
  });

  it('surfaces a refusal reason from a 422', async () => {
    (searchAskApi.ask as ReturnType<typeof vi.fn>).mockRejectedValue({
      response: { status: 422, data: { detail: 'Nationality is not stored in this system.' } },
    });
    setup();

    await userEvent.click(screen.getByRole('button', { name: /ai mode/i }));
    await userEvent.type(screen.getByRole('combobox'), 'headcount by nationality{Enter}');

    await waitFor(() => expect(screen.getByText(/nationality is not stored/i)).toBeInTheDocument());
  });
});
