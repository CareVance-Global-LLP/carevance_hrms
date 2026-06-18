import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Save, CheckCircle2, AlertCircle, Loader2, ClipboardCheck, Users, Sparkles } from 'lucide-react';
import SetupLayout, { StepHeader } from './SetupLayout';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { payrollApi } from '@/services/api';
import { usePayrollOnboarding } from '@/hooks/usePayrollOnboarding';

interface ToggleItem {
  key: string;
  label: string;
  desc: string;
  enabled: boolean;
}

interface RateItem {
  key: string;
  label: string;
  desc: string;
  value: string;
}

const TOGGLE_DEFS: Array<{ key: string; label: string; desc: string }> = [
  { key: 'pf', label: 'Provident Fund (PF)', desc: '12% employee + 12% employer' },
  { key: 'esi', label: 'Employee State Insurance (ESI)', desc: '0.75% employee + 3.25% employer (if gross ≤ ₹21,000)' },
  { key: 'pt', label: 'Professional Tax (PT)', desc: 'State-specific deduction (₹0 to ₹200/mo)' },
  { key: 'tds', label: 'Tax Deducted at Source (TDS)', desc: 'Income tax based on regime' },
  { key: 'lwf', label: 'Labour Welfare Fund (LWF)', desc: 'Annual state-specific contribution' },
  { key: 'nps', label: 'National Pension Scheme (NPS)', desc: 'Optional retirement contribution (Section 80CCD(1B))' },
  { key: 'vpf', label: 'Voluntary Provident Fund (VPF)', desc: 'Voluntary additional PF contribution by employee' },
];

const TOGGLE_INFO: Record<string, { tooltip: string; typical: string }> = {
  pf: {
    tooltip: 'Employee and employer each contribute 12% of Basic. Tax-deductible under Section 80C (employee share).',
    typical: '12% of Basic',
  },
  esi: {
    tooltip: 'Health insurance for employees earning ≤ ₹21,000/month gross. Provides medical benefits to employee and family.',
    typical: '0.75% employee + 3.25% employer',
  },
  pt: {
    tooltip: 'State-level tax. Varies by state (₹0–₹200/mo). Some states (Delhi, Haryana) have no PT.',
    typical: '₹0 – ₹200/month',
  },
  tds: {
    tooltip: 'Income tax deducted monthly based on annual projection. Adjusted at year-end — excess refunded via ITR.',
    typical: 'Based on tax regime + slab',
  },
  lwf: {
    tooltip: 'Annual state welfare contribution. Only some states require it (Maharashtra, Karnataka).',
    typical: '₹10 – ₹100/year',
  },
  nps: {
    tooltip: 'Optional retirement scheme. Employee contributes up to 14% of Basic (80CCD(1)) + extra ₹50,000 (80CCD(1B)).',
    typical: '10% of Basic',
  },
  vpf: {
    tooltip: 'Voluntary PF contribution beyond 12% statutory. Employee-only. Earns EPF rate (~8.15%), tax-deferred.',
    typical: 'Voluntary % above 12% PF',
  },
};

const RATE_DEFS: Array<{ key: string; label: string; desc: string; defaultValue: string; field: string; tooltip: string; typical: string }> = [
  { key: 'pf_employee_pct', label: 'PF — Employee %', desc: 'Default 12%', defaultValue: '12', field: 'pfEmployeePercentage', tooltip: 'Employee Provident Fund contribution as % of Basic Salary.', typical: '12% of Basic' },
  { key: 'pf_employer_pct', label: 'PF — Employer %', desc: 'Default 12%', defaultValue: '12', field: 'pfEmployerPercentage', tooltip: 'Employer PF contribution. Split 8.33% to EPS (pension) and 3.67% to EPF by default.', typical: '12% of Basic' },
  { key: 'pf_wage_cap', label: 'PF Wage Cap (₹/mo)', desc: 'Default ₹15,000', defaultValue: '15000', field: 'pfWageCap', tooltip: 'Maximum Basic considered for PF. Establishments registered before 2014 with EPS membership use this cap.', typical: '₹15,000/month' },
  { key: 'esi_employee_pct', label: 'ESI — Employee %', desc: 'Default 0.75%', defaultValue: '0.75', field: 'esiEmployeePercentage', tooltip: 'Employee ESI contribution as % of monthly Gross. Only applies when Gross ≤ ESI Threshold.', typical: '0.75% of Gross' },
  { key: 'esi_employer_pct', label: 'ESI — Employer %', desc: 'Default 3.25%', defaultValue: '3.25', field: 'esiEmployerPercentage', tooltip: 'Employer ESI contribution as % of monthly Gross.', typical: '3.25% of Gross' },
  { key: 'esi_threshold', label: 'ESI Threshold (₹/mo)', desc: 'Default ₹21,000', defaultValue: '21000', field: 'esiThreshold', tooltip: 'Maximum monthly Gross for ESI eligibility. Above this, neither employee nor employer ESI applies.', typical: '₹21,000/month' },
  { key: 'nps_employee_pct', label: 'NPS — Employee %', desc: 'Default 10% (max 14% under 80CCD(1))', defaultValue: '10', field: 'npsEmployeePercentage', tooltip: 'Employee NPS contribution as % of Basic + DA. Deductible under Section 80CCD(1) up to 14%.', typical: '10% of Basic' },
  { key: 'vpf_pct', label: 'VPF — Employee %', desc: 'Voluntary % above statutory PF', defaultValue: '0', field: 'vpfPercentage', tooltip: 'Voluntary PF contribution above 12%. Employee-only decision. Same EPF interest, tax-deferred.', typical: '0% (opt-in)' },
];

