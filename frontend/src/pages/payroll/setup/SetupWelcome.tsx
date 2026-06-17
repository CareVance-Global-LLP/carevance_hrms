import { useNavigate } from 'react-router-dom';
import { Building2, Users, ClipboardCheck, ScrollText, Calendar, Landmark, Calculator, Sparkles, Clock, CheckCircle2, ArrowRight, Users as UsersIcon } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';
import Button from '@/components/ui/Button';

const PREVIEW_STEPS = [
  { icon: Building2, label: 'Organization Defaults', desc: 'Set Basic %, HRA %, working days, PT state' },
  { icon: Users, label: 'Department Templates', desc: 'Default salary structure per department' },
  { icon: UsersIcon, label: 'Employees & CTC', desc: 'Add employees and assign their annual CTC' },
  { icon: ClipboardCheck, label: 'Compliance Toggles', desc: 'Configure PF, ESI, PT, TDS, LWF' },
  { icon: ScrollText, label: 'Statutory Details', desc: 'Set TAN, PAN, establishment codes' },
  { icon: Calendar, label: 'Pay Schedule', desc: 'Pay day, frequency, cut-off dates' },
  { icon: Landmark, label: 'Bank & Payout', desc: 'Bank account, NEFT/RTGS file format' },
  { icon: Calculator, label: 'Test Run', desc: 'Dry run with one employee to validate' },
];

export default function SetupWelcome() {
  const navigate = useNavigate();
  const { status } = usePayrollOnboarding();
  const completedCount = status?.completed_count ?? 0;

  return (
    <SetupLayout currentStep="welcome">
      <StepHeader
        stepNumber={1}
        title="Welcome to Payroll Setup"
        description="Let's set up your payroll step by step. You can pause and come back anytime."
      />

      <SurfaceCard className="p-8 mb-6 bg-gradient-to-br from-blue-50 to-white border-blue-200">
        <div className="flex items-start gap-4">
          <div className="h-14 w-14 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center flex-shrink-0">
            <Sparkles className="h-7 w-7" />
          </div>
          <div className="flex-1">
            <h3 className="text-xl font-bold text-slate-900">Set up payroll in 9 simple steps</h3>
            <p className="text-sm text-slate-600 mt-1">
              We'll guide you through setting up defaults, departments, employees, compliance, and a test run.
              Each step is independent — you can skip around and come back later.
            </p>
            <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" /> ~15 minutes total
              </span>
              <span className="flex items-center gap-1">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" /> {completedCount}/9 complete
              </span>
            </div>
          </div>
        </div>
      </SurfaceCard>

      <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">
        What we'll set up
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {PREVIEW_STEPS.map((s, idx) => {
          const Icon = s.icon;
          return (
            <SurfaceCard key={s.label} className="p-3 flex items-center gap-3 hover:border-blue-300 transition-colors">
              <div className="h-9 w-9 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center flex-shrink-0">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-900 truncate">
                  <span className="text-slate-400 mr-1.5">{idx + 2}.</span>
                  {s.label}
                </p>
                <p className="text-xs text-slate-500 truncate">{s.desc}</p>
              </div>
            </SurfaceCard>
          );
        })}
      </div>

      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between bg-white p-4 rounded-lg border border-slate-200">
        <p className="text-sm text-slate-600">
          Ready to begin? Start with organization defaults, or jump to any step from the sidebar.
        </p>
        <Button
          variant="primary"
          onClick={() => navigate('/payroll/setup/defaults')}
          iconRight={<ArrowRight className="h-4 w-4" />}
        >
          Start Setup
        </Button>
      </div>
    </SetupLayout>
  );
}