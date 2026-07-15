import { useMemo } from 'react';
import {
  Users,
  Play,
  AlertCircle,
  CheckCircle2,
  Wallet,
  Clock,
  CalendarClock,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import PayrollRunCard from '@/components/ui/PayrollRunCard';
import MonthTimeline from './MonthTimeline';
import CompensationAnalytics from './CompensationAnalytics';
import PayrollToDoRail from './PayrollToDoRail';
import ComplianceStatusBoard from './ComplianceStatusBoard';
import PayrollModuleLauncher from './PayrollModuleLauncher';
import PayGroupCard from './PayGroupCard';

import type { PayGroup, PayrollMonthlyRun, PayrollDepartment } from '@/types';

interface PayrollDashboardProps {
  selectedMonth?: string;
  onMonthChange?: (month: string) => void;
  onSelectEmployee: (employeeId: number) => void;
  onOpenProcessAndPay: (monthYear: string, pendingCount: number, expectedNetPay: number) => void;
  onOpenFilings?: () => void;
  onOpenWizard?: () => void;
  onOpenRunDetail?: (runId: number) => void;
  onOpenCreatePayGroup?: () => void;
  onOpenEmployeeCards?: () => void;
  onSelectPayGroup?: (payGroupId: number) => void;
  onOpenDepartmentTemplates?: () => void;
  onOpenUnassignedEmployees?: () => void;
  onOpenReports?: (stats: { totalEmployees: number; processedCount: number; paidCount: number; totalNetPay: number; pendingCount: number }) => void;
  onOpenSalaryComponents?: () => void;
}

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function PayrollDashboard({
  selectedMonth: selectedMonthProp,
  onMonthChange,
  onOpenProcessAndPay,
  onOpenEmployeeCards,
  onOpenFilings,
  onOpenRunDetail,
  onOpenCreatePayGroup,
  onSelectPayGroup,
  onOpenDepartmentTemplates,
  onOpenUnassignedEmployees,
  onOpenSalaryComponents,
}: PayrollDashboardProps) {
  const fallbackMonth = useMemo(() => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  }, []);
  const selectedMonth = selectedMonthProp ?? fallbackMonth;
  const setSelectedMonth = (m: string) => onMonthChange?.(m);

  // Fetch data (runs for timeline, pay groups for stats & grid)
  const { data: runsData } = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => payrollApi.getPayrollRuns().then((r) => r.data),
  });

  const { data: payGroupsData, isLoading: isPayGroupsLoading } = useQuery({
    queryKey: ['payroll', 'pay-groups', selectedMonth],
    queryFn: () =>
      payrollApi.listPayGroups({ month_year: selectedMonth }).then((r) => r.data),
  });
  const payGroups: PayGroup[] = useMemo(
    () => (payGroupsData?.pay_groups ?? []) as PayGroup[],
    [payGroupsData],
  );
  const runs = (Array.isArray(runsData) ? runsData : (runsData?.runs ?? [])) as Array<{
    month_year: string;
    status: string;
    id: number;
    employee_count?: number;
    total_employees?: number;
    total_gross?: number;
    total_deductions?: number;
    total_net_pay?: number;
    created_at?: string;
    disbursed_at?: string;
  }>;

  // The run backing the currently selected month (for the snapshot card).
  const monthRun = useMemo(
    () => runs.find((r) => r.month_year === selectedMonth) ?? null,
    [runs, selectedMonth],
  );

  // Fetch departments for CompensationAnalytics
  const { data: deptsData } = useQuery({
    queryKey: ['payroll', 'departments', selectedMonth],
    queryFn: () =>
      payrollApi.getDepartments({ month_year: selectedMonth }).then((r) => r.data),
  });
  const departments: PayrollDepartment[] = useMemo(
    () => (deptsData?.departments ?? []) as PayrollDepartment[],
    [deptsData],
  );

  const summaryStats = useMemo(() => {
    const totalEmployees = payGroups.reduce((sum, pg) => sum + pg.employee_count, 0);
    const processedCount = payGroups.reduce((sum, pg) => sum + pg.processed_count, 0);
    const paidCount = payGroups.reduce((sum, pg) => sum + pg.paid_count, 0);
    const totalNetPay = payGroups.reduce((sum, pg) => sum + pg.total_net_pay, 0);
    const pendingCount = Math.max(0, totalEmployees - processedCount);

    return { totalEmployees, processedCount, paidCount, totalNetPay, pendingCount };
  }, [payGroups]);

  // Previous month for Month-over-Month (MoM) comparison.
  const prevMonth = useMemo(() => {
    const [y, m] = selectedMonth.split('-').map(Number);
    const prev = new Date(y, m - 2, 1);
    return prev.getFullYear() + '-' + String(prev.getMonth() + 1).padStart(2, '0');
  }, [selectedMonth]);

  const { data: prevPayGroupsData } = useQuery({
    queryKey: ['payroll', 'pay-groups', prevMonth],
    queryFn: () =>
      payrollApi.listPayGroups({ month_year: prevMonth }).then((r) => r.data),
    enabled: !!prevMonth,
  });

  const prevRuns = useMemo(() => {
    const prev = runs.find((r) => r.month_year === prevMonth) ?? null;
    return prev;
  }, [runs, prevMonth]);

  const prevStats = useMemo(() => {
    const prevPgs: PayGroup[] = (prevPayGroupsData?.pay_groups ?? []) as PayGroup[];
    return {
      totalEmployees: prevPgs.reduce((s, pg) => s + pg.employee_count, 0),
      processedCount: prevPgs.reduce((s, pg) => s + pg.processed_count, 0),
      paidCount: prevPgs.reduce((s, pg) => s + pg.paid_count, 0),
      totalNetPay: prevPgs.reduce((s, pg) => s + pg.total_net_pay, 0),
    };
  }, [prevPayGroupsData]);

  const momDelta = (curr: number, prev: number | undefined | null): number | null => {
    if (prev === undefined || prev === null || !Number.isFinite(prev) || prev === 0) return null;
    if (!Number.isFinite(curr)) return null;
    return ((curr - prev) / Math.abs(prev)) * 100;
  };

  const netPayDelta = momDelta(summaryStats.totalNetPay, prevStats.totalNetPay ?? (prevRuns ? prevRuns.total_net_pay : null));
  const employeesDelta = momDelta(summaryStats.totalEmployees, prevStats.totalEmployees || (prevRuns ? prevRuns.total_employees : null) || null);
  const pendingDelta = momDelta(summaryStats.pendingCount, prevStats.totalEmployees - prevStats.processedCount);
  const paidDelta = momDelta(summaryStats.paidCount, prevStats.paidCount);

  // "Needs attention" live counts (always-on, even with nothing pending).
  const { data: attentionData } = useQuery({
    queryKey: ['payroll', 'dashboard-attention'],
    queryFn: () => payrollApi.getDashboardAttention().then((r) => r.data?.attention ?? null),
  });

  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings'],
    queryFn: () => payrollApi.getPayrollSettings().then((r) => r.data),
  });
  const payrollSettings = (settingsData?.settings ?? {}) as Record<string, any>;

  const paidPct = summaryStats.totalEmployees > 0
    ? Math.round((summaryStats.paidCount / summaryStats.totalEmployees) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Month timeline (Apr-Mar FY) */}
      <MonthTimeline
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        runs={runs}
      />

      {/* To-Do rail — pending processing, filings, missing data (Zoho-style) */}
      <PayrollToDoRail
        monthYear={selectedMonth}
        onOpenProcessAndPay={() => onOpenProcessAndPay(selectedMonth, summaryStats.pendingCount, summaryStats.totalNetPay)}
        onOpenFilings={onOpenFilings}
      />

      {/* Compliance due-date rail — upcoming statutory filing deadlines */}
      <ComplianceDueDateRail settings={payrollSettings} selectedMonth={selectedMonth} />

      {/* Current Pay Run snapshot + primary action */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {monthRun ? (
          <PayrollRunCard
            run={{
              id: monthRun.id,
              month_year: monthRun.month_year,
              status: monthRun.status,
              employee_count: monthRun.employee_count ?? monthRun.total_employees ?? 0,
              total_gross: monthRun.total_gross,
              total_deductions: monthRun.total_deductions,
              total_net_pay: monthRun.total_net_pay,
              created_at: monthRun.created_at,
              disbursed_at: monthRun.disbursed_at,
            }}
            onClick={() => onOpenRunDetail?.(monthRun.id)}
            onViewDetails={onOpenRunDetail}
          />
        ) : (
          <SurfaceCard className="flex flex-col justify-center p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(93,150,157,0.1)] text-[#5D969D]">
                <CalendarClock className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-semibold text-slate-900">No run for {selectedMonth}</h3>
                <p className="text-sm text-slate-500">Process &amp; Pay to create this month's run.</p>
              </div>
            </div>
          </SurfaceCard>
        )}

        {/* Process & Pay CTA */}
        <SurfaceCard className="flex flex-col justify-between gap-3 p-5">
          <div>
            <h3 className="font-semibold text-slate-900">Process &amp; Pay</h3>
            <p className="mt-1 text-sm text-slate-500">
              {summaryStats.pendingCount > 0
                ? `${summaryStats.pendingCount} employee${summaryStats.pendingCount === 1 ? '' : 's'} pending · ${formatCurrency(summaryStats.totalNetPay)} expected net pay`
                : 'All employees processed for this month.'}
            </p>
          </div>
          <div>
            <Button
              variant="primary"
              iconLeft={<Play className="h-4 w-4" />}
              onClick={() => onOpenProcessAndPay(selectedMonth, summaryStats.pendingCount, summaryStats.totalNetPay)}
              disabled={summaryStats.pendingCount === 0}
              className="shadow-sm whitespace-nowrap"
            >
              Process &amp; Pay ({summaryStats.pendingCount})
            </Button>
          </div>
        </SurfaceCard>
      </div>

      {/* Needs Attention — always-on, surfaces real blockers */}
      <NeedsAttentionRail
        attention={attentionData}
        onOpenUnassignedEmployees={onOpenUnassignedEmployees}
        onOpenEmployeeCards={onOpenEmployeeCards}
        onOpenFbp={() => onOpenFilings?.()}
      />

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Net Pay"
          value={formatCurrency(summaryStats.totalNetPay)}
          hint={`${summaryStats.processedCount} employees processed`}
          icon={Wallet}
          accent="emerald"
          delta={netPayDelta}
        />
        <MetricCard
          label="Total Employees"
          value={summaryStats.totalEmployees}
          hint={`${summaryStats.processedCount} processed`}
          icon={Users}
          accent="violet"
          delta={employeesDelta}
        />
        <MetricCard
          label="Pending Processing"
          value={summaryStats.pendingCount}
          hint={`${summaryStats.totalEmployees - summaryStats.paidCount} awaiting payment`}
          icon={Clock}
          accent={summaryStats.pendingCount > 0 ? 'amber' : 'emerald'}
          delta={pendingDelta}
          invertDelta
        />
        <MetricCard
          label="Paid This Month"
          value={summaryStats.paidCount}
          hint={`${paidPct}% completion`}
          icon={CheckCircle2}
          accent="emerald"
          delta={paidDelta}
        />
      </div>

      {/* Live statutory compliance readiness board */}
      <ComplianceStatusBoard monthYear={selectedMonth} onOpenFilings={onOpenFilings} />

      {/* Module launcher (search + category filter) — single source of truth */}
      <PayrollModuleLauncher
        onOpenCreatePayGroup={onOpenCreatePayGroup}
        onOpenSalaryComponents={onOpenSalaryComponents}
        onOpenEmployeeCards={onOpenEmployeeCards}
        onOpenFilings={onOpenFilings}
        onOpenDepartmentTemplates={onOpenDepartmentTemplates}
        onOpenUnassignedEmployees={onOpenUnassignedEmployees}
      />

      {/* Compensation Analytics Charts */}
      <CompensationAnalytics
        departments={departments}
        runs={runs as Partial<PayrollMonthlyRun>[]}
        summaryStats={summaryStats}
      />

      {/* Pay Groups Section */}
      {(isPayGroupsLoading || payGroups.length > 0) && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:items-end sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Pay Groups</h2>
              <p className="text-sm text-slate-500">
                {payGroups.length === 0
                  ? 'No pay groups yet — create one from All Payroll Modules'
                  : `${payGroups.length} pay group${payGroups.length === 1 ? '' : 's'} for ${selectedMonth}`}
              </p>
            </div>
          </div>

          {/* Pay Groups Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {isPayGroupsLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <SurfaceCard key={i} className="p-5 animate-pulse">
                  <div className="h-12 w-12 bg-slate-200 rounded-xl mb-4" />
                  <div className="h-5 bg-slate-200 rounded w-1/2 mb-2" />
                  <div className="h-4 bg-slate-200 rounded w-1/3" />
                </SurfaceCard>
              ))
            ) : (
              payGroups.map((pg) => (
                <PayGroupCard
                  key={pg.id}
                  payGroup={pg}
                  onClick={() => onSelectPayGroup?.(pg.id)}
                />
              ))
            )}
          </div>
        </div>
      )}

      {/* Recent Runs */}
      <RecentRuns runs={runs} onOpenRunDetail={onOpenRunDetail} />

      {/* Help Text */}
      <SurfaceCard className="p-4 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-blue-900">How to process payroll</h4>
            <ol className="text-sm text-blue-700 mt-1 space-y-1 list-decimal list-inside">
              <li>Create a pay group and assign employees</li>
              <li>Select employees to process or process all at once</li>
              <li>Review the run — Lock → Approve → Release → Disburse</li>
              <li>When a second approver is required, a <span className="font-medium">different admin</span> must approve and release before disbursement</li>
              <li>Generate bank file and upload to your banking portal</li>
            </ol>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}

function RecentRuns({
  runs,
  onOpenRunDetail,
}: {
  runs: Array<{ id: number; month_year?: string; run_month?: string; status?: string; total_employees?: number; employee_count?: number; total_net_pay?: number; payslips_notified_status?: string | null; locked_by_name?: string | null; approved_by_name?: string | null; released_by_name?: string | null }>;
  onOpenRunDetail?: (runId: number) => void;
}) {
  if (!runs || runs.length === 0) return null;

  const recent = runs;
  const statusTone: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    locked: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    released: 'bg-violet-100 text-violet-700',
    disbursed: 'bg-emerald-100 text-emerald-700',
    paid: 'bg-emerald-100 text-emerald-700',
  };

  const formatRunMonth = (raw: string | null | undefined): { short: string; long: string } => {
    if (!raw) return { short: 'Unknown', long: 'Unknown month' };
    const [y, m] = raw.split('-').map(Number);
    if (!y || !m || m < 1 || m > 12) return { short: raw, long: raw };
    const date = new Date(y, m - 1, 1);
    return {
      short: date.toLocaleString('en-US', { month: 'short', year: 'numeric' }),
      long: date.toLocaleString('en-US', { month: 'long', year: 'numeric' }),
    };
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Payroll Run History</h2>
        <p className="text-xs text-slate-500">Click a run to view its lifecycle, lock/approve, or download bank file</p>
      </div>
      <SurfaceCard className="p-0 overflow-hidden">
        <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto">
          {recent.map((r) => {
            const monthLabel = formatRunMonth(r.month_year ?? r.run_month);
            return (
              <button
                key={r.id}
                onClick={() => onOpenRunDetail?.(r.id)}
                className="w-full flex items-center justify-between p-3 hover:bg-blue-50 transition-colors text-left"
              >
                 <div className="min-w-0 flex-1">
                  <p className="font-medium text-slate-900">{monthLabel.long}</p>
                  <p className="text-xs text-slate-500">
                    <span className="font-mono">{r.month_year ?? r.run_month ?? '—'}</span>
                    {' · '}Run #{r.id}{' · '}{r.total_employees ?? r.employee_count ?? 0} employees
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {[
                      r.locked_by_name && `Locked: ${r.locked_by_name}`,
                      r.approved_by_name && `Approved: ${r.approved_by_name}`,
                      r.released_by_name && `Released: ${r.released_by_name}`,
                    ].filter(Boolean).join(' · ') || 'No approvers yet'}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">
                    ₹{Number(r.total_net_pay ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                  <div className="flex items-center justify-end gap-1 mt-1">
                    {r.status === 'disbursed' && (
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${
                        r.payslips_notified_status === 'sent'
                          ? 'bg-emerald-100 text-emerald-700'
                          : r.payslips_notified_status === 'failed'
                            ? 'bg-rose-100 text-rose-700'
                            : 'bg-slate-100 text-slate-500'
                      }`}>
                        {r.payslips_notified_status === 'sent'
                          ? 'Notified'
                          : r.payslips_notified_status === 'failed'
                            ? 'Notify failed'
                            : 'Not sent'}
                      </span>
                    )}
                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${statusTone[r.status ?? ''] ?? 'bg-slate-100 text-slate-700'}`}>
                      {r.status ?? 'draft'}
                    </span>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </SurfaceCard>
    </div>
  );
}

interface AttentionItem {
  key: string;
  label: string;
  count: number;
  onResolve?: () => void;
}

function NeedsAttentionRail({
  attention,
  onOpenUnassignedEmployees,
  onOpenEmployeeCards,
  onOpenFbp,
}: {
  attention: {
    missing_bank_details?: number;
    missing_pan_uan?: number;
    unassigned_employees?: number;
    pending_fbp_declarations?: number;
  } | null;
  onOpenUnassignedEmployees?: () => void;
  onOpenEmployeeCards?: () => void;
  onOpenFbp?: () => void;
}) {
  const items: AttentionItem[] = [
    { key: 'unassigned', label: 'Unassigned employees', count: attention?.unassigned_employees ?? 0, onResolve: onOpenUnassignedEmployees },
    { key: 'bank', label: 'Missing bank details', count: attention?.missing_bank_details ?? 0, onResolve: onOpenEmployeeCards },
    { key: 'pan', label: 'Missing PAN / UAN', count: attention?.missing_pan_uan ?? 0, onResolve: onOpenEmployeeCards },
    { key: 'fbp', label: 'Pending FBP declarations', count: attention?.pending_fbp_declarations ?? 0, onResolve: onOpenFbp },
  ];

  const total = items.reduce((s, i) => s + i.count, 0);

  return (
    <SurfaceCard className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="h-4 w-4 text-amber-600" />
          <h3 className="text-sm font-semibold text-slate-900">Needs attention</h3>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${total > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'}`}>
          {total > 0 ? `${total} item${total === 1 ? '' : 's'}` : 'All clear'}
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {items.map((it) => {
          const tone = it.count > 0
            ? 'border-amber-200 bg-amber-50 hover:bg-amber-100'
            : 'border-slate-200 bg-white';
          return (
            <button
              key={it.key}
              type="button"
              onClick={it.onResolve}
              disabled={!it.onResolve}
              className={`text-left rounded-lg border p-3 flex items-center justify-between gap-2 transition-colors ${tone} ${it.onResolve ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <span className="text-sm text-slate-700">{it.label}</span>
              <span className={`inline-flex items-center justify-center min-w-6 h-6 px-1.5 rounded-full text-xs font-bold ${it.count > 0 ? 'bg-amber-500 text-white' : 'bg-emerald-500 text-white'}`}>
                {it.count}
              </span>
            </button>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

const COMPLIANCE_DEFAULTS = {
  pf: true,
  esi: true,
  pt: true,
  tds: true,
  lwf: false,
};

function lastWorkingDay(year: number, month: number): Date {
  // month is 1-indexed
  const d = new Date(year, month, 0); // last day of month
  const day = d.getDay();
  if (day === 0) d.setDate(d.getDate() - 2); // Sunday -> Friday
  else if (day === 6) d.setDate(d.getDate() - 1); // Saturday -> Friday
  return d;
}

function addMonths(year: number, month: number, delta: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

interface DueDate {
  key: string;
  label: string;
  due: Date;
  frequency: 'monthly' | 'annual';
}

function computeDueDates(
  compliance: Record<string, any>,
  defaultState: string | undefined,
  overrides: Record<string, any> | undefined,
  selectedMonth: string,
): DueDate[] {
  const enabled: Record<string, boolean> = { ...COMPLIANCE_DEFAULTS, ...(compliance ?? {}) };
  const [y, m] = (selectedMonth ?? '').split('-').map(Number);
  if (!y || !m) return [];

  // Payroll month M → filings are due in the following month.
  const next = addMonths(y, m, 1);

  const out: DueDate[] = [];

  if (enabled.pf ?? COMPLIANCE_DEFAULTS.pf) {
    out.push({ key: 'pf', label: 'PF', due: new Date(next.year, next.month - 1, 15), frequency: 'monthly' });
    out.push({ key: 'esi', label: 'ESI', due: new Date(next.year, next.month - 1, 15), frequency: 'monthly' });
  }
  if (enabled.tds ?? COMPLIANCE_DEFAULTS.tds) {
    out.push({ key: 'tds', label: 'TDS', due: new Date(next.year, next.month - 1, 7), frequency: 'monthly' });
  }
  if (enabled.pt ?? COMPLIANCE_DEFAULTS.pt) {
    // PT is state-specific; default to the last working day of the following month.
    out.push({ key: 'pt', label: `PT (${defaultState ?? 'state'})`, due: lastWorkingDay(next.year, next.month), frequency: 'monthly' });
  }
  if (enabled.lwf ?? COMPLIANCE_DEFAULTS.lwf) {
    // LWF is annual — due by the last working day of the financial year (Mar 31).
    out.push({ key: 'lwf', label: 'LWF', due: lastWorkingDay(y, 3), frequency: 'annual' });
  }

  // Apply org overrides when provided.
  if (overrides) {
    for (const d of out) {
      const ov = overrides[d.key];
      if (ov && typeof ov === 'string' && !Number.isNaN(Date.parse(ov))) {
        d.due = new Date(ov);
      }
    }
  }

  return out.sort((a, b) => a.due.getTime() - b.due.getTime());
}

function ComplianceDueDateRail({
  settings,
  selectedMonth,
}: {
  settings: Record<string, any>;
  selectedMonth: string;
}) {
  const compliance = (settings?.compliance ?? {}) as Record<string, any>;
  const defaultState = settings?.defaultState as string | undefined;
  const overrides = settings?.compliance_due_dates as Record<string, any> | undefined;

  const dueDates = computeDueDates(compliance, defaultState, overrides, selectedMonth);
  if (dueDates.length === 0) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (
    <SurfaceCard className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <CalendarClock className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-900">Upcoming compliance due dates</h3>
        <span className="text-xs text-slate-400">· filing deadlines for {selectedMonth}</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {dueDates.map((d) => {
          const days = Math.ceil((d.due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          const overdue = days < 0;
          const tone = overdue
            ? 'bg-rose-100 text-rose-700 border-rose-200'
            : days <= 3
              ? 'bg-rose-50 text-rose-700 border-rose-200'
              : days <= 7
                ? 'bg-amber-100 text-amber-700 border-amber-200'
                : 'bg-slate-100 text-slate-700 border-slate-200';
          const label = overdue
            ? `${Math.abs(days)}d overdue`
            : days === 0
              ? 'Due today'
              : `${days}d left`;
          return (
            <div key={d.key} className={`flex flex-col gap-0.5 rounded-lg border px-3 py-2 ${tone}`}>
              <span className="text-sm font-semibold">{d.label}</span>
              <span className="text-xs">
                {d.due.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} · {label}
              </span>
            </div>
          );
        })}
      </div>
    </SurfaceCard>
  );
}

