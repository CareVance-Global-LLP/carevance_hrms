import { Check, Lock, ShieldCheck, Send, Wallet, FileCheck, Cog } from 'lucide-react';
import { cn } from '@/utils/cn';

export type RunLifecycleState = 'draft' | 'processing' | 'locked' | 'approved' | 'released' | 'disbursed';

interface PayrollRunLifecycleStepperProps {
  currentState: RunLifecycleState;
  completedAt?: Partial<Record<RunLifecycleState, string>>;
  className?: string;
}

const STEPS: Array<{ state: RunLifecycleState; label: string; icon: any }> = [
  { state: 'draft', label: 'Draft', icon: FileCheck },
  { state: 'processing', label: 'Processing', icon: Cog },
  { state: 'locked', label: 'Locked', icon: Lock },
  { state: 'approved', label: 'Approved', icon: ShieldCheck },
  { state: 'released', label: 'Released', icon: Send },
  { state: 'disbursed', label: 'Disbursed', icon: Wallet },
];

const stateOrder: Record<RunLifecycleState, number> = {
  draft: 0,
  processing: 1,
  locked: 2,
  approved: 3,
  released: 4,
  disbursed: 5,
};

function formatTimestamp(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Vertical lifecycle timeline for payroll runs.
 *
 * Designed to live in the modal's left sidebar. Each step shows:
 *   - icon + label
 *   - timestamp (if completed)
 *   - pulsing dot for the current step
 */
export default function PayrollRunLifecycleStepper({
  currentState,
  completedAt,
  className,
}: PayrollRunLifecycleStepperProps) {
  const currentIdx = stateOrder[currentState] ?? 0;

  return (
    <div className={cn('w-full', className)}>
      <ol className="space-y-0">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;
          const ts = completedAt?.[step.state];

          return (
            <li key={step.state} className="relative flex gap-3 pb-5 last:pb-0">
              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={cn(
                    'absolute left-[15px] top-8 bottom-0 w-0.5',
                    isCompleted ? 'bg-emerald-300' : 'bg-slate-200',
                  )}
                />
              )}

              {/* Icon circle */}
              <div className="relative flex-shrink-0">
                <div
                  className={cn(
                    'h-8 w-8 rounded-full flex items-center justify-center border-2 transition-colors',
                    isCompleted && 'bg-emerald-500 border-emerald-500 text-white',
                    isCurrent && 'bg-white border-blue-500 text-blue-600',
                    isFuture && 'bg-slate-50 border-slate-200 text-slate-400',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isCompleted ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                </div>
                {isCurrent && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-full ring-4 ring-blue-100 animate-ping"
                  />
                )}
              </div>

              {/* Label + metadata */}
              <div className="flex-1 min-w-0 pt-1">
                <p
                  className={cn(
                    'text-sm font-semibold leading-tight',
                    isCurrent
                      ? 'text-blue-700'
                      : isCompleted
                        ? 'text-slate-900'
                        : 'text-slate-400',
                  )}
                >
                  {step.label}
                  {isCurrent && (
                    <span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-blue-600">
                      Current
                    </span>
                  )}
                </p>
                {ts ? (
                  <p className="text-[11px] text-slate-500 mt-0.5">{formatTimestamp(ts)}</p>
                ) : isFuture ? (
                  <p className="text-[11px] text-slate-400 mt-0.5">Pending</p>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
