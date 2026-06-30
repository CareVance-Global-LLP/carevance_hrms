import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Rocket, X, ChevronRight, Sparkles } from 'lucide-react';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface NextStepsCardProps {
  onOpenWizard?: () => void;
}

const STEP_PATHS: Record<string, string> = {
  welcome: '/payroll/setup',
  defaults: '/payroll/setup/defaults',
  employees: '/payroll/setup/employees',
  compliance: '/payroll/setup/compliance',
  statutory: '/payroll/setup/statutory',
  pay_schedule: '/payroll/setup/pay-schedule',
  bank: '/payroll/setup/bank',
  departments: '/payroll/setup/departments',
  test_run: '/payroll/setup/test-run',
};

const ACTION_LABELS: Record<string, { title: string; description: string; cta: string; to: string }> = {
  welcome: { title: 'Welcome — start the setup journey', description: 'A guided tour of all 8 setup steps.', cta: 'Open Setup', to: '/payroll/setup' },
  defaults: { title: 'Configure your payroll defaults', description: 'Set Basic %, HRA %, working days, PT state and compliance toggles.', cta: 'Configure Defaults', to: '/payroll/setup/defaults' },
  employees: { title: 'Add CTCs for your employees', description: 'Set the annual CTC and tax regime for each employee.', cta: 'Add Employees', to: '/payroll/setup/employees' },
  compliance: { title: 'Configure compliance toggles', description: 'PF, ESI, PT, TDS, LWF on/off per organization.', cta: 'Configure Compliance', to: '/payroll/setup/compliance' },
  statutory: { title: 'Enter your statutory details', description: 'TAN, PAN, PF/ESI establishment codes used on filings.', cta: 'Add Statutory Details', to: '/payroll/setup/statutory' },
  pay_schedule: { title: 'Set your pay schedule', description: 'Pay day, frequency, attendance cut-off.', cta: 'Set Pay Schedule', to: '/payroll/setup/pay-schedule' },
  bank: { title: 'Configure bank & payout', description: 'Bank account and NEFT/RTGS file format for salary transfers.', cta: 'Configure Bank', to: '/payroll/setup/bank' },
  departments: { title: 'Department salary templates', description: 'Set default salary structures per department.', cta: 'Configure Departments', to: '/payroll/setup/departments' },
  test_run: { title: 'Run a test calculation', description: 'Verify everything works with a sample payslip before going live.', cta: 'Run Test Calculation', to: '/payroll/setup/test-run' },
  all_done: { title: "You're all set 🎉", description: 'Your payroll is fully configured and running. Explore the rest of the Payroll menu.', cta: 'Explore Payroll', to: '/payroll' },
};

export default function NextStepsCard(_: NextStepsCardProps) {
  const navigate = useNavigate();
  const { status, dismiss, isMutating, isFirstTime } = usePayrollOnboarding();
  const [dismissed, setDismissed] = useState(false);

  if (!status || dismissed) return null;
  if (status.onboarded && status.completion_percentage >= 100) return null;

  // Build checklist from the 9 tracked setup steps
  const stepLabels = status.step_labels ?? {};
  const checklistSteps = Object.keys(STEP_PATHS).map((id) => ({
    id,
    label: stepLabels[id] ?? id,
    done: !!status.steps?.[id],
    to: STEP_PATHS[id],
  }));
  const completedCount = checklistSteps.filter(s => s.done).length;
  const totalCount = checklistSteps.length;

  const next = ACTION_LABELS[status.next_action] || ACTION_LABELS.welcome;
  const isFirstTimeSetup = isFirstTime && completedCount === 0;

  return (
    <SurfaceCard className="p-5 border-l-4 border-l-blue-500 bg-gradient-to-r from-blue-50/60 to-white">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-lg bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
          <Rocket className="h-5 w-5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-base font-semibold text-slate-900 flex items-center gap-2">
              {isFirstTimeSetup ? 'Welcome to Payroll!' : 'Get Started with Payroll'}
              <span className="text-xs font-normal text-slate-500">({completedCount} of {totalCount} steps complete)</span>
            </h3>
            <button
              onClick={() => {
                dismiss();
                setDismissed(true);
              }}
              className="text-slate-400 hover:text-slate-600 transition-colors p-1"
              aria-label="Dismiss for now"
              disabled={isMutating}
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-[#5D969D] to-emerald-500 transition-all"
              style={{ width: `${status.completion_percentage}%` }}
            />
          </div>

          {/* CTA */}
          <div className="mt-4 flex items-center gap-3 flex-wrap">
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Sparkles className="h-4 w-4" />}
              iconRight={<ChevronRight className="h-4 w-4" />}
              onClick={() => navigate('/payroll/setup')}
            >
              {isFirstTimeSetup ? 'Start Setup (9 steps)' : 'Continue Setup'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(next.to)}
            >
              Skip — {next.cta}
            </Button>
          </div>
          <p className="text-xs text-slate-500 mt-2">{next.description}</p>
        </div>
      </div>
    </SurfaceCard>
  );
}
