import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Calculator, CheckCircle2, AlertCircle, Loader2, IndianRupee, ArrowRight, PartyPopper } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

export default function SetupTestRun() {
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.test_run ?? false;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [employeeId, setEmployeeId] = useState('');
  const [annualCtc, setAnnualCtc] = useState('1200000');
  const [taxRegime, setTaxRegime] = useState<'new' | 'old'>('new');
  const [calcPreview, setCalcPreview] = useState<any>(null);

  const { data: employeesData } = useQuery({
    queryKey: ['payroll', 'employees-list'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
  });
  const employees = Array.isArray(employeesData) ? employeesData : [];

  const calculateMutation = useMutation({
    mutationFn: () => payrollApi.calculate({
      user_id: parseInt(employeeId),
      annual_ctc: parseFloat(annualCtc),
      tax_regime: taxRegime,
      is_metro_city: true,
    }),
    onSuccess: (res) => {
      setCalcPreview(res.data?.calculation ?? res.data);
      setSuccess('Test calculation complete.');
      setTimeout(() => setSuccess(null), 3000);
    },
    onError: (e: any) => {
      console.error('Test calc error:', e);
      setError(e?.response?.data?.message || e?.message || 'Calculation failed');
    },
  });

  const handleCompleteSetup = async () => {
    try {
      await markSetupStep('test_run');
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to complete setup');
    }
  };

  const handleEmployeeChange = (userId: string) => {
    setEmployeeId(userId);
    const emp = employees.find((e: any) => String(e.id) === userId);
    if (emp && (emp as any).annual_ctc) setAnnualCtc(String((emp as any).annual_ctc));
  };

  return (
    <SetupLayout currentStep="test_run">
      <StepHeader
        stepNumber={9}
        title="Test Run"
        description="Final step! Run a sample calculation to verify everything works."
        isComplete={isComplete}
      />

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 break-words flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
        </div>
      )}
      {success && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-emerald-700 flex-1">{success}</p>
        </div>
      )}

      <SurfaceCard className="p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <Calculator className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Sample Calculation</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div>
            <FieldLabel>Employee</FieldLabel>
            <SelectInput value={employeeId} onChange={(e) => handleEmployeeChange(e.target.value)}>
              <option value="">Select...</option>
              {employees.map((emp: any) => (
                <option key={emp.id} value={emp.id}>{emp.name}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Annual CTC (₹)</FieldLabel>
            <div className="relative">
              <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <TextInput
                type="number"
                value={annualCtc}
                onChange={(e) => setAnnualCtc(e.target.value)}
                className="pl-9"
              />
            </div>
          </div>
          <div>
            <FieldLabel>Tax Regime</FieldLabel>
            <SelectInput value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as 'new' | 'old')}>
              <option value="new">New Regime</option>
              <option value="old">Old Regime</option>
            </SelectInput>
          </div>
        </div>
        <div className="flex justify-center">
          <Button
            variant="primary"
            iconLeft={calculateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
            onClick={() => calculateMutation.mutate()}
            disabled={!employeeId || !annualCtc || calculateMutation.isPending}
          >
            {calculateMutation.isPending ? 'Calculating...' : 'Run Test Calculation'}
          </Button>
        </div>
      </SurfaceCard>

      {calcPreview && (
        <SurfaceCard className="p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-900">Salary Breakdown Preview</h3>
            <CheckCircle2 className="h-5 w-5 text-emerald-500" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 mb-2">Earnings</h4>
              <div className="space-y-2 text-sm">
                <Row label="Basic" value={calcPreview.components?.earnings?.basic} />
                <Row label="HRA" value={calcPreview.components?.earnings?.hra} />
                <Row label="Conveyance" value={calcPreview.components?.earnings?.conveyance} />
                <Row label="Special Allowance" value={calcPreview.components?.earnings?.special_allowance} />
                <div className="border-t pt-2 mt-2">
                  <Row label="Monthly Gross" value={calcPreview.monthly?.gross} bold />
                </div>
              </div>
            </div>
            <div>
              <h4 className="text-xs font-semibold uppercase tracking-wide text-rose-700 mb-2">Deductions</h4>
              <div className="space-y-2 text-sm">
                <Row label="PF (Employee)" value={calcPreview.components?.deductions?.pf_employee} />
                <Row label="ESI (Employee)" value={calcPreview.components?.deductions?.esi_employee} />
                <Row label="Professional Tax" value={calcPreview.components?.deductions?.pt} />
                <Row label="TDS" value={calcPreview.components?.deductions?.tds} />
                <div className="border-t pt-2 mt-2">
                  <Row label="Total Deductions" value={calcPreview.monthly?.total_deductions} bold />
                </div>
              </div>
            </div>
          </div>
          <div className="mt-6 p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PartyPopper className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-semibold text-emerald-900">Net Take-Home</span>
              </div>
              <span className="text-2xl font-bold text-emerald-700">
                ₹{Number(calcPreview.monthly?.net || 0).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </SurfaceCard>
      )}

      <div className="mt-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <p className="text-sm text-slate-600">
          {isComplete ? '🎉 Setup complete! You can now process payroll.' : 'Once everything looks good, mark setup as complete.'}
        </p>
        <Button
          variant="primary"
          onClick={handleCompleteSetup}
          disabled={isComplete}
          iconLeft={isComplete ? <CheckCircle2 className="h-4 w-4" /> : <ArrowRight className="h-4 w-4" />}
        >
          {isComplete ? 'Setup Complete ✓' : 'Mark Setup as Complete'}
        </Button>
      </div>
    </SetupLayout>
  );
}

function Row({ label, value, bold }: { label: string; value?: number; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'font-semibold text-slate-900' : 'text-slate-700'}`}>
      <span>{label}</span>
      <span>₹{Number(value || 0).toLocaleString('en-IN')}</span>
    </div>
  );
}