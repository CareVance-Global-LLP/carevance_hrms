import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2, AlertCircle, Loader2, Users, Sparkles } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

export default function SetupDefaults() {
  const queryClient = useQueryClient();
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.defaults ?? false;

  const [basicPct, setBasicPct] = useState('40');
  const [hraPct, setHraPct] = useState('50');
  const [conveyance, setConveyance] = useState('1600');
  const [workingDays, setWorkingDays] = useState('26');
  const [ptState, setPtState] = useState('maharashtra');
  const [taxRegime, setTaxRegime] = useState<'new' | 'old'>('new');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [applyingToAll, setApplyingToAll] = useState(false);

  // Pre-fill from existing org settings if available
  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings-existing'],
    queryFn: () => payrollApi.getPayrollSettings().then(res => res.data?.settings ?? {}),
  });

  useEffect(() => {
    const s = (settingsData as any) ?? {};
    if (s.defaultBasicPercentage !== undefined) setBasicPct(String(s.defaultBasicPercentage));
    if (s.defaultHraPercentage !== undefined) setHraPct(String(s.defaultHraPercentage));
    if (s.defaultConveyance !== undefined) setConveyance(String(s.defaultConveyance));
    if (s.workingDaysPerMonth !== undefined) setWorkingDays(String(s.workingDaysPerMonth));
    if (s.defaultState) setPtState(s.defaultState);
    if (s.defaultTaxRegime) setTaxRegime(s.defaultTaxRegime);
  }, [settingsData]);

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

  const invalidateAllPayrollCaches = () => {
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'onboarding-status'] });
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      await payrollApi.updatePayrollSettings({
        defaultBasicPercentage: parseFloat(basicPct) || 40,
        defaultHraPercentage: parseFloat(hraPct) || 50,
        defaultConveyance: parseFloat(conveyance) || 1600,
        workingDaysPerMonth: parseInt(workingDays) || 26,
        defaultState: ptState,
        defaultTaxRegime: taxRegime,
      } as any);
      await markSetupStep('defaults');
      invalidateAllPayrollCaches();
      setSuccess('Defaults saved. Future employees will use these values.');
    } catch (e: any) {
      console.error('Defaults save error:', e);
      setError(extractError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyToAll = async () => {
    if (!confirm('Apply these defaults to ALL existing employees? This will update their salary structure. Custom employee overrides will be preserved.')) {
      return;
    }
    setError(null);
    setSuccess(null);
    setApplyingToAll(true);
    try {
      // Save first, then apply
      await payrollApi.updatePayrollSettings({
        defaultBasicPercentage: parseFloat(basicPct) || 40,
        defaultHraPercentage: parseFloat(hraPct) || 50,
        defaultConveyance: parseFloat(conveyance) || 1600,
        workingDaysPerMonth: parseInt(workingDays) || 26,
        defaultState: ptState,
        defaultTaxRegime: taxRegime,
      } as any);
      const res = await payrollApi.applySettingsToAllEmployees(false);
      invalidateAllPayrollCaches();
      await markSetupStep('defaults');
      setSuccess(`Applied to ${res.data.affected_count ?? 0} employee templates. Custom overrides preserved.`);
    } catch (e: any) {
      console.error('Apply all error:', e);
      setError(extractError(e));
    } finally {
      setApplyingToAll(false);
    }
  };

  return (
    <SetupLayout currentStep="defaults">
      <StepHeader
        stepNumber={2}
        title="Organization Defaults"
        description="These defaults apply to every new employee. Click 'Apply to All' to update existing employees too."
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
          <p className="text-sm text-emerald-700 break-words flex-1">{success}</p>
        </div>
      )}

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Salary Structure</h3>
        <p className="text-xs text-slate-500 mb-4">These percentages split each employee\'s CTC into Basic + HRA + allowances. Click <InfoTooltip content="The breakdown of an employee\'s annual CTC into Basic, HRA, and allowances." title="Salary structure" size="sm" /> any label for details.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Basic Salary (% of CTC)</FieldLabel>
              <InfoTooltip content="The foundation of salary. Most statutory calculations (PF, gratuity, HRA exemption) are anchored to Basic. Setting it too low reduces PF corpus; too high increases tax via lower allowances." title="Basic Salary" typical="40% – 50% of CTC" />
            </div>
            <TextInput type="number" value={basicPct} onChange={(e) => setBasicPct(e.target.value)} min="0" max="100" />
            <p className="text-xs text-slate-400 mt-1">Industry standard: 40–50%</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>HRA (% of Basic)</FieldLabel>
              <InfoTooltip content="Tax-exempt allowance for rent paid by employee. Exempt amount = minimum of (actual HRA, rent paid − 10% of Basic, 50% of Basic in metros or 40% in non-metros)." title="HRA" typical="50% of Basic (metro) or 40% (non-metro)" />
            </div>
            <TextInput type="number" value={hraPct} onChange={(e) => setHraPct(e.target.value)} min="0" max="100" />
            <p className="text-xs text-slate-400 mt-1">Industry standard: 50%</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Conveyance Allowance (₹/mo)</FieldLabel>
              <InfoTooltip content="Transport allowance. Tax-exempt up to ₹1,600/month under Old Regime. Fully taxable under New Regime." title="Conveyance" typical="₹1,600/month" />
            </div>
            <TextInput type="number" value={conveyance} onChange={(e) => setConveyance(e.target.value)} min="0" />
            <p className="text-xs text-slate-400 mt-1">Tax-exempt up to ₹1,600</p>
          </div>
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Working Days per Month</FieldLabel>
              <InfoTooltip content="Number of days an employee is expected to work. Used for pro-rata calculations: LOP, overtime, partial-month salary for new joiners / exits." title="Working days" typical="26 days/month (Mon–Sat)" />
            </div>
            <TextInput type="number" value={workingDays} onChange={(e) => setWorkingDays(e.target.value)} min="1" max="31" />
            <p className="text-xs text-slate-400 mt-1">Usually 26 (Mon–Sat)</p>
          </div>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-4">Location & Tax</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Professional Tax State</FieldLabel>
              <InfoTooltip content="Each state has its own Professional Tax slab. Pick the state where your office is registered (not where the employee lives). Some states (Delhi, Haryana) have no PT." title="PT State" />
            </div>
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
            <div className="flex items-center gap-1.5 mb-1">
              <FieldLabel>Default Tax Regime</FieldLabel>
              <InfoTooltip content="New Regime: lower slabs, no HRA/80C/LTA exemptions. Old Regime: higher slabs, full exemptions. Most employees benefit from New unless they have large 80C investments, home loan, or high HRA." title="Tax regime" />
            </div>
            <SelectInput value={taxRegime} onChange={(e) => setTaxRegime(e.target.value as 'new' | 'old')}>
              <option value="new">New Regime (default)</option>
              <option value="old">Old Regime</option>
            </SelectInput>
            <p className="text-xs text-slate-400 mt-1">Employees can change this later</p>
          </div>
        </div>
      </SurfaceCard>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
        <Button
          variant="secondary"
          iconLeft={applyingToAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
          onClick={handleApplyToAll}
          disabled={submitting || applyingToAll}
        >
          {applyingToAll ? 'Applying...' : 'Save & Apply to All Employees'}
        </Button>
        <Button
          variant="primary"
          iconLeft={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          onClick={handleSave}
          disabled={submitting || applyingToAll}
        >
          {submitting ? 'Saving...' : isComplete ? 'Update Defaults' : 'Save Defaults'}
        </Button>
      </div>
      <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
        <Sparkles className="h-3 w-3" />
        Use "Apply to All" to propagate these changes to existing employee templates (custom overrides are preserved).
      </p>
    </SetupLayout>
  );
}
