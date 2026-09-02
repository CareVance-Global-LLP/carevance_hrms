import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

/*
 * react-virtuoso measures the scroll container to decide how many rows to
 * mount, and in happy-dom every box is zero-high, so the real component mounts
 * none of them and `itemContent` — where the editable cells live — never runs.
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
    listDepartmentTemplates: vi.fn(),
    getPayrollSettings: vi.fn(),
    getEmployeeReimbursements: vi.fn().mockResolvedValue({ data: [] }),
    getFbpAllocations: vi.fn().mockResolvedValue({ data: [] }),
    listLoans: vi.fn().mockResolvedValue({ data: { loans: [] } }),
    completeStep: vi.fn().mockResolvedValue({ data: { success: true, step: 6, updated_count: 1 } }),
    processPayGroupSelectedEmployees: vi.fn().mockResolvedValue({
      data: { success: true, message: '1 processed, 0 failed', succeeded: [], failed: [] },
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

/*
 * Byte-for-byte what PayrollFilingController::getPayGroupEmployees emits from
 * the catch block around monthlyAttendanceSummary. Nothing distinguishes it
 * from a genuine 26-day month over the wire, which is the whole reason the
 * grid must not re-assert it.
 */
const serverAttendanceFallback = {
  working_days: 26,
  present_days: 26,
  paid_leave_days: 0,
  lop_days: 0,
  overtime_hours: 0,
};

type MountOptions = {
  dayBasis?: string;
  settingsFail?: boolean;
  templates?: Array<{ basic_pct: number; hra_pct: number; special_pct: number }>;
};

function mountWith(employees: ReturnType<typeof employee>[], opts: MountOptions = {}) {
  vi.mocked(payrollApi.getPayGroupEmployees).mockResolvedValue({
    data: {
      pay_group: { id: 9, name: 'Monthly Staff', code: 'MS', pay_frequency: 'monthly' },
      employees,
    },
  } as any);

  vi.mocked(payrollApi.listDepartmentTemplates).mockResolvedValue({
    data: { templates: opts.templates ?? [] },
  } as any);

  if (opts.settingsFail) {
    vi.mocked(payrollApi.getPayrollSettings).mockRejectedValue(new Error('500'));
  } else {
    vi.mocked(payrollApi.getPayrollSettings).mockResolvedValue({
      data: { success: true, settings: { dayBasis: opts.dayBasis ?? 'calendar' } },
    } as any);
  }

  return render(
    <Providers>
      <BulkPayrollMatrix payGroupId={9} monthYear="2026-08" onBack={vi.fn()} />
    </Providers>,
  );
}

async function processAll(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Preview & Process' }));
  await user.click(await screen.findByRole('button', { name: /process all employees/i }));
  await waitFor(() => expect(payrollApi.processPayGroupSelectedEmployees).toHaveBeenCalledTimes(1));
  // Serialized the way the body is, so an explicit `undefined` — which never
  // reaches the wire — cannot read as a regression, while a real one does.
  return JSON.parse(
    JSON.stringify(vi.mocked(payrollApi.processPayGroupSelectedEmployees).mock.calls[0][1]),
  );
}

const input = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

async function retype(user: ReturnType<typeof userEvent.setup>, label: string, value: string) {
  const cell = await screen.findByLabelText(label);
  await user.clear(cell);
  await user.type(cell, value);
}

/**
 * getPayGroupEmployees answers a failed monthlyAttendanceSummary with a
 * hardcoded 26 working / 26 present / 0 LOP. The grid used to treat any
 * attendance object as "stated" and echo the whole grid back, so that invented
 * calendar was submitted as the operator's own statement of the month — and
 * processEmployeePayroll reads a stated working_days as a description of the
 * month, pricing 26 full days for somebody whose real August had 22. It also
 * meant every row arrived stated, so the "let the employee's own summary
 * decide" path could never be taken in production at all.
 */
describe('BulkPayrollMatrix attendance provenance', () => {
  it('displays the server fallback calendar but never submits it', async () => {
    const user = userEvent.setup();
    mountWith([employee(1, 'Asha', serverAttendanceFallback)]);

    // Shown, so nothing is hidden from the operator.
    await waitFor(() => expect(input('Working days for Asha').value).toBe('26'));
    expect(input('Days present for Asha').value).toBe('26');

    const body = await processAll(user);

    // Not asserted. 26 is a number the server invented and the grid cannot
    // tell apart from a real one, so it goes back over the wire only if a
    // human types it.
    expect(body).not.toHaveProperty('employees');
    expect(body.user_ids).toEqual([1]);
  });

  it('takes the omit path when every row carries a server summary, not just when one is missing', async () => {
    const user = userEvent.setup();
    mountWith([
      employee(1, 'Asha', { working_days: 22, present_days: 22, paid_leave_days: 0, lop_days: 0, overtime_hours: 0 }),
      employee(2, 'Bilal', serverAttendanceFallback),
    ]);
    await screen.findByLabelText('Working days for Asha');

    const body = await processAll(user);

    expect(body).not.toHaveProperty('employees');
    expect(body.user_ids).toEqual([1, 2]);
  });

  it('submits only the cells typed, leaving the rest of the row to the employee record', async () => {
    const user = userEvent.setup();
    mountWith([employee(1, 'Asha', serverAttendanceFallback)]);

    await retype(user, 'Overtime hours for Asha', '4');

    const body = await processAll(user);

    // No days_present: 0 alongside it. A zero days_present is a claim that
    // somebody worked no days at all.
    expect(body.employees).toEqual([{ user_id: 1, overtime_hours: 4 }]);
  });
});

