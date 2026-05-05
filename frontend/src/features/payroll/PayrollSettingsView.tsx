import { useEffect, useState } from 'react';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput, TextInput, ToggleInput } from '@/components/ui/FormField';
import { payrollWorkspaceApi } from '@/services/api';
import { CalendarDays, Landmark, Settings2, ShieldCheck } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';

export default function PayrollSettingsView() {
  const [settings, setSettings] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const response = await payrollWorkspaceApi.settings();
      setSettings(response.data);
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to load payroll settings.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const save = async () => {
    if (!settings) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollWorkspaceApi.updateSettings(settings);
      setFeedback({ tone: 'success', message: 'Payroll settings updated.' });
      await load();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to save payroll settings.' });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <PageLoadingState label="Loading payroll settings..." />;
  }

  if (!settings) {
    return <PageErrorState message={feedback?.message || 'Payroll settings are not available.'} onRetry={() => void load()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payroll setup"
        title="Payroll Settings"
        description="Configuration for pay schedule, payout defaults, payroll rules, compliance, tax, payslips, and approval guardrails."
        actions={<Button onClick={save} disabled={isSaving}>{isSaving ? 'Saving...' : 'Save Settings'}</Button>}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Cutoff Day" value={Number(settings.payroll_calendar?.cutoff_day || 30)} hint="Current payroll cutoff configuration." icon={CalendarDays} accent="sky" />
        <MetricCard label="Payment Day" value={Number(settings.payroll_calendar?.payment_day || 1)} hint="Configured salary credit day." icon={Landmark} accent="emerald" />
        <MetricCard label="Default Method" value={settings.default_payout_method?.method || 'mock'} hint="Default payout channel for payroll." icon={Settings2} accent="violet" />
        <MetricCard label="Approval Guardrails" value={settings.approval_workflow?.adjustments_require_approval ? 'Enabled' : 'Relaxed'} hint="Adjustment review workflow state." icon={ShieldCheck} accent="amber" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <PayrollSectionCard title="Pay Schedule" description="Cycle-level payroll timing and default payout configuration.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Cutoff Day</FieldLabel>
              <TextInput type="number" min={1} max={31} value={Number(settings.payroll_calendar?.cutoff_day || 30)} onChange={(event) => setSettings((current: any) => ({ ...current, payroll_calendar: { ...current.payroll_calendar, cutoff_day: Number(event.target.value || 0) } }))} />
            </div>
            <div>
              <FieldLabel>Payment Day</FieldLabel>
              <TextInput type="number" min={1} max={31} value={Number(settings.payroll_calendar?.payment_day || 1)} onChange={(event) => setSettings((current: any) => ({ ...current, payroll_calendar: { ...current.payroll_calendar, payment_day: Number(event.target.value || 0) } }))} />
            </div>
            <div>
              <FieldLabel>Default Payout Method</FieldLabel>
              <SelectInput value={settings.default_payout_method?.method || 'mock'} onChange={(event) => setSettings((current: any) => ({ ...current, default_payout_method: { ...current.default_payout_method, method: event.target.value } }))}>
                <option value="mock">Mock</option>
                <option value="stripe">Stripe</option>
                <option value="bank_transfer">Bank transfer</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Default Currency</FieldLabel>
              <TextInput value={settings.default_payout_method?.currency || 'INR'} onChange={(event) => setSettings((current: any) => ({ ...current, default_payout_method: { ...current.default_payout_method, currency: event.target.value } }))} />
            </div>
          </div>
        </PayrollSectionCard>

        <PayrollSectionCard title="Payroll Rules" description="Operational rules that influence overtime, late deductions, and leave-to-payroll behavior.">
          <div className="space-y-4">
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Overtime enabled</p>
                  <p className="text-sm text-slate-500">Use approved overtime in payroll calculations.</p>
                </div>
                <ToggleInput checked={Boolean(settings.overtime_rules?.enabled)} onChange={(checked) => setSettings((current: any) => ({ ...current, overtime_rules: { ...current.overtime_rules, enabled: checked } }))} />
              </div>
              <div className="mt-4">
                <FieldLabel>Rate Multiplier</FieldLabel>
                <TextInput type="number" min={0} step="0.1" value={Number(settings.overtime_rules?.rate_multiplier || 1.5)} onChange={(event) => setSettings((current: any) => ({ ...current, overtime_rules: { ...current.overtime_rules, rate_multiplier: Number(event.target.value || 0) } }))} />
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Late deductions enabled</p>
                  <p className="text-sm text-slate-500">Apply configured reduction rules for late attendance.</p>
                </div>
                <ToggleInput checked={Boolean(settings.late_deduction_rules?.enabled)} onChange={(checked) => setSettings((current: any) => ({ ...current, late_deduction_rules: { ...current.late_deduction_rules, enabled: checked } }))} />
              </div>
              <div className="mt-4">
                <FieldLabel>Deduction Per Late Day</FieldLabel>
                <TextInput type="number" min={0} value={Number(settings.late_deduction_rules?.deduction_per_late_day || 0)} onChange={(event) => setSettings((current: any) => ({ ...current, late_deduction_rules: { ...current.late_deduction_rules, deduction_per_late_day: Number(event.target.value || 0) } }))} />
              </div>
            </div>

            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Approved leave counts as payable</p>
                  <p className="text-sm text-slate-500">Control whether approved leave increases payable days.</p>
                </div>
                <ToggleInput checked={Boolean(settings.leave_mapping?.approved_leave_counts_as_payable_day)} onChange={(checked) => setSettings((current: any) => ({ ...current, leave_mapping: { ...current.leave_mapping, approved_leave_counts_as_payable_day: checked } }))} />
              </div>
            </div>
          </div>
        </PayrollSectionCard>

        <PayrollSectionCard title="Approvals and Branding" description="Control payroll review gates and payslip presentation.">
          <div className="space-y-4">
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Adjustments require approval</p>
                  <p className="text-sm text-slate-500">Protect variable pay before it reaches a pay run.</p>
                </div>
                <ToggleInput checked={Boolean(settings.approval_workflow?.adjustments_require_approval)} onChange={(checked) => setSettings((current: any) => ({ ...current, approval_workflow: { ...current.approval_workflow, adjustments_require_approval: checked } }))} />
              </div>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Pay run requires finalization</p>
                  <p className="text-sm text-slate-500">Add a final checkpoint before payout and payslip generation.</p>
                </div>
                <ToggleInput checked={Boolean(settings.approval_workflow?.pay_run_requires_finalization)} onChange={(checked) => setSettings((current: any) => ({ ...current, approval_workflow: { ...current.approval_workflow, pay_run_requires_finalization: checked } }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <FieldLabel>Payslip Company Name</FieldLabel>
                <TextInput value={settings.payslip_branding?.company_name || ''} onChange={(event) => setSettings((current: any) => ({ ...current, payslip_branding: { ...current.payslip_branding, company_name: event.target.value } }))} />
              </div>
              <div>
                <FieldLabel>Payslip Accent Color</FieldLabel>
                <TextInput value={settings.payslip_branding?.accent_color || '#0f172a'} onChange={(event) => setSettings((current: any) => ({ ...current, payslip_branding: { ...current.payslip_branding, accent_color: event.target.value } }))} />
              </div>
            </div>
          </div>
        </PayrollSectionCard>

        <PayrollSectionCard title="Compliance and Payslips" description="Statutory defaults, declaration fallback, and payslip publication rules.">
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">PF enabled</p>
                    <p className="text-sm text-slate-500">Enable Provident Fund deduction and employer contribution.</p>
                  </div>
                  <ToggleInput checked={Boolean(settings.compliance_settings?.pf?.enabled)} onChange={(checked) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, pf: { ...current.compliance_settings?.pf, enabled: checked } } }))} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Employee %</FieldLabel>
                    <TextInput type="number" min={0} step="0.01" value={Number(settings.compliance_settings?.pf?.employee_rate || 12)} onChange={(event) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, pf: { ...current.compliance_settings?.pf, employee_rate: Number(event.target.value || 0) } } }))} />
                  </div>
                  <div>
                    <FieldLabel>Employer %</FieldLabel>
                    <TextInput type="number" min={0} step="0.01" value={Number(settings.compliance_settings?.pf?.employer_rate || 12)} onChange={(event) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, pf: { ...current.compliance_settings?.pf, employer_rate: Number(event.target.value || 0) } } }))} />
                  </div>
                </div>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">ESI enabled</p>
                    <p className="text-sm text-slate-500">Apply Employee State Insurance thresholds and rates.</p>
                  </div>
                  <ToggleInput checked={Boolean(settings.compliance_settings?.esi?.enabled)} onChange={(checked) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, esi: { ...current.compliance_settings?.esi, enabled: checked } } }))} />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <FieldLabel>Employee %</FieldLabel>
                    <TextInput type="number" min={0} step="0.01" value={Number(settings.compliance_settings?.esi?.employee_rate || 0.75)} onChange={(event) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, esi: { ...current.compliance_settings?.esi, employee_rate: Number(event.target.value || 0) } } }))} />
                  </div>
                  <div>
                    <FieldLabel>Employer %</FieldLabel>
                    <TextInput type="number" min={0} step="0.01" value={Number(settings.compliance_settings?.esi?.employer_rate || 3.25)} onChange={(event) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, esi: { ...current.compliance_settings?.esi, employer_rate: Number(event.target.value || 0) } } }))} />
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">Professional tax enabled</p>
                    <p className="text-sm text-slate-500">Use a monthly PT fallback amount when no state table is configured.</p>
                  </div>
                  <ToggleInput checked={Boolean(settings.compliance_settings?.professional_tax?.enabled)} onChange={(checked) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, professional_tax: { ...current.compliance_settings?.professional_tax, enabled: checked } } }))} />
                </div>
                <div className="mt-4">
                  <FieldLabel>Default monthly PT</FieldLabel>
                  <TextInput type="number" min={0} value={Number(settings.compliance_settings?.professional_tax?.default_monthly_amount || 200)} onChange={(event) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, professional_tax: { ...current.compliance_settings?.professional_tax, default_monthly_amount: Number(event.target.value || 0) } } }))} />
                </div>
              </div>
              <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">TDS enabled</p>
                    <p className="text-sm text-slate-500">Fall back to profile tax amount when declarations are absent.</p>
                  </div>
                  <ToggleInput checked={Boolean(settings.compliance_settings?.tds?.enabled)} onChange={(checked) => setSettings((current: any) => ({ ...current, compliance_settings: { ...current.compliance_settings, tds: { ...current.compliance_settings?.tds, enabled: checked } } }))} />
                </div>
                <div className="mt-4">
                  <FieldLabel>Default regime</FieldLabel>
                  <SelectInput value={settings.tax_settings?.default_regime || 'new'} onChange={(event) => setSettings((current: any) => ({ ...current, tax_settings: { ...current.tax_settings, default_regime: event.target.value } }))}>
                    <option value="new">New</option>
                    <option value="old">Old</option>
                  </SelectInput>
                </div>
              </div>
            </div>
            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Publish payslips after payment</p>
                  <p className="text-sm text-slate-500">Keep payslips in draft until the pay run is paid.</p>
                </div>
                <ToggleInput checked={Boolean(settings.payslip_issue_rules?.publish_after_payment)} onChange={(checked) => setSettings((current: any) => ({ ...current, payslip_issue_rules: { ...current.payslip_issue_rules, publish_after_payment: checked } }))} />
              </div>
              <div className="mt-4">
                <FieldLabel>Track viewed timestamp</FieldLabel>
                <ToggleInput checked={Boolean(settings.payslip_issue_rules?.track_viewed_at)} onChange={(checked) => setSettings((current: any) => ({ ...current, payslip_issue_rules: { ...current.payslip_issue_rules, track_viewed_at: checked } }))} />
              </div>
            </div>
          </div>
        </PayrollSectionCard>
      </div>
    </div>
  );
}
