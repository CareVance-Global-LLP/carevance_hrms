import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';

vi.mock('@/services/api', () => ({
  payrollApi: {
    processAndPay: vi.fn(() => new Promise(() => {})),
    disburseRun: vi.fn().mockResolvedValue({ data: {} }),
    getPayrollReports: vi.fn().mockResolvedValue({ data: {} }),
    uploadForm16: vi.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: vi.fn(() => 'error'),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

import HelpDrawer from './HelpDrawer';
import PayrollReportsModal from './PayrollReportsModal';
import ProcessAndPayModal from './ProcessAndPayModal';
import UploadForm16Modal from './UploadForm16Modal';

afterEach(() => {
  resetDialogStack();
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

describe('large payroll dialogs', () => {
  it('renders process and pay as a named dialog', () => {
    render(
      <Providers>
        <ProcessAndPayModal {...processProps} />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /process & pay/i })).toBeInTheDocument();
  });

  it('does not close on Escape while a disbursement is in flight', async () => {
    // processAndPay never resolves in this suite, so the panel stays in its
    // processing stage. A stray Escape mid-disbursement must not close it.
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <Providers>
        <ProcessAndPayModal {...processProps} onClose={onClose} />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: /process & pay/i }));
    await user.keyboard('{Escape}');

    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders payroll reports as a named dialog', () => {
    render(
      <Providers>
        <PayrollReportsModal isOpen onClose={vi.fn()} monthYear="2026-08" />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /payroll reports/i })).toBeInTheDocument();
  });

  it('renders the form 16 upload drawer as a named dialog', () => {
    render(
      <Providers>
        <UploadForm16Modal
          isOpen
          onClose={vi.fn()}
          financialYear="2025-26"
          organizationName="CareVance"
        />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /upload form 16/i })).toBeInTheDocument();
  });

  it('renders the help drawer as a named dialog', () => {
    render(
      <Providers>
        <HelpDrawer isOpen onClose={vi.fn()} />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /help & resources/i })).toBeInTheDocument();
  });
});
