import { useState } from 'react';
import {
  CalendarDays, UserPlus, Gift, CreditCard, PauseCircle, CheckCircle2,
  ArrowLeft, ArrowRight, Loader2, Users, DollarSign, AlertTriangle,
  CheckCircle, XCircle, Clock, Building2, TrendingUp, Wallet,
  FileText, Landmark, Zap, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

const STEPS = [
  { key: 'attendance', label: 'Leaves & Attendance', icon: CalendarDays, color: 'blue' },
  { key: 'joiners', label: 'New Joiners & Exits', icon: UserPlus, color: 'emerald' },
  { key: 'revisions', label: 'Bonus, Revisions & OT', icon: Gift, color: 'violet' },
  { key: 'payments', label: 'One-time Payments & Deductions', icon: CreditCard, color: 'amber' },
  { key: 'holds', label: 'Salary on Hold & Arrears', icon: PauseCircle, color: 'rose' },
  { key: 'review', label: 'Review & Finalize', icon: CheckCircle2, color: 'blue' },
] as const;

type StepKey = typeof STEPS[number]['key'];

interface PayrollWizardProps {
  monthYear: string;
  onComplete: () => void;
  onBack: () => void;
}

function StepIndicator({ currentStep }: { currentStep: StepKey }) {
  const currentIdx = STEPS.findIndex(s => s.key === currentStep);
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-2">
      {STEPS.map((step, i) => {
        const isDone = i < currentIdx;
        const isActive = i === currentIdx;
        return (
          <div key={step.key} className="flex items-center gap-1 flex-shrink-0">
            {i > 0 && (
              <div className={`h-0.5 w-4 ${isDone ? 'bg-blue-500' : 'bg-slate-200'}`} />
            )}
            <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
              isDone ? 'bg-emerald-50 text-emerald-700' :
              isActive ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' :
              'bg-slate-50 text-slate-400'
            }`}>
              {isDone ? <CheckCircle2 className="h-3.5 w-3.5" /> : <step.icon className="h-3.5 w-3.5" />}
              {step.label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function PayrollWizard({ monthYear, onComplete, onBack }: PayrollWizardProps) {
  const [step, setStep] = useState<StepKey>('attendance');
  const [processing, setProcessing] = useState(false);

  const { data: deptData } = useQuery({
    queryKey: ['wizard-depts', monthYear],
    queryFn: () => payrollApi.getDepartments({ month_year: monthYear }).then(r => r.data),
  });

  const { data: changesData } = useQuery({
    queryKey: ['wizard-changes', monthYear],
    queryFn: () => payrollApi.detectPayrollChanges(monthYear).then(r => r.data),
  });

  const departments = deptData?.departments || [];
  const changes = changesData?.changes || {};

  const currentIdx = STEPS.findIndex(s => s.key === step);
  const isLastStep = step === 'review';
  const isFirstStep = step === 'attendance';

  const goNext = () => {
    if (currentIdx < STEPS.length - 1) {
      setStep(STEPS[currentIdx + 1].key);
    }
  };

  const goPrev = () => {
    if (currentIdx > 0) {
      setStep(STEPS[currentIdx - 1].key);
    }
  };

  const runMutation = useMutation({
    mutationFn: () => payrollApi.quickProcessPayroll(monthYear).then(r => r.data),
    onSuccess: () => {
      setProcessing(false);
      onComplete();
    },
    onError: () => setProcessing(false),
  });

  const handleFinalize = () => {
    setProcessing(true);
    runMutation.mutate();
  };

  const totalEmployees = departments.reduce((s: number, d: any) => s + d.employee_count, 0) + (deptData?.unassigned_count || 0);
  const processedCount = departments.reduce((s: number, d: any) => s + d.processed_count, 0);
  const pendingCount = totalEmployees - processedCount;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Payroll {monthYear}</h2>
            <p className="text-sm text-slate-500">Step {currentIdx + 1} of {STEPS.length}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isFirstStep && (
            <Button variant="ghost" onClick={goPrev} iconLeft={<ArrowLeft className="h-4 w-4" />}>
              Previous
            </Button>
          )}
          {isLastStep ? (
            <Button onClick={handleFinalize} disabled={processing} iconLeft={processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}>
              {processing ? 'Processing...' : 'Finalize & Lock Payroll'}
            </Button>
          ) : (
            <Button onClick={goNext} iconRight={<ArrowRight className="h-4 w-4" />}>
              Next
            </Button>
          )}
        </div>
      </div>

      {/* Steps */}
      <StepIndicator currentStep={step} />

      {/* Step content */}
      <div className="min-h-[300px]">
        {step === 'attendance' && <AttendanceStep monthYear={monthYear} departments={departments} />}
        {step === 'joiners' && <JoinersStep changes={changes} />}
        {step === 'revisions' && <RevisionsStep changes={changes} monthYear={monthYear} />}
        {step === 'payments' && <PaymentsStep />}
        {step === 'holds' && <HoldsStep />}
        {step === 'review' && (
          <ReviewStep
            monthYear={monthYear}
            departments={departments}
            totalEmployees={totalEmployees}
            processedCount={processedCount}
            pendingCount={pendingCount}
          />
        )}
      </div>
    </div>
  );
}

/* ===== Step 1: Leaves & Attendance ===== */
function AttendanceStep({ monthYear, departments }: { monthYear: string; departments: any[] }) {
  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <CalendarDays className="h-6 w-6 text-blue-600" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">Leaves & Attendance</h3>
          <p className="text-sm text-slate-500">Auto-synced for {monthYear}. Verify before proceeding.</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        {[
          { label: 'Working Days', value: '26', color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Employees Tracked', value: departments.reduce((s: number, d: any) => s + d.employee_count, 0), color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Attendance Synced', value: 'Auto', color: 'text-violet-600', bg: 'bg-violet-50' },
        ].map((item, i) => (
          <div key={i} className={`${item.bg} rounded-lg p-4 text-center`}>
            <p className={`text-2xl font-bold ${item.color}`}>{item.value}</p>
            <p className="text-xs text-slate-600 mt-1">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="bg-slate-50 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5" />
          <p className="text-sm text-slate-600">Attendance records auto-synced from time tracking module. LOP and absences will be reflected in salary calculation.</p>
        </div>
        <div className="flex items-start gap-2 mt-2">
          <CheckCircle className="h-4 w-4 text-emerald-500 mt-0.5" />
          <p className="text-sm text-slate-600">Leave encashments approved this month will be automatically included.</p>
        </div>
      </div>
    </SurfaceCard>
  );
}

/* ===== Step 2: New Joiners & Exits ===== */
function JoinersStep({ changes }: { changes: Record<string, any> }) {
  const hasNew = changes.new_joiners?.length > 0;
  const hasExits = changes.exits?.length > 0;
  const hasChanges = hasNew || hasExits;

  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <UserPlus className="h-6 w-6 text-emerald-600" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">New Joiners & Exits</h3>
          <p className="text-sm text-slate-500">Changes detected since last payroll run</p>
        </div>
      </div>
      {!hasChanges && (
        <div className="bg-emerald-50 rounded-lg p-6 text-center">
          <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
          <p className="text-sm font-medium text-emerald-800">No changes detected</p>
          <p className="text-xs text-emerald-600 mt-1">Employee roster is stable compared to last month</p>
        </div>
      )}
      {hasChanges && (
        <div className="space-y-3">
          {hasNew && (
            <div className="bg-blue-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-blue-800 mb-2">{changes.new_joiners.length} New Joiner(s)</h4>
              <div className="space-y-1">
                {changes.new_joiners.map((name: string, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm text-blue-700">
                    <span>{name}</span>
                    <span className="text-xs bg-blue-100 px-2 py-0.5 rounded">Process</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          {hasExits && (
            <div className="bg-rose-50 rounded-lg p-4">
              <h4 className="text-sm font-medium text-rose-800 mb-2">{changes.exits.length} Exit(s)</h4>
              <div className="space-y-1">
                {changes.exits.map((name: string, i: number) => (
                  <div key={i} className="flex items-center justify-between text-sm text-rose-700">
                    <span>{name}</span>
                    <span className="text-xs bg-rose-100 px-2 py-0.5 rounded">Excluded</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </SurfaceCard>
  );
}

/* ===== Step 3: Bonus, Revisions & OT ===== */
function RevisionsStep({ changes, monthYear }: { changes: Record<string, any>; monthYear: string }) {
  const revisions = changes.ctc_revisions || [];
  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <Gift className="h-6 w-6 text-violet-600" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">Bonus, Revisions & Overtime</h3>
          <p className="text-sm text-slate-500">Salary revisions, variable pay, and overtime</p>
        </div>
      </div>
      {revisions.length === 0 && (
        <div className="bg-slate-50 rounded-lg p-6 text-center">
          <TrendingUp className="h-8 w-8 text-slate-300 mx-auto mb-2" />
          <p className="text-sm text-slate-500">No CTC revisions or bonuses this month</p>
        </div>
      )}
      {revisions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-slate-800">{revisions.length} CTC Revision(s)</h4>
          {revisions.map((r: any, i: number) => (
            <div key={i} className="flex items-center justify-between bg-violet-50 rounded-lg p-3">
              <span className="text-sm font-medium text-violet-800">{r.name}</span>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-slate-500">₹{r.old_ctc?.toLocaleString('en-IN')}</span>
                <ArrowRight className="h-3 w-3 text-slate-400" />
                <span className="text-emerald-600 font-medium">₹{r.new_ctc?.toLocaleString('en-IN')}</span>
                <span className={`px-1.5 py-0.5 rounded ${r.change_pct > 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {r.change_pct > 0 ? '+' : ''}{r.change_pct}%
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-4 bg-slate-50 rounded-lg p-4">
        <p className="text-sm text-slate-600">Variable pay and overtime rules will be applied automatically based on active assignments.</p>
      </div>
    </SurfaceCard>
  );
}

/* ===== Step 4: One-time Payments & Deductions ===== */
function PaymentsStep() {
  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <CreditCard className="h-6 w-6 text-amber-600" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">One-time Payments & Deductions</h3>
          <p className="text-sm text-slate-500">Reimbursements, adhoc payments, deductions</p>
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {[
          { label: 'Approved Reimbursements', value: 'Auto-sync', icon: Wallet, color: 'emerald' },
          { label: 'FBP Claims', value: 'Auto-sync', icon: DollarSign, color: 'blue' },
          { label: 'Loan EMIs', value: 'Auto-deduct', icon: Landmark, color: 'violet' },
          { label: 'Arrears', value: 'Auto-calc', icon: FileText, color: 'amber' },
        ].map((item, i) => (
          <div key={i} className={`bg-${item.color}-50 rounded-lg p-4 flex items-center gap-3`}>
            <item.icon className={`h-5 w-5 text-${item.color}-600`} />
            <div>
              <p className="text-sm font-medium text-slate-900">{item.label}</p>
              <p className="text-xs text-slate-500">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 bg-slate-50 rounded-lg p-4">
        <p className="text-sm text-slate-600">All approved one-time payments and deductions will sync automatically when payroll is processed.</p>
      </div>
    </SurfaceCard>
  );
}

/* ===== Step 5: Salary on Hold & Arrears ===== */
function HoldsStep() {
  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <PauseCircle className="h-6 w-6 text-rose-600" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">Salary on Hold & Arrears</h3>
          <p className="text-sm text-slate-500">Employees with stopped payments or pending arrears</p>
        </div>
      </div>
      <div className="bg-slate-50 rounded-lg p-6 text-center">
        <CheckCircle2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No employees on hold</p>
        <p className="text-xs text-slate-400 mt-1">Employees with active stop payment flags will be excluded from processing</p>
      </div>
      <div className="mt-4 bg-amber-50 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
          <p className="text-sm text-amber-700">Hold status means the employee will not appear in pay register and no statutory deductions will apply.</p>
        </div>
      </div>
    </SurfaceCard>
  );
}

/* ===== Step 6: Review & Finalize ===== */
function ReviewStep({
  monthYear, departments, totalEmployees, processedCount, pendingCount,
}: {
  monthYear: string; departments: any[]; totalEmployees: number; processedCount: number; pendingCount: number;
}) {
  const totalGross = departments.reduce((s: number, d: any) => s + d.total_gross, 0);
  const totalDed = departments.reduce((s: number, d: any) => s + d.total_deductions, 0);
  const totalNet = departments.reduce((s: number, d: any) => s + d.total_net_pay, 0);

  return (
    <SurfaceCard className="p-6">
      <div className="flex items-center gap-3 mb-4">
        <CheckCircle2 className="h-6 w-6 text-blue-600" />
        <div>
          <h3 className="text-base font-semibold text-slate-900">Review & Finalize</h3>
          <p className="text-sm text-slate-500">Preview payroll summary before locking</p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: 'Total Gross', value: totalGross, color: 'text-blue-600' },
          { label: 'Total Deductions', value: totalDed, color: 'text-rose-600' },
          { label: 'Net Payable', value: totalNet, color: 'text-emerald-600' },
          { label: 'Employees', value: totalEmployees, color: 'text-violet-600' },
        ].map((item, i) => (
          <div key={i} className="bg-slate-50 rounded-lg p-4 text-center">
            <p className={`text-xl font-bold ${item.color}`}>
              {typeof item.value === 'number' && item.label !== 'Employees'
                ? '₹' + item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })
                : item.value}
            </p>
            <p className="text-xs text-slate-500 mt-1">{item.label}</p>
          </div>
        ))}
      </div>

      <div className="space-y-2 mb-4">
        <h4 className="text-sm font-medium text-slate-800">Statutory Summary</h4>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { label: 'PF (Employee)', value: departments.reduce((s: number, d: any) => s + (d.total_pf_employee || 0), 0) },
            { label: 'PF (Employer)', value: departments.reduce((s: number, d: any) => s + (d.total_pf_employer || 0), 0) },
            { label: 'ESI', value: departments.reduce((s: number, d: any) => s + (d.total_esi_employee || 0), 0) },
            { label: 'TDS', value: departments.reduce((s: number, d: any) => s + (d.total_tds || 0), 0) },
            { label: 'PT', value: departments.reduce((s: number, d: any) => s + (d.total_pt || 0), 0) },
            { label: 'Employer Contributions', value: departments.reduce((s: number, d: any) => s + (d.total_employer_contributions || 0), 0) },
          ].map((item, i) => (
            <div key={i} className="bg-slate-50 rounded p-2">
              <p className="text-xs text-slate-500">{item.label}</p>
              <p className="text-sm font-semibold">₹{item.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="bg-blue-50 rounded-lg p-4">
        <div className="flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-blue-600 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-blue-800">Locking payroll will:</p>
            <ul className="text-sm text-blue-700 mt-1 space-y-1 list-disc list-inside">
              <li>Auto-generate PF ECR, ESI challan, Form 24Q, Form 12BA, LWF, PT returns</li>
              <li>Make payslips available for employees</li>
              <li>Enable bank file generation for disbursal</li>
            </ul>
          </div>
        </div>
      </div>

      {pendingCount > 0 && (
        <div className="mt-4 bg-amber-50 rounded-lg p-4 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          <p className="text-sm text-amber-700">{pendingCount} employee(s) still pending. They will be included in the current run.</p>
        </div>
      )}
    </SurfaceCard>
  );
}
