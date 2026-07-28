import { useMemo } from 'react';
import {
  Users,
  Play,
  CheckCircle2,
  Wallet,
  Clock,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import MonthTimeline from './MonthTimeline';
import CompensationAnalytics from './CompensationAnalytics';
import ComplianceStatusBoard from './ComplianceStatusBoard';

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
  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings'],
    queryFn: () => payrollApi.getPayrollSettings().then((r) => r.data),
  });
  const payrollSettings = (settingsData?.settings ?? {}) as Record<string, any>;

  const paidPct = summaryStats.totalEmployees > 0
    ? Math.round((summaryStats.paidCount / summaryStats.totalEmployees) * 100)
    : 0;

  const statusTone: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    locked: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    released: 'bg-violet-100 text-violet-700',
    disbursed: 'bg-emerald-100 text-emerald-700',
    paid: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="space-y-6">
      {/* Month timeline (Apr-Mar FY) */}
      <MonthTimeline
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        runs={runs}
      />

      {/* Quick Stats — 4 metric cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard
          label="Total Payroll"
          value={formatCurrency(summaryStats.totalNetPay)}
          hint={`${summaryStats.processedCount} employees processed`}
          icon={Wallet}
          accent="emerald"
          delta={netPayDelta}
        />
        <MetricCard
          label="Total Employees"
          value={`${summaryStats.processedCount} / ${summaryStats.totalEmployees}`}
          hint={`${summaryStats.pendingCount} pending`}
          icon={Users}
          accent="violet"
          delta={employeesDelta}
        />
        <MetricCard
          label="Active Pay Groups"
          value={payGroups.length}
          hint={`for ${selectedMonth}`}
          icon={Users}
          accent="sky"
        />
        <MetricCard
          label="Run Status"
          value={monthRun?.status ? monthRun.status.charAt(0).toUpperCase() + monthRun.status.slice(1) : 'No Run'}
          hint={monthRun ? `${summaryStats.totalEmployees} employees` : 'Process & Pay to create'}
          icon={monthRun?.status === 'disbursed' ? CheckCircle2 : Clock}
          accent={monthRun?.status === 'disbursed' ? 'emerald' : monthRun?.status === 'locked' ? 'amber' : 'violet'}
        />
      </div>

      {/* Compensation Analytics Charts */}
      <CompensationAnalytics
        departments={departments}
        runs={runs as Partial<PayrollMonthlyRun>[]}
        summaryStats={summaryStats}
      />

      {/* Live statutory compliance readiness board */}
      <ComplianceStatusBoard monthYear={selectedMonth} onOpenFilings={onOpenFilings} />

      {/* Pay Groups + Recent Runs side by side */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Pay Groups — Table format matching wireframe */}
        <div className="lg:col-span-2">
          <SurfaceCard className="p-0 overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Pay Groups</h2>
                <p className="text-xs text-slate-500">{selectedMonth}</p>
              </div>
              <Button variant="secondary" size="sm" onClick={onOpenCreatePayGroup}>
                + Add Group
              </Button>
            </div>
            {isPayGroupsLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />
                ))}
              </div>
            ) : payGroups.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-500">
                No pay groups yet. Click "+ Add Group" to create one.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-5 py-2.5 font-medium text-slate-600">Group</th>
                    <th className="text-center px-3 py-2.5 font-medium text-slate-600">Employees</th>
                    <th className="text-center px-3 py-2.5 font-medium text-slate-600">Frequency</th>
                    <th className="text-center px-3 py-2.5 font-medium text-slate-600">Status</th>
                    <th className="text-right px-5 py-2.5 font-medium text-slate-600"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {payGroups.map((pg) => {
                    const statusTone: Record<string, string> = {
                      draft: 'bg-slate-100 text-slate-700',
                      locked: 'bg-amber-100 text-amber-700',
                      approved: 'bg-blue-100 text-blue-700',
                      released: 'bg-violet-100 text-violet-700',
                      disbursed: 'bg-emerald-100 text-emerald-700',
                    };
                    const pgStatus = pg.processed_count === pg.employee_count && pg.employee_count > 0
                      ? 'Disbursed'
                      : pg.processed_count > 0
                        ? 'Locked'
                        : 'Draft';
                    return (
                      <tr
                        key={pg.id}
                        className="hover:bg-slate-50 cursor-pointer transition-colors"
                        onClick={() => onSelectPayGroup?.(pg.id)}
                      >
                        <td className="px-5 py-3 font-medium text-slate-900">{pg.name}</td>
                        <td className="px-3 py-3 text-center text-slate-700">{pg.employee_count}</td>
                        <td className="px-3 py-3 text-center text-slate-700 capitalize">{pg.pay_frequency ?? 'monthly'}</td>
                        <td className="px-3 py-3 text-center">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${statusTone[pgStatus] ?? statusTone.draft}`}>
                            {pgStatus}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          <span className="text-sm font-medium text-slate-600 hover:text-emerald-600">View →</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </SurfaceCard>
        </div>

        {/* Recent Runs — Simple list matching wireframe */}
        <div className="lg:col-span-1">
          <SurfaceCard className="p-5">
            <h2 className="text-base font-semibold text-slate-900 mb-4">Recent Runs</h2>
            {runs.length === 0 ? (
              <p className="text-sm text-slate-500">No runs yet.</p>
            ) : (
              <div className="space-y-3">
                {runs.slice(0, 5).map((r) => {
                  const [y, m] = (r.month_year ?? '').split('-').map(Number);
                  const monthLabel = m ? new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' }) : r.month_year;
                  return (
                    <button
                      key={r.id}
                      onClick={() => onOpenRunDetail?.(r.id)}
                      className="w-full text-left p-3 rounded-lg hover:bg-slate-50 border border-slate-100 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{monthLabel}</p>
                          <p className="text-xs text-slate-500">{r.total_employees ?? r.employee_count ?? 0} employees</p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-slate-900">{formatCurrency(r.total_net_pay ?? 0)}</p>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${statusTone[r.status ?? ''] ?? 'bg-slate-100 text-slate-700'}`}>
                            {r.status ?? 'draft'}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </SurfaceCard>
        </div>
      </div>

      {/* Process & Pay CTA */}
      <SurfaceCard className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-900">Process &amp; Pay</h3>
            <p className="mt-1 text-sm text-slate-500">
              {summaryStats.pendingCount > 0
                ? `${summaryStats.pendingCount} employee${summaryStats.pendingCount === 1 ? '' : 's'} pending · ${formatCurrency(summaryStats.totalNetPay)} expected net pay`
                : 'All employees processed for this month.'}
            </p>
          </div>
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
  );
}

const COMPLIANCE_DEFAULTS = {
  pf: true,
  esi: true,
  pt: true,
  tds: true,
  lwf: false,
};