/**
 * The grid sent lOP_days on every row including a zero, and an explicit zero
 * beats the server's own days_present → LOP derivation. A typed 21-of-26
 * therefore paid a FULL month while Days Absent on the same row read 5 — an
 * input that visibly changes a number on screen and provably changes nothing on
 * the payslip.
 */
describe('BulkPayrollMatrix Days Present moves pay', () => {
  it('turns a typed 21-of-26 into a five-day LOP on screen and in the request', async () => {
    const user = userEvent.setup();
    mountWith([employee(1, 'Asha', serverAttendanceFallback)]);

    await retype(user, 'Days present for Asha', '21');

    // The cell that gets submitted is the cell being read.
    expect(input('Loss of pay days for Asha').value).toBe('5');

    const body = await processAll(user);

    expect(body.employees).toEqual([
      { user_id: 1, working_days: 26, days_present: 21, lOP_days: 5 },
    ]);
    // The exact shape of the defect: a zero here is honoured over the
    // derivation and pays the month in full.
    expect(body.employees[0].lOP_days).not.toBe(0);
  });

  it('does not charge paid leave as loss of pay', async () => {
    const user = userEvent.setup();
    // present_days excludes paid leave, so of five non-present days two were
    // approved leave. The server's own working - present derivation cannot see
    // that and would charge all five; stating LOP keeps the ledger's answer.
    mountWith([
      employee(1, 'Asha', { working_days: 26, present_days: 22, paid_leave_days: 2, lop_days: 2, overtime_hours: 0 }),
    ]);

    await retype(user, 'Days present for Asha', '21');

    expect(input('Loss of pay days for Asha').value).toBe('3');

    const body = await processAll(user);

    expect(body.employees).toEqual([
      { user_id: 1, working_days: 26, days_present: 21, lOP_days: 3 },
    ]);
  });

  it('keeps a hand-typed LOP when Days Present is edited afterwards', async () => {
    const user = userEvent.setup();
    mountWith([employee(1, 'Asha', serverAttendanceFallback)]);

    // Five absences, all of them paid: a real statement, and the grid must not
    // overwrite it with its own arithmetic.
    await retype(user, 'Loss of pay days for Asha', '0');
    await retype(user, 'Days present for Asha', '21');

    expect(input('Loss of pay days for Asha').value).toBe('');

    const body = await processAll(user);

    expect(body.employees).toEqual([
      { user_id: 1, working_days: 26, days_present: 21, lOP_days: 0 },
    ]);
  });
});

/*
 * A 6,00,000 CTC on a 40/20/35 split plus ₹1,600 conveyance is ₹49,100 monthly
 * gross. Five LOP days in August 2026:
 *   the run charges 49100 / 31 * 5   = ₹7,919
 *   this screen used to quote (20000 + 10000) / 26 * 5 = ₹5,769
 * — the wrong numerator (basic+HRA rather than gross) and the wrong divisor
 * (working days rather than the wage period), understating every absence by 27%
 * on the screen whose job is to be agreed with before the money moves.
 */
const TEMPLATE = [{ basic_pct: 40, hra_pct: 20, special_pct: 35 }];

describe('BulkPayrollMatrix review step LOP arithmetic', () => {
  async function reviewWithFiveLopDays(opts: MountOptions) {
    const user = userEvent.setup();
    mountWith([employee(1, 'Asha', serverAttendanceFallback)], { ...opts, templates: TEMPLATE });

    // Wait for the department template to land, or the row is still on the
    // 25% special allowance the initial estimate uses.
    await waitFor(() => expect(payrollApi.listDepartmentTemplates).toHaveBeenCalled());
    await retype(user, 'Loss of pay days for Asha', '5');
    await user.click(await screen.findByRole('button', { name: 'Preview & Process' }));
    await screen.findByText('LOP Ded.');
    return user;
  }

  it('prices a day at monthly gross over the calendar month, not basic+HRA over working days', async () => {
    await reviewWithFiveLopDays({ dayBasis: 'calendar' });

    expect(screen.getAllByText('₹7,919').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹5,769')).toBeNull();
  });

  it('follows the organisation day basis rather than a divisor of its own', async () => {
    await reviewWithFiveLopDays({ dayBasis: 'fixed_26' });

    // 49100 / 26 * 5. Same arithmetic, the org's configured wage period.
    expect(screen.getAllByText('₹9,442').length).toBeGreaterThan(0);
    expect(screen.queryByText('₹7,919')).toBeNull();
    expect(screen.getByText(/÷ 26 \(a fixed 26-day month\)/)).toBeInTheDocument();
  });

  it('names the divisor it used', async () => {
    await reviewWithFiveLopDays({ dayBasis: 'calendar' });

    expect(screen.getByText(/÷ 31 \(31 calendar days\), the divisor payroll runs on/)).toBeInTheDocument();
  });

  it('says so when the organisation day basis could not be read', async () => {
    await reviewWithFiveLopDays({ settingsFail: true });

    // The statutory default is still used — it is what the resolver falls back
    // to — but it is not passed off as this organisation's answer.
    expect(
      screen.getByText(/day basis could not be read, so the statutory default is shown/),
    ).toBeInTheDocument();
  });
});
