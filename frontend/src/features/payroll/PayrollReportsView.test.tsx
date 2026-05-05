import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PayrollReportsView from '@/features/payroll/PayrollReportsView';
import { renderWithProviders } from '@/test/renderWithProviders';

const mocks = vi.hoisted(() => ({
  reports: vi.fn(),
}));

vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return {
    ...actual,
    payrollWorkspaceApi: {
      ...actual.payrollWorkspaceApi,
      reports: mocks.reports,
    },
  };
});

describe('PayrollReportsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.reports.mockResolvedValue({
      data: {
        monthly_summary: {
          gross_payroll: 120000,
          net_payroll: 96000,
          employees_count: 3,
          overtime_seconds: 7200,
        },
        payout_status_report: [{ status: 'paid', count: 2, amount: 65000 }],
        monthly_trend: [
          { month: '2026-04', gross_payroll: 120000, net_payroll: 96000, employees_count: 3, paid_count: 2, failed_payouts: 0 },
          { month: '2026-03', gross_payroll: 100000, net_payroll: 82000, employees_count: 2, paid_count: 2, failed_payouts: 1 },
        ],
        component_totals: [{ component: 'Basic', category: 'basic', amount: 50000 }],
        employee_payroll_sheet: [
          { user: { name: 'Irbaz Mavli' }, payable_days: 22, status: 'processed', payout_status: 'paid', gross_pay: 50000, total_deductions: 6000, net_pay: 44000 },
          { user: { name: 'Riya Shah' }, payable_days: 20, status: 'processed', payout_status: 'pending', gross_pay: 40000, total_deductions: 5000, net_pay: 35000 },
        ],
        department_payroll_cost: [{ name: 'Finance', employee_count: 2, gross_pay: 80000, net_pay: 70000 }],
        deductions_report: [],
        attendance_vs_payable_days: [],
        tax_report: [],
        compliance_report: [],
        payout_history: [],
        failed_payout_report: [],
        payout_bank_advice: [],
      },
    });
  });

  it('renders detailed payroll report-specific analysis', async () => {
    renderWithProviders(<PayrollReportsView />);

    expect(await screen.findByText('Payroll Reports')).toBeInTheDocument();
    expect(screen.getByText('Report Specific Analysis')).toBeInTheDocument();
    expect(screen.getByText('Payroll Cost Waterfall')).toBeInTheDocument();
    expect(screen.getByText('Deduction Exposure')).toBeInTheDocument();
    expect(screen.getByText('Payout Risk Queue')).toBeInTheDocument();
    expect(screen.queryByText('Attendance Risk Radar')).not.toBeInTheDocument();
    expect(screen.getByText('Department Cost Detail')).toBeInTheDocument();
    expect(screen.getByText('Employee Payroll Detail')).toBeInTheDocument();
  });
});
