import { ChevronRight, FileText } from 'lucide-react';
import PayrollStatusBadge from './PayrollStatusBadge';
import { formatPayrollAmount } from './PayrollAmount';

interface PayrollRunCardProps {
  run: {
    id: number;
    month_year: string;
    status: string;
    employee_count: number;
    total_gross?: number | string;
    total_deductions?: number | string;
    total_net_pay?: number | string;
    created_at?: string;
    disbursed_at?: string;
  };
  onClick?: () => void;
  onViewDetails?: (id: number) => void;
  onDisburse?: (id: number) => void;
}

export default function PayrollRunCard({ 
  run, 
  onClick, 
  onViewDetails,
  onDisburse 
}: PayrollRunCardProps) {
  const formatMonth = (monthYear: string) => {
    if (!monthYear) return 'Unknown';
    const [y, m] = monthYear.split('-').map(Number);
    if (!y || !m || m < 1 || m > 12) return monthYear;
    return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  };

  const formatRelativeTime = (dateStr?: string) => {
    if (!dateStr) return 'Recently';
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor(diff / (1000 * 60));
    
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'Just now';
  };

  return (
    <div
      onClick={onClick}
      className="group rounded-2xl border border-slate-100 bg-white p-5 shadow-sm hover:shadow-md hover:border-slate-200 transition-all cursor-pointer"
    >
      {/* Header Row */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <PayrollStatusBadge status={run.status as any} size="md" />
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 truncate">{formatMonth(run.month_year)}</h3>
            <p className="text-sm text-slate-500">Run #{run.id} · {run.employee_count} employee{run.employee_count !== 1 ? 's' : ''}</p>
          </div>
        </div>
        <div className="text-right ml-4 flex-shrink-0">
          <p className="text-xl font-bold text-slate-900">{formatPayrollAmount(run.total_net_pay, { compact: true })}</p>
          <p className="text-xs text-slate-400">Net Pay</p>
        </div>
      </div>

      {/* Amount Breakdown */}
      <div className="grid grid-cols-3 gap-4 py-3 border-t border-slate-100">
        <div>
          <p className="text-xs text-slate-400">Gross</p>
          <p className="text-sm font-semibold text-slate-700">{formatPayrollAmount(run.total_gross, { compact: true })}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Deductions</p>
          <p className="text-sm font-semibold text-slate-700">{formatPayrollAmount(run.total_deductions, { compact: true })}</p>
        </div>
        <div>
          <p className="text-xs text-slate-400">Net Pay</p>
          <p className="text-sm font-semibold text-emerald-600">{formatPayrollAmount(run.total_net_pay, { compact: true })}</p>
        </div>
      </div>

      {/* Footer Row */}
      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
        <span className="text-xs text-slate-400">
          {run.disbursed_at 
            ? `Disbursed ${formatRelativeTime(run.disbursed_at)}`
            : run.created_at 
              ? `Created ${formatRelativeTime(run.created_at)}`
              : 'Recently'}
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); onViewDetails?.(run.id); }}
            className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
          >
            View Details <ChevronRight className="h-4 w-4" />
          </button>
          {run.status === 'released' && onDisburse && (
            <button
              onClick={(e) => { e.stopPropagation(); onDisburse(run.id); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-[#4A7A80] transition-colors"
            >
              Disburse
            </button>
          )}
        </div>
      </div>
    </div>
  );
}