import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Banknote, BarChart3, CheckCircle2, Play, Receipt, Settings, SlidersHorizontal, Users, Wallet } from 'lucide-react';
import DataTable from '@/components/dashboard/DataTable';
import MetricCard from '@/components/dashboard/MetricCard';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { hasAdminAccess } from '@/lib/permissions';
import { payrollSimpleApi } from '@/services/api';
import { cn } from '@/utils/cn';

type PayrollTab = 'overview' | 'run' | 'salary' | 'adjustments' | 'payslips' | 'reports' | 'settings';
type PayrollWorkspaceMode = 'overview' | 'runs' | 'employees' | 'adjustments' | 'payslips' | 'settings' | 'components' | 'structures' | 'reports' | 'employee-detail';

const tabs: Array<{ key: PayrollTab; label: string; icon: typeof Wallet }> = [
  { key: 'overview', label: 'Overview', icon: Wallet },
  { key: 'run', label: 'Run Payroll', icon: Play },
  { key: 'salary', label: 'Salary Setup', icon: Users },
  { key: 'adjustments', label: 'Adjustments', icon: SlidersHorizontal },
  { key: 'payslips', label: 'Payslips', icon: Receipt },
  { key: 'reports', label: 'Payroll Report', icon: BarChart3 },
  { key: 'settings', label: 'Settings', icon: Settings },
];

const modeToTab: Record<string, PayrollTab> = {
  overview: 'overview',
  runs: 'run',
  employees: 'salary',
  adjustments: 'adjustments',
  payslips: 'payslips',
  reports: 'reports',
  settings: 'settings',
  components: 'settings',
  structures: 'settings',
  'employee-detail': 'salary',
};

const defaultMonth = () => new Date().toISOString().slice(0, 7);
const money = (value: number, currency = 'INR') => new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(value || 0));
const monthName = (value: string) => {
  const [year, month] = value.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
};

export default function PayrollWorkspace({ mode }: { mode: PayrollWorkspaceMode }) {
  const { user } = useAuth();
  const canManage = hasAdminAccess(user);
  const navigate = useNavigate();
  const location = useLocation();
  const [month, setMonth] = useState(defaultMonth());
  const [activeTab, setActiveTab] = useState<PayrollTab>(canManage ? modeToTab[mode] || 'overview' : 'payslips');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setActiveTab(canManage ? modeToTab[mode] || 'overview' : 'payslips');
  }, [canManage, mode]);

  if (!canManage && mode !== 'payslips') {
    return <Navigate to="/payroll/payslips" replace />;
  }

  const openTab = (tab: PayrollTab) => {
    setActiveTab(tab);
    const path = tab === 'overview' ? '/payroll' : tab === 'run' ? '/payroll/runs' : tab === 'salary' ? '/payroll/employees' : `/payroll/${tab}`;
    if (location.pathname !== path) navigate(path);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Payroll"
        title={canManage ? 'Simple Payroll' : 'My Payslips'}
        description={canManage ? 'Run payroll from attendance, leave, approved hours, and small manual adjustments.' : 'View and download your salary slips.'}
        actions={<MonthPicker month={month} onChange={setMonth} />}
      />

      {canManage ? (
        <SurfaceCard className="p-2">
          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => {
              const Icon = tab.icon;
              const selected = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => openTab(tab.key)}
                  className={cn(
                    'inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition',
                    selected ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-950'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </SurfaceCard>
      ) : null}

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}
      {activeTab === 'overview' && canManage ? <Overview month={month} /> : null}
      {activeTab === 'run' && canManage ? <RunPayroll month={month} setFeedback={setFeedback} /> : null}
      {activeTab === 'salary' && canManage ? <SalarySetup setFeedback={setFeedback} /> : null}
      {activeTab === 'adjustments' && canManage ? <Adjustments month={month} setFeedback={setFeedback} /> : null}
      {activeTab === 'payslips' ? <Payslips month={month} canManage={canManage} /> : null}
      {activeTab === 'reports' && canManage ? <PayrollReport month={month} /> : null}
      {activeTab === 'settings' && canManage ? <BasicSettings setFeedback={setFeedback} /> : null}
    </div>
  );
}

