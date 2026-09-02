import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/services/api', () => ({
  payrollApi: {
    getPayrollSettings: vi.fn(),
    updatePayrollSettings: vi.fn().mockResolvedValue({ data: { success: true } }),
    applySettingsToAllEmployees: vi.fn().mockResolvedValue({ data: { affected_count: 0 } }),
    getPTStates: vi.fn(),
    getOnboardingStatus: vi.fn().mockResolvedValue({
      data: { onboarded: false, dismissed_at: null, steps: {}, completed_count: 0, total_count: 9, completion_percentage: 0, next_action: 'defaults' },
    }),
    markSetupStep: vi.fn().mockResolvedValue({ data: {} }),
    markDefaultsConfigured: vi.fn().mockResolvedValue({ data: {} }),
    unmarkSetupStep: vi.fn().mockResolvedValue({ data: {} }),
    markWelcomeSeen: vi.fn().mockResolvedValue({ data: {} }),
    dismissOnboarding: vi.fn().mockResolvedValue({ data: {} }),
    reopenOnboarding: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import { payrollApi } from '@/services/api';
import SetupDefaults from './SetupDefaults';

const PT_STATES = {
  all_states: [
    { code: 'delhi', name: 'Delhi' },
    { code: 'karnataka', name: 'Karnataka' },
    { code: 'maharashtra', name: 'Maharashtra' },
  ],
  states_with_pt: [],
  states_without_pt: [],
};

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/payroll/setup/defaults']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

/** The settings an organisation that has never answered the question returns. */
function settingsWithout(defaultState: Record<string, unknown> = {}) {
  return {
    data: {
      success: true,
      settings: {
        defaultBasicPercentage: 40,
        defaultHraPercentage: 50,
        defaultConveyance: 1600,
        workingDaysPerMonth: 26,
        defaultTaxRegime: 'new',
        ...defaultState,
      },
    },
  };
}

beforeEach(() => {
  vi.mocked(payrollApi.getPTStates).mockResolvedValue({ data: PT_STATES } as any);
  vi.mocked(payrollApi.getPayrollSettings).mockResolvedValue(settingsWithout() as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Professional tax is state-levied and several states — Delhi, Haryana, Punjab,
 * Uttar Pradesh — levy none. This field used to open on Maharashtra, so an
 * admin in Delhi who clicked through the wizard without touching it agreed to
 * Maharashtra's slabs on the whole company's behalf: ₹200 a month, ₹300 in
 * February, ₹2,500 a year deducted from every employee who owed nothing.
 *
 * Nothing else in the suite can see that. The save succeeds, the wizard step
 * goes green, every employee template is created happily, and the wrong number
 * only surfaces on a payslip. These tests are what fails the moment a state is
 * preselected again, or the moment an unanswered field is allowed through.
 */
describe('SetupDefaults professional tax state', () => {
  it('opens with no state chosen', async () => {
    render(
      <Providers>
        <SetupDefaults />
      </Providers>,
    );

    await screen.findByRole('button', { name: /save defaults/i });

    expect(screen.getByRole('button', { name: /select a state/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Maharashtra$/ })).not.toBeInTheDocument();
  });

  it('refuses to save while the state is unanswered', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <SetupDefaults />
      </Providers>,
    );

    await user.click(await screen.findByRole('button', { name: /save defaults/i }));

    expect(payrollApi.updatePayrollSettings).not.toHaveBeenCalled();
    expect(await screen.findByText(/choose a professional tax state before saving/i)).toBeInTheDocument();
  });

  it('saves null — not a state — when the admin says their state levies none', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <SetupDefaults />
      </Providers>,
    );

    await screen.findByRole('button', { name: /save defaults/i });

    await user.click(screen.getByRole('button', { name: /select a state/i }));
    await user.click(screen.getByRole('option', { name: /no professional tax in my state/i }));
    await user.click(screen.getByRole('button', { name: /save defaults/i }));

    await waitFor(() => expect(payrollApi.updatePayrollSettings).toHaveBeenCalled());
    expect(vi.mocked(payrollApi.updatePayrollSettings).mock.calls[0][0]).toMatchObject({
      defaultState: null,
    });
  });

  it('saves the code the admin actually picked', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <SetupDefaults />
      </Providers>,
    );

    await screen.findByRole('button', { name: /save defaults/i });

    await user.click(screen.getByRole('button', { name: /select a state/i }));
    await user.click(screen.getByRole('option', { name: /^Karnataka$/ }));
    await user.click(screen.getByRole('button', { name: /save defaults/i }));

    await waitFor(() => expect(payrollApi.updatePayrollSettings).toHaveBeenCalled());
    expect(vi.mocked(payrollApi.updatePayrollSettings).mock.calls[0][0]).toMatchObject({
      defaultState: 'karnataka',
    });
  });

  it('shows a recorded "no professional tax" answer as answered, not as unset', async () => {
    // null is the organisation's answer; an absent key is no answer at all.
    // Collapsing the two would show a green setup tick above an empty field.
    vi.mocked(payrollApi.getPayrollSettings).mockResolvedValue(
      settingsWithout({ defaultState: null }) as any,
    );

    render(
      <Providers>
        <SetupDefaults />
      </Providers>,
    );

    expect(
      await screen.findByRole('button', { name: /no professional tax in my state/i }),
    ).toBeInTheDocument();
  });
});
