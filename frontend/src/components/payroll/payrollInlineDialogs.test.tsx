import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';

vi.mock('@/services/api', () => ({
  payrollApi: {
    getFbpComponents: vi.fn().mockResolvedValue({ data: [] }),
    getFbpAllocations: vi.fn().mockResolvedValue({ data: [] }),
    allocateFbp: vi.fn().mockResolvedValue({ data: {} }),
    listStopPaymentFlags: vi.fn().mockResolvedValue({
      data: {
        data: [
          {
            id: 3,
            user_id: 9,
            user_name: 'Asha Rao',
            user_email: 'asha@example.com',
            month_year: '2026-08',
            hold_type: 'processing',
            reason: 'Bank details unverified',
            is_active: true,
            created_at: '2026-08-01T00:00:00Z',
          },
        ],
      },
    }),
    createStopPaymentFlag: vi.fn().mockResolvedValue({ data: {} }),
    updateStopPaymentFlag: vi.fn().mockResolvedValue({ data: {} }),
    resolveStopPaymentFlag: vi.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: vi.fn(() => 'error'),
}));

import EmployeePickerList from './EmployeePickerList';
import FbpDashboard from './FbpDashboard';
import StopPaymentFlags from './StopPaymentFlags';

afterEach(() => {
  resetDialogStack();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('inline payroll dialogs', () => {
  it('opens the FBP allocation dialog with an accessible name', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <FbpDashboard />
      </Providers>,
    );

    // The Allocate button is disabled until a user id is entered.
    await user.type(screen.getByPlaceholderText('Employee User ID'), '7');
    await user.click(screen.getByRole('button', { name: /allocate/i }));

    expect(screen.getByRole('dialog', { name: /allocate fbp component/i })).toBeInTheDocument();
  });

  it('opens the add stop payment flag dialog with an accessible name', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <StopPaymentFlags />
      </Providers>,
    );

    await user.click(screen.getByRole('button', { name: /add flag/i }));

    expect(screen.getByRole('dialog', { name: /add stop payment flag/i })).toBeInTheDocument();
  });

  it('opens the edit stop payment flag dialog with an accessible name', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <StopPaymentFlags />
      </Providers>,
    );

    await user.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByRole('dialog', { name: /edit stop payment flag/i })).toBeInTheDocument();
  });

  it('opens the resolve confirmation with an accessible name', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <StopPaymentFlags />
      </Providers>,
    );

    await user.click(await screen.findByRole('button', { name: 'Resolve' }));

    expect(screen.getByRole('dialog', { name: /resolve stop payment flag/i })).toBeInTheDocument();
  });

  it('renders the employee picker as a named dialog', () => {
    render(
      <Providers>
        <EmployeePickerList
          isOpen
          onClose={vi.fn()}
          onConfirm={vi.fn()}
          queryKey={['test-employees']}
          queryFn={vi.fn().mockResolvedValue({ employees: [], total: 0, last_page: 1 })}
        />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /select employees/i })).toBeInTheDocument();
  });
});