function MonthPicker({ month, onChange }: { month: string; onChange: (value: string) => void }) {
  return (
    <div className="min-w-[11rem]">
      <FieldLabel>Payroll Month</FieldLabel>
      <TextInput type="month" value={month} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function Overview({ month }: { month: string }) {
  const query = useQuery({
    queryKey: ['simple-payroll-overview', month],
    queryFn: async () => (await payrollSimpleApi.overview(month)).data,
  });

  if (query.isLoading) return <PageLoadingState label="Loading payroll overview..." />;
  if (query.isError) return <PageErrorState message="Unable to load payroll overview." onRetry={() => void query.refetch()} />;

  const data = query.data;
  const summary = data.summary;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Current Status" value={data.current_run?.status || 'Not run'} hint={monthName(month)} icon={CheckCircle2} accent="sky" />
        <MetricCard label="Employees" value={summary.employees} hint="Included in run." icon={Users} accent="slate" />
        <MetricCard label="Gross Pay" value={money(summary.gross_pay)} icon={Wallet} accent="emerald" />
        <MetricCard label="Deductions" value={money(summary.deductions)} icon={AlertTriangle} accent="amber" />
        <MetricCard label="Net Pay" value={money(summary.net_pay)} icon={Banknote} accent="violet" />
        <MetricCard label="Exceptions" value={summary.exceptions} hint="Need review." icon={AlertTriangle} accent={summary.exceptions > 0 ? 'rose' : 'emerald'} />
      </div>

      <DataTable
        title="Recent Pay Runs"
        description="A short history of payroll cycles."
        rows={data.recent_runs as any[]}
        emptyMessage="No payroll runs yet."
        columns={[
          { key: 'month', header: 'Month', render: (row) => monthName(row.month) },
          { key: 'employees', header: 'Employees', render: (row) => row.employees },
          { key: 'gross', header: 'Gross', render: (row) => money(row.gross_pay) },
          { key: 'net', header: 'Net', render: (row) => money(row.net_pay) },
          { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
        ]}
      />
    </div>
  );
}

function RunPayroll({ month, setFeedback }: { month: string; setFeedback: (value: { tone: 'success' | 'error'; message: string } | null) => void }) {
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const runsQuery = useQuery({
    queryKey: ['simple-payroll-runs', month],
    queryFn: async () => (await payrollSimpleApi.runs(month)).data.data,
  });
  const runId = selectedRunId || runsQuery.data?.[0]?.id || null;
  const detailQuery = useQuery({
    queryKey: ['simple-payroll-run', runId],
    queryFn: async () => (await payrollSimpleApi.run(runId as number)).data,
    enabled: Boolean(runId),
  });

  useEffect(() => {
    if (!selectedRunId && runsQuery.data?.[0]?.id) setSelectedRunId(runsQuery.data[0].id);
  }, [runsQuery.data, selectedRunId]);

  const action = async (fn: () => Promise<any>, success: string) => {
    setBusy(true);
    setFeedback(null);
    try {
      await fn();
      setFeedback({ tone: 'success', message: success });
      await runsQuery.refetch();
      await detailQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Payroll action failed.' });
    } finally {
      setBusy(false);
    }
  };

  if (runsQuery.isLoading) return <PageLoadingState label="Loading payroll run..." />;
  const run = detailQuery.data?.run || null;
  const items = detailQuery.data?.items || [];

  return (
    <div className="space-y-5">
      <SurfaceCard className="p-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Run payroll for {monthName(month)}</h2>
            <p className="mt-1 text-sm text-slate-500">Generate a draft, review exceptions, approve, then mark paid to create payslips.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => action(() => payrollSimpleApi.generateRun(month), 'Draft payroll generated.')}>
              <Play className="h-4 w-4" /> Generate Draft
            </Button>
            <Button variant="secondary" disabled={busy || !run || run.exceptions > 0} onClick={() => action(() => payrollSimpleApi.approveRun(run.id), 'Payroll approved.')}>
              Approve
            </Button>
            <Button variant="secondary" disabled={busy || !run || run.status !== 'approved'} onClick={() => action(() => payrollSimpleApi.markPaid(run.id), 'Payroll marked paid and payslips generated.')}>
              Mark Paid
            </Button>
          </div>
        </div>
      </SurfaceCard>

      {run ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <MetricCard label="Status" value={run.status} icon={CheckCircle2} accent="sky" />
          <MetricCard label="Employees" value={run.employees} icon={Users} accent="slate" />
          <MetricCard label="Net Pay" value={money(run.net_pay)} icon={Banknote} accent="emerald" />
          <MetricCard label="Exceptions" value={run.exceptions} icon={AlertTriangle} accent={run.exceptions > 0 ? 'rose' : 'emerald'} />
        </div>
      ) : null}

      <DataTable
        title="Payroll Review"
        description="Everything important is visible in one table."
        rows={items as any[]}
        emptyMessage="Generate payroll to review employee rows."
        stickyHeader
        columns={[
          { key: 'employee', header: 'Employee', className: 'min-w-[13rem]', render: (row) => <div><p className="font-semibold text-slate-950">{row.employee?.name}</p><p className="text-xs text-slate-500">{row.employee?.email}</p></div> },
          { key: 'type', header: 'Type', render: (row) => salaryTypeLabel(row.salary_type) },
          { key: 'days', header: 'Days', render: (row) => `${row.present_days} present / ${row.paid_leave_days} paid leave / ${row.lop_days} LOP` },
          { key: 'hours', header: 'Hours', render: (row) => `${row.approved_worked_hours} worked / ${row.overtime_hours} OT` },
          { key: 'gross', header: 'Gross', render: (row) => money(row.gross_pay) },
          { key: 'deductions', header: 'Deductions', render: (row) => money(row.deductions) },
          { key: 'net', header: 'Net', render: (row) => <span className="font-semibold text-slate-950">{money(row.net_pay)}</span> },
          { key: 'status', header: 'Status', render: (row) => <div className="space-y-1"><StatusBadge status={row.status} />{row.warnings?.length ? <p className="max-w-[16rem] text-xs text-rose-600">{row.warnings.join(', ')}</p> : null}</div> },
        ]}
      />
    </div>
  );
}

