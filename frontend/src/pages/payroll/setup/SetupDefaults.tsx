import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Save, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

export default function SetupDefaults() {
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.defaults ?? false;

  const [basicPct, setBasicPct] = useState('40');
  const [hraPct, setHraPct] = useState('50');
  const [conveyance, setConveyance] = useState('1600');
  const [workingDays, setWorkingDays] = useState('26');
  const [ptState, setPtState] = useState('maharashtra');
  const [taxRegime, setTaxRegime] = useState<'new' | 'old'>('new');
  const [pfEnabled, setPfEnabled] = useState(true);
  const [esiEnabled, setEsiEnabled] = useState(true);
  const [ptEnabled, setPtEnabled] = useState(true);
  const [tdsEnabled, setTdsEnabled] = useState(true);
  const [lwfEnabled, setLwfEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: ptStatesData } = useQuery({
    queryKey: ['payroll', 'pt-states'],
    queryFn: () => payrollApi.getPTStates().then(res => res.data),
    staleTime: 1000 * 60 * 60 * 24,
  });

  const ptStates = (ptStatesData?.all_states ?? []) as Array<{ code: string; name: string }>;

  const extractError = (err: any): string => {
    if (err?.response?.data?.message) return err.response.data.message;
    if (err?.response?.data?.errors) {
      const e = err.response.data.errors;
      const first = Object.keys(e)[0];
      if (first) return `${first}: ${e[first][0]}`;
    }
    return err?.message || 'Something went wrong';
  };

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // Save via existing payroll settings endpoint
      await payrollApi.updatePayrollSettings({
        defaultBasicPercentage: parseFloat(basicPct) || 40,
        defaultHraPercentage: parseFloat(hraPct) || 50,
        defaultConveyance: parseFloat(conveyance) || 1600,
        workingDaysPerMonth: parseInt(workingDays) || 26,
        defaultState: ptState,
        defaultTaxRegime: taxRegime,
        pfEnabled,
        esiEnabled,
        ptEnabled,
        tdsEnabled,
        lwfEnabled,
      } as any);
      // Mark defaults as configured
      await payrollApi.markDefaultsConfigured();
      await markSetupStep('defaults');
    } catch (e: any) {
      console.error('Defaults save error:', e);
      setError(extractError(e));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SetupLayout currentStep="defaults">
      <StepHeader
        stepNumber={2}
        title="Organization Defaults"
        description="These defaults apply to every new employee. You can override per-employee later."
        isComplete={isComplete}
      />

      {error && (
        <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-rose-700 break-words flex-1">{error}</p>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">
            ×
          </button>
        </div>
      )}

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Salary Structure</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Basic Salary (% of CTC)</FieldLabel>
            <TextInput type="number" value={basicPct} onChange={(e) => setBasicPct(e.target.value)} min="0" max="100" />
            <p className="text-xs text-slate-400 mt-1">Industry standard: 40-50%</p>
          </div>
          <div>
            <FieldLabel>HRA (% of Basic)</FieldLabel>
            <TextInput type="number" value={hraPct} onChange={(e) => setHraPct(e.target.value)} min="0" max="100" />
            <p className="text-xs text-slate-400 mt-1">Industry standard: 50%</p>
          </div>
          <div>
            <FieldLabel>Conveyance Allowance (₹/mo)</FieldLabel>
            <TextInput type="number" value={conveyance} onChange={(e) => setConveyance(e.target.value)} min="0" />
            <p className="text-xs text-slate-400 mt-1">Tax-exempt up to ₹1,600</p>
          </div>
          <div>
            <FieldLabel>Working Days per Month</FieldLabel>
            <TextInput type="number" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} min="1" max="31" />
            <p className="text-xs text-slate-400 mt-1">Usually 26 (Mon-Sat)</p>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Location & Tax</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <FieldLabel>Professional Tax State</FieldLabel>
            <SelectInput value={ptState} onChange={(e) => setPtState(e.target.value)}>
              {ptStates.length > 0 ? (
                ptStates.map(s => <option key={s.code} value={s.code}>{s.name}</option>)
              ) : (
                <>
                  <option value="maharashtra">Maharashtra</option>
                  <option value="karnataka">Karnataka</option>
                  <option value="tamil_nadu">Tamil Nadu</option>
                  <option value="delhi">Delhi</option>
                  <option value="gujarat">Gujarat</option>
                </>
              )}
            </SelectInput>
            <p className="text-xs text-slate-400 mt-1">Where your office is located</p>
          </div>
          <div>
            <FieldLabel>Default Tax Regime</FieldLabel>
            <SelectInput value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as 'new' | 'old')}>
              <option value="new">New Regime (default)</option>
              <option value="old">Old Regime</option>
            </SelectInput>
            <p className="text-xs text-slate-400 mt-1">Employees can change this later</p>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">Statutory Compliance Toggles</h3>
        <p className="text-xs text-slate-500 mb-4">Enable/disable deductions. You can change these per-employee too.</p>
        <div className="space-y-3">
          {[
            { key: 'pf', label: 'Provident Fund (PF)', desc: '12% employee + 12% employer', state: pfEnabled, set: setPfEnabled },
            { key: 'esi', label: 'Employee State Insurance (ESI)', desc: '0.75% employee + 3.25% employer (if gross ≤ ₹21,000)', state: esiEnabled, set: setEsiEnabled },
            { key: 'pt', label: 'Professional Tax (PT)', desc: 'State-specific amount (₹0 to ₹200/mo)', state: ptEnabled, set: setPtEnabled },
            { key: 'tds', label: 'Tax Deducted at Source (TDS)', desc: 'Income tax based on regime', state: tdsEnabled, set: setTdsEnabled },
            { key: 'lwf', label: 'Labour Welfare Fund (LWF)', desc: 'Annual state-specific contribution', state: lwfEnabled, set: setLwfEnabled },
          ].map(item => (
            <div key={item.key} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
              <button
                onClick={() => item.set(!item.state)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${item.state ? 'bg-blue-600' : 'bg-slate-300'}`}
                role="switch"
                aria-checked={item.state}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${item.state ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
          ))}
        </div>
      </SurfaceCard>

      <div className="flex justify-end">
        <Button
          variant="primary"
          iconLeft={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          onClick={handleSave}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : isComplete ? 'Update Defaults' : 'Save & Continue'}
        </Button>
      </div>
    </SetupLayout>
  );
}