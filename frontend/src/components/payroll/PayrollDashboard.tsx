import { useMemo } from 'react';
import {
  Users,
  ChevronRight,
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
import StatusBadge from '@/components/ui/StatusBadge';
import PayrollRunCard from '@/components/ui/PayrollRunCard';
import MonthTimeline from './MonthTimeline';
import CompensationAnalytics from './CompensationAnalytics';
import PayrollToDoRail from './PayrollToDoRail';
import ComplianceStatusBoard from './ComplianceStatusBoard';
import PayrollModuleLauncher from './PayrollModuleLauncher';
import { cn } from '@/utils/cn';

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

// Pay Group Card Component
function PayGroupCard({
  payGroup,
  onClick,
}: {
  payGroup: PayGroup;
  onClick: () => void;
}) {
  const progress = payGroup.employee_count > 0
    ? (payGroup.processed_count / payGroup.employee_count) * 100
    : 0;

  const isComplete = progress === 100;
  const hasPending = payGroup.processed_count < payGroup.employee_count;

  return (
    <SurfaceCard
      className="p-5 cursor-pointer hover:shadow-lg hover:border-emerald-300 transition-all group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            {payGroup.name.charAt(0)}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 group-hover:text-emerald-600 transition-colors">
              {payGroup.name}
            </h3>
            <p className="text-sm text-slate-500">
              {payGroup.employee_count} employee{payGroup.employee_count === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-500">Processing Progress</span>
          <span className={cn('font-medium', isComplete ? 'text-emerald-600' : 'text-amber-600')}>
            {payGroup.processed_count}/{payGroup.employee_count}
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isComplete ? 'bg-emerald-500' : 'bg-emerald-400',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-1">Total Net Pay</p>
          <p className="font-semibold text-slate-900">{formatCurrency(payGroup.total_net_pay)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">Paid</p>
          <p className="font-semibold text-emerald-600">
            {payGroup.paid_count} {payGroup.paid_count === 1 ? 'employee' : 'employees'}
          </p>
        </div>
      </div>

      {/* Status Badge */}
      <div className="mt-4 flex items-center gap-2">
        <StatusBadge tone={isComplete ? 'success' : hasPending ? 'warning' : 'neutral'}>
          {isComplete
            ? 'Complete'
            : hasPending
              ? `${payGroup.employee_count - payGroup.processed_count} pending`
              : 'Not Started'}
        </StatusBadge>
      </div>
    </SurfaceCard>
  );
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

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Net Pay"
          value={formatCurrency(summaryStats.totalNetPay)}
          hint={`${summaryStats.processedCount} employees processed`}
          icon={Wallet}
          accent="emerald"
        />
        <MetricCard
          label="Total Employees"
          value={summaryStats.totalEmployees}
          hint={`${summaryStats.processedCount} processed`}
          icon={Users}
          accent="violet"
        />
        <MetricCard
          label="Pending Processing"
          value={summaryStats.pendingCount}
          hint={`${summaryStats.totalEmployees - summaryStats.paidCount} awaiting payment`}
          icon={Clock}
          accent={summaryStats.pendingCount > 0 ? 'amber' : 'emerald'}
        />
        <MetricCard
          label="Paid This Month"
          value={summaryStats.paidCount}
          hint={`${paidPct}% completion`}
          icon={CheckCircle2}
          accent="emerald"
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
  runs: Array<{ id: number; month_year?: string; run_month?: string; status?: string; total_employees?: number; employee_count?: number; total_net_pay?: number }>;
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
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-slate-900">
                    ₹{Number(r.total_net_pay ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </p>
                  <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${statusTone[r.status ?? ''] ?? 'bg-slate-100 text-slate-700'}`}>
                    {r.status ?? 'draft'}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </SurfaceCard>
    </div>
  );
}