function SalarySetup({ setFeedback }: { setFeedback: (value: { tone: 'success' | 'error'; message: string } | null) => void }) {
  const query = useQuery({
    queryKey: ['simple-payroll-salary-profiles'],
    queryFn: async () => (await payrollSimpleApi.salaryProfiles()).data.data,
  });
  const [editing, setEditing] = useState<any | null>(null);

  if (query.isLoading) return <PageLoadingState label="Loading salary setup..." />;
  if (query.isError) return <PageErrorState message="Unable to load salary setup." onRetry={() => void query.refetch()} />;

  return (
    <div className="space-y-5">
      {editing ? <SalaryForm row={editing} onClose={() => setEditing(null)} onSaved={async () => { setEditing(null); setFeedback({ tone: 'success', message: 'Salary profile saved.' }); await query.refetch(); }} /> : null}
      <DataTable
        title="Employee Salary Setup"
        description="Simple salary types and rates. Bank details are optional."
        rows={query.data as any[]}
        emptyMessage="No employees found."
        columns={[
          { key: 'employee', header: 'Employee', className: 'min-w-[13rem]', render: (row) => <div><p className="font-semibold text-slate-950">{row.user.name}</p><p className="text-xs text-slate-500">{row.user.email}</p></div> },
          { key: 'type', header: 'Salary Type', render: (row) => salaryTypeLabel(row.salary_type) },
          { key: 'rate', header: 'Rate', render: (row) => row.salary_type === 'hourly' ? money(row.hourly_rate) + '/hr' : money(row.monthly_salary) },
          { key: 'start', header: 'Start Date', render: (row) => row.payroll_start_date || 'Not set' },
          { key: 'status', header: 'Status', render: (row) => <StatusBadge status={row.status} /> },
          { key: 'action', header: 'Action', render: (row) => <Button size="sm" variant="secondary" onClick={() => setEditing(row)}>Edit</Button> },
        ]}
      />
    </div>
  );
}

