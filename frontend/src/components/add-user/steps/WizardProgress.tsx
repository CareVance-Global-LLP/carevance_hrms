import { Check } from 'lucide-react';

interface StepIndicatorProps {
  step: number;
  label: string;
  status: 'completed' | 'current' | 'future';
}

export function StepIndicator({ step, label, status }: StepIndicatorProps) {
  const styles = {
    completed: 'bg-emerald-500 text-white',
    current: 'bg-blue-500 text-white ring-4 ring-blue-100',
    future: 'bg-slate-200 text-slate-500',
  };

  return (
    <div className="flex items-center gap-2">
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${styles[status]}`}
      >
        {status === 'completed' ? <Check className="h-4 w-4" /> : step}
      </div>
      <span
        className={`text-sm hidden sm:inline ${
          status === 'current' ? 'font-semibold text-slate-900' : 'text-slate-500'
        }`}
      >
        {label}
      </span>
    </div>
  );
}

interface WizardProgressProps {
  currentStep: number;
  completedSteps: Set<number>;
}

export function WizardProgress({ currentStep, completedSteps }: WizardProgressProps) {
  const steps = [
    { num: 1, label: 'Basic Info' },
    { num: 2, label: 'Account' },
    { num: 3, label: 'Profile' },
  ];

  const getStepStatus = (stepNum: number): 'completed' | 'current' | 'future' => {
    if (completedSteps.has(stepNum) && stepNum < (typeof currentStep === 'number' ? currentStep : 4)) return 'completed';
    if (stepNum === currentStep) return 'current';
    return 'future';
  };

  return (
    <div className="flex items-center justify-center gap-1 sm:gap-3 px-6 py-4 border-b border-gray-100 bg-gray-50/50">
      {steps.map((step, idx) => (
        <div key={step.num} className="flex items-center gap-1 sm:gap-3">
          <StepIndicator step={step.num} label={step.label} status={getStepStatus(step.num)} />
          {idx < steps.length - 1 && (
            <div
              className={`w-8 sm:w-16 h-0.5 rounded-full transition-colors ${
                completedSteps.has(step.num) ? 'bg-emerald-400' : 'bg-slate-200'
              }`}
            />
          )}
        </div>
      ))}
    </div>
  );
}
