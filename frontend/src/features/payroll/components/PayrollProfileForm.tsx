import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import type { PayrollProfile, SalaryTemplate } from '@/types';

export type PayrollProfileFormValue = {
  user_id: number | '';
  payroll_code: string;
  salary_template_id: number | '';
  currency: string;
  pay_group: string;
  payout_method: string;
  bank_name: string;
  bank_account_number: string;
  bank_ifsc_swift: string;
  payment_email: string;
  bank_verification_status: string;
  tax_identifier: string;
  tax_regime: string;
  pan_or_tax_id: string;
  pf_account_number: string;
  uan: string;
  esi_number: string;
  professional_tax_state: string;
  payroll_start_date: string;
  declaration_status: string;
  payout_readiness_status: string;
  compliance_readiness_status: string;
  payroll_eligible: boolean;
  reimbursements_eligible: boolean;
  is_active: boolean;
  bonus_amount: number;
  tax_amount: number;
  template_effective_from: string;
};

export const createEmptyPayrollProfileForm = (userId?: number): PayrollProfileFormValue => ({
  user_id: userId ?? '',
  payroll_code: '',
  salary_template_id: '',
  currency: 'INR',
  pay_group: '',
  payout_method: 'mock',
  bank_name: '',
  bank_account_number: '',
  bank_ifsc_swift: '',
  payment_email: '',
  bank_verification_status: 'pending',
  tax_identifier: '',
  tax_regime: 'new',
  pan_or_tax_id: '',
  pf_account_number: '',
  uan: '',
  esi_number: '',
  professional_tax_state: '',
  payroll_start_date: new Date().toISOString().slice(0, 10),
  declaration_status: 'not_started',
  payout_readiness_status: 'pending',
  compliance_readiness_status: 'pending',
  payroll_eligible: true,
  reimbursements_eligible: true,
  is_active: true,
  bonus_amount: 0,
  tax_amount: 0,
  template_effective_from: new Date().toISOString().slice(0, 10),
});

export const payrollProfileToForm = (profile?: PayrollProfile | null, lockedUserId?: number): PayrollProfileFormValue =>
  profile
    ? {
        user_id: lockedUserId ?? profile.user_id,
        payroll_code: profile.payroll_code || '',
        salary_template_id: profile.salary_template_id || '',
        currency: profile.currency || 'INR',
        pay_group: profile.pay_group || '',
        payout_method: profile.payout_method || 'mock',
        bank_name: profile.bank_name || '',
        bank_account_number: profile.bank_account_number || '',
        bank_ifsc_swift: profile.bank_ifsc_swift || '',
        payment_email: profile.payment_email || '',
        bank_verification_status: profile.bank_verification_status || 'pending',
        tax_identifier: profile.tax_identifier || '',
        tax_regime: profile.tax_regime || 'new',
        pan_or_tax_id: profile.pan_or_tax_id || '',
        pf_account_number: profile.pf_account_number || '',
        uan: profile.uan || '',
        esi_number: profile.esi_number || '',
        professional_tax_state: profile.professional_tax_state || '',
        payroll_start_date: profile.payroll_start_date || new Date().toISOString().slice(0, 10),
        declaration_status: profile.declaration_status || 'not_started',
        payout_readiness_status: profile.payout_readiness_status || 'pending',
        compliance_readiness_status: profile.compliance_readiness_status || 'pending',
        payroll_eligible: profile.payroll_eligible,
        reimbursements_eligible: profile.reimbursements_eligible,
        is_active: profile.is_active,
        bonus_amount: Number(profile.bonus_amount || 0),
        tax_amount: Number(profile.tax_amount || 0),
        template_effective_from: new Date().toISOString().slice(0, 10),
      }
    : createEmptyPayrollProfileForm(lockedUserId);

