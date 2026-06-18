import { useState, useMemo } from 'react';
import {
  Users,
  Search,
  Building2,
  ChevronRight,
  Play,
  AlertCircle,
  CheckCircle2,
  DollarSign,
  Wallet,
  ArrowRight,
  Clock,
  Briefcase,
  FileText,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import NextStepsCard from './NextStepsCard';
import { cn } from '@/utils/cn';

import type { PayrollDepartment, PayrollStats } from '@/types';

interface PayrollDashboardProps {
  onSelectDepartment: (departmentId: number) => void;
  onSelectEmployee: (employeeId: number) => void;
  onOpenRunPayroll: (stats: PayrollStats, departments: PayrollDepartment[]) => void;
  onOpenDepartmentTemplates?: () => void;
  onOpenFilings?: () => void;
  onOpenWizard?: () => void;
  onOpenRunDetail?: (runId: number) => void;
}

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

// Department Card Component (kept local — too domain-specific for the shared system)
function DepartmentCard({
  department,
  onClick,
}: {
  department: PayrollDepartment;
  onClick: () => void;
}) {
  const progress = department.employee_count > 0
    ? (department.processed_count / department.employee_count) * 100
    : 0;

  const isComplete = progress === 100;
  const hasPending = department.processed_count < department.employee_count;

  return (
    <SurfaceCard
      className="p-5 cursor-pointer hover:shadow-lg hover:border-blue-300 transition-all group"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white font-bold text-lg shadow-sm">
            {department.name.charAt(0)}
          </div>
          <div>
            <h3 className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors">
              {department.name}
            </h3>
            <p className="text-sm text-slate-500">
              {department.employee_count} employees
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-blue-500 transition-colors" />
      </div>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-slate-500">Processing Progress</span>
          <span className={cn('font-medium', isComplete ? 'text-emerald-600' : 'text-amber-600')}>
            {department.processed_count}/{department.employee_count}
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500',
              isComplete ? 'bg-emerald-500' : 'bg-blue-500',
            )}
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400 mb-1">Total Net Pay</p>
          <p className="font-semibold text-slate-900">{formatCurrency(department.total_net_pay)}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400 mb-1">Paid</p>
          <p className="font-semibold text-emerald-600">{department.paid_count} employees</p>
        </div>
      </div>

      {/* Status Badge */}
      <div className="mt-4 flex items-center gap-2">
        <StatusBadge tone={isComplete ? 'success' : hasPending ? 'warning' : 'neutral'}>
          {isComplete
            ? 'Complete'
            : hasPending
              ? `${department.employee_count - department.processed_count} pending`
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
  onSelectDepartment,
  onOpenRunPayroll,
  onOpenDepartmentTemplates,
  onOpenFilings,
  onOpenWizard,
  onOpenRunDetail,
}: PayrollDashboardProps) {
  // onSelectEmployee is declared in the interface so the parent (Payroll.tsx)
  // can still wire it; the legacy dashboard's current widgets don't drill into
  // a single employee, so we don't destructure it here.
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  });
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch data
  const { data: departmentsData, isLoading: isDepartmentsLoading } = useQuery({
    queryKey: ['payroll', 'departments', selectedMonth],
    queryFn: () => payrollApi.getDepartments({ month_year: selectedMonth }).then((res) => res.data),
  });

  const { data: statsData } = useQuery({
    queryKey: ['payroll', 'stats', selectedMonth],
    queryFn: () => payrollApi.getStats({ month_year: selectedMonth }).then((res) => res.data),
  });

  const departments = departmentsData?.departments || [];
  const unassignedCount = departmentsData?.unassigned_count || 0;

  // Calculate summary stats
  const summaryStats = useMemo(() => {
    const totalEmployees = departments.reduce((sum, d) => sum + d.employee_count, 0) + unassignedCount;
    const processedCount = departments.reduce((sum, d) => sum + d.processed_count, 0);
    const paidCount = departments.reduce((sum, d) => sum + d.paid_count, 0);
    const totalNetPay = departments.reduce((sum, d) => sum + d.total_net_pay, 0);
    const pendingCount = Math.max(0, totalEmployees - processedCount);

    return { totalEmployees, processedCount, paidCount, totalNetPay, pendingCount };
  }, [departments, unassignedCount]);

  // Filter and sort departments
  const filteredDepartments = useMemo(() => {
    const filtered = departments.filter((dept) =>
      dept.name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    return filtered.sort((a, b) => {
      const aPending = a.employee_count - a.processed_count;
      const bPending = b.employee_count - b.processed_count;
      if (aPending > 0 && bPending === 0) return -1;
      if (aPending === 0 && bPending > 0) return 1;
      return b.employee_count - a.employee_count;
    });
  }, [departments, searchQuery]);

  // Get departments needing attention
  const departmentsNeedingAttention = useMemo(
    () => filteredDepartments.filter((d) => d.processed_count < d.employee_count),
    [filteredDepartments],
  );

  const handleQuickProcess = () => {
    if (statsData && departments.length > 0) {
      onOpenRunPayroll(statsData, departments);
    }
  };

  const paidPct = summaryStats.totalEmployees > 0
    ? Math.round((summaryStats.paidCount / summaryStats.totalEmployees) * 100)
    : 0;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Onboarding: Next Steps card for first-time / not-yet-completed users */}
      <NextStepsCard onOpenWizard={onOpenWizard} />

      {/* Month selector + quick action row */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-slate-700">Month:</label>
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <Button
          variant="primary"
          iconLeft={<Play className="h-4 w-4" />}
          onClick={handleQuickProcess}
          disabled={summaryStats.pendingCount === 0}
        >
          Process All ({summaryStats.pendingCount})
        </Button>
      </div>

      {/* Quick Stats (design system MetricCard) */}
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

      {/* Quick Actions */}
      {summaryStats.pendingCount > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <QuickActionCard
              icon={Play}
              title="Process Pending Payroll"
              description={`${summaryStats.pendingCount} employees need processing`}
              count={summaryStats.pendingCount}
              action={handleQuickProcess}
              variant="warning"
            />
            <QuickActionCard
              icon={Briefcase}
              title="View Unassigned Employees"
              description={`${unassignedCount} employees without department`}
              count={unassignedCount > 0 ? unassignedCount : undefined}
              action={() => onSelectDepartment(0)}
              variant={unassignedCount > 0 ? 'danger' : 'default'}
            />
            <QuickActionCard
              icon={Building2}
              title="Salary Templates"
              description="Edit individual employee salary structures. Pick a department, select an employee, and update their template."
              action={() => onOpenDepartmentTemplates?.()}
              variant="default"
            />
            <QuickActionCard
              icon={DollarSign}
              title="Review Payroll Reports"
              description="View detailed payroll analytics"
              action={() => {
                /* open reports */
              }}
              variant="default"
            />
            <QuickActionCard
              icon={FileText}
              title="Statutory Filings"
              description="Generate PF, ESI, Form 16, 24Q, PT, LWF returns"
              action={() => onOpenFilings?.()}
              variant="default"
            />
          </div>
        </div>
      )}

      {/* Departments Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">
              {departmentsNeedingAttention.length > 0 ? 'Needs Attention' : 'All Departments'}
            </h2>
            <p className="text-sm text-slate-500">
              {departmentsNeedingAttention.length > 0
                ? `${departmentsNeedingAttention.length} departments have pending payrolls`
                : 'Select a department to view employees'}
            </p>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <TextInput
              placeholder="Search departments..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-full sm:w-64"
            />
          </div>
        </div>

        {/* Departments Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {isDepartmentsLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <SurfaceCard key={i} className="p-5 animate-pulse">
                <div className="h-12 w-12 bg-slate-200 rounded-xl mb-4" />
                <div className="h-5 bg-slate-200 rounded w-1/2 mb-2" />
                <div className="h-4 bg-slate-200 rounded w-1/3" />
              </SurfaceCard>
            ))
          ) : filteredDepartments.length === 0 ? (
            <div className="col-span-full text-center py-12 text-slate-500">
              <Building2 className="h-12 w-12 mx-auto mb-3 text-slate-300" />
              <p className="font-medium">No departments found</p>
              <p className="text-sm">Create departments to organize payroll</p>
            </div>
          ) : (
            filteredDepartments.map((dept) => (
              <DepartmentCard
                key={dept.id}
                department={dept}
                onClick={() => onSelectDepartment(dept.id)}
              />
            ))
          )}
        </div>

        {departmentsNeedingAttention.length > 0 && departmentsNeedingAttention.length < filteredDepartments.length && (
          <div className="text-center pt-4">
            <Button variant="ghost" onClick={() => setSearchQuery('')}>
              View All {filteredDepartments.length} Departments
            </Button>
          </div>
        )}
      </div>

      {/* Recent Runs */}
      <RecentRuns onOpenRunDetail={onOpenRunDetail} />

      {/* Help Text */}
      <SurfaceCard className="p-4 bg-blue-50 border-blue-200">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-medium text-blue-900">How to process payroll</h4>
            <ol className="text-sm text-blue-700 mt-1 space-y-1 list-decimal list-inside">
              <li>Click on a department with pending employees</li>
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

