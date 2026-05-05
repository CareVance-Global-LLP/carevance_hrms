import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import Button from '@/components/ui/Button';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { employeeWorkspaceApi, payrollWorkspaceApi } from '@/services/api';
import { ArrowLeft, Clock3, Landmark, Receipt, ShieldCheck, Wallet } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollInfoList from '@/features/payroll/components/PayrollInfoList';
import PayrollWarningPanel from '@/features/payroll/components/PayrollWarningPanel';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import PayrollProfileForm, { type PayrollProfileFormValue } from '@/features/payroll/components/PayrollProfileForm';
import {
  formatPayrollCurrency,
  formatPayrollDuration,
  formatPayrollMonth,
  maskBankAccount,
  payrollCompensationSourceLabel,
  templateAssignmentLabel,
} from '@/features/payroll/utils';

export default function PayrollEmployeeDetailView() {
  const { employeeId } = useParams();
  const id = Number(employeeId || 0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const payrollMonth = new Date().toISOString().slice(0, 7);

  const workspaceQuery = useQuery({
    queryKey: ['payroll-employee-detail', id, payrollMonth],
    queryFn: async () => (await employeeWorkspaceApi.getWorkspace(id, { payroll_month: payrollMonth })).data,
    enabled: id > 0,
  });

  const optionsQuery = useQuery({
    queryKey: ['payroll-employee-options', id],
    queryFn: async () => (await payrollWorkspaceApi.getProfiles()).data,
    enabled: id > 0,
  });

  const saveProfile = useMutation({
    mutationFn: async (form: PayrollProfileFormValue) => {
      const payload = {
        ...form,
        user_id: Number(form.user_id),
        salary_template_id: form.salary_template_id ? Number(form.salary_template_id) : undefined,
        bonus_amount: Number(form.bonus_amount || 0),
        tax_amount: Number(form.tax_amount || 0),
      };

      const currentProfile = workspaceQuery.data?.payroll.profile;
      if (currentProfile?.id) {
        return payrollWorkspaceApi.updateProfile(currentProfile.id, payload);
      }
      return payrollWorkspaceApi.createProfile(payload);
    },
    onSuccess: async () => {
      setFeedback({ tone: 'success', message: 'Employee payroll profile saved.' });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payroll-employee-detail', id, payrollMonth] }),
        queryClient.invalidateQueries({ queryKey: ['payroll-employee-options', id] }),
        queryClient.invalidateQueries({ queryKey: ['payroll-workspace-profiles'] }),
      ]);
    },
    onError: (error: any) => {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to save employee payroll profile.' });
    },
  });

  const data = workspaceQuery.data;
  const templates = optionsQuery.data?.templates || [];
  const employees = optionsQuery.data?.employees || [];
  const defaultBank = useMemo(
    () => data?.bank_accounts.find((item) => item.is_default) || data?.bank_accounts[0],
    [data?.bank_accounts]
  );
  const profile = data?.payroll.profile || null;
  const compensationSnapshot = data?.payroll.current_compensation?.snapshot || {};
  const compensationSource = data?.payroll.current_compensation?.source || 'none';
  const revisionCount = data?.payroll.salary_assignments.length || 0;
  const latestAssignment = data?.payroll.salary_assignments[0] || null;
  const bankStatus = defaultBank?.verification_status || (profile?.bank_account_number || profile?.payment_email ? 'verified' : 'incomplete');
  const payrollAlerts = useMemo(() => {
    const alerts = [...(data?.payroll.warnings || []), ...(data?.readiness.payout_readiness.warnings || [])];
    return Array.from(new Set(alerts));
  }, [data?.payroll.warnings, data?.readiness.payout_readiness.warnings]);

  if (workspaceQuery.isLoading || optionsQuery.isLoading) {
    return <PageLoadingState label="Loading payroll employee record..." />;
  }

  if (workspaceQuery.isError || !data) {
    return <PageErrorState message={(workspaceQuery.error as any)?.response?.data?.message || 'Failed to load employee payroll record.'} onRetry={() => void workspaceQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <div className="rounded-[24px] border border-white/70 bg-white/80 px-4 py-4 shadow-[0_20px_60px_-40px_rgba(15,23,42,0.2)] backdrop-blur">
        <Button variant="secondary" onClick={() => navigate('/payroll/employees')}>
          <ArrowLeft className="h-4 w-4" />
          Back to Payroll Employees
        </Button>
      </div>

      <PageHeader
        eyebrow="Payroll employee record"
        title={data.employee.name}
        description="Dedicated payroll record with readiness checks, payout configuration, salary assignment history, and compensation context for this employee."
        actions={(
          <>
            <Link to={`/employees/${data.employee.id}?tab=payroll`}>
              <Button variant="secondary">Open full employee workspace</Button>
            </Link>
            <Link to="/payroll/runs">
              <Button>Open Pay Runs</Button>
            </Link>
          </>
        )}
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Payroll Status" value={profile?.is_active ? 'Active' : profile ? 'Inactive' : 'Not set'} hint="Whether this employee currently has an active payroll record." icon={ShieldCheck} accent={profile?.is_active ? 'emerald' : 'amber'} />
        <MetricCard label="Eligibility" value={profile?.payroll_eligible ? 'Eligible' : 'Needs review'} hint="Current inclusion state for payroll processing." icon={Wallet} accent={profile?.payroll_eligible ? 'sky' : 'amber'} />
        <MetricCard label="Bank Status" value={String(bankStatus).replace(/_/g, ' ')} hint="Default payout destination verification state." icon={Landmark} accent={bankStatus === 'verified' ? 'emerald' : 'amber'} />
        <MetricCard label="Salary Revisions" value={revisionCount} hint="Effective-date salary template assignments on record." icon={Receipt} accent="violet" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-5">
          <PayrollSectionCard
            title="Payroll Record Summary"
            description="Primary payroll identity for this employee, including current template, payout method, readiness, and revision context."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <PayrollStatusBadge status={profile?.is_active ? 'active' : 'inactive'} />
                <PayrollStatusBadge status={profile?.payroll_eligible ? 'eligible' : 'ineligible'} />
                <PayrollStatusBadge status={bankStatus} />
                <PayrollStatusBadge status={profile?.payout_method || 'incomplete'} />
              </div>

              <PayrollInfoList
                items={[
                  { label: 'Salary template', value: templateAssignmentLabel(profile?.salary_template), emphasize: true },
                  { label: 'Compensation source', value: payrollCompensationSourceLabel(compensationSource) },
                  { label: 'Payout method', value: profile?.payout_method || defaultBank?.payout_method || 'Not configured' },
                  { label: 'Bank destination', value: defaultBank?.account_number ? maskBankAccount(defaultBank.account_number) : maskBankAccount(profile?.bank_account_number) },
                  { label: 'Latest revision', value: latestAssignment ? formatPayrollMonth(latestAssignment.effective_from) : 'No salary assignment yet' },
                  { label: 'Readiness score', value: `${data.readiness.overall_percentage || 0}%` },
                  { label: 'Default bonus', value: formatPayrollCurrency(Number(profile?.bonus_amount || 0), profile?.currency || 'INR') },
                  { label: 'Default tax', value: formatPayrollCurrency(Number(profile?.tax_amount || 0), profile?.currency || 'INR') },
                ]}
                columns={2}
              />
            </div>
          </PayrollSectionCard>

          <PayrollSectionCard
            title="Compensation Snapshot"
            description="Current salary source and breakup resolved from the payroll workspace. Templates are preferred, while legacy structures remain valid fallback."
          >
            <div className="space-y-4">
              <PayrollInfoList
                items={[
                  { label: 'Payroll month', value: formatPayrollMonth(data.payroll_month) },
                  { label: 'Basic salary', value: formatPayrollCurrency(Number(compensationSnapshot.basic_salary || 0), profile?.currency || 'INR'), emphasize: true },
                  { label: 'Allowances', value: formatPayrollCurrency(Number(compensationSnapshot.allowances || 0), profile?.currency || 'INR') },
                  { label: 'Bonus', value: formatPayrollCurrency(Number(compensationSnapshot.bonus || 0), profile?.currency || 'INR') },
                  { label: 'Deductions + Tax', value: formatPayrollCurrency(Number(compensationSnapshot.deductions || 0) + Number(compensationSnapshot.tax || 0), profile?.currency || 'INR') },
                  { label: 'Estimated net', value: formatPayrollCurrency(Number(compensationSnapshot.net_salary || 0), profile?.currency || 'INR'), emphasize: true },
                ]}
                columns={3}
              />

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-950">Earning components</p>
                  <div className="mt-3 space-y-2">
                    {(compensationSnapshot.earnings_components || []).length === 0 ? (
                      <p className="text-sm text-slate-500">No earning components were returned for the current compensation source.</p>
                    ) : (compensationSnapshot.earnings_components || []).map((item: any) => (
                      <div key={`${item.salary_component_id}-${item.name}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-600">{item.name}</span>
                        <span className="font-medium text-slate-950">{formatPayrollCurrency(Number(item.computed_amount || 0), profile?.currency || 'INR')}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-950">Deduction components</p>
                  <div className="mt-3 space-y-2">
                    {(compensationSnapshot.deduction_components || []).length === 0 ? (
                      <p className="text-sm text-slate-500">No deduction components were returned for the current compensation source.</p>
                    ) : (compensationSnapshot.deduction_components || []).map((item: any) => (
                      <div key={`${item.salary_component_id}-${item.name}`} className="flex items-center justify-between gap-3 text-sm">
                        <span className="text-slate-600">{item.name}</span>
                        <span className="font-medium text-slate-950">{formatPayrollCurrency(Number(item.computed_amount || 0), profile?.currency || 'INR')}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </PayrollSectionCard>

          <PayrollSectionCard
            title="Salary Revision History"
            description="Effective-date template assignments already stored in the payroll workspace."
          >
            <div className="space-y-3">
              {data.payroll.salary_assignments.length === 0 ? (
                <p className="text-sm text-slate-500">No salary assignment history yet.</p>
              ) : data.payroll.salary_assignments.map((assignment) => (
                <div key={assignment.id} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{assignment.salary_template?.name || 'Template removed'}</p>
                      <p className="mt-1 text-sm text-slate-500">
                        Effective from {assignment.effective_from}{assignment.effective_to ? ` to ${assignment.effective_to}` : ''}
                      </p>
                    </div>
                    <PayrollStatusBadge status={assignment.is_active ? 'active' : 'historical'} />
                  </div>
                </div>
              ))}
            </div>
          </PayrollSectionCard>
        </div>

        <div className="space-y-5">
          <PayrollSectionCard
            title="Missing Setup Alerts"
            description="Operational checks used by pay runs to confirm payroll eligibility and payout readiness."
          >
            <div className="space-y-4">
              <PayrollWarningPanel title="Payroll record validation" warnings={payrollAlerts} successMessage="The employee payroll record is currently ready for payroll processing and payout." />
              <PayrollInfoList
                items={[
                  { label: 'Payroll ready', value: data.readiness.payroll_readiness.is_ready ? 'Yes' : 'Needs setup', emphasize: true },
                  { label: 'Payout ready', value: data.readiness.payout_readiness.is_ready ? 'Yes' : 'Needs setup', emphasize: true },
                  { label: 'Declaration status', value: data.readiness.declaration_status || profile?.declaration_status || 'not_started' },
                  { label: 'Compliance status', value: data.readiness.compliance_status || profile?.compliance_readiness_status || 'pending' },
                  { label: 'Missing sections', value: data.readiness.missing_sections.length ? data.readiness.missing_sections.join(', ') : 'None' },
                  { label: 'Eligibility state', value: profile?.payroll_eligible ? 'Included in payroll' : 'Excluded until reviewed' },
                ]}
                columns={2}
              />
            </div>
          </PayrollSectionCard>

          <PayrollSectionCard
            title="Edit Payroll Profile"
            description="Use the form for payroll profile maintenance. The record summary above stays focused on operational context and readiness."
          >
            <PayrollProfileForm
              employees={employees}
              templates={templates}
              profile={profile}
              lockedUserId={data.employee.id}
              lockedUserLabel={`${data.employee.name} (${data.employee.email})`}
              onSave={(form) => saveProfile.mutate(form)}
              isSaving={saveProfile.isPending}
              saveLabel={profile ? 'Update Payroll Profile' : 'Create Payroll Profile'}
            />
          </PayrollSectionCard>

          <PayrollSectionCard
            title="Payment and Tax Details"
            description="Bank, payment, and compliance-facing details currently available in the backend."
          >
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                <PayrollStatusBadge status={profile?.payout_method || defaultBank?.payout_method || 'incomplete'} />
                <PayrollStatusBadge status={bankStatus} />
                {profile?.tax_identifier ? <PayrollStatusBadge status="verified" /> : <PayrollStatusBadge status="incomplete" />}
              </div>
              <PayrollInfoList
                items={[
                  { label: 'Bank name', value: defaultBank?.bank_name || profile?.bank_name },
                  { label: 'Account number', value: defaultBank?.account_number ? maskBankAccount(defaultBank.account_number) : maskBankAccount(profile?.bank_account_number) },
                  { label: 'IFSC / SWIFT', value: defaultBank?.ifsc_swift || profile?.bank_ifsc_swift },
                  { label: 'Payment email', value: defaultBank?.payment_email || profile?.payment_email },
                  { label: 'Tax identifier', value: profile?.tax_identifier || 'Not captured yet' },
                  { label: 'PAN / Tax ID', value: profile?.pan_or_tax_id || 'Not captured yet' },
                  { label: 'Tax regime', value: profile?.tax_regime || 'Not selected' },
                  { label: 'PF / UAN', value: profile?.pf_account_number || profile?.uan || 'Not captured yet' },
                  { label: 'ESI number', value: profile?.esi_number || 'Not captured yet' },
                  { label: 'Professional tax state', value: profile?.professional_tax_state || 'Not captured yet' },
                  { label: 'Bank verification', value: String(bankStatus).replace(/_/g, ' ') },
                ]}
                columns={2}
              />
            </div>
          </PayrollSectionCard>

          <PayrollSectionCard
            title="Tax Declarations"
            description="Current financial-year declarations and review state used for TDS readiness."
          >
            <div className="space-y-3">
              {(data.payroll.tax_declarations || []).length === 0 ? (
                <p className="text-sm text-slate-500">No tax declarations have been submitted for this employee yet. Payroll will fall back to the profile tax amount until one is approved.</p>
              ) : (data.payroll.tax_declarations || []).map((declaration) => (
                <div key={declaration.id} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{declaration.financial_year}</p>
                      <p className="mt-1 text-sm text-slate-500">{declaration.tax_regime} regime</p>
                    </div>
                    <PayrollStatusBadge status={declaration.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-1 gap-2 text-sm md:grid-cols-3">
                    <div>
                      <p className="text-slate-500">Investments</p>
                      <p className="font-semibold text-slate-950">{formatPayrollCurrency(Number(declaration.sections?.investments?.total || 0), profile?.currency || 'INR')}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Exemptions</p>
                      <p className="font-semibold text-slate-950">{formatPayrollCurrency(Number(declaration.sections?.exemptions?.total || 0), profile?.currency || 'INR')}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Other income</p>
                      <p className="font-semibold text-slate-950">{formatPayrollCurrency(Number(declaration.sections?.other_income?.total || 0), profile?.currency || 'INR')}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </PayrollSectionCard>

          <PayrollSectionCard
            title="Adjustments and Reimbursements"
            description="Most recent payroll-impacting changes returned for this employee."
          >
            <div className="space-y-3">
              {data.payroll.recent_adjustments.length === 0 ? (
                <p className="text-sm text-slate-500">No recent payroll adjustments were returned for this employee.</p>
              ) : data.payroll.recent_adjustments.map((adjustment) => (
                <div key={adjustment.id} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{adjustment.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{formatPayrollMonth(adjustment.effective_month)} | {adjustment.kind.replace(/_/g, ' ')}</p>
                    </div>
                    <div className="text-right">
                      <PayrollStatusBadge status={adjustment.status} />
                      <p className="mt-2 text-sm font-semibold text-slate-950">{formatPayrollCurrency(adjustment.amount, adjustment.currency)}</p>
                    </div>
                  </div>
                </div>
              ))}
              <Link to="/payroll/adjustments" className="inline-flex text-sm font-semibold text-sky-700">
                Open payroll adjustments workspace
              </Link>
            </div>
          </PayrollSectionCard>

          <PayrollSectionCard
            title="Connected Payroll Signals"
            description="Useful attendance, reimbursement, and payslip context that influences payroll processing."
          >
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <MetricCard label="Payable Days" value={data.attendance.payable_days || 0} hint="Attendance plus approved leave." icon={Wallet} accent="sky" />
              <MetricCard label="Worked Time" value={formatPayrollDuration(Number(data.attendance.worked_seconds || 0))} hint="Resolved from attendance and time tracking." icon={Clock3} accent="emerald" />
              <MetricCard label="Pending Reimbursements" value={data.payroll.pending_reimbursements || 0} hint="Open reimbursement queue." icon={Receipt} accent="amber" />
              <MetricCard label="Payslips Issued" value={data.overview.payslips_count || 0} hint="Generated for this employee so far." icon={Receipt} accent="violet" />
            </div>
          </PayrollSectionCard>
        </div>
      </div>
    </div>
  );
}