// Map toggle key → backend field
const TOGGLE_TO_FIELD: Record<string, string> = {
  pf: 'pfEnabled',
  esi: 'esiEnabled',
  pt: 'ptEnabled',
  tds: 'tdsEnabled',
  lwf: 'lwfEnabled',
  nps: 'npsEnabled',
  vpf: 'vpfEnabled',
};

export default function SetupCompliance() {
  const queryClient = useQueryClient();
  const { status, markSetupStep } = usePayrollOnboarding();
  const isComplete = status?.steps.compliance ?? false;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [applyingToAll, setApplyingToAll] = useState(false);

  // Pre-fill toggles and rates from existing org settings
  const { data: settingsData } = useQuery({
    queryKey: ['payroll', 'settings-existing'],
    queryFn: () => payrollApi.getPayrollSettings().then(res => res.data?.settings ?? {}),
  });

  const initialSettings = (settingsData as any) ?? {};
  const initialToggleEnabled = (key: string): boolean => {
    const field = TOGGLE_TO_FIELD[key];
    const stored = field ? initialSettings[field] : undefined;
    return typeof stored === 'boolean' ? stored : key !== 'lwf';
  };
  const initialRateValue = (key: string): string => {
    const def = RATE_DEFS.find(d => d.key === key);
    if (!def) return '';
    const stored = initialSettings[def.field];
    return stored !== undefined ? String(stored) : def.defaultValue;
  };

  const [toggles, setToggles] = useState<ToggleItem[]>(() =>
    TOGGLE_DEFS.map(d => ({ ...d, enabled: initialToggleEnabled(d.key) })),
  );

  const [rates, setRates] = useState<RateItem[]>(() =>
    RATE_DEFS.map(d => ({ key: d.key, label: d.label, desc: d.desc, value: initialRateValue(d.key) })),
  );

  // Re-sync when settings refresh after a save (without clobbering unsaved
  // local edits — only update values that match the previous defaults).
  useEffect(() => {
    const s = (settingsData as any) ?? {};
    setToggles(prev => prev.map(t => {
      const field = TOGGLE_TO_FIELD[t.key];
      const value = s[field];
      return { ...t, enabled: typeof value === 'boolean' ? value : t.enabled };
    }));
    setRates(prev => prev.map(r => {
      const def = RATE_DEFS.find(d => d.key === r.key);
      if (!def) return r;
      const stored = s[def.field];
      return { ...r, value: stored !== undefined ? String(stored) : r.value };
    }));
  }, [settingsData]);

  const toggle = (key: string) =>
    setToggles(prev => prev.map(t => t.key === key ? { ...t, enabled: !t.enabled } : t));

  const setRate = (key: string, value: string) =>
    setRates(prev => prev.map(r => r.key === key ? { ...r, value } : r));

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['payroll'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'onboarding-status'] });
  };

  const buildSavePayload = () => {
    const compliance: Record<string, boolean> = {};
    const settings: Record<string, any> = {};
    for (const t of toggles) {
      const field = TOGGLE_TO_FIELD[t.key];
      compliance[t.key] = t.enabled;
      settings[field] = t.enabled;
    }
    for (const r of rates) {
      const def = RATE_DEFS.find(d => d.key === r.key);
      if (!def) continue;
      const num = parseFloat(r.value);
      if (Number.isNaN(num)) continue;
      settings[def.field] = num;
    }
    return { compliance, settings };
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);
    setSubmitting(true);
    try {
      const { compliance, settings } = buildSavePayload();
      await payrollApi.updatePayrollSettings({
        ...settings,
        compliance,
      } as any);
      await markSetupStep('compliance');
      invalidateAll();
      setSuccess('Compliance configuration saved. Future employees will use these defaults.');
    } catch (e: any) {
      console.error('Compliance save error:', e);
      setError(e?.response?.data?.message || e?.message || 'Failed to save');
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplyToAll = async () => {
    if (!confirm('Apply these compliance settings to ALL existing employees? This will update their deductions and PF/ESI rates. Custom employee overrides will be preserved.')) {
      return;
    }
    setError(null);
    setSuccess(null);
    setApplyingToAll(true);
    try {
      const { compliance, settings } = buildSavePayload();
      await payrollApi.updatePayrollSettings({ ...settings, compliance } as any);
      const res = await payrollApi.applySettingsToAllEmployees(false);
      invalidateAll();
      await markSetupStep('compliance');
      setSuccess(`Applied to ${res.data.affected_count ?? 0} employee templates. Custom overrides preserved.`);
    } catch (e: any) {
      console.error('Apply all error:', e);
      setError(e?.response?.data?.message || e?.message || 'Failed to save');
    } finally {
      setApplyingToAll(false);
    }
  };

  return (
    <SetupLayout currentStep="compliance">
      <StepHeader
        stepNumber={5}
        title="Compliance Toggles"
        description="Pick which statutory deductions apply to your organization. Click 'Apply to All' to update existing employees too."
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
        <div className="flex items-center gap-3 mb-4">
          <ClipboardCheck className="h-5 w-5 text-blue-600" />
          <h3 className="text-sm font-semibold text-slate-900">Statutory Deductions</h3>
          <InfoTooltip content="Enable the deductions that apply to your organization. Employees can override per-person on their own template. Click any (i) icon for what each deduction does." title="Statutory deductions" />
        </div>
        <div className="space-y-3">
          {toggles.map(item => {
            const info = TOGGLE_INFO[item.key];
            return (
              <div key={item.key} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex-1 min-w-0 pr-3">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    {info && (
                      <InfoTooltip
                        content={info.tooltip}
                        title={item.label}
                        typical={info.typical}
                      />
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{item.desc}</p>
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
            );
          })}
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6 mb-6">
        <h3 className="text-sm font-semibold text-slate-900 mb-1">PF & ESI Rates</h3>
        <p className="text-xs text-slate-500 mb-4">
          Adjust PF/ESI rates and the ESI eligibility threshold. Defaults match current Indian statutory rates.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {rates.map(item => {
            const def = RATE_DEFS.find(d => d.key === item.key);
            return (
              <div key={item.key}>
                <div className="flex items-center gap-1.5 mb-1">
                  <FieldLabel>{item.label}</FieldLabel>
                  {def && (
                    <InfoTooltip
                      content={def.tooltip}
                      title={item.label}
                      typical={def.typical}
                    />
                  )}
                </div>
                <TextInput
                  type="number"
                  step={item.key.includes('pct') ? '0.01' : '1'}
                  value={item.value}
                  onChange={(e) => setRate(item.key, e.target.value)}
                  min="0"
                />
                <p className="text-xs text-slate-400 mt-1">{item.desc}</p>
              </div>
            );
          })}
        </div>
      </SurfaceCard>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-end gap-3">
        <Button
          variant="secondary"
          iconLeft={applyingToAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
          onClick={handleApplyToAll}
          disabled={submitting || applyingToAll}
        >
          {applyingToAll ? 'Applying...' : 'Save & Apply to All'}
        </Button>
        <Button
          variant="primary"
          iconLeft={submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : isComplete ? <CheckCircle2 className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          onClick={handleSave}
          disabled={submitting || applyingToAll}
        >
          {submitting ? 'Saving...' : isComplete ? 'Update Compliance' : 'Save Compliance'}
        </Button>
      </div>
      <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
        <Sparkles className="h-3 w-3" />
        Changes are persisted to org settings immediately and used for new employee calculations.
      </p>
    </SetupLayout>
  );
}