function RecentRuns({ onOpenRunDetail }: { onOpenRunDetail?: (runId: number) => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => payrollApi.getPayrollRuns().then((r) => r.data),
  });

  const runs = Array.isArray(data) ? data : (data?.runs ?? []);
  if (isLoading || runs.length === 0) return null;

  const recent = runs.slice(0, 5);
  const statusTone: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    locked: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    released: 'bg-violet-100 text-violet-700',
    disbursed: 'bg-emerald-100 text-emerald-700',
    paid: 'bg-emerald-100 text-emerald-700',
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">Recent Payroll Runs</h2>
        <p className="text-xs text-slate-500">Click a run to view its lifecycle, lock/approve, or download bank file</p>
      </div>
      <SurfaceCard className="p-0 overflow-hidden">
        <div className="divide-y divide-slate-100">
          {recent.map((r: any) => (
            <button
              key={r.id}
              onClick={() => onOpenRunDetail?.(r.id)}
              className="w-full flex items-center justify-between p-3 hover:bg-blue-50 transition-colors text-left"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900">{r.month_year ?? r.run_month ?? 'Unknown month'}</p>
                <p className="text-xs text-slate-500">Run #{r.id} · {r.employee_count ?? 0} employees</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">
                  ₹{Number(r.total_net_pay ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                </p>
                <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${statusTone[r.status] ?? 'bg-slate-100 text-slate-700'}`}>
                  {r.status ?? 'draft'}
                </span>
              </div>
            </button>
          ))}
        </div>
      </SurfaceCard>
    </div>
  );
}
