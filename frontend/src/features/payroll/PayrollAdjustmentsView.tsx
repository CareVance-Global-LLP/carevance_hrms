import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import EmptyStateCard from '@/components/dashboard/EmptyStateCard';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { payrollWorkspaceApi } from '@/services/api';
import type { PayrollAdjustment } from '@/types';
import { Receipt, ShieldCheck, Wallet } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import { adjustmentKindLabel, defaultPayrollMonth, formatPayrollCurrency, formatPayrollMonth } from '@/features/payroll/utils';

const emptyAdjustment = {
  user_id: '',
  title: '',
  description: '',
  kind: 'bonus',
  source: 'manual',
  effective_month: defaultPayrollMonth(),
  amount: 0,
  currency: 'INR',
  status: 'draft',
  claim_reference: '',
  claim_category: '',
  merchant_name: '',
  reimbursement: {
    title: '',
    description: '',
    amount: 0,
    currency: 'INR',
  },
};

export default function PayrollAdjustmentsView() {
  const [form, setForm] = useState<any>(emptyAdjustment);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [kindFilter, setKindFilter] = useState('');
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);

  const adjustmentsQuery = useQuery({
    queryKey: ['payroll-adjustments', form.effective_month],
    queryFn: async () => (await payrollWorkspaceApi.getAdjustments({ effective_month: form.effective_month })).data,
  });

  const adjustments = adjustmentsQuery.data?.adjustments || [];
  const employees = adjustmentsQuery.data?.employees || [];
  const filteredAdjustments = useMemo(
    () => adjustments.filter((adjustment) => !kindFilter || adjustment.kind === kindFilter),
    [adjustments, kindFilter]
  );

  const saveAdjustment = async () => {
    setFeedback(null);
    try {
      const payload = {
        ...form,
        user_id: Number(form.user_id),
        amount: Number(form.amount || 0),
        reimbursement: form.kind === 'reimbursement' ? {
          ...form.reimbursement,
          amount: Number(form.reimbursement?.amount || form.amount || 0),
        } : undefined,
      };

      if (selectedId) {
        await payrollWorkspaceApi.updateAdjustment(selectedId, payload);
      } else {
        await payrollWorkspaceApi.createAdjustment(payload);
      }

      setFeedback({ tone: 'success', message: selectedId ? 'Adjustment updated.' : 'Adjustment created.' });
      setForm(emptyAdjustment);
      setSelectedId(null);
      await adjustmentsQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to save adjustment.' });
    }
  };

  const updateStatus = async (adjustmentId: number, action: 'approve' | 'reject' | 'apply') => {
    setFeedback(null);
    try {
      if (action === 'approve') await payrollWorkspaceApi.approveAdjustment(adjustmentId);
      if (action === 'reject') await payrollWorkspaceApi.rejectAdjustment(adjustmentId);
      if (action === 'apply') await payrollWorkspaceApi.applyAdjustment(adjustmentId);
      setFeedback({ tone: 'success', message: `Adjustment ${action}d successfully.` });
      await adjustmentsQuery.refetch();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to update adjustment status.' });
    }
  };

  const loadAdjustment = (adjustment: PayrollAdjustment) => {
    setSelectedId(adjustment.id);
    setForm({
      user_id: adjustment.user_id,
      title: adjustment.title,
      description: adjustment.description || '',
      kind: adjustment.kind,
      source: adjustment.source || 'manual',
      effective_month: adjustment.effective_month,
      amount: adjustment.amount,
      currency: adjustment.currency,
      status: adjustment.status,
      claim_reference: adjustment.claim_reference || '',
      claim_category: adjustment.claim_category || '',
      merchant_name: adjustment.merchant_name || '',
      reimbursement: {
        title: adjustment.reimbursement?.title || adjustment.title,
        description: adjustment.reimbursement?.description || adjustment.description || '',
        amount: adjustment.reimbursement?.amount || adjustment.amount,
        currency: adjustment.reimbursement?.currency || adjustment.currency,
      },
    });
  };

  if (adjustmentsQuery.isLoading) {
    return <PageLoadingState label="Loading payroll adjustments..." />;
  }

  if (adjustmentsQuery.isError) {
    return <PageErrorState message={(adjustmentsQuery.error as any)?.response?.data?.message || 'Failed to load payroll adjustments.'} onRetry={() => void adjustmentsQuery.refetch()} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Payroll operations"
        title="Adjustments & Variable Pay"
        description="Manage bonuses, one-time additions, manual deductions, penalties, and reimbursements in a dedicated workspace instead of burying them inside pay run detail."
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Current Month Items" value={adjustments.length} hint="Adjustments in the selected month." icon={Wallet} accent="sky" />
        <MetricCard label="Pending Approval" value={adjustments.filter((item) => item.status === 'pending_approval').length} hint="Needs reviewer action." icon={ShieldCheck} accent="amber" />
        <MetricCard label="Approved / Applied" value={adjustments.filter((item) => ['approved', 'applied'].includes(item.status)).length} hint="Ready or already used in payroll." icon={ShieldCheck} accent="emerald" />
        <MetricCard label="Adjustment Value" value={formatPayrollCurrency(adjustments.reduce((sum, item) => sum + Number(item.amount || 0), 0))} hint="Combined value in current filter." icon={Receipt} accent="violet" />
      </div>

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div>
          <FieldLabel>Effective Month</FieldLabel>
          <TextInput type="month" value={form.effective_month} onChange={(event) => setForm((current: any) => ({ ...current, effective_month: event.target.value }))} />
        </div>
        <div>
          <FieldLabel>Kind</FieldLabel>
          <SelectInput value={kindFilter} onChange={(event) => setKindFilter(event.target.value)}>
            <option value="">All kinds</option>
            <option value="reimbursement">Reimbursement</option>
            <option value="bonus">Bonus</option>
            <option value="manual_deduction">Manual deduction</option>
            <option value="penalty">Penalty</option>
            <option value="one_time_adjustment">One-time adjustment</option>
          </SelectInput>
        </div>
        <div className="flex items-end">
          <Button variant="secondary" className="w-full" onClick={() => setKindFilter('')}>Clear Filter</Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.95fr_1.05fr]">
        <PayrollSectionCard title={selectedId ? 'Update Adjustment' : 'Create Adjustment'} description="Capture variable pay and payroll-impacting changes outside live payroll runs.">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <FieldLabel>Employee</FieldLabel>
              <SelectInput value={form.user_id} onChange={(event) => setForm((current: any) => ({ ...current, user_id: event.target.value }))}>
                <option value="">Select employee</option>
                {employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Kind</FieldLabel>
              <SelectInput value={form.kind} onChange={(event) => setForm((current: any) => ({ ...current, kind: event.target.value }))}>
                <option value="bonus">Bonus</option>
                <option value="one_time_adjustment">One-time adjustment</option>
                <option value="manual_deduction">Manual deduction</option>
                <option value="penalty">Penalty</option>
                <option value="reimbursement">Reimbursement</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Effective Month</FieldLabel>
              <TextInput type="month" value={form.effective_month} onChange={(event) => setForm((current: any) => ({ ...current, effective_month: event.target.value }))} />
            </div>
            <div>
              <FieldLabel>Source</FieldLabel>
              <SelectInput value={form.source} onChange={(event) => setForm((current: any) => ({ ...current, source: event.target.value }))}>
                <option value="manual">Manual</option>
                <option value="reimbursement_claim">Reimbursement claim</option>
                <option value="attendance_correction">Attendance correction</option>
                <option value="manager_override">Manager override</option>
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Amount</FieldLabel>
              <TextInput type="number" min={0} value={Number(form.amount || 0)} onChange={(event) => setForm((current: any) => ({ ...current, amount: Number(event.target.value || 0) }))} />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Title</FieldLabel>
              <TextInput value={form.title} onChange={(event) => setForm((current: any) => ({ ...current, title: event.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Description</FieldLabel>
              <TextInput value={form.description} onChange={(event) => setForm((current: any) => ({ ...current, description: event.target.value }))} />
            </div>
            <div>
              <FieldLabel>Claim Reference</FieldLabel>
              <TextInput value={form.claim_reference} onChange={(event) => setForm((current: any) => ({ ...current, claim_reference: event.target.value }))} />
            </div>
            <div>
              <FieldLabel>Claim Category</FieldLabel>
              <TextInput value={form.claim_category} onChange={(event) => setForm((current: any) => ({ ...current, claim_category: event.target.value }))} />
            </div>
            <div className="md:col-span-2">
              <FieldLabel>Merchant / Vendor</FieldLabel>
              <TextInput value={form.merchant_name} onChange={(event) => setForm((current: any) => ({ ...current, merchant_name: event.target.value }))} />
            </div>
          </div>

          {form.kind === 'reimbursement' ? (
            <div className="mt-5 rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
              <p className="text-sm font-semibold text-slate-950">Reimbursement Claim Details</p>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <FieldLabel>Claim Title</FieldLabel>
                  <TextInput value={form.reimbursement.title} onChange={(event) => setForm((current: any) => ({ ...current, reimbursement: { ...current.reimbursement, title: event.target.value } }))} />
                </div>
                <div>
                  <FieldLabel>Claim Amount</FieldLabel>
                  <TextInput type="number" min={0} value={Number(form.reimbursement.amount || 0)} onChange={(event) => setForm((current: any) => ({ ...current, reimbursement: { ...current.reimbursement, amount: Number(event.target.value || 0) } }))} />
                </div>
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex gap-3">
            <Button onClick={saveAdjustment} disabled={!form.user_id || !form.title.trim()}>Save Adjustment</Button>
            <Button variant="secondary" onClick={() => { setSelectedId(null); setForm(emptyAdjustment); }}>Reset</Button>
          </div>
        </PayrollSectionCard>

        <PayrollSectionCard title="Adjustment Queue" description="Review approval state, payroll impact, and employee-level context before a run is processed.">
          {filteredAdjustments.length === 0 ? (
            <EmptyStateCard title="No adjustments found" description="Try another month or create a new variable pay item." icon={Receipt} />
          ) : (
            <div className="space-y-3">
              {filteredAdjustments.map((adjustment) => (
                <div key={adjustment.id} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{adjustment.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{adjustment.user?.name} • {adjustmentKindLabel(adjustment.kind)} • {formatPayrollMonth(adjustment.effective_month)}</p>
                    </div>
                    <PayrollStatusBadge status={adjustment.status} />
                  </div>
                  <p className="mt-3 text-lg font-semibold text-slate-950">{formatPayrollCurrency(adjustment.amount, adjustment.currency)}</p>
                  <p className="mt-1 text-sm text-slate-500">{adjustment.description || 'No description provided.'}</p>
                  <div className="mt-3 rounded-[18px] border border-dashed border-slate-300 bg-white/70 px-3 py-2 text-xs text-slate-500">
                    {adjustment.appliedRun ? `Linked to ${adjustment.appliedRun.run_code} for ${formatPayrollMonth(adjustment.appliedRun.payroll_month)}.` : 'Not linked to a pay run yet.'}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => loadAdjustment(adjustment)}>Edit</Button>
                    <Button size="sm" variant="secondary" onClick={() => updateStatus(adjustment.id, 'approve')}>Approve</Button>
                    <Button size="sm" variant="secondary" onClick={() => updateStatus(adjustment.id, 'apply')}>Apply</Button>
                    <Button size="sm" variant="danger" onClick={() => updateStatus(adjustment.id, 'reject')}>Reject</Button>
                    <Link to={`/payroll/employees/${adjustment.user_id}`}>
                      <Button size="sm" variant="secondary">Open Employee</Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </PayrollSectionCard>
      </div>
    </div>
  );
}
