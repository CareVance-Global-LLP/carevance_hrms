import { useMemo } from 'react';
import {
  Users, UserPlus, UserMinus, CalendarDays, Wallet, Clock,
  CheckCircle2, Play, Settings, FileBarChart, GitCompare,
  TrendingUp, TrendingDown, ListChecks, Zap, Building2,
  DollarSign, Landmark, ArrowRight, Sparkles,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import PageHeader from '@/components/dashboard/PageHeader';
import { cn } from '@/utils/cn';

interface PayrollCockpitProps {
  monthYear: string;
  onStartWizard: () => void;
  onQuickProcess: () => void;
  onOpenSettings: () => void;
  onOpenReports: () => void;
  onOpenLegacyDashboard?: () => void;
  onOpenDepartmentTemplates?: () => void;
}

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function monthLabel(monthYear: string): string {
  if (!monthYear) return '';
  const [y, m] = monthYear.split('-');
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function getCalendarDaysInMonth(monthYear: string): number {
  if (!monthYear) return 0;
  const [y, m] = monthYear.split('-');
  return new Date(Number(y), Number(m), 0).getDate();
}

type ReadinessKey = 'attendance' | 'leaves' | 'reimbursements' | 'fbp_claims' | 'loan_emis' | 'variable_pay';

const READINESS: Array<{ key: ReadinessKey; label: string; icon: typeof CalendarDays; status: 'ready' | 'pending' }> = [
  { key: 'attendance',    label: 'Attendance',       icon: CalendarDays, status: 'ready'   },
  { key: 'leaves',        label: 'Leaves',           icon: ListChecks,   status: 'ready'   },
  { key: 'reimbursements',label: 'Reimbursements',   icon: DollarSign,   status: 'pending' },
  { key: 'fbp_claims',    label: 'FBP Claims',       icon: Wallet,       status: 'pending' },
  { key: 'loan_emis',     label: 'Loan EMIs',        icon: Landmark,     status: 'ready'   },
  { key: 'variable_pay',  label: 'Variable Pay',     icon: TrendingUp,   status: 'pending' },
];

export default function PayrollCockpit({
  monthYear, onStartWizard, onQuickProcess, onOpenSettings, onOpenReports, onOpenLegacyDashboard, onOpenDepartmentTemplates,
}: PayrollCockpitProps) {
  const { data: deptData } = useQuery({
    queryKey: ['payroll-cockpit-depts', monthYear],
    queryFn: () => payrollApi.getDepartments({ month_year: monthYear }).then(r => r.data),
  });
  const { data: statsData } = useQuery({
    queryKey: ['payroll-cockpit-stats', monthYear],
    queryFn: () => payrollApi.getStats({ month_year: monthYear }).then(r => r.data),
  });
  const { data: diffData } = useQuery({
    queryKey: ['payroll-cockpit-diff', monthYear],
    queryFn: () => payrollApi.getPayrollDiff(monthYear).then(r => r.data),
  });

  const departments = deptData?.departments || [];
  const unassignedCount = deptData?.unassigned_count || 0;

  // Aggregate stats from departments so the cockpit is always consistent.
  const stats = useMemo(() => {
    const total = departments.reduce((s, d) => s + d.employee_count, 0) + unassignedCount;
    const processed = departments.reduce((s, d) => s + d.processed_count, 0);
    const paid = departments.reduce((s, d) => s + d.paid_count, 0);
    const netPay = departments.reduce((s, d) => s + (d.total_net_pay || 0), 0);
    const gross = departments.reduce((s, d) => s + ((d as any).total_gross || 0), 0);
    const deductions = departments.reduce((s, d) => s + ((d as any).total_deductions || 0), 0);
    return {
      total, processed, paid,
      pending: Math.max(0, total - processed),
      netPay, gross, deductions,
    };
  }, [departments, unassignedCount]);

  const diff = (diffData as any)?.has_prev ? (diffData as any).diff : null;
  const prevMonth = (diffData as any)?.previous?.month_year || (diffData as any)?.prev_month || '';
  const current = (diffData as any)?.current || null;
  const previous = (diffData as any)?.previous || null;

  const employeeDelta = current && previous
    ? (Number(current.total_employees || 0) - Number(previous.total_employees || 0))
    : 0;
  const joinedCount = (statsData as any)?.joined_count;
  const leftCount = (statsData as any)?.left_count;

  const calendarDays = getCalendarDaysInMonth(monthYear);
  const completionPct = stats.total > 0 ? Math.round((stats.processed / stats.total) * 100) : 0;

  const diffItems: Array<{ label: string; value: number; format: 'currency' | 'number' }> = [
    { label: 'Gross',       value: Number(diff?.gross || 0),       format: 'currency' },
    { label: 'Deductions',  value: Number(diff?.deductions || 0),  format: 'currency' },
    { label: 'Net Pay',     value: Number(diff?.net_pay || 0),     format: 'currency' },
    { label: 'Employees',   value: employeeDelta,                  format: 'number'   },
  ];

  const readyCount = READINESS.filter(r => r.status === 'ready').length;
  const allReady = readyCount === READINESS.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description={monthLabel(monthYear)}
        actions={
          <>
            {onOpenDepartmentTemplates && (
              <Button variant="ghost" iconLeft={<Building2 className="h-4 w-4" />} onClick={onOpenDepartmentTemplates}>
                Dept Templates
              </Button>
            )}
            <Button variant="ghost" iconLeft={<FileBarChart className="h-4 w-4" />} onClick={onOpenReports}>
              Reports
            </Button>
            <Button variant="ghost" iconLeft={<Settings className="h-4 w-4" />} onClick={onOpenSettings}>
              Settings
            </Button>
            <Button variant="secondary" iconLeft={<Zap className="h-4 w-4" />} onClick={onQuickProcess}>
              Quick Process
            </Button>
            <Button variant="primary" iconLeft={<Play className="h-4 w-4" />} onClick={onStartWizard}>
              Run Payroll
            </Button>
          </>
        }
      />

      {/* Keka-style stat cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <MetricCard
          label="Total Employees"
          value={stats.total}
          hint={`${stats.processed} processed`}
          icon={Users}
          accent="sky"
        />
        <MetricCard
          label="Joined"
          value={typeof joinedCount === 'number' ? joinedCount : 0}
          hint="This month"
          icon={UserPlus}
          accent="emerald"
        />
        <MetricCard
          label="Left"
          value={typeof leftCount === 'number' ? leftCount : 0}
          hint="This month"
          icon={UserMinus}
          accent="rose"
        />
        <MetricCard
          label="Calendar Days"
          value={calendarDays}
          hint={monthLabel(monthYear)}
          icon={CalendarDays}
          accent="violet"
        />
        <MetricCard
          label="Pending"
          value={stats.pending}
          hint={stats.pending > 0 ? 'Awaiting processing' : 'All caught up'}
          icon={Clock}
          accent={stats.pending > 0 ? 'amber' : 'emerald'}
        />
        <MetricCard
          label="Processed"
          value={stats.processed}
          hint={`${completionPct}% complete`}
          icon={CheckCircle2}
          accent="emerald"
        />
      </div>

      {/* Payroll cost row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <SurfaceCard className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Total Payroll Cost</p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{formatCurrency(stats.gross)}</p>
          <p className="mt-1 text-xs text-slate-400">Gross salary including employer contributions</p>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Total Deductions</p>
          <p className="mt-2 text-2xl font-bold text-rose-700">{formatCurrency(stats.deductions)}</p>
          <p className="mt-1 text-xs text-slate-400">PF, ESI, PT, TDS, LOP deductions</p>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Net Payable</p>
          <p className="mt-2 text-2xl font-bold text-emerald-700">{formatCurrency(stats.netPay)}</p>
          <p className="mt-1 text-xs text-slate-400">
            {stats.paid} of {stats.total} employees paid
          </p>
        </SurfaceCard>
      </div>

      {/* Month-over-month diff */}
      {diff && (
        <SurfaceCard className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">Compared to Previous Month</h3>
            {prevMonth && <span className="text-xs text-slate-400">({monthLabel(prevMonth)})</span>}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {diffItems.map((item) => {
              const isZero = item.value === 0;
              const trendClass = isZero
                ? 'text-slate-500'
                : item.value > 0
                  ? 'text-emerald-600'
                  : 'text-rose-600';
              const formatted = item.format === 'currency' ? formatCurrency(Math.abs(item.value)) : Math.abs(item.value);
              return (
                <div key={item.label} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <div className="mt-1 flex items-center gap-1">
                    {!isZero && (
                      item.value > 0
                        ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                        : <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                    )}
                    <p className={cn('text-sm font-semibold', trendClass)}>
                      {isZero ? '—' : `${item.value > 0 ? '+' : '-'}${formatted}`}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      )}

      {/* Input readiness + Departments */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <SurfaceCard className="p-5 lg:col-span-1">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Input Readiness</h3>
            <StatusBadge tone={allReady ? 'success' : 'warning'}>
              {allReady ? 'All synced' : `${readyCount}/${READINESS.length} ready`}
            </StatusBadge>
          </div>
          <div className="space-y-1">
            {READINESS.map((item) => (
              <div key={item.key} className="flex items-center justify-between rounded-md py-1.5">
                <div className="flex items-center gap-2">
                  <item.icon className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-sm text-slate-700">{item.label}</span>
                </div>
                <StatusBadge tone={item.status === 'ready' ? 'success' : 'warning'}>
                  {item.status === 'ready' ? 'Synced' : 'Pending'}
                </StatusBadge>
              </div>
            ))}
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">Departments</h3>
            <span className="text-xs text-slate-400">
              {departments.length} total · {unassignedCount} unassigned
            </span>
          </div>
          {departments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <Building2 className="mb-2 h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">No departments found</p>
              <p className="mt-1 text-xs text-slate-400">Create departments to organise payroll processing.</p>
            </div>
          ) : (
            <div className="max-h-64 space-y-1 overflow-y-auto pr-1">
              {departments.map((dept) => {
                const pct = dept.employee_count > 0 ? Math.round((dept.processed_count / dept.employee_count) * 100) : 0;
                return (
                  <div key={dept.id} className="flex items-center justify-between rounded-lg px-3 py-2 transition-colors hover:bg-slate-50">
                    <div className="flex items-center gap-3">
                      <Building2 className="h-4 w-4 text-slate-400" />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{dept.name}</p>
                        <p className="text-xs text-slate-400">
                          {dept.processed_count}/{dept.employee_count} processed
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className={cn(
                            'h-full rounded-full transition-all',
                            pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-200',
                          )}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="min-w-[2.5rem] text-right text-xs font-semibold text-slate-600">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Primary action cards - hero CTAs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <button
          onClick={onStartWizard}
          className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-sky-600 to-sky-700 p-6 text-left text-white shadow-lg shadow-sky-200 transition-all hover:from-sky-700 hover:to-sky-800"
        >
          <Sparkles className="absolute -right-4 -top-4 h-24 w-24 text-white/10" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">Run Payroll</h3>
              <p className="mt-1 text-sm text-sky-100">Guided 6-step process with checklist</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 transition-colors group-hover:bg-white/30">
              <ListChecks className="h-5 w-5" />
            </div>
          </div>
          <div className="relative mt-4 flex items-center gap-1 text-xs text-sky-100">
            <span>Leaves & Attendance → Review & Finalize</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </button>
        <button
          onClick={onQuickProcess}
          className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-700 p-6 text-left text-white shadow-lg shadow-emerald-200 transition-all hover:from-emerald-700 hover:to-emerald-800"
        >
          <Zap className="absolute -right-4 -top-4 h-24 w-24 text-white/10" />
          <div className="relative flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold">Quick Process</h3>
              <p className="mt-1 text-sm text-emerald-100">One-click auto payroll with sync</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/20 transition-colors group-hover:bg-white/30">
              <Zap className="h-5 w-5" />
            </div>
          </div>
          <div className="relative mt-4 flex items-center gap-1 text-xs text-emerald-100">
            <span>Auto-syncs attendance, leave, reimbursements</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </button>
      </div>

      {/* Footer actions */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-2 text-sm">
        <Button variant="ghost" iconLeft={<FileBarChart className="h-4 w-4" />} onClick={onOpenReports}>
          View Reports
        </Button>
        <Button variant="ghost" iconLeft={<Settings className="h-4 w-4" />} onClick={onOpenSettings}>
          Payroll Settings
        </Button>
        {onOpenLegacyDashboard && (
          <Button variant="ghost" iconLeft={<Building2 className="h-4 w-4" />} onClick={onOpenLegacyDashboard}>
            Classic View
          </Button>
        )}
      </div>
    </div>
  );
}
