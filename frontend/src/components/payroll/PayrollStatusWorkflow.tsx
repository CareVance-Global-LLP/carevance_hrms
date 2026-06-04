import { 
  FileText, 
  Calculator, 
  Eye, 
  CheckCircle, 
  Send, 
  DollarSign,
  ChevronRight,
  Play
} from 'lucide-react';
import Button from '@/components/ui/Button';

interface WorkflowStep {
  id: string;
  label: string;
  status: 'completed' | 'current' | 'pending';
}

interface PayrollStatusWorkflowProps {
  workflowStatus: {
    current_step: string;
    status: string;
    steps: WorkflowStep[];
    progress_percentage: number;
    can_process: boolean;
    can_approve: boolean;
    can_release: boolean;
    can_pay: boolean;
  } | null;
  onProcess: () => void;
  onApprove: () => void;
  onRelease: () => void;
  onPay: () => void;
  loading?: boolean;
}

const stepIcons: Record<string, React.ReactNode> = {
  input: <FileText className="h-4 w-4" />,
  process: <Calculator className="h-4 w-4" />,
  review: <Eye className="h-4 w-4" />,
  approve: <CheckCircle className="h-4 w-4" />,
  release: <Send className="h-4 w-4" />,
  pay: <DollarSign className="h-4 w-4" />,
};

const stepDescriptions: Record<string, string> = {
  input: 'Employee data and attendance inputs',
  process: 'Calculate salaries and deductions',
  review: 'Review payroll before approval',
  approve: 'Get necessary approvals',
  release: 'Release for payment processing',
  pay: 'Process salary payments',
};

export default function PayrollStatusWorkflow({
  workflowStatus,
  onProcess,
  onApprove,
  onRelease,
  onPay,
  loading = false
}: PayrollStatusWorkflowProps) {
  if (loading || !workflowStatus) {
    return (
      <div className="bg-white rounded-xl p-6 border border-slate-200 animate-pulse">
        <div className="h-32 bg-slate-200 rounded-lg"></div>
      </div>
    );
  }

  const { steps, progress_percentage, current_step } = workflowStatus;

  const getCurrentStepIndex = () => {
    return steps.findIndex(step => step.status === 'current');
  };

  const currentStepIndex = getCurrentStepIndex();

  // Determine primary action based on current status
  const getPrimaryAction = () => {
    if (workflowStatus.can_process) {
      return { label: 'Process Payroll', action: onProcess, icon: <Play className="h-4 w-4" /> };
    }
    if (workflowStatus.can_approve) {
      return { label: 'Approve Payroll', action: onApprove, icon: <CheckCircle className="h-4 w-4" /> };
    }
    if (workflowStatus.can_release) {
      return { label: 'Release for Payment', action: onRelease, icon: <Send className="h-4 w-4" /> };
    }
    if (workflowStatus.can_pay) {
      return { label: 'Process Payments', action: onPay, icon: <DollarSign className="h-4 w-4" /> };
    }
    return null;
  };

  const primaryAction = getPrimaryAction();

  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Payroll Workflow</h3>
          <p className="text-sm text-slate-500 mt-1">
            {progress_percentage === 100 ? (
              <span className="text-emerald-600 font-medium">All steps completed ✓</span>
            ) : (
              `${progress_percentage}% complete - Currently at ${steps[currentStepIndex]?.label || 'Input'}`
            )}
          </p>
        </div>
        
        {primaryAction && (
          <Button 
            variant="primary" 
            size="sm"
            onClick={primaryAction.action}
            iconLeft={primaryAction.icon}
          >
            {primaryAction.label}
          </Button>
        )}
      </div>

      {/* Progress Bar */}
      <div className="mb-8">
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div 
            className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${progress_percentage}%` }}
          />
        </div>
      </div>

      {/* Workflow Steps */}
      <div className="grid grid-cols-6 gap-2">
        {steps.map((step, index) => {
          const isCompleted = step.status === 'completed';
          const isCurrent = step.status === 'current';
          const isPending = step.status === 'pending';

          return (
            <div key={step.id} className="relative">
              {/* Connector Line */}
              {index < steps.length - 1 && (
                <div 
                  className={`absolute top-5 left-[60%] right-[-40%] h-0.5 ${
                    isCompleted ? 'bg-emerald-500' : 'bg-slate-200'
                  }`}
                />
              )}

              {/* Step */}
              <div className="flex flex-col items-center">
                {/* Icon Circle */}
                <div 
                  className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 transition-colors ${
                    isCompleted 
                      ? 'bg-emerald-500 text-white' 
                      : isCurrent 
                        ? 'bg-blue-500 text-white ring-4 ring-blue-100' 
                        : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isCompleted ? (
                    <CheckCircle className="h-5 w-5" />
                  ) : (
                    stepIcons[step.id]
                  )}
                </div>

                {/* Label */}
                <span 
                  className={`text-xs font-medium text-center ${
                    isCompleted || isCurrent ? 'text-slate-900' : 'text-slate-400'
                  }`}
                >
                  {step.label}
                </span>

                {/* Description */}
                <span className="text-[10px] text-slate-400 text-center mt-1 px-1">
                  {stepDescriptions[step.id]}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Current Step Details */}
      {currentStepIndex >= 0 && (
        <div className="mt-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              {stepIcons[steps[currentStepIndex].id]}
            </div>
            <div className="flex-1">
              <h4 className="font-medium text-slate-900">
                Current: {steps[currentStepIndex].label}
              </h4>
              <p className="text-sm text-slate-500 mt-1">
                {stepDescriptions[steps[currentStepIndex].id]}
              </p>
              
              {/* Action hint */}
              {primaryAction && (
                <p className="text-sm text-blue-600 mt-2">
                  Click &quot;{primaryAction.label}&quot; to proceed to the next step
                </p>
              )}
            </div>
            <ChevronRight className="h-5 w-5 text-slate-400" />
          </div>
        </div>
      )}
    </div>
  );
}