function SalaryForm({ row, onClose, onSaved }: { row: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ ...row });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await payrollSimpleApi.saveSalaryProfile(row.user.id, form);
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <SurfaceCard className="p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div>
          <FieldLabel>Employee</FieldLabel>
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-semibold text-slate-800">{row.user.name}</div>
        </div>
        <div>
          <FieldLabel>Salary Type</FieldLabel>
          <SelectInput value={form.salary_type} onChange={(event) => setForm((current: any) => ({ ...current, salary_type: event.target.value }))}>
            <option value="fixed_monthly">Fixed Monthly</option>
            <option value="hourly">Hourly Pay</option>
            <option value="hybrid">Hybrid Salary</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Status</FieldLabel>
          <SelectInput value={form.status} onChange={(event) => setForm((current: any) => ({ ...current, status: event.target.value }))}>
            <option value="active">Active</option>
            <option value="on_hold">On Hold</option>
          </SelectInput>
        </div>
        <NumberField label="Monthly Salary" value={form.monthly_salary} disabled={form.salary_type === 'hourly'} onChange={(value) => setForm((current: any) => ({ ...current, monthly_salary: value }))} />
        <NumberField label="Hourly Rate" value={form.hourly_rate} disabled={form.salary_type === 'fixed_monthly'} onChange={(value) => setForm((current: any) => ({ ...current, hourly_rate: value }))} />
        <NumberField label="Working Days" value={form.working_days} onChange={(value) => setForm((current: any) => ({ ...current, working_days: value }))} />
        <div>
          <FieldLabel>Payroll Start Date</FieldLabel>
          <TextInput type="date" value={form.payroll_start_date || ''} onChange={(event) => setForm((current: any) => ({ ...current, payroll_start_date: event.target.value }))} />
        </div>
        <NumberField label="Overtime Rate" value={form.overtime_hourly_rate} onChange={(value) => setForm((current: any) => ({ ...current, overtime_hourly_rate: value }))} />
        <NumberField label="Productivity Bonus Rate" value={form.productivity_bonus_rate} onChange={(value) => setForm((current: any) => ({ ...current, productivity_bonus_rate: value }))} />
        <div>
          <FieldLabel>Bank Name</FieldLabel>
          <TextInput value={form.bank_name || ''} onChange={(event) => setForm((current: any) => ({ ...current, bank_name: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Account Number</FieldLabel>
          <TextInput value={form.bank_account_number || ''} onChange={(event) => setForm((current: any) => ({ ...current, bank_account_number: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>IFSC / SWIFT</FieldLabel>
          <TextInput value={form.bank_ifsc_swift || ''} onChange={(event) => setForm((current: any) => ({ ...current, bank_ifsc_swift: event.target.value }))} />
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(form.overtime_enabled)} onChange={(event) => setForm((current: any) => ({ ...current, overtime_enabled: event.target.checked }))} /> Overtime enabled</label>
        <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={Boolean(form.productivity_bonus_enabled)} onChange={(event) => setForm((current: any) => ({ ...current, productivity_bonus_enabled: event.target.checked }))} /> Productivity bonus enabled</label>
      </div>
      <div className="mt-4 flex gap-2">
        <Button disabled={saving} onClick={save}>Save Salary</Button>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </SurfaceCard>
  );
}

function Adjustments({ month, setFeedback }: { month: string; setFeedback: (value: { tone: 'success' | 'error'; message: string } | null) => void }) {
  const query = useQuery({
    queryKey: ['simple-payroll-adjustments', month],
    queryFn: async () => (await payrollSimpleApi.adjustments(month)).data,
  });
  const [form, setForm] = useState({ user_id: '', type: 'bonus', amount: 0, reason: '' });

  if (query.isLoading) return <PageLoadingState label="Loading adjustments..." />;

  const save = async () => {
    await payrollSimpleApi.createAdjustment({ ...form, user_id: Number(form.user_id), month });
    setForm({ user_id: '', type: 'bonus', amount: 0, reason: '' });
    setFeedback({ tone: 'success', message: 'Adjustment added. Regenerate payroll to include it.' });
    await query.refetch();
  };

  return (
    <div className="space-y-5">
      <SurfaceCard className="p-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_0.8fr_0.6fr_1.4fr_auto] md:items-end">
          <div><FieldLabel>Employee</FieldLabel><SelectInput value={form.user_id} onChange={(event) => setForm((current) => ({ ...current, user_id: event.target.value }))}><option value="">Select</option>{query.data.employees.map((employee: any) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</SelectInput></div>
          <div><FieldLabel>Type</FieldLabel><SelectInput value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}><option value="bonus">Bonus</option><option value="reimbursement">Reimbursement</option><option value="overtime">Overtime</option><option value="manual_deduction">Manual Deduction</option><option value="lop_correction">LOP Correction</option></SelectInput></div>
          <NumberField label="Amount" value={form.amount} onChange={(value) => setForm((current) => ({ ...current, amount: value }))} />
          <div><FieldLabel>Reason</FieldLabel><TextInput value={form.reason} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} /></div>
          <Button disabled={!form.user_id || !form.reason || Number(form.amount) <= 0} onClick={save}>Add</Button>
        </div>
      </SurfaceCard>
      <DataTable
        title="Adjustments"
        rows={query.data.data}
        emptyMessage="No adjustments for this month."
        columns={[
          { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Employee' },
          { key: 'month', header: 'Month', render: (row: any) => row.effective_month },
          { key: 'type', header: 'Type', render: (row: any) => String(row.meta?.simple_type || row.kind).replace(/_/g, ' ') },
          { key: 'amount', header: 'Amount', render: (row: any) => money(row.amount, row.currency || 'INR') },
          { key: 'reason', header: 'Reason', render: (row: any) => row.description },
          { key: 'status', header: 'Status', render: (row: any) => <StatusBadge status={row.status} /> },
        ]}
      />
    </div>
  );
}

function Payslips({ month, canManage }: { month: string; canManage: boolean }) {
  const query = useQuery({
    queryKey: ['simple-payroll-payslips', month, canManage],
    queryFn: async () => (await payrollSimpleApi.payslips(canManage ? month : undefined)).data.data,
  });
  const downloadPayslip = async (id: number, periodMonth: string) => {
    const response = await payrollSimpleApi.downloadPayslipPdf(id);
    const url = window.URL.createObjectURL(response.data);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payslip-${periodMonth}.pdf`;
    link.click();
    window.URL.revokeObjectURL(url);
  };
  if (query.isLoading) return <PageLoadingState label="Loading payslips..." />;

  return (
    <DataTable
      title={canManage ? 'Payslips' : 'My Payslips'}
      rows={query.data}
      emptyMessage="No payslips yet."
      columns={[
        ...(canManage ? [{ key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Employee' }] : []),
        { key: 'month', header: 'Month', render: (row: any) => monthName(row.period_month) },
        { key: 'gross', header: 'Gross', render: (row: any) => money(Number(row.basic_salary || 0) + Number(row.total_allowances || 0), row.currency) },
        { key: 'deductions', header: 'Deductions', render: (row: any) => money(row.total_deductions, row.currency) },
        { key: 'net', header: 'Net Pay', render: (row: any) => <span className="font-semibold text-slate-950">{money(row.net_salary, row.currency)}</span> },
        { key: 'status', header: 'Status', render: (row: any) => <StatusBadge status={row.payment_status || 'pending'} /> },
        { key: 'download', header: 'Download', render: (row: any) => <button type="button" className="text-sm font-semibold text-blue-600" onClick={() => downloadPayslip(row.id, row.period_month)}>PDF</button> },
      ]}
    />
  );
}

function PayrollReport({ month }: { month: string }) {
  const query = useQuery({
    queryKey: ['simple-payroll-report', month],
    queryFn: async () => {
      const [overviewResponse, runsResponse, payslipsResponse, adjustmentsResponse] = await Promise.all([
        payrollSimpleApi.overview(month),
        payrollSimpleApi.runs(month),
        payrollSimpleApi.payslips(month),
        payrollSimpleApi.adjustments(month),
      ]);

      return {
        overview: overviewResponse.data,
        runs: runsResponse.data?.data || [],
        payslips: payslipsResponse.data?.data || [],
        adjustments: adjustmentsResponse.data?.data || [],
      };
    },
  });

  if (query.isLoading) return <PageLoadingState label="Loading payroll report..." />;
  if (query.isError) return <PageErrorState message="Unable to load payroll report." onRetry={() => void query.refetch()} />;

  const data = query.data;
  const summary = data.overview?.summary || {};
  const currentRun = data.overview?.current_run || data.runs?.[0] || null;
  const payslips = Array.isArray(data.payslips) ? data.payslips : [];
  const adjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
  const paidPayslips = payslips.filter((row: any) => ['paid', 'published'].includes(String(row.payment_status || row.status || '').toLowerCase())).length;
  const pendingPayslips = Math.max(0, payslips.length - paidPayslips);
  const adjustmentTotal = adjustments.reduce((sum: number, row: any) => sum + Number(row.amount || 0), 0);

  return (
    <div className="space-y-5">
      <SurfaceCard className="p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Payroll Report - {monthName(month)}</h2>
            <p className="mt-1 text-sm text-slate-500">Month-specific payroll totals, run status, payslips, and manual adjustments.</p>
          </div>
          <StatusBadge status={currentRun?.status || 'not_run'} />
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
        <MetricCard label="Employees" value={summary.employees || currentRun?.employees || payslips.length || 0} hint="Included in payroll." icon={Users} accent="slate" />
        <MetricCard label="Gross Pay" value={money(summary.gross_pay || currentRun?.gross_pay || 0)} icon={Wallet} accent="emerald" />
        <MetricCard label="Deductions" value={money(summary.deductions || currentRun?.deductions || 0)} icon={AlertTriangle} accent="amber" />
        <MetricCard label="Net Pay" value={money(summary.net_pay || currentRun?.net_pay || 0)} icon={Banknote} accent="violet" />
        <MetricCard label="Payslips" value={payslips.length} hint={`${paidPayslips} paid / ${pendingPayslips} pending`} icon={Receipt} accent="sky" />
        <MetricCard label="Adjustments" value={money(adjustmentTotal)} hint={`${adjustments.length} entries`} icon={SlidersHorizontal} accent="rose" />
      </div>

      <DataTable
        title="Payroll Report: Payslips"
        description="Payroll-only payslip summary for the selected month."
        rows={payslips}
        emptyMessage="No payslips generated for this payroll month."
        columns={[
          { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Employee' },
          { key: 'month', header: 'Payroll Month', render: (row: any) => monthName(row.period_month || month) },
          { key: 'gross', header: 'Gross Pay', render: (row: any) => money(Number(row.basic_salary || 0) + Number(row.total_allowances || 0), row.currency) },
          { key: 'deductions', header: 'Deductions', render: (row: any) => money(row.total_deductions, row.currency) },
          { key: 'net', header: 'Net Pay', render: (row: any) => <span className="font-semibold text-slate-950">{money(row.net_salary, row.currency)}</span> },
          { key: 'status', header: 'Payment Status', render: (row: any) => <StatusBadge status={row.payment_status || row.status || 'pending'} /> },
        ]}
      />

      <DataTable
        title="Payroll Report: Adjustments"
        description="Bonuses, reimbursements, deductions, overtime, and LOP corrections included around this payroll month."
        rows={adjustments}
        emptyMessage="No adjustments for this payroll month."
        columns={[
          { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Employee' },
          { key: 'type', header: 'Adjustment Type', render: (row: any) => String(row.meta?.simple_type || row.kind || 'adjustment').replace(/_/g, ' ') },
          { key: 'amount', header: 'Amount', render: (row: any) => money(row.amount, row.currency || 'INR') },
          { key: 'reason', header: 'Reason', render: (row: any) => row.description || '-' },
          { key: 'status', header: 'Status', render: (row: any) => <StatusBadge status={row.status || 'pending'} /> },
        ]}
      />
    </div>
  );
}

function BasicSettings({ setFeedback }: { setFeedback: (value: { tone: 'success' | 'error'; message: string } | null) => void }) {
  const query = useQuery({
    queryKey: ['simple-payroll-settings'],
    queryFn: async () => (await payrollSimpleApi.settings()).data,
  });
  const [form, setForm] = useState<any | null>(null);
  useEffect(() => {
    if (query.data && !form) {
      setForm({
        working_days: query.data.payroll_calendar?.working_days || 30,
        payroll_cycle_day: query.data.payroll_calendar?.payment_day || 1,
        currency: query.data.default_payout_method?.currency || 'INR',
        enable_overtime: query.data.overtime_rules?.enabled !== false,
        enable_productivity_bonus: Boolean(query.data.adjustment_rules?.productivity_bonus_enabled),
        company_name: query.data.payslip_branding?.company_name || 'CareVance',
      });
    }
  }, [form, query.data]);
  if (query.isLoading || !form) return <PageLoadingState label="Loading settings..." />;

  const save = async () => {
    await payrollSimpleApi.saveSettings(form);
    setFeedback({ tone: 'success', message: 'Payroll settings saved.' });
    await query.refetch();
  };

  return (
    <SurfaceCard className="p-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <NumberField label="Default Working Days" value={form.working_days} onChange={(value) => setForm((current: any) => ({ ...current, working_days: value }))} />
        <NumberField label="Payroll Cycle Day" value={form.payroll_cycle_day} onChange={(value) => setForm((current: any) => ({ ...current, payroll_cycle_day: value }))} />
        <div><FieldLabel>Currency</FieldLabel><TextInput value={form.currency} onChange={(event) => setForm((current: any) => ({ ...current, currency: event.target.value.toUpperCase() }))} /></div>
        <div><FieldLabel>Company Name</FieldLabel><TextInput value={form.company_name} onChange={(event) => setForm((current: any) => ({ ...current, company_name: event.target.value }))} /></div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={form.enable_overtime} onChange={(event) => setForm((current: any) => ({ ...current, enable_overtime: event.target.checked }))} /> Enable overtime</label>
        <label className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><input type="checkbox" checked={form.enable_productivity_bonus} onChange={(event) => setForm((current: any) => ({ ...current, enable_productivity_bonus: event.target.checked }))} /> Enable productivity bonus</label>
      </div>
      <div className="mt-4">
        <Button onClick={save}>Save Settings</Button>
      </div>
    </SurfaceCard>
  );
}

function NumberField({ label, value, onChange, disabled = false }: { label: string; value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div>
      <FieldLabel>{label}</FieldLabel>
      <TextInput type="number" disabled={disabled} value={Number(value || 0)} onChange={(event) => onChange(Number(event.target.value || 0))} />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = ['paid', 'approved', 'ready', 'active', 'published'].includes(status)
    ? 'bg-emerald-50 text-emerald-700'
    : ['exception', 'draft', 'on_hold', 'pending'].includes(status)
      ? 'bg-amber-50 text-amber-700'
      : 'bg-slate-100 text-slate-700';
  return <span className={cn('inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize', tone)}>{status.replace(/_/g, ' ')}</span>;
}

function salaryTypeLabel(value: string) {
  return value === 'hourly' ? 'Hourly Pay' : value === 'hybrid' ? 'Hybrid Salary' : 'Fixed Monthly';
}
