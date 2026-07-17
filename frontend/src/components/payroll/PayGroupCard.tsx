import { ChevronRight, Settings } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import type { PayGroup } from '@/types';
import { cn } from '@/utils/cn';

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function PayGroupCard({
  payGroup,
  onClick,
  onSettingsClick,
}: {
  payGroup: PayGroup;
  onClick: () => void;
  onSettingsClick?: () => void;
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
        <div className="flex items-center gap-2">
          {onSettingsClick && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSettingsClick();
              }}
              className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              title="Settings"
              aria-label={`Settings for ${payGroup.name}`}
            >
              <Settings className="h-4 w-4" />
            </button>
          )}
          <ChevronRight className="h-5 w-5 text-slate-400 group-hover:text-emerald-500 transition-colors" />
        </div>
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