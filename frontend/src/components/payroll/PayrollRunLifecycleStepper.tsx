import { Check, Lock, ShieldCheck, Send, Wallet, FileCheck } from 'lucide-react';
import { cn } from '@/utils/cn';

export type RunLifecycleState = 'draft' | 'locked' | 'approved' | 'released' | 'disbursed';

interface PayrollRunLifecycleStepperProps {
  currentState: RunLifecycleState;
  className?: string;
}

const STEPS: Array<{ state: RunLifecycleState; label: string; description: string; icon: any }> = [
  { state: 'draft', label: 'Draft', description: 'Calculated, not finalized', icon: FileCheck },
  { state: 'locked', label: 'Locked', description: 'Finalized, no more edits', icon: Lock },
  { state: 'approved', label: 'Approved', description: 'Manager sign-off', icon: ShieldCheck },
  { state: 'released', label: 'Released', description: 'Bank file generated', icon: Send },
  { state: 'disbursed', label: 'Disbursed', description: 'Funds credited to employees', icon: Wallet },
];

const stateOrder: Record<RunLifecycleState, number> = {
  draft: 0,
  locked: 1,
  approved: 2,
  released: 3,
  disbursed: 4,
};

/**
 * Horizontal lifecycle stepper for payroll runs.
 * Shows current state and what happens at each stage.
 */
export default function PayrollRunLifecycleStepper({
  currentState,
  className,
}: PayrollRunLifecycleStepperProps) {
  const currentIdx = stateOrder[currentState] ?? 0;

  return (
    <div className={cn('w-full', className)}>
      <div className="flex items-start justify-between gap-2">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isCompleted = idx < currentIdx;
          const isCurrent = idx === currentIdx;
          const isFuture = idx > currentIdx;

          return (
            <div key={step.state} className="flex-1 min-w-0 flex flex-col items-center text-center">
              <div className="flex items-center w-full">
                {idx > 0 && (
                  <div
                    className={cn(
                      'flex-1 h-0.5 -mx-1',
                      isCompleted || isCurrent ? 'bg-blue-500' : 'bg-slate-200',
                    )}
                  />
                )}
                <div
                  className={cn(
                    'h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 border-2 transition-colors',
                    isCompleted && 'bg-blue-500 border-blue-500 text-white',
                    isCurrent && 'bg-white border-blue-500 text-blue-600 ring-4 ring-blue-100',
                    isFuture && 'bg-slate-50 border-slate-200 text-slate-400',
                  )}
                  aria-current={isCurrent ? 'step' : undefined}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                {idx < STEPS.length - 1 && (
                  <div
                    className={cn(
                      'flex-1 h-0.5 -mx-1',
                      idx < currentIdx ? 'bg-blue-500' : 'bg-slate-200',
                    )}
                  />
                )}
              </div>
              <div className="mt-2 px-1">
                <p
                  className={cn(
                    'text-xs font-semibold',
                    isCurrent ? 'text-blue-700' : isCompleted ? 'text-slate-900' : 'text-slate-400',
                  )}
                >
                  {step.label}
                </p>
                <p
                  className={cn(
                    'text-[10px] leading-tight mt-0.5',
                    isCurrent || isCompleted ? 'text-slate-600' : 'text-slate-400',
                  )}
                >
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
