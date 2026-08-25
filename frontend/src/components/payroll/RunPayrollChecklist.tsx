import {
  ClipboardList, Users, TrendingUp, Receipt, PauseCircle, Sliders,
  Check, AlertTriangle, Lock, MinusCircle,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { cn } from '@/utils/cn';

interface RunPayrollChecklistProps {
  runId: number;
  className?: string;
}

const ICON_MAP: Record<string, any> = {
  ClipboardList,
  Users,
  TrendingUp,
  Receipt,
  PauseCircle,
  Sliders,
};

const STATUS_STYLE: Record<string, { dot: string; pill: string; pillText: string }> = {
  completed: {
    dot: 'bg-emerald-500',
    pill: 'bg-emerald-100',
    pillText: 'text-emerald-700',
  },
  pending: {
    dot: 'bg-amber-500',
    pill: 'bg-amber-100',
    pillText: 'text-amber-700',
  },
  no_action: {
    dot: 'bg-slate-300',
    pill: 'bg-slate-100',
    pillText: 'text-slate-600',
  },
};

/**
 * 6-step pre-flight checklist shown inside the run detail modal.
 *
 * Status comes from /payroll/runs/{id}/checklist which derives each step
 * from live data (attendance, joinees/exits, overtime/bonus, pending
 * reimbursements, arrears, etc).
 */
export default function RunPayrollChecklist({ runId, className }: RunPayrollChecklistProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'run-checklist', runId],
    queryFn: () => payrollApi.getRunChecklist(runId).then((r) => r.data),
    enabled: !!runId,
  });

  if (isLoading) {
    return (
      <SurfaceCard className={cn('p-4', className)}>
        <div className="text-sm text-slate-500">Loading checklist…</div>
      </SurfaceCard>
    );
  }

  const steps = data?.steps ?? [];
  const completed = data?.completed_count ?? 0;
  const total = data?.total_count ?? 6;
  const pending = data?.pending_count ?? 0;
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

  return (
    <SurfaceCard className={cn('p-4', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-blue-600" />
            Pre-flight Checklist
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            {completed} of {total} steps complete
            {pending > 0 && ` · ${pending} pending review`}
          </p>
        </div>
        <span
          className={cn(
            'px-2.5 py-1 rounded-full text-xs font-semibold',
            pct === 100 ? 'bg-emerald-100 text-emerald-700' :
            pct >= 50 ? 'bg-blue-100 text-blue-700' :
            'bg-slate-100 text-slate-600',
          )}
        >
          {pct}%
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-4">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            pct === 100 ? 'bg-emerald-500' : 'bg-blue-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Step grid: 2x3 on desktop, 1-col on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {steps.map((step) => {
          const Icon = ICON_MAP[step.icon ?? 'ClipboardList'] ?? ClipboardList;
          return (
            <div
              key={step.id}
              className={cn(
                'flex items-start gap-2.5 p-3 rounded-lg border',
                step.status === 'pending' ? 'bg-amber-50 border-amber-200' :
                step.status === 'completed' ? 'bg-emerald-50/30 border-emerald-100' :
                'bg-slate-50 border-slate-200',
              )}
            >
              <div
                className={cn(
                  'h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0',
                  step.status === 'completed' ? 'bg-emerald-100 text-emerald-600' :
                  step.status === 'pending' ? 'bg-amber-100 text-amber-600' :
                  'bg-slate-100 text-slate-500',
                )}
              >
                {step.status === 'completed' ? <Check className="h-3.5 w-3.5" /> :
                 step.status === 'pending' ? <AlertTriangle className="h-3.5 w-3.5" /> :
                 <MinusCircle className="h-3.5 w-3.5" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5 text-slate-500 flex-shrink-0" />
                  <p className="text-sm font-medium text-slate-900 truncate">{step.title}</p>
                  {'locked' in step && (step as any).locked && (
                    <Lock className="h-3 w-3 text-slate-500 flex-shrink-0" />
                  )}
                </div>
                {step.detail && (
                  <p className="text-xs text-slate-600 mt-0.5 leading-snug">{step.detail}</p>
                )}
                {step.last_changed_at && (
                  <p className="text-[10px] text-slate-500 mt-1">
                    Last reviewed {new Date(step.last_changed_at).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })}
                    {step.last_changed_by ? ` by ${step.last_changed_by}` : ''}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Helper action */}
      <div className="mt-4 flex items-center justify-between gap-2 pt-3 border-t border-slate-100">
        <p className="text-xs text-slate-500">
          {pending > 0
            ? `${pending} step(s) still need attention before locking.`
            : 'All reviewable steps are accounted for.'}
        </p>
        <Button variant="ghost" size="sm" disabled title="Coming soon">
          Review all employees
        </Button>
      </div>
    </SurfaceCard>
  );
}
