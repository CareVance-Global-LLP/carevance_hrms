import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

/*
 * react-virtuoso measures the scroll container to decide how many rows to
 * mount, and in happy-dom every box is zero-high, so the real component mounts
 * none of them and `itemContent` — which is where all the editable cells live —
 * never runs. Rendering every row keeps the assertions about the request body
 * and about which cells are editable, rather than about layout.
 */
vi.mock('react-virtuoso', () => ({
  TableVirtuoso: ({ totalCount, fixedHeaderContent, fixedFooterContent, itemContent }: any) => (
    <table>
      <thead>{fixedHeaderContent?.()}</thead>
      <tbody>
        {Array.from({ length: totalCount }, (_, i) => (
          <tr key={i}>{itemContent(i)}</tr>
        ))}
      </tbody>
      <tfoot>{fixedFooterContent?.()}</tfoot>
    </table>
  ),
}));

vi.mock('@/components/ui/Toast', () => ({
  useToast: () => ({ show: vi.fn(), dismiss: vi.fn(), toasts: [] }),
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('@/services/api', () => ({
  payrollApi: {
    getPayGroupEmployees: vi.fn(),
    listDepartmentTemplates: vi.fn().mockResolvedValue({ data: { templates: [] } }),
    getEmployeeReimbursements: vi.fn().mockResolvedValue({ data: [] }),
    getFbpAllocations: vi.fn().mockResolvedValue({ data: [] }),
    listLoans: vi.fn().mockResolvedValue({ data: { loans: [] } }),
    getPayrollSettings: vi.fn().mockResolvedValue({ data: { success: true, settings: { dayBasis: 'calendar' } } }),
    completeStep: vi.fn().mockResolvedValue({ data: { success: true, step: 6, updated_count: 3 } }),
    processPayGroupSelectedEmployees: vi.fn().mockResolvedValue({
      data: { success: true, message: '3 processed, 0 failed', succeeded: [], failed: [] },
    }),
  },
  getApiErrorMessage: vi.fn(() => 'error'),
}));

import { payrollApi } from '@/services/api';
import BulkPayrollMatrix from './BulkPayrollMatrix';

afterEach(() => {
  vi.clearAllMocks();
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

type Attendance = {
  working_days: number;
  present_days: number;
  paid_leave_days: number;
  lop_days: number;
  overtime_hours: number;
} | null;

function employee(id: number, name: string, attendance: Attendance) {
  return {
    id,
    name,
    email: `${name.toLowerCase()}@example.com`,
    employee_code: `E${id}`,
    department: 'Ops',
    designation: 'Operator',
    annual_ctc: 600000,
    attendance,
    steps_completed: { step1: false, step2: false, step3: false, step4: false, step5: false, step6: false },
    current_step: 1,
    payroll_status: {
      is_processed: false,
      net_pay: 0,
      payment_status: 'pending',
      gross_salary: 0,
      total_deductions: 0,
    },
  };
}

const present = (id: number, name: string) =>
  employee(id, name, { working_days: 26, present_days: 26, paid_leave_days: 0, lop_days: 0, overtime_hours: 0 });

function mountWith(employees: ReturnType<typeof employee>[]) {
  vi.mocked(payrollApi.getPayGroupEmployees).mockResolvedValue({
    data: {
      pay_group: { id: 9, name: 'Monthly Staff', code: 'MS', pay_frequency: 'monthly' },
      employees,
    },
  } as any);

  return render(
    <Providers>
      <BulkPayrollMatrix payGroupId={9} monthYear="2026-08" onBack={vi.fn()} />
    </Providers>,
  );
}

async function processAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Preview & Process' }));
  await user.click(await screen.findByRole('button', { name: /process all employees/i }));
  await waitFor(() =>
    expect(payrollApi.processPayGroupSelectedEmployees).toHaveBeenCalledTimes(1),
  );
  // Serialized the way the request body is, so an explicit `undefined` — which
  // never reaches the wire — cannot be mistaken for a regression, while any
  // group-wide number that comes back can.
  return JSON.parse(
    JSON.stringify(vi.mocked(payrollApi.processPayGroupSelectedEmployees).mock.calls[0][1]),
  );
}

/**
 * The grid always held a correct per-person row; the submit threw it away. It
 * sent the FIRST row's working days and the group MEAN loss of pay as two flat
 * numbers, and the endpoint wrote them to everybody identically. One person's 5
 * unpaid days therefore docked all twenty people in a group 0.25 days each — on
 * a 6,00,000 CTC, 416.67 taken from each of the nineteen who were present and
 * 7,916.67 handed to the absentee, whose real 5 days were worth 8,333.33. Every
 * row returned success, nothing was logged, and the only way to find it was two
 * employees comparing payslips. These tests are what fails if an averaged or
 * first-row figure is ever put back.
 */
describe('BulkPayrollMatrix per-employee attendance', () => {
  it('sends one person 5 LOP days and nothing at all for the rest, never the group mean', async () => {
    const user = userEvent.setup();
    mountWith([present(1, 'Asha'), present(2, 'Bilal'), present(3, 'Chandni')]);

    const lopCell = await screen.findByLabelText('Loss of pay days for Bilal');
    await user.clear(lopCell);
    await user.type(lopCell, '5');

    const body = await processAll(user);

    // Bilal's five days land on Bilal. Asha and Chandni are named in user_ids
    // so they are processed, and carry no attendance so the server prices them
    // from their own records — the grid has nothing to say about them that the
    // server did not tell it in the first place.
    expect(body.employees).toEqual([{ user_id: 2, lOP_days: 5 }]);
    expect(body.user_ids).toEqual([1, 2, 3]);

    // The two flat fields are the defect itself: whatever value they carry is
    // applied to every member. 5/3 = 1.6667 was the number that reached the
    // three payroll items here.
    expect(body).not.toHaveProperty('lOP_days');
    expect(body).not.toHaveProperty('working_days');
  });

  it('sends an edited LOP figure for the person it was typed against and nobody else', async () => {
    const user = userEvent.setup();
    mountWith([present(1, 'Asha'), present(2, 'Bilal')]);

    const lopCell = await screen.findByLabelText('Loss of pay days for Asha');
    await user.clear(lopCell);
    await user.type(lopCell, '3');

    const body = await processAll(user);

    expect(body.employees).toEqual([{ user_id: 1, lOP_days: 3 }]);
  });

  it('states nothing for an employee whose attendance nobody typed, so their own calendar decides', async () => {
    const user = userEvent.setup();
    // A null summary used to become 26 working days and 26 present. The server
    // reads a stated working_days as a description of the month, so a 26-day
    // calendar against a real 22-day one is four days of pay invented here.
    mountWith([present(1, 'Asha'), employee(2, 'Bilal', null)]);

    const body = await processAll(user);

    expect(body).not.toHaveProperty('employees');
    // Both still processed — they are priced off their own attendance.
    expect(body.user_ids).toEqual([1, 2]);
  });

  it('never names somebody outside the selection, which the endpoint refuses with a 422', async () => {
    const user = userEvent.setup();
    // The row map only ever grows, so a narrowed selection leaves rows behind.
    // Building the array from those rows would put a stranger in employees[]
    // and lose the whole batch to one validation error.
    const { rerender } = mountWith([present(1, 'Asha'), present(2, 'Bilal')]);

    for (const name of ['Asha', 'Bilal']) {
      const cell = await screen.findByLabelText(`Loss of pay days for ${name}`);
      await user.clear(cell);
      await user.type(cell, '2');
    }

    rerender(
      <Providers>
        <BulkPayrollMatrix payGroupId={9} monthYear="2026-08" onBack={vi.fn()} selectedEmployeeIds={[1]} />
      </Providers>,
    );

    const body = await processAll(user);

    expect(body.user_ids).toEqual([1]);
    expect(body.employees.map((e: { user_id: number }) => e.user_id)).toEqual([1]);
  });
});

/**
 * The other half of the same defect. Every cell on the salary and statutory
 * steps was an editable box, and the submit carried none of them — an operator
 * who corrected a PF figure believed they had, and the payslip disagreed with
 * the screen they signed off on. There is no field on the endpoint for any of
 * them, so they are shown rather than offered.
 */
describe('BulkPayrollMatrix derived columns', () => {
  it('offers no editable cell on the salary or statutory step', async () => {
    const user = userEvent.setup();
    mountWith([present(1, 'Asha')]);

    await user.click(await screen.findByRole('button', { name: 'Salary Structure' }));
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
    expect(screen.getByText(/not submitted from this grid/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Statutory Compliances' }));
    expect(screen.queryAllByRole('spinbutton')).toHaveLength(0);
  });

  it('leaves exactly the four attendance fields editable, paid leave included in neither', async () => {
    mountWith([present(1, 'Asha')]);

    await screen.findByLabelText('Working days for Asha');
    expect(screen.getByLabelText('Days present for Asha')).toBeInTheDocument();
    expect(screen.getByLabelText('Loss of pay days for Asha')).toBeInTheDocument();
    expect(screen.getByLabelText('Overtime hours for Asha')).toBeInTheDocument();
    // Paid leave is the leave ledger's answer and the endpoint has no field for
    // it. One row, four inputs — a fifth means a column was made editable
    // without anywhere on the request to put it.
    expect(screen.getAllByRole('spinbutton')).toHaveLength(4);
  });
});
