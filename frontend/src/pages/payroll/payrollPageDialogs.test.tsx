import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';

vi.mock('@/services/api', () => ({
  payrollApi: {
    getPayGroups: vi.fn().mockResolvedValue({
      data: [
        {
          id: 5,
          name: 'Monthly staff',
          code: 'MON',
          pay_frequency: 'monthly',
          employee_count: 3,
          is_active: true,
        },
      ],
    }),
    updatePayGroup: vi.fn().mockResolvedValue({ data: {} }),
    deletePayGroup: vi.fn().mockResolvedValue({ data: {} }),
    getSalaryStructures: vi.fn().mockResolvedValue({ data: [] }),
    createSalaryStructure: vi.fn().mockResolvedValue({ data: {} }),
    updateSalaryStructure: vi.fn().mockResolvedValue({ data: {} }),
  },
  getApiErrorMessage: vi.fn(() => 'error'),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn() }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, name: 'Admin', role: 'admin' } }),
}));

import SalaryStructureTemplates from './SalaryStructureTemplates';

afterEach(() => {
  resetDialogStack();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <MemoryRouter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </MemoryRouter>
  );
}

describe('payroll page dialogs', () => {
  it('opens the new salary structure dialog with an accessible name', async () => {
    const user = userEvent.setup();
    render(
      <Providers>
        <SalaryStructureTemplates />
      </Providers>,
    );

    await user.click(await screen.findByRole('button', { name: /new structure|new salary structure|add structure/i }));

    expect(screen.getByRole('dialog', { name: /new salary structure/i })).toBeInTheDocument();
  });
});
