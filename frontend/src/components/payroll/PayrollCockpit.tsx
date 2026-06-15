import { useState, useMemo } from 'react';
import {
  Users, CalendarDays, UserPlus, UserMinus, Wallet, ArrowRight, Clock,
  CheckCircle2, AlertCircle, Play, Settings, FileBarChart, Landmark,
  TrendingUp, TrendingDown, GitCompare, Zap, RefreshCw, Building2,
  DollarSign, ListChecks, ChevronRight,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayrollDepartment, PayrollStats } from '@/types';

interface PayrollCockpitProps {
  monthYear: string;
  onStartWizard: () => void;
  onQuickProcess: () => void;
  onOpenSettings: () => void;
  onOpenReports: () => void;
  onOpenLegacyDashboard?: () => void;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function PayrollCockpit({
  monthYear, onStartWizard, onQuickProcess, onOpenSettings, onOpenReports, onOpenLegacyDashboard,
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
  const stats = useMemo(() => {
    const total = departments.reduce((s, d) => s + d.employee_count, 0) + (deptData?.unassigned_count || 0);
    const processed = departments.reduce((s, d) => s + d.processed_count, 0);
    const paid = departments.reduce((s, d) => s + d.paid_count, 0);
    const netPay = departments.reduce((s, d) => s + (d as any).total_net_pay || 0, 0);
    return { total, processed, paid, pending: total - processed, netPay };
  }, [departments, deptData]);

  const diff = (diffData as any)?.has_prev ? (diffData as any).diff : null;
  const prevMonth = (diffData as any)?.prev_month || '';

  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payroll</h1>
          <p className="text-sm text-slate-500 mt-1">{monthYear}</p>
        </div>
        <div className="flex items-center gap-2">
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
        </div>
      </div>

      {/* Keka-style stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-blue-50 flex items-center justify-center">
              <Users className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Total Employees</p>
              <p className="text-lg font-bold text-slate-900">{stats.total}</p>
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
              <UserPlus className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Joined</p>
              <p className="text-lg font-bold text-emerald-600">0</p>
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-rose-50 flex items-center justify-center">
              <UserMinus className="h-4 w-4 text-rose-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Left</p>
              <p className="text-lg font-bold text-rose-600">0</p>
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-violet-50 flex items-center justify-center">
              <CalendarDays className="h-4 w-4 text-violet-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Calendar Days</p>
              <p className="text-lg font-bold text-slate-900">26</p>
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-amber-50 flex items-center justify-center">
              <Clock className="h-4 w-4 text-amber-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Pending</p>
              <p className="text-lg font-bold text-amber-600">{stats.pending}</p>
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-lg bg-emerald-50 flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Processed</p>
              <p className="text-lg font-bold text-emerald-600">{stats.processed}</p>
            </div>
          </div>
        </SurfaceCard>
      </div>

      {/* Payroll cost row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SurfaceCard className="p-5">
          <p className="text-xs text-slate-500 mb-1">Total Payroll Cost</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(stats.netPay || departments.reduce((s, d) => s + (d as any).total_gross || 0, 0))}</p>
          <p className="text-xs text-slate-400 mt-1">Gross salary including employer contributions</p>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <p className="text-xs text-slate-500 mb-1">Total Deductions</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(departments.reduce((s, d) => s + (d as any).total_deductions || 0, 0))}</p>
          <p className="text-xs text-slate-400 mt-1">PF, ESI, PT, TDS, LOP deductions</p>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <p className="text-xs text-slate-500 mb-1">Net Payable</p>
          <p className="text-2xl font-bold text-slate-900">{formatCurrency(stats.netPay)}</p>
          <p className="text-xs text-slate-400 mt-1">{stats.paid} employees paid</p>
        </SurfaceCard>
      </div>

      {/* Month-over-month diff */}
      {diff && (
        <SurfaceCard className="p-5 border-slate-200">
          <div className="flex items-center gap-2 mb-3">
            <GitCompare className="h-4 w-4 text-slate-500" />
            <h3 className="text-sm font-semibold text-slate-900">vs Previous Month</h3>
            <span className="text-xs text-slate-400">({prevMonth})</span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Gross', value: diff.gross },
              { label: 'Deductions', value: diff.deductions },
              { label: 'Net Pay', value: diff.net_pay },
              { label: 'Employees', value: (diffData as any)?.current?.total_employees - (diffData as any)?.previous?.total_employees || 0 },
            ].map((item, i) => (
              <div key={i} className="bg-slate-50 rounded-lg p-3">
                <p className="text-xs text-slate-500">{item.label}</p>
                <div className="flex items-center gap-1">
                  {item.value !== 0 && (
                    item.value > 0
                      ? <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                      : <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                  )}
                  <p className={`text-sm font-semibold ${item.value > 0 ? 'text-emerald-600' : item.value < 0 ? 'text-rose-600' : 'text-slate-900'}`}>
                    {item.value > 0 ? '+' : ''}{item.label === 'Employees' ? item.value : formatCurrency(Math.abs(item.value))}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}

      {/* Input readiness + Action / Departments */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Input Readiness */}
        <SurfaceCard className="p-5 lg:col-span-1">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">Input Readiness</h3>
          <div className="space-y-2">
            {[
              { label: 'Attendance', status: 'ready', icon: CalendarDays },
              { label: 'Leaves', status: 'ready', icon: ListChecks },
              { label: 'Reimbursements', status: 'pending', icon: DollarSign },
              { label: 'FBP Claims', status: 'pending', icon: Wallet },
              { label: 'Loan EMIs', status: 'ready', icon: Landmark },
              { label: 'Variable Pay', status: 'pending', icon: TrendingUp },
            ].map((item, i) => (
              <div key={i} className="flex items-center justify-between py-1.5">
                <div className="flex items-center gap-2">
                  <item.icon className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-sm text-slate-700">{item.label}</span>
                </div>
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                  item.status === 'ready' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
                }`}>
                  {item.status === 'ready' ? 'Synced' : 'Pending'}
                </span>
              </div>
            ))}
          </div>
        </SurfaceCard>

        {/* Departments */}
        <SurfaceCard className="p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-900">Departments</h3>
            <span className="text-xs text-slate-400">{departments.length} total</span>
          </div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {departments.length === 0 && (
              <p className="text-sm text-slate-400 text-center py-6">No departments found</p>
            )}
            {departments.map((dept: any) => {
              const pct = dept.employee_count > 0 ? Math.round((dept.processed_count / dept.employee_count) * 100) : 0;
              return (
                <div key={dept.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-slate-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-4 w-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">{dept.name}</p>
                      <p className="text-xs text-slate-400">{dept.processed_count}/{dept.employee_count} processed</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="w-20 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : pct > 0 ? 'bg-blue-500' : 'bg-slate-200'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300" />
                  </div>
                </div>
              );
            })}
          </div>
        </SurfaceCard>
      </div>

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          onClick={onStartWizard}
          className="group relative bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-xl p-6 text-left hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg shadow-blue-200"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold mb-1">Run Payroll</h3>
              <p className="text-sm text-blue-100">Guided 6-step process with checklist</p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
              <ListChecks className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs text-blue-200">
            <span>Leaves & Attendance → Review & Finalize</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </button>
        <button
          onClick={onQuickProcess}
          className="group relative bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-xl p-6 text-left hover:from-emerald-700 hover:to-emerald-800 transition-all shadow-lg shadow-emerald-200"
        >
          <div className="flex items-start justify-between">
            <div>
              <h3 className="text-lg font-semibold mb-1">Quick Process</h3>
              <p className="text-sm text-emerald-100">One-click auto payroll with sync</p>
            </div>
            <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center group-hover:bg-white/30 transition-colors">
              <Zap className="h-5 w-5" />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-1 text-xs text-emerald-200">
            <span>Auto-syncs attendance, leave, reimbursements</span>
            <ArrowRight className="h-3 w-3" />
          </div>
        </button>
      </div>

      {/* Settings & Reports */}
      <div className="flex items-center justify-center gap-4 pt-2">
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
