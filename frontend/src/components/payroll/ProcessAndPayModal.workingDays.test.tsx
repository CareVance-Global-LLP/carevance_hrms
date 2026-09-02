import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';

vi.mock('@/services/api', () => ({
  payrollApi: {
    processAndPay: vi.fn().mockResolvedValue({
      data: {
        success: true,
        run: { id: 77, month_year: '2026-08', status: 'released' },
        summary: { employees_processed: 12, employees_skipped_no_ctc: 0, total_net_pay: 450000 },
      },
    }),
    disburseRun: vi.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: vi.fn(() => 'error'),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import { payrollApi } from '@/services/api';
import ProcessAndPayModal from './ProcessAndPayModal';

afterEach(() => {
  resetDialogStack();
  vi.clearAllMocks();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const processProps = {
  isOpen: true,
  onClose: vi.fn(),
  monthYear: '2026-08',
  pendingCount: 12,
  expectedNetPay: 450000,
};

/**
 * A constant working_days from this modal is a pay defect, not a formatting one,
 * and nothing else in the suite can see it: the request still succeeds, the run
 * still locks, the bank file still generates — only the payslips are wrong. The
 * backend reads an explicit working_days as a statement of attendance and
 * derives LOP = working_days - days_present, so the flat 26 this modal used to
 * send, against calendars producing 21-23 present days, docked 3-5 days from
 * every employee with perfect attendance on every run. This test is the thing
 * that fails the moment a number is put back.
 */
describe('ProcessAndPayModal working days', () => {
  it('sends no working_days, leaving each employee attendance summary to decide', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <ProcessAndPayModal {...processProps} />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: /process & pay/i }));

    await waitFor(() => expect(payrollApi.processAndPay).toHaveBeenCalledTimes(1));

    // Serialized the way the request body is: an explicit `undefined` never
    // reaches the wire so it is not a regression, whereas any number is.
    const body = JSON.parse(
      JSON.stringify(vi.mocked(payrollApi.processAndPay).mock.calls[0][0]),
    );

    expect(body).not.toHaveProperty('working_days');
    // Whole-body equality on purpose: `default_annual_ctc` is the same trap one
    // field over — a silent org-wide default the backend would treat as stated
    // fact — so this fails on any figure the operator did not enter, not just
    // on working_days.
    expect(body).toEqual({ month_year: '2026-08' });
  });
});
