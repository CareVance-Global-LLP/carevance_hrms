import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { resetDialogStack } from '@/components/ui/dialog/dialogStack';

vi.mock('@/services/api', () => ({
  payrollApi: {
    getOrganizationSettings: vi.fn().mockResolvedValue({ data: {} }),
    updateOrganizationSettings: vi.fn().mockResolvedValue({ data: {} }),
    getPayGroups: vi.fn().mockResolvedValue({ data: [] }),
    createPayGroup: vi.fn().mockResolvedValue({ data: {} }),
    getAllEmployees: vi.fn().mockResolvedValue({ data: [] }),
    assignEmployeesToPayGroup: vi.fn().mockResolvedValue({ data: {} }),
    getSalaryStructures: vi.fn().mockResolvedValue({ data: [] }),
    createSalaryStructure: vi.fn().mockResolvedValue({ data: {} }),
    updateSalaryStructure: vi.fn().mockResolvedValue({ data: {} }),
  },
  userApi: {
    getUsers: vi.fn().mockResolvedValue({ data: [] }),
  },
}));

import AddEmployeeToPayGroupModal from './AddEmployeeToPayGroupModal';
import PayGroupModal from './PayGroupModal';
import PayrollSettingsModal from './PayrollSettingsModal';
import SalaryStructureFormModal from './SalaryStructureFormModal';

afterEach(() => {
  resetDialogStack();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('payroll settings and pay group dialogs', () => {
  it('renders payroll settings as a named dialog', () => {
    render(
      <Providers>
        <PayrollSettingsModal isOpen onClose={vi.fn()} />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /payroll settings/i })).toBeInTheDocument();
  });

  it('renders the salary structure form as a named dialog', () => {
    render(
      <Providers>
        <SalaryStructureFormModal structure={null} onClose={vi.fn()} />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /template/i })).toBeInTheDocument();
  });

  it('renders the add-employee-to-pay-group dialog with an accessible name', () => {
    render(
      <Providers>
        <AddEmployeeToPayGroupModal
          isOpen
          onClose={vi.fn()}
          payGroupId={1}
          payGroupName="Monthly staff"
          onSuccess={vi.fn()}
        />
      </Providers>,
    );

    // This modal renders EmployeePickerList inside itself and passes it the
    // SAME title, so two nested dialogs end up with an identical accessible
    // name — the user sees the heading twice, stacked. That duplication is
    // pre-existing and out of scope here; it is recorded for follow-up. Match
    // the outer dialog by the heading it owns rather than by name.
    const outer = screen
      .getAllByRole('dialog')
      .find((node) => node.getAttribute('aria-labelledby') === 'add-employee-to-paygroup-title');

    expect(outer).toBeDefined();
    expect(outer).toHaveAccessibleName('Add Employee to Monthly staff');
  });

  it('renders the create pay group dialog with an accessible name', () => {
    render(
      <Providers>
        <PayGroupModal isOpen onClose={vi.fn()} monthYear="2026-08" onCreated={vi.fn()} />
      </Providers>,
    );

    expect(screen.getByRole('dialog', { name: /pay group/i })).toBeInTheDocument();
  });
});
