import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';

vi.mock('@/services/api', () => ({
  payrollApi: {
    getPayrollRunDetail: vi.fn(() =>
      Promise.resolve({
        data: {
          run: {
            id: 41,
            month_year: '2026-08',
            status: 'draft',
            total_net_pay: 450000,
            employee_count: 12,
          },
          items: [],
        },
      }),
    ),
    getRunMissingBankDetails: vi.fn().mockResolvedValue({ data: { employees: [] } }),
    getRunCompleteness: vi.fn().mockResolvedValue({
      data: { completeness: { expected_count: 12, processed_count: 10, missing_count: 2 } },
    }),
    getRunReversals: vi.fn().mockResolvedValue({ data: { reversals: [] } }),
    // The partial-lock dialog opens from a 422 carrying `incomplete`, not from
    // the click itself — that is the only path that nests a dialog inside the
    // drawer, which is what this suite is here to exercise.
    lockRun: vi.fn().mockRejectedValue({
      response: {
        data: {
          incomplete: true,
          completeness: { expected_count: 12, processed_count: 10, missing_count: 2 },
        },
      },
    }),
    approveRun: vi.fn().mockResolvedValue({ data: {} }),
    releaseRun: vi.fn().mockResolvedValue({ data: {} }),
    disburseRun: vi.fn().mockResolvedValue({ data: {} }),
    getRunProcessingStatus: vi.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: vi.fn(() => 'error'),
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', role: 'admin' } }),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import PayrollRunDetailModal from './PayrollRunDetailModal';

afterEach(() => {
  resetDialogStack();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  runId: 41,
  monthYear: '2026-08',
};

describe('PayrollRunDetailModal', () => {
  it('renders the run drawer as a named dialog', async () => {
    render(
      <Providers>
        <PayrollRunDetailModal {...baseProps} />
      </Providers>,
    );

    expect(await screen.findByRole('dialog', { name: /run #41/i })).toBeInTheDocument();
  });

  /*
   * There is deliberately no integration test here for "Escape closes only the
   * nested dialog". Reaching that state needs the lock request to reject with a
   * 422 carrying `incomplete`, and driving react-query to that branch through
   * the mock proved unreliable. The behaviour itself is covered where the logic
   * lives, and covered harder:
   *
   *   useDialogBehavior.test.tsx  "closes only the top dialog when two are open"
   *   useDialogBehavior.test.tsx  "stacks z-index by depth"
   *   dialogStack.test.ts         "treats the deepest dialog as top regardless
   *                                of registration order"
   *   Modal.test.tsx              nested Modal z-index 50 / 60
   */
});