export default function PayrollProfileForm({
  employees,
  templates,
  profile,
  lockedUserId,
  defaultUserId,
  lockedUserLabel,
  onSave,
  onReset,
  isSaving = false,
  saveLabel,
}: {
  employees: Array<{ id: number; name: string; email: string }>;
  templates: SalaryTemplate[];
  profile?: PayrollProfile | null;
  lockedUserId?: number;
  defaultUserId?: number;
  lockedUserLabel?: string;
  onSave: (value: PayrollProfileFormValue) => Promise<void> | void;
  onReset?: () => void;
  isSaving?: boolean;
  saveLabel?: string;
}) {
  const [form, setForm] = useState<PayrollProfileFormValue>(profile ? payrollProfileToForm(profile, lockedUserId) : createEmptyPayrollProfileForm(defaultUserId ?? lockedUserId));

  useEffect(() => {
    setForm(profile ? payrollProfileToForm(profile, lockedUserId) : createEmptyPayrollProfileForm(defaultUserId ?? lockedUserId));
  }, [defaultUserId, profile, lockedUserId]);

  return (
    <div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <FieldLabel>Employee</FieldLabel>
          {lockedUserId ? (
            <div className="min-h-11 rounded-[20px] border border-slate-200/90 bg-slate-50/80 px-4 py-3 text-sm text-slate-700">
              {lockedUserLabel || `Employee #${lockedUserId}`}
            </div>
          ) : (
            <SelectInput value={form.user_id} onChange={(event) => setForm((current) => ({ ...current, user_id: event.target.value ? Number(event.target.value) : '' }))}>
              <option value="">Select employee</option>
              {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
            </SelectInput>
          )}
        </div>
        <div>
          <FieldLabel>Payroll Code</FieldLabel>
          <TextInput value={form.payroll_code} onChange={(event) => setForm((current) => ({ ...current, payroll_code: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Salary Template</FieldLabel>
          <SelectInput value={form.salary_template_id} onChange={(event) => setForm((current) => ({ ...current, salary_template_id: event.target.value ? Number(event.target.value) : '' }))}>
            <option value="">No template</option>
            {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Pay Group</FieldLabel>
          <TextInput value={form.pay_group} onChange={(event) => setForm((current) => ({ ...current, pay_group: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Template Effective From</FieldLabel>
          <TextInput type="date" value={form.template_effective_from} onChange={(event) => setForm((current) => ({ ...current, template_effective_from: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Payout Method</FieldLabel>
          <SelectInput value={form.payout_method} onChange={(event) => setForm((current) => ({ ...current, payout_method: event.target.value }))}>
            <option value="mock">Mock</option>
            <option value="stripe">Stripe</option>
            <option value="bank_transfer">Bank transfer</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Bank Name</FieldLabel>
          <TextInput value={form.bank_name} onChange={(event) => setForm((current) => ({ ...current, bank_name: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Account Number</FieldLabel>
          <TextInput value={form.bank_account_number} onChange={(event) => setForm((current) => ({ ...current, bank_account_number: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>IFSC / SWIFT</FieldLabel>
          <TextInput value={form.bank_ifsc_swift} onChange={(event) => setForm((current) => ({ ...current, bank_ifsc_swift: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Payment Email</FieldLabel>
          <TextInput type="email" value={form.payment_email} onChange={(event) => setForm((current) => ({ ...current, payment_email: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Bank Verification</FieldLabel>
          <SelectInput value={form.bank_verification_status} onChange={(event) => setForm((current) => ({ ...current, bank_verification_status: event.target.value }))}>
            <option value="pending">Pending</option>
            <option value="verified">Verified</option>
            <option value="unverified">Unverified</option>
            <option value="rejected">Rejected</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Default Bonus</FieldLabel>
          <TextInput type="number" value={Number(form.bonus_amount || 0)} onChange={(event) => setForm((current) => ({ ...current, bonus_amount: Number(event.target.value || 0) }))} />
        </div>
        <div>
          <FieldLabel>Default Tax</FieldLabel>
          <TextInput type="number" value={Number(form.tax_amount || 0)} onChange={(event) => setForm((current) => ({ ...current, tax_amount: Number(event.target.value || 0) }))} />
        </div>
        <div className="md:col-span-2">
          <FieldLabel>Tax Identifier</FieldLabel>
          <TextInput value={form.tax_identifier} onChange={(event) => setForm((current) => ({ ...current, tax_identifier: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Tax Regime</FieldLabel>
          <SelectInput value={form.tax_regime} onChange={(event) => setForm((current) => ({ ...current, tax_regime: event.target.value }))}>
            <option value="new">New</option>
            <option value="old">Old</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>PAN / Tax ID</FieldLabel>
          <TextInput value={form.pan_or_tax_id} onChange={(event) => setForm((current) => ({ ...current, pan_or_tax_id: event.target.value.toUpperCase() }))} />
        </div>
        <div>
          <FieldLabel>PF Account Number</FieldLabel>
          <TextInput value={form.pf_account_number} onChange={(event) => setForm((current) => ({ ...current, pf_account_number: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>UAN</FieldLabel>
          <TextInput value={form.uan} onChange={(event) => setForm((current) => ({ ...current, uan: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>ESI Number</FieldLabel>
          <TextInput value={form.esi_number} onChange={(event) => setForm((current) => ({ ...current, esi_number: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Professional Tax State</FieldLabel>
          <TextInput value={form.professional_tax_state} onChange={(event) => setForm((current) => ({ ...current, professional_tax_state: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Payroll Start Date</FieldLabel>
          <TextInput type="date" value={form.payroll_start_date} onChange={(event) => setForm((current) => ({ ...current, payroll_start_date: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Declaration Status</FieldLabel>
          <SelectInput value={form.declaration_status} onChange={(event) => setForm((current) => ({ ...current, declaration_status: event.target.value }))}>
            <option value="not_started">Not started</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Payout Readiness</FieldLabel>
          <SelectInput value={form.payout_readiness_status} onChange={(event) => setForm((current) => ({ ...current, payout_readiness_status: event.target.value }))}>
            <option value="pending">Pending</option>
            <option value="ready">Ready</option>
            <option value="blocked">Blocked</option>
          </SelectInput>
        </div>
        <div>
          <FieldLabel>Compliance Readiness</FieldLabel>
          <SelectInput value={form.compliance_readiness_status} onChange={(event) => setForm((current) => ({ ...current, compliance_readiness_status: event.target.value }))}>
            <option value="pending">Pending</option>
            <option value="ready">Ready</option>
            <option value="blocked">Blocked</option>
          </SelectInput>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-4">
        {[
          { key: 'payroll_eligible', label: 'Payroll eligible' },
          { key: 'reimbursements_eligible', label: 'Reimbursement eligible' },
          { key: 'is_active', label: 'Active in payroll' },
        ].map((item) => (
          <label key={item.key} className="flex items-center gap-2 rounded-full border border-slate-200/90 bg-slate-50/70 px-3.5 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={Boolean(form[item.key as keyof PayrollProfileFormValue])}
              onChange={(event) => setForm((current) => ({ ...current, [item.key]: event.target.checked }))}
            />
            {item.label}
          </label>
        ))}
      </div>

      <div className="mt-6 flex gap-3">
        <Button onClick={() => onSave(form)} disabled={isSaving || !form.user_id}>
          {saveLabel || (profile ? 'Update Profile' : 'Create Profile')}
        </Button>
        {onReset ? (
          <Button
            variant="secondary"
            onClick={() => {
              setForm(createEmptyPayrollProfileForm(defaultUserId ?? lockedUserId));
              onReset();
            }}
          >
            Reset
          </Button>
        ) : null}
      </div>
    </div>
  );
}
