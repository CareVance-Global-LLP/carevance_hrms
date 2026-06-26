import { ReactNode, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  Rocket,
  Building2,
  Users,
  ClipboardCheck,
  ScrollText,
  Calendar,
  Landmark,
  Calculator,
  CheckCircle2,
  ArrowRight,
  X,
  Sparkles,
  ChevronRight,
} from 'lucide-react';
import { usePayrollOnboarding, SetupStepId } from '@/hooks/usePayrollOnboarding';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';

interface SetupLayoutProps {
  children: ReactNode;
  currentStep: SetupStepId;
}

interface StepConfig {
  id: SetupStepId;
  label: string;
  description: string;
  path: string;
  icon: any;
}

export const SETUP_STEPS: StepConfig[] = [
  { id: 'welcome', label: 'Welcome', description: 'Overview of the setup journey', path: '/payroll/setup', icon: Rocket },
  { id: 'defaults', label: 'Organization Defaults', description: 'Basic %, HRA, working days, PT state', path: '/payroll/setup/defaults', icon: Building2 },
  { id: 'employees', label: 'Employees & CTC', description: 'Add employees and assign their CTC', path: '/payroll/setup/employees', icon: Users },
  { id: 'compliance', label: 'Compliance Toggles', description: 'PF, ESI, PT, TDS, LWF configuration', path: '/payroll/setup/compliance', icon: ClipboardCheck },
  { id: 'statutory', label: 'Statutory Details', description: 'TAN, PAN, establishment codes', path: '/payroll/setup/statutory', icon: ScrollText },
  { id: 'pay_schedule', label: 'Pay Schedule', description: 'Pay day, frequency, cut-off dates', path: '/payroll/setup/pay-schedule', icon: Calendar },
  { id: 'bank', label: 'Bank & Payout', description: 'Bank account, NEFT/RTGS setup', path: '/payroll/setup/bank', icon: Landmark },
  { id: 'test_run', label: 'Test Run', description: 'Dry run before going live', path: '/payroll/setup/test-run', icon: Calculator },
];

export default function SetupLayout({ children, currentStep }: SetupLayoutProps) {
  const navigate = useNavigate();
  const { status, isLoading, markWelcomeSeen } = usePayrollOnboarding();

  useEffect(() => {
    if (currentStep === 'welcome' && status && !status.onboarded && status.next_action === 'welcome') {
      markWelcomeSeen().catch(() => {});
    }
  }, [currentStep, status, markWelcomeSeen]);

  const completedCount = status?.completed_count ?? 0;
  const totalCount = status?.total_count ?? 9;
  const percentage = status?.completion_percentage ?? 0;
  const stepStatuses = status?.steps ?? {};

  const currentIndex = SETUP_STEPS.findIndex(s => s.id === currentStep);
  const prevStep = currentIndex > 0 ? SETUP_STEPS[currentIndex - 1] : null;
  const nextStep = currentIndex < SETUP_STEPS.length - 1 ? SETUP_STEPS[currentIndex + 1] : null;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-blue-600" />
              Payroll Setup
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              {completedCount} of {totalCount} steps complete
              {percentage > 0 && ` (${percentage}%)`}
            </p>
          </div>
          <button
            onClick={() => navigate('/payroll')}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">Exit Setup</span>
          </button>
        </div>
        <div className="max-w-7xl mx-auto px-6 pb-3">
          <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-emerald-500 transition-all"
              style={{ width: `${percentage}%` }}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 flex flex-col lg:flex-row gap-6">
        <aside className="lg:w-72 flex-shrink-0">
          <SurfaceCard className="p-3 sticky top-28">
            <nav>
              <ul className="space-y-1">
                {SETUP_STEPS.map((step, idx) => {
                  const isDone = !!stepStatuses[step.id];
                  const isCurrent = step.id === currentStep;
                  const Icon = step.icon;
                  return (
                    <li key={step.id}>
                      <NavLink
                        to={step.path}
                        end={step.path === '/payroll/setup'}
                        className={({ isActive }) =>
                          cn(
                            'w-full text-left px-3 py-2.5 rounded-lg flex items-start gap-3 transition-colors group border',
                            isActive || isCurrent
                              ? 'bg-blue-50 border-blue-200'
                              : 'hover:bg-slate-50 border-transparent',
                          )
                        }
                      >
                        {({ isActive }) => (
                          <>
                            <div
                              className={cn(
                                'h-7 w-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-semibold',
                                isDone
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : isActive || isCurrent
                                    ? 'bg-blue-600 text-white'
                                    : 'bg-slate-100 text-slate-400',
                              )}
                            >
                              {isDone ? <CheckCircle2 className="h-4 w-4" /> : idx + 1}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p
                                className={cn(
                                  'text-sm font-medium truncate',
                                  isActive || isCurrent ? 'text-blue-900' : isDone ? 'text-slate-700' : 'text-slate-500',
                                )}
                              >
                                {step.label}
                              </p>
                              <p className="text-xs text-slate-400 truncate">{step.description}</p>
                            </div>
                            {(isActive || isCurrent) && (
                              <ChevronRight className="h-4 w-4 text-blue-600 flex-shrink-0 mt-1" />
                            )}
                          </>
                        )}
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </SurfaceCard>
        </aside>

        <main className="flex-1 min-w-0">
          {isLoading ? (
            <SurfaceCard className="p-8 flex items-center justify-center">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600" />
            </SurfaceCard>
          ) : (
            <>{children}</>
          )}

          <div className="mt-6 flex items-center justify-between">
            {prevStep ? (
              <button
                onClick={() => navigate(prevStep.path)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ArrowRight className="h-4 w-4 rotate-180" />
                Previous: {prevStep.label}
              </button>
            ) : (
              <div />
            )}
            {nextStep ? (
              <button
                onClick={() => navigate(nextStep.path)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 hover:text-blue-900 hover:bg-blue-50 rounded-lg transition-colors"
              >
                Next: {nextStep.label}
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : (
              <button
                onClick={() => navigate('/payroll')}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-emerald-700 hover:text-emerald-900 hover:bg-emerald-50 rounded-lg transition-colors"
              >
                Finish Setup
                <CheckCircle2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

export function StepHeader({
  title,
  description,
  stepNumber,
  totalSteps = 9,
  isComplete,
}: {
  title: string;
  description: string;
  stepNumber: number;
  totalSteps?: number;
  isComplete?: boolean;
}) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">
          Step {stepNumber} of {totalSteps}
        </span>
        {isComplete && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="h-3 w-3" /> Completed
          </span>
        )}
      </div>
      <h2 className="text-2xl font-bold text-slate-900">{title}</h2>
      <p className="text-sm text-slate-500 mt-1">{description}</p>
    </div>
  );
}