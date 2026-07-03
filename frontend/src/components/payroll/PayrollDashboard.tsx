import { useMemo } from 'react';
import {
  Users,
  ChevronRight,
  Play,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Wallet,
  ArrowRight,
  Clock,
  FileText,
  CreditCard,
  BookOpen,
  UserX,
  Settings2,
  Download,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import NextStepsCard from './NextStepsCard';
import MonthTimeline from './MonthTimeline';
import CompensationAnalytics from './CompensationAnalytics';
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

// Quick Action Card (kept local)
function QuickActionCard({
  icon: Icon,
  title,
  description,
  count,
  action,
  variant = 'default',
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  count?: number;
  action: () => void;
  variant?: 'default' | 'warning' | 'danger';
}) {
  const variantClasses = {
    default: 'border-l-4 border-blue-500 hover:border-blue-600',
    warning: 'border-l-4 border-amber-500 hover:border-amber-600',
    danger: 'border-l-4 border-rose-500 hover:border-rose-600',
  };

  const iconColors = {
    default: 'text-blue-600 bg-blue-50',
    warning: 'text-amber-600 bg-amber-50',
    danger: 'text-rose-600 bg-rose-50',
  };

  return (
    <SurfaceCard className={cn('p-4 cursor-pointer transition-all', variantClasses[variant])} onClick={action}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={cn('h-10 w-10 rounded-lg flex items-center justify-center', iconColors[variant])}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <h4 className="font-medium text-slate-900">{title}</h4>
            <p className="text-sm text-slate-500">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {count !== undefined && count > 0 && (
            <span
              className={cn(
                'px-2.5 py-1 rounded-full text-sm font-semibold',
                variant === 'danger'
                  ? 'bg-rose-100 text-rose-700'
                  : variant === 'warning'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-blue-100 text-blue-700',
              )}
            >
              {count}
            </span>
          )}
          <ArrowRight className="h-4 w-4 text-slate-400" />
        </div>
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
  onOpenWizard,
  onOpenRunDetail,
  onOpenCreatePayGroup,
  onSelectPayGroup,
  onOpenDepartmentTemplates,
  onOpenUnassignedEmployees,
  onOpenReports,
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

  // Org-wide employee count (not limited to pay groups).
  const { data: statsData } = useQuery({
    queryKey: ['payroll', 'stats', selectedMonth],
    queryFn: () => payrollApi.getStats({ month_year: selectedMonth }).then((r) => r.data),
    staleTime: 60_000,
  });

  const runs = (Array.isArray(runsData) ? runsData : (runsData?.runs ?? [])) as Array<{
    month_year: string;
    status: string;
    id: number;
    employee_count?: number;
    total_employees?: number;
    total_net_pay?: number;
  }>;

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
    // Use org-wide count from the stats endpoint, not the pay-group
    // subset. This ensures "Total Employees" shows every employee in
    // the organization regardless of pay group assignment.
    const totalEmployees = statsData?.total_employees ?? 0;
    const processedCount = payGroups.reduce((sum, pg) => sum + pg.processed_count, 0);
    const paidCount = payGroups.reduce((sum, pg) => sum + pg.paid_count, 0);
    const totalNetPay = payGroups.reduce((sum, pg) => sum + pg.total_net_pay, 0);
    const pendingCount = Math.max(0, totalEmployees - processedCount);

    return { totalEmployees, processedCount, paidCount, totalNetPay, pendingCount };
  }, [payGroups, statsData]);

  const paidPct = summaryStats.totalEmployees > 0
    ? Math.round((summaryStats.paidCount / summaryStats.totalEmployees) * 100)
    : 0;

  const prevMonthRun = useMemo(() => {
    const sorted = [...runs]
      .filter((r) => r.month_year && r.month_year < selectedMonth)
      .sort((a, b) => (b.month_year ?? '').localeCompare(a.month_year ?? ''));
    return sorted[0] ?? null;
  }, [runs, selectedMonth]);

  const netPayBadge = useMemo(() => {
    if (!prevMonthRun || !prevMonthRun.total_net_pay || summaryStats.totalNetPay === 0) return null;
    const prev = Number(prevMonthRun.total_net_pay);
    const curr = summaryStats.totalNetPay;
    if (prev === 0) return null;
    const pct = ((curr - prev) / prev) * 100;
    const rounded = Math.abs(pct) < 0.1 ? '0.0' : Math.abs(pct).toFixed(1);
    return {
      text: `${rounded}% vs last month`,
      trend: pct > 0 ? ('up' as const) : pct < 0 ? ('down' as const) : ('neutral' as const),
    };
  }, [prevMonthRun, summaryStats.totalNetPay]);

  const handleExportSummary = () => {
    const rows: string[][] = [
      ['CareVance HRMS - Payroll Summary'],
      ['Month', selectedMonth],
      ['Generated', new Date().toLocaleString()],
      [''],
      ['Metric', 'Value'],
      ['Total Employees', String(summaryStats.totalEmployees)],
      ['Processed', String(summaryStats.processedCount)],
      ['Paid', String(summaryStats.paidCount)],
      ['Pending', String(summaryStats.pendingCount)],
      ['Total Net Pay', `Rs.${summaryStats.totalNetPay.toLocaleString('en-IN')}`],
      [''],
      ['Department Breakdown'],
      ['Department', 'Employees', 'Net Pay'],
      ...departments.map((d) => [
        d.name,
        String(d.employee_count),
        `Rs.${Number(d.total_net_pay || 0).toLocaleString('en-IN')}`,
      ]),
    ];
    const csv = rows.map((r) => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `payroll_summary_${selectedMonth}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Onboarding: Next Steps card for first-time / not-yet-completed users */}
      <NextStepsCard onOpenWizard={onOpenWizard} />

      {/* Month timeline (Apr-Mar FY) */}
      <MonthTimeline
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        runs={runs}
      />

      {/* Process & Pay primary CTA */}
      <div className="flex justify-start gap-3">
        <Button
          variant="primary"
          iconLeft={<Play className="h-4 w-4" />}
          onClick={() => onOpenProcessAndPay(selectedMonth, summaryStats.pendingCount, summaryStats.totalNetPay)}
          disabled={summaryStats.pendingCount === 0}
          className="shadow-sm whitespace-nowrap"
        >
          Process &amp; Pay ({summaryStats.pendingCount})
        </Button>
        <Button
          variant="secondary"
          iconLeft={<Download className="h-4 w-4" />}
          onClick={handleExportSummary}
          className="shadow-sm whitespace-nowrap"
        >
          Export Summary
        </Button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          label="Total Net Pay"
          value={formatCurrency(summaryStats.totalNetPay)}
          hint={`${summaryStats.processedCount} employees processed`}
          badge={netPayBadge ?? undefined}
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

      {/* Compensation Analytics Charts */}
      <CompensationAnalytics
        departments={departments}
        runs={runs as Partial<PayrollMonthlyRun>[]}
        summaryStats={summaryStats}
      />

      {/* Quick Actions */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <QuickActionCard
            icon={Users}
            title="Create Pay Group"
            description="Group employees for a shared pay schedule"
            action={() => onOpenCreatePayGroup?.()}
            variant="default"
          />
          <QuickActionCard
            icon={Settings2}
            title="Salary Components"
            description="Enable/disable earnings, deductions, and formula-based components"
            action={() => onOpenSalaryComponents?.()}
            variant="default"
          />
          <QuickActionCard
            icon={CreditCard}
            title="Employee Payroll Cards"
            description="View and manage individual employee CTC, salary components, and payroll config"
            action={() => onOpenEmployeeCards?.()}
            variant="default"
          />
          <QuickActionCard
            icon={FileText}
            title="Statutory Filings"
            description="Generate PF, ESI, Form 16, 24Q, PT, LWF returns"
            action={() => onOpenFilings?.()}
            variant="default"
          />
          <QuickActionCard
            icon={BookOpen}
            title="Salary Templates"
            description="Create and manage salary component templates for departments"
            action={() => onOpenDepartmentTemplates?.()}
            variant="default"
          />
          <QuickActionCard
            icon={UserX}
            title="View Unassigned Employees"
            description="Employees without a department assignment"
            action={() => onOpenUnassignedEmployees?.()}
            variant="default"
          />
        </div>
      </div>

      {/* Needs Attention */}
      {summaryStats.pendingCount > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Needs Attention</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickActionCard
              icon={Play}
              title="Process & Pay"
              description={`${summaryStats.pendingCount} employees ready for ${selectedMonth}`}
              count={summaryStats.pendingCount}
              action={() => onOpenProcessAndPay(selectedMonth, summaryStats.pendingCount, summaryStats.totalNetPay)}
              variant="warning"
            />
            <QuickActionCard
              icon={DollarSign}
              title="Review Payroll Reports"
              description="View detailed payroll analytics"
              action={() => onOpenReports?.(summaryStats)}
              variant="default"
            />
          </div>
        </div>
      )}

      {/* Pay Groups Section */}
      {(isPayGroupsLoading || payGroups.length > 0) && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:items-end sm:justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Pay Groups</h2>
              <p className="text-sm text-slate-500">
                {payGroups.length === 0
                  ? 'No pay groups yet — create one from Quick Actions'
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
