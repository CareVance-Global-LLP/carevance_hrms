import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import DataTable from '@/components/dashboard/DataTable';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { payrollWorkspaceApi } from '@/services/api';
import { AlertTriangle, Building2, CheckCircle2, Clock3, Download, FileText, Wallet } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import { defaultPayrollMonth, formatPayrollCurrency, formatPayrollDuration, formatPayrollMonth } from '@/features/payroll/utils';

const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));

export default function PayrollReportsView() {
  const [payrollMonth, setPayrollMonth] = useState(defaultPayrollMonth());

  const reportsQuery = useQuery({
    queryKey: ['payroll-reports', payrollMonth],
    queryFn: async () => (await payrollWorkspaceApi.reports({ payroll_month: payrollMonth })).data,
  });

  if (reportsQuery.isLoading) {
    return <PageLoadingState label="Loading payroll reports..." />;
  }

  if (reportsQuery.isError) {
    return <PageErrorState message={(reportsQuery.error as any)?.response?.data?.message || 'Failed to load payroll reports.'} onRetry={() => void reportsQuery.refetch()} />;
  }

  const reports = reportsQuery.data;
  const monthlySummary = reports.monthly_summary || {};
  const employeePayrollSheet = reports.employee_payroll_sheet || [];
  const departmentPayrollCost = reports.department_payroll_cost || [];
  const grossPayroll = Number(monthlySummary.gross_payroll || 0);
  const netPayroll = Number(monthlySummary.net_payroll || 0);
  const totalDeductions = employeePayrollSheet.reduce((sum: number, row: any) => sum + Number(row.total_deductions || 0), 0);
  const totalGrossFromSheet = employeePayrollSheet.reduce((sum: number, row: any) => sum + Number(row.gross_pay || 0), 0);
  const totalNetFromSheet = employeePayrollSheet.reduce((sum: number, row: any) => sum + Number(row.net_pay || 0), 0);
  const payoutRows = reports.payout_status_report || [];
  const paidPayoutCount = payoutRows
    .filter((row: any) => ['paid', 'success', 'processed'].includes(String(row.status || '').toLowerCase()))
    .reduce((sum: number, row: any) => sum + Number(row.count || 0), 0);
  const totalPayoutCount = payoutRows.reduce((sum: number, row: any) => sum + Number(row.count || 0), 0);
  const payrollCompletionRate = totalPayoutCount ? (paidPayoutCount / totalPayoutCount) * 100 : 0;
  const largestDepartmentCost = departmentPayrollCost.reduce((largest: any, row: any) => (
    Number(row.net_pay || 0) > Number(largest?.net_pay || 0) ? row : largest
  ), null);
  const trendRows = [...(reports.monthly_trend || [])].sort((left: any, right: any) => String(right.month || '').localeCompare(String(left.month || '')));
  const currentTrend = trendRows.find((row: any) => row.month === payrollMonth) || trendRows[0] || null;
  const previousTrend = currentTrend ? trendRows.find((row: any) => row.month !== currentTrend.month) || null : null;
  const netDelta = currentTrend && previousTrend ? Number(currentTrend.net_payroll || 0) - Number(previousTrend.net_payroll || 0) : null;
  const employeeDelta = currentTrend && previousTrend ? Number(currentTrend.employees_count || 0) - Number(previousTrend.employees_count || 0) : null;
  const payrollWaterfall = [
    { label: 'Gross', value: totalGrossFromSheet || grossPayroll, tone: 'bg-sky-500' },
    { label: 'Deductions', value: -Math.abs(totalDeductions), tone: 'bg-rose-500' },
    { label: 'Net', value: totalNetFromSheet || netPayroll, tone: 'bg-emerald-500' },
  ];
  const maxWaterfallValue = Math.max(1, ...payrollWaterfall.map((row) => Math.abs(row.value)));
  const deductionExposureRows = employeePayrollSheet
    .map((row: any) => {
      const gross = Number(row.gross_pay || 0);
      const deductions = Number(row.total_deductions || 0);
      return {
        ...row,
        deductionRate: gross ? (deductions / gross) * 100 : 0,
      };
    })
    .sort((left: any, right: any) => Number(right.deductionRate || 0) - Number(left.deductionRate || 0))
    .slice(0, 5);
  const payoutRiskRows = [
    ...(reports.failed_payout_report || []),
    ...employeePayrollSheet.filter((row: any) => !['paid', 'success', 'processed'].includes(String(row.payout_status || '').toLowerCase())),
  ].slice(0, 5);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Payroll analytics"
        title="Payroll Reports"
        description="Executive payroll summary first, then denser finance and operations tables for employees, deductions, payouts, and payroll control."
        actions={(
          <>
            <div className="min-w-[12rem]">
              <FieldLabel>Payroll Month</FieldLabel>
              <TextInput type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled>
                <Download className="h-4 w-4" />
                Export CSV
              </Button>
              <Button variant="secondary" size="sm" disabled>
                <Download className="h-4 w-4" />
                Export XLSX
              </Button>
            </div>
          </>
        )}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Gross Payroll" value={formatPayrollCurrency(grossPayroll)} hint="Selected payroll cycle." icon={Wallet} accent="sky" />
        <MetricCard label="Net Payroll" value={formatPayrollCurrency(netPayroll)} hint="Selected payroll cycle." icon={Wallet} accent="emerald" />
        <MetricCard label="Employees" value={Number(monthlySummary.employees_count || 0)} hint="Employees in the current run." icon={Building2} accent="violet" />
        <MetricCard label="Overtime" value={formatPayrollDuration(Number(monthlySummary.overtime_seconds || 0))} hint="Approved overtime included in payroll." icon={Clock3} accent="amber" />
      </div>

      <PayrollSectionCard title="Report Specific Analysis" description="Finance-focused payroll intelligence for the selected month: waterfall movement, deduction exposure, and payout risk.">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1fr]">
          <div className="rounded-[22px] border border-sky-200 bg-[linear-gradient(135deg,#eff6ff_0%,#ffffff_60%,#f8fafc_100%)] px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Payroll Cost Waterfall</h3>
                <p className="mt-1 text-xs text-slate-500">Gross to deduction to net movement for {formatPayrollMonth(payrollMonth)}.</p>
              </div>
              <PayrollStatusBadge status={payrollCompletionRate >= 90 ? 'healthy' : payrollCompletionRate > 0 ? 'processed' : 'pending'} />
            </div>
            <div className="mt-5 flex min-h-52 items-end gap-3 rounded-2xl bg-white/75 px-4 pb-4 pt-5 shadow-inner">
              {payrollWaterfall.map((row) => {
                const height = clampPercent((Math.abs(row.value) / maxWaterfallValue) * 100);
                return (
                  <div key={row.label} className="group flex flex-1 flex-col items-center justify-end gap-2">
                    <span className="text-xs font-semibold text-slate-700 opacity-0 transition group-hover:opacity-100">{formatPayrollCurrency(Math.abs(row.value))}</span>
                    <div className="flex h-36 w-full items-end rounded-xl bg-slate-100 px-2 py-2">
                      <div
                        title={`${row.label}: ${formatPayrollCurrency(Math.abs(row.value))}`}
                        className={`w-full rounded-lg ${row.tone} shadow-sm transition-all duration-500 group-hover:scale-x-105 group-hover:brightness-110`}
                        style={{ height: `${Math.max(12, height)}%` }}
                      />
                    </div>
                    <span className="text-xs font-medium text-slate-600">{row.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Deduction Exposure</h3>
                <p className="mt-1 text-xs text-slate-500">Highest deduction percentage by employee, with hover expansion.</p>
              </div>
              <FileText className="h-5 w-5 text-rose-500" />
            </div>
            <div className="mt-5 space-y-3">
              {deductionExposureRows.length === 0 ? (
                <p className="text-sm text-slate-500">No employee deduction data available.</p>
              ) : deductionExposureRows.map((row: any) => (
                <div key={row.user?.id || row.user?.name} className="group rounded-xl border border-slate-200 bg-slate-50/80 p-3 transition hover:-translate-y-0.5 hover:border-rose-300 hover:bg-rose-50/60 hover:shadow-md">
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <p className="truncate font-semibold text-slate-950">{row.user?.name || 'Unknown employee'}</p>
                    <span className="text-xs font-semibold text-rose-700">{row.deductionRate.toFixed(1)}%</span>
                  </div>
                  <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-white">
                    <div className="h-full rounded-full bg-rose-500 transition-all duration-500 group-hover:bg-rose-600" style={{ width: `${Math.max(8, clampPercent(row.deductionRate))}%` }} />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{formatPayrollCurrency(row.total_deductions || 0)} deducted from {formatPayrollCurrency(row.gross_pay || 0)} gross.</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:col-span-2">
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
              <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Payout completion</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{payrollCompletionRate.toFixed(1)}%</p>
              <p className="mt-2 text-sm text-slate-500">{paidPayoutCount} of {totalPayoutCount} payout rows completed.</p>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-white px-4 py-4 transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md">
              <Building2 className="h-5 w-5 text-sky-600" />
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Largest department</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">{largestDepartmentCost?.name || 'No department'}</p>
              <p className="mt-2 text-sm text-slate-500">{formatPayrollCurrency(Number(largestDepartmentCost?.net_pay || 0))} net cost.</p>
            </div>
            <div className="rounded-[22px] border border-amber-200 bg-amber-50/70 px-4 py-4 transition hover:-translate-y-0.5 hover:shadow-md">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <p className="text-xs uppercase tracking-[0.18em] text-amber-700">Payout Risk Queue</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{payoutRiskRows.length}</p>
              <p className="mt-2 text-sm text-slate-600">{payoutRiskRows.length ? `${payoutRiskRows[0]?.user?.name || 'Employee'} needs payout review first.` : 'No payout risk rows in this cycle.'}</p>
            </div>
          </div>
        </div>
      </PayrollSectionCard>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <PayrollSectionCard title="Reporting Controls" description="Operational reporting scope and export visibility for payroll admins and finance reviewers.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Reporting month</p>
              <p className="mt-2 font-semibold text-slate-950">{formatPayrollMonth(payrollMonth)}</p>
              <p className="mt-2 text-sm text-slate-500">All summaries and tables below are scoped to this payroll cycle.</p>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Exports</p>
              <p className="mt-2 font-semibold text-slate-950">Visible and ready for backend wiring</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" disabled>
                  <Download className="h-4 w-4" />
                  Export CSV
                </Button>
                <Button variant="secondary" size="sm" disabled>
                  <Download className="h-4 w-4" />
                  Export XLSX
                </Button>
              </div>
              <p className="mt-3 text-sm text-slate-500">Dedicated report-export endpoints are the remaining backend step for full payroll downloads.</p>
            </div>
          </div>
        </PayrollSectionCard>

        <DataTable
          title="Payout Status Distribution"
          description="Current payout distribution for the selected run."
          rows={payoutRows}
          emptyMessage="No payout report data found."
          columns={[
            { key: 'status', header: 'Status', render: (row: any) => <PayrollStatusBadge status={row.status} /> },
            { key: 'count', header: 'Count', render: (row: any) => row.count },
            { key: 'amount', header: 'Amount', render: (row: any) => formatPayrollCurrency(row.amount || 0) },
          ]}
        />
      </div>

      {currentTrend && previousTrend ? (
        <PayrollSectionCard title="Period Comparison" description="Current cycle compared with the previous available payroll period.">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Net payroll delta</p>
              <p className="mt-2 font-semibold text-slate-950">{formatPayrollCurrency(Number(netDelta || 0))}</p>
              <p className="mt-2 text-sm text-slate-500">{formatPayrollMonth(currentTrend.month)} vs {formatPayrollMonth(previousTrend.month)}</p>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Employee delta</p>
              <p className="mt-2 font-semibold text-slate-950">{Number(employeeDelta || 0) >= 0 ? `+${Number(employeeDelta || 0)}` : Number(employeeDelta || 0)}</p>
              <p className="mt-2 text-sm text-slate-500">Employees moved in or out of the cycle.</p>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Failed payouts</p>
              <p className="mt-2 font-semibold text-slate-950">{Number(currentTrend.failed_payouts || 0)}</p>
              <p className="mt-2 text-sm text-slate-500">Previous period: {Number(previousTrend.failed_payouts || 0)}</p>
            </div>
          </div>
        </PayrollSectionCard>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <PayrollSectionCard title="Monthly Trend" description="Recent payroll trend across available pay runs.">
          <div className="space-y-3">
            {(reports.monthly_trend || []).length === 0 ? (
              <p className="text-sm text-slate-500">No monthly trend data is available yet.</p>
            ) : (reports.monthly_trend || []).map((row: any) => {
              const gross = Number(row.gross_payroll || 0);
              const net = Number(row.net_payroll || 0);
              const width = gross > 0 ? Math.max(12, Math.round((net / gross) * 100)) : 12;
              return (
                <div key={row.month} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{formatPayrollMonth(row.month)}</p>
                      <p className="mt-1 text-sm text-slate-500">{row.employees_count || 0} employees | {row.paid_count || 0} paid</p>
                    </div>
                    <PayrollStatusBadge status={row.failed_payouts ? `${row.failed_payouts} failed` : 'healthy'} />
                  </div>
                  <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
                    <div className="h-full rounded-full bg-[linear-gradient(90deg,#0ea5e9_0%,#0f172a_100%)]" style={{ width: `${width}%` }} />
                  </div>
                  <div className="mt-3 flex items-center justify-between text-sm">
                    <span className="text-slate-500">Gross {formatPayrollCurrency(gross)}</span>
                    <span className="font-medium text-slate-950">Net {formatPayrollCurrency(net)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </PayrollSectionCard>

        <DataTable
          title="Component Totals"
          description="Component-wise totals aggregated from the selected pay run."
          rows={reports.component_totals || []}
          emptyMessage="No component totals are available for this month."
          columns={[
            { key: 'component', header: 'Component', render: (row: any) => row.component },
            { key: 'category', header: 'Category', render: (row: any) => <PayrollStatusBadge status={row.category} /> },
            { key: 'amount', header: 'Amount', render: (row: any) => formatPayrollCurrency(Number(row.amount || 0)) },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <DataTable
          description="Employee-wise payroll sheet for the selected month."
          title="Employee Payroll Detail"
          rows={employeePayrollSheet}
          emptyMessage="No payroll sheet data found."
          stickyHeader
          columns={[
            { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
            { key: 'payable_days', header: 'Payable Days', render: (row: any) => row.payable_days },
            { key: 'status', header: 'Payroll', render: (row: any) => <PayrollStatusBadge status={row.status} /> },
            { key: 'payout_status', header: 'Payout', render: (row: any) => <PayrollStatusBadge status={row.payout_status} /> },
            { key: 'gross_pay', header: 'Gross Pay', render: (row: any) => formatPayrollCurrency(row.gross_pay || 0) },
            { key: 'total_deductions', header: 'Deductions', render: (row: any) => formatPayrollCurrency(row.total_deductions || 0) },
            { key: 'net_pay', header: 'Net Pay', render: (row: any) => formatPayrollCurrency(row.net_pay || 0) },
          ]}
        />

        <DataTable
          title="Department Cost Detail"
          description="Payroll cost grouped by existing team and department groups."
          rows={departmentPayrollCost}
          emptyMessage="No department payroll cost data found."
          stickyHeader
          columns={[
            { key: 'name', header: 'Department', render: (row: any) => row.name },
            { key: 'employee_count', header: 'Employees', render: (row: any) => row.employee_count },
            { key: 'gross_pay', header: 'Gross Pay', render: (row: any) => formatPayrollCurrency(row.gross_pay || 0) },
            { key: 'net_pay', header: 'Net Pay', render: (row: any) => formatPayrollCurrency(row.net_pay || 0) },
          ]}
        />

        <DataTable
          title="Deductions Report"
          description="Deductions, tax, and compliance deductions by employee."
          rows={reports.deductions_report || []}
          emptyMessage="No deduction report data found."
          stickyHeader
          columns={[
            { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
            { key: 'deductions', header: 'Deductions', render: (row: any) => formatPayrollCurrency(row.deductions || 0) },
            { key: 'tax', header: 'Tax', render: (row: any) => formatPayrollCurrency(row.tax || 0) },
            { key: 'tds', header: 'TDS', render: (row: any) => formatPayrollCurrency(row.tds || 0) },
            { key: 'total_deductions', header: 'Total', render: (row: any) => formatPayrollCurrency(row.total_deductions || 0) },
          ]}
        />

        <DataTable
          title="Attendance vs Payable Snapshot"
          description="Attendance coverage alongside payroll-calculated payable days."
          rows={reports.attendance_vs_payable_days || []}
          emptyMessage="No attendance snapshot data found."
          stickyHeader
          columns={[
            { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
            { key: 'payable_days', header: 'Payable Days', render: (row: any) => row.payable_days },
            { key: 'present', header: 'Present', render: (row: any) => row.attendance_present_days },
            { key: 'leave', header: 'Leave', render: (row: any) => row.approved_leave_days },
            { key: 'worked', header: 'Worked Time', render: (row: any) => formatPayrollDuration(row.worked_seconds || 0) },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <DataTable
          title="Tax Report"
          description="Employee-level TDS view with declared regime and annual estimate."
          rows={reports.tax_report || []}
          emptyMessage="No tax report data found."
          stickyHeader
          columns={[
            { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
            { key: 'tax_regime', header: 'Regime', render: (row: any) => row.tax_regime || 'N/A' },
            { key: 'monthly_tds', header: 'Monthly TDS', render: (row: any) => formatPayrollCurrency(row.monthly_tds || 0) },
            { key: 'annual_tax', header: 'Annual Tax', render: (row: any) => formatPayrollCurrency(row.annual_tax || 0) },
          ]}
        />

        <DataTable
          title="Compliance Report"
          description="Employee and employer statutory totals for the selected run."
          rows={reports.compliance_report || []}
          emptyMessage="No compliance report data found."
          stickyHeader
          columns={[
            { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
            { key: 'employee_deductions', header: 'Employee Deductions', render: (row: any) => formatPayrollCurrency(row.employee_deductions || 0) },
            { key: 'tds', header: 'TDS', render: (row: any) => formatPayrollCurrency(row.tds || 0) },
            { key: 'employer_contributions', header: 'Employer Contributions', render: (row: any) => formatPayrollCurrency(row.employer_contributions || 0) },
          ]}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.08fr_0.92fr]">
        <DataTable
          title="Payout History"
          description="Recent payout transactions linked to payroll records for the selected month."
          rows={reports.payout_history || []}
          emptyMessage="No payout history is available for this month."
          stickyHeader
          columns={[
            { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Employee' },
            { key: 'provider', header: 'Provider', render: (row: any) => row.provider || 'N/A' },
            { key: 'reference', header: 'Reference', render: (row: any) => row.transaction_id || 'No reference' },
            { key: 'created_at', header: 'Created', render: (row: any) => row.created_at ? new Date(row.created_at).toLocaleString() : 'N/A' },
            { key: 'status', header: 'Status', render: (row: any) => <PayrollStatusBadge status={row.status} /> },
            { key: 'amount', header: 'Amount', render: (row: any) => formatPayrollCurrency(Number(row.amount || 0), row.currency || 'INR') },
          ]}
        />

        <DataTable
          title="Failed Payout Report"
          description="Employees whose payout status is currently marked failed."
          rows={reports.failed_payout_report || []}
          emptyMessage="No failed payouts were reported for this run."
          stickyHeader
          columns={[
            { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Employee' },
            { key: 'net_pay', header: 'Net Pay', render: (row: any) => formatPayrollCurrency(Number(row.net_pay || 0)) },
            { key: 'status', header: 'Payout Status', render: (row: any) => <PayrollStatusBadge status={row.payout_status} /> },
            { key: 'warnings', header: 'Warnings', render: (row: any) => (row.warnings || []).length > 0 ? row.warnings.join(' | ') : 'No warning details' },
          ]}
        />
      </div>

      <DataTable
        title="Bank Advice / Payout Summary"
        description="Export-friendly payout sheet with payment references and current status."
        rows={reports.payout_bank_advice || []}
        emptyMessage="No payout summary rows found."
        stickyHeader
        columns={[
          { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Employee' },
          { key: 'net_pay', header: 'Net Pay', render: (row: any) => formatPayrollCurrency(Number(row.net_pay || 0)) },
          { key: 'payout_status', header: 'Payout', render: (row: any) => <PayrollStatusBadge status={row.payout_status} /> },
          { key: 'payment_reference', header: 'Reference', render: (row: any) => row.payment_reference || 'Pending' },
        ]}
      />

      <div className="rounded-[24px] border border-dashed border-slate-300 bg-slate-50/70 px-4 py-4 text-sm text-slate-500">
        Current reports are fully viewable in-app. Dedicated export generation for these workspace reports is the remaining backend step.
      </div>
    </div>
  );
}
