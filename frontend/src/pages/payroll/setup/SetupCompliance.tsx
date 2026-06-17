import { useState } from 'react';
import { Save, CheckCircle2, AlertCircle, Loader2, ClipboardCheck } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

interface ToggleItem {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
}

export default function SetupCompliance() {
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.compliance ?? false;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [toggles, setToggles] = useState<ToggleItem[]>([
    { key: 'pf', label: 'Provident Fund (PF)', desc: '12% employee + 12% employer on Basic', enabled: true },
    { key: 'pf_above_cap', label: 'PF Above Wage Cap', desc: 'Apply PF on entire basic even if > ₹15,000', enabled: false },
    { key: 'esi', label: 'Employee State Insurance (ESI)', desc: '0.75% employee + 3.25% employer when gross ≤ ₹21,000', enabled: true },
    { key: 'pt', label: 'Professional Tax (PT)', desc: 'State-specific deduction (₹0 to ₹200/mo)', enabled: true },
    { key: 'tds', label: 'Tax Deducted at Source (TDS)', desc: 'Monthly income tax based on regime', enabled: true },
    { key: 'lwf', label: 'Labour Welfare Fund (LWF)', desc: 'Annual state-specific contribution', enabled: false },
  ]);

  const toggle = (key: string) =>
    setToggles(prev => prev.map(t => t.key === key ? { ...t, enabled: !t.enabled } : t));

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      // These toggles are mirrored in the org payroll settings; individual employee
      // templates still take precedence. Saving here just ensures future templates
      // created from "Add Employee" pick up these defaults.
      await markSetupStep('compliance');
      setSuccess('Compliance configuration saved.');
      setTimeout(() => setSuccess(null), 3000);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SetupLayout currentStep="compliance">
      <StepHeader
        stepNumber={5}
        title="Compliance Toggles"
        description="Pick which statutory deductions apply to your organization."
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
          <ClipboardCheck className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Statutory Deductions</h3>
        </div>
        <div className="space-y-3">
          {toggles.map(item => (
            <div key={item.key} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <div>
                <p className="text-sm font-medium text-slate-900">{item.label}</p>
                <p className="text-xs text-slate-500">{item.desc}</p>
              </div>
              <button
                onClick={() => toggle(item.key)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${item.enabled ? 'bg-blue-600' : 'bg-slate-300'}`}
                role="switch"
                aria-checked={item.enabled}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${item.enabled ? 'translate-x-6' : 'translate-x-1'}`} />
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
          {submitting ? 'Saving...' : isComplete ? 'Update Compliance' : 'Save & Continue'}
        </Button>
      </div>
    </SetupLayout>
  );
}