import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('@/services/api', () => ({
  payrollApi: {
    getEmployees: vi.fn(),
    getPayrollSettings: vi.fn(),
    updateEmployeeTemplate: vi.fn().mockResolvedValue({ data: { success: true } }),
    getOnboardingStatus: vi.fn().mockResolvedValue({
      data: { onboarded: false, dismissed_at: null, steps: {}, completed_count: 0, total_count: 9, completion_percentage: 0, next_action: 'employees' },
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
import SetupEmployees from './SetupEmployees';

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/payroll/setup/employees']}>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.mocked(payrollApi.getEmployees).mockResolvedValue({
    data: [{ id: 7, name: 'Asha Rao', email: 'asha@example.com' }],
  } as any);
  // An organisation that has never named a professional tax state: the
  // settings API omits the key rather than inventing one.
  vi.mocked(payrollApi.getPayrollSettings).mockResolvedValue({
    data: { success: true, settings: { defaultBasicPercentage: 40, defaultHraPercentage: 50 } },
  } as any);
});

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * This step writes a payroll template for every employee in the company in one
 * click, so it is the largest single amplifier of a wrong professional tax
 * state in the product. It used to send `orgSettings.defaultState ??
 * 'maharashtra'` — meaning an organisation that had never answered the
 * question had Maharashtra's slab stamped on every one of its employees, and
 * ₹200 a month came off each payslip in a state that may levy nothing.
 *
 * The save reports success either way, which is why this needs a test rather
 * than a careful reader.
 */
describe('SetupEmployees professional tax state', () => {
  it('sends null rather than a state the organisation never chose', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <SetupEmployees />
      </Providers>,
    );

    const ctcInput = await screen.findByPlaceholderText(/e\.g\. 1200000/i);
    await user.type(ctcInput, '1200000');
    await user.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(payrollApi.updateEmployeeTemplate).toHaveBeenCalled());

    const [userId, payload] = vi.mocked(payrollApi.updateEmployeeTemplate).mock.calls[0];
    expect(userId).toBe(7);
    expect((payload as Record<string, unknown>).pt_state).toBeNull();
  });

  it('passes the organisation\'s own state through untouched when it has one', async () => {
    vi.mocked(payrollApi.getPayrollSettings).mockResolvedValue({
      data: { success: true, settings: { defaultState: 'karnataka' } },
    } as any);

    const user = userEvent.setup();
    render(
      <Providers>
        <SetupEmployees />
      </Providers>,
    );

    const ctcInput = await screen.findByPlaceholderText(/e\.g\. 1200000/i);
    await user.type(ctcInput, '1200000');
    await user.click(await screen.findByRole('button', { name: /save/i }));

    await waitFor(() => expect(payrollApi.updateEmployeeTemplate).toHaveBeenCalled());

    const [, payload] = vi.mocked(payrollApi.updateEmployeeTemplate).mock.calls[0];
    expect((payload as Record<string, unknown>).pt_state).toBe('karnataka');
  });
});
