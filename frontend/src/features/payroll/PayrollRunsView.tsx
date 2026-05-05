import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import DataTable from '@/components/dashboard/DataTable';
import EmptyStateCard from '@/components/dashboard/EmptyStateCard';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { payrollApi, payrollWorkspaceApi } from '@/services/api';
import type { PayrollRecord, PayrollRunItem } from '@/types';
import { AlertTriangle, RefreshCw, Send, ShieldCheck, Users, Wallet } from 'lucide-react';
import PayrollSectionCard from '@/features/payroll/components/PayrollSectionCard';
import PayrollStatusBadge from '@/features/payroll/components/PayrollStatusBadge';
import PayrollWarningPanel from '@/features/payroll/components/PayrollWarningPanel';
import { defaultPayrollMonth, formatPayrollCurrency, formatPayrollDuration, payrollGrossAmount, payrollTotalDeductions } from '@/features/payroll/utils';

type WorkflowStep = {
  key: string;
  label: string;
  detail: string;
  state: 'complete' | 'current' | 'blocked';
};

export default function PayrollRunsView() {
  const [payrollMonth, setPayrollMonth] = useState(defaultPayrollMonth());
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [generateEmployeeId, setGenerateEmployeeId] = useState<number | ''>('');
  const [generatePayoutMethod, setGeneratePayoutMethod] = useState<'mock' | 'stripe' | 'bank_transfer'>('mock');
  const [allowOverwrite, setAllowOverwrite] = useState(false);
  const [selectedPayrollDraft, setSelectedPayrollDraft] = useState<PayrollRecord | null>(null);
  const [validatedRunIds, setValidatedRunIds] = useState<number[]>([]);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const employeesQuery = useQuery({
    queryKey: ['payroll-run-employees'],
    queryFn: async () => (await payrollApi.getEmployees()).data.data,
  });

  const runsQuery = useQuery({
    queryKey: ['payroll-runs', payrollMonth],
    queryFn: async () => (await payrollWorkspaceApi.getRuns({ payroll_month: payrollMonth })).data.data,
  });

  const runDetailQuery = useQuery({
    queryKey: ['payroll-run-detail', selectedRunId],
    queryFn: async () => (await payrollWorkspaceApi.getRun(selectedRunId as number)).data,
    enabled: Boolean(selectedRunId),
  });

  useEffect(() => {
    if (!runsQuery.data?.length) {
      setSelectedRunId(null);
      return;
    }
    if (!selectedRunId || !runsQuery.data.some((run) => run.id === selectedRunId)) {
      setSelectedRunId(runsQuery.data[0].id);
    }
  }, [runsQuery.data, selectedRunId]);

  const selectedRun = runDetailQuery.data?.run || null;
  const items = selectedRun?.items || [];
  const selectedItem = useMemo(
    () => selectedRun?.items?.find((item) => item.id === selectedItemId) || selectedRun?.items?.[0] || null,
    [selectedItemId, selectedRun?.items]
  );

  useEffect(() => {
    if (!selectedRun?.items?.length) {
      setSelectedItemId(null);
      setSelectedPayrollDraft(null);
      return;
    }
    if (!selectedItemId || !selectedRun.items.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(selectedRun.items[0].id);
    }
  }, [selectedItemId, selectedRun?.items]);

  useEffect(() => {
    if (!generateEmployeeId || !selectedRun?.items?.length) return;
    const matchingItem = selectedRun.items.find((item) => item.user_id === Number(generateEmployeeId));
    if (matchingItem && matchingItem.id !== selectedItemId) {
      setSelectedItemId(matchingItem.id);
    }
  }, [generateEmployeeId, selectedItemId, selectedRun?.items]);

  useEffect(() => {
    setSelectedPayrollDraft(selectedItem?.payroll ? { ...selectedItem.payroll } : null);
  }, [selectedItem]);

  const summary = useMemo(() => ({
    gross: items.reduce((sum, item) => sum + Number(item.gross_pay || 0), 0),
    net: items.reduce((sum, item) => sum + Number(item.net_pay || 0), 0),
    readyForPayout: items.filter((item) => item.payroll?.payroll_status === 'processed' && item.payroll?.payout_status !== 'success').length,
    warnings: items.reduce((sum, item) => sum + (item.warnings?.length || 0), 0),
    drafts: items.filter((item) => item.payroll?.payroll_status === 'draft').length,
    paid: items.filter((item) => item.payroll?.payroll_status === 'paid').length,
  }), [items]);

  const runWarnings = useMemo(
    () => (selectedRun?.warnings || []).flatMap((entry) => entry.warnings.map((warning) => `${selectedRun.items?.find((item) => item.user_id === entry.user_id)?.user?.name || 'Employee'}: ${warning}`)),
    [selectedRun]
  );

  const approvalTimeline = runDetailQuery.data?.approval_timeline || [];

  const runStage = useMemo(() => {
    if (!selectedRun) return 'draft';
    if (['validated', 'manager_approved', 'finance_approved', 'processed', 'paid'].includes(selectedRun.status)) return selectedRun.status;
    if (items.length > 0 && items.every((item) => item.payroll?.payroll_status === 'paid')) return 'paid';
    if (items.length > 0 && items.every((item) => ['processed', 'paid'].includes(item.payroll?.payroll_status || 'draft'))) return 'processed';
    if (selectedRun.status === 'approved') return 'approved';
    return 'draft';
  }, [items, selectedRun]);

  const isValidated = useMemo(
    () => Boolean(selectedRun && (validatedRunIds.includes(selectedRun.id) || ['validated', 'approved', 'manager_approved', 'finance_approved', 'processed', 'paid', 'finalized', 'locked'].includes(selectedRun.status))),
    [selectedRun, validatedRunIds]
  );

  const workflowSteps = useMemo<WorkflowStep[]>(() => {
    const managerApproved = ['manager_approved', 'finance_approved', 'processed', 'paid'].includes(runStage);
    const financeApproved = ['finance_approved', 'processed', 'paid'].includes(runStage);
    const processed = ['processed', 'paid'].includes(runStage);
    const paid = runStage === 'paid';
    return [
      { key: 'draft', label: 'Draft', detail: `${summary.drafts} draft records`, state: isValidated ? 'complete' : 'current' },
      { key: 'validate', label: 'Validate', detail: runWarnings.length > 0 ? `${runWarnings.length} blockers` : 'Ready for manager review', state: runStage !== 'draft' || isValidated ? 'complete' : 'current' },
      { key: 'manager', label: 'Manager Approval', detail: managerApproved ? 'Manager approved' : 'Awaiting manager sign-off', state: managerApproved ? 'complete' : (isValidated ? 'current' : 'blocked') },
      { key: 'finance', label: 'Finance Approval', detail: financeApproved ? 'Finance approved' : 'Awaiting finance sign-off', state: financeApproved ? 'complete' : (managerApproved ? 'current' : 'blocked') },
      { key: 'process', label: 'Process', detail: `${items.filter((item) => item.payroll?.payroll_status === 'processed').length} processed`, state: processed ? 'complete' : (financeApproved ? 'current' : 'blocked') },
      { key: 'payout', label: 'Payout', detail: `${summary.readyForPayout} pending payout`, state: paid ? 'complete' : (processed ? 'current' : 'blocked') },
      { key: 'publish', label: 'Publish Payslips', detail: paid ? 'Ready to issue' : 'Awaiting paid run', state: paid ? 'current' : 'blocked' },
    ];
  }, [isValidated, items, runStage, runWarnings.length, summary.drafts, summary.readyForPayout]);

  const currentWorkflowStep = workflowSteps.find((step) => step.state === 'current') || workflowSteps[workflowSteps.length - 1];

  const refetchAll = async () => {
    await Promise.all([runsQuery.refetch(), runDetailQuery.refetch()]);
  };

  const validateRun = async () => {
    if (!selectedRun) return;
    setValidatedRunIds((current) => current.includes(selectedRun.id) ? current : [...current, selectedRun.id]);
    if (runWarnings.length === 0) {
      await updateRunStage('validated', 'Validation completed. This run is ready for manager approval.');
      return;
    }
    setFeedback({
      tone: 'error',
      message: 'Validation completed with blockers. Review the warnings before approval.',
    });
  };

  const updateRunStage = async (status: string, successMessage: string) => {
    if (!selectedRun) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollWorkspaceApi.updateRunStatus(selectedRun.id, status);
      setFeedback({ tone: 'success', message: successMessage });
      await refetchAll();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to update pay run status.' });
    } finally {
      setIsSaving(false);
    }
  };

  const approveRun = async () => {
    if (runWarnings.length > 0) {
      setFeedback({ tone: 'error', message: 'Resolve validation blockers before approval.' });
      return;
    }
    await updateRunStage('manager_approved', 'Pay run approved and ready for finance review.');
  };

  const generateRun = async () => {
    setFeedback(null);
    setIsSaving(true);
    try {
      const response = await payrollApi.generateRecords({
        payroll_month: payrollMonth,
        user_id: generateEmployeeId || undefined,
        payout_method: generatePayoutMethod,
        allow_overwrite: allowOverwrite,
      });
      setFeedback({ tone: 'success', message: response.data.message || 'Payroll generation completed.' });
      await refetchAll();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to generate payroll.' });
    } finally {
      setIsSaving(false);
    }
  };

  const processRun = async () => {
    if (!selectedRun?.items?.length) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      const targetPayrolls = selectedRun.items
        .filter((item) => item.payroll_id && item.payroll?.payroll_status === 'draft')
        .map((item) => item.payroll_id as number);

      await Promise.all(targetPayrolls.map((payrollId) => payrollApi.updateRecordStatus(payrollId, 'processed')));
      if (targetPayrolls.length > 0) {
        await payrollWorkspaceApi.updateRunStatus(selectedRun.id, 'processed');
      }
      setFeedback({ tone: 'success', message: targetPayrolls.length > 0 ? 'Draft payroll items were marked processed.' : 'No draft payroll items needed processing.' });
      await refetchAll();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to process selected run.' });
    } finally {
      setIsSaving(false);
    }
  };

  const payoutRun = async () => {
    if (!selectedRun?.items?.length) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      const stripeItems = selectedRun.items.filter((item) => item.payroll?.payout_method === 'stripe' && item.payroll?.payout_status !== 'success');
      if (stripeItems.length > 0) {
        setFeedback({ tone: 'error', message: 'This run contains Stripe payouts. Complete those from the employee drilldown so checkout redirects can be handled safely.' });
        return;
      }

      const targetPayrolls = selectedRun.items
        .filter((item) => item.payroll_id && item.payroll?.payroll_status === 'processed' && item.payroll?.payout_status !== 'success')
        .map((item) => item.payroll_id as number);

      await Promise.all(targetPayrolls.map((payrollId) => payrollApi.payoutRecord(payrollId)));
      setFeedback({ tone: 'success', message: targetPayrolls.length > 0 ? 'Eligible payouts were submitted for this run.' : 'No processed payroll items were ready for payout.' });
      await refetchAll();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to run payouts for this pay run.' });
    } finally {
      setIsSaving(false);
    }
  };

  const publishPayslips = async () => {
    if (!selectedRun?.items?.length) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await Promise.all(selectedRun.items.map((item) => payrollApi.generatePayslip({ user_id: item.user_id, period_month: payrollMonth })));
      setFeedback({ tone: 'success', message: 'Payslips were generated for the selected run. They become available immediately because publish state is not modeled yet in the backend.' });
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to generate payslips for this run.' });
    } finally {
      setIsSaving(false);
    }
  };

  const updateDraftField = (field: keyof PayrollRecord, value: number | string) => {
    if (!selectedPayrollDraft) return;
    const next = { ...selectedPayrollDraft, [field]: value } as PayrollRecord;
    const netSalary = Number(next.basic_salary || 0) + Number(next.allowances || 0) + Number(next.bonus || 0) - Number(next.deductions || 0) - Number(next.tax || 0);
    next.net_salary = Math.max(0, netSalary);
    setSelectedPayrollDraft(next);
  };

  const saveSelectedPayroll = async () => {
    if (!selectedPayrollDraft) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollApi.updateRecord(selectedPayrollDraft.id, {
        basic_salary: Number(selectedPayrollDraft.basic_salary || 0),
        allowances: Number(selectedPayrollDraft.allowances || 0),
        deductions: Number(selectedPayrollDraft.deductions || 0),
        bonus: Number(selectedPayrollDraft.bonus || 0),
        tax: Number(selectedPayrollDraft.tax || 0),
        payout_method: selectedPayrollDraft.payout_method,
      });
      setFeedback({ tone: 'success', message: 'Selected payroll record updated.' });
      await refetchAll();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to update payroll record.' });
    } finally {
      setIsSaving(false);
    }
  };

  const processSelectedPayroll = async () => {
    if (!selectedPayrollDraft) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollApi.updateRecordStatus(selectedPayrollDraft.id, 'processed');
      setFeedback({ tone: 'success', message: 'Selected payroll record marked processed.' });
      await refetchAll();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to process selected payroll record.' });
    } finally {
      setIsSaving(false);
    }
  };

  const payoutSelectedPayroll = async (simulateStatus?: 'success' | 'failed' | 'pending') => {
    if (!selectedPayrollDraft) return;
    setFeedback(null);
    setIsSaving(true);
    try {
      await payrollApi.updateRecord(selectedPayrollDraft.id, {
        basic_salary: Number(selectedPayrollDraft.basic_salary || 0),
        allowances: Number(selectedPayrollDraft.allowances || 0),
        deductions: Number(selectedPayrollDraft.deductions || 0),
        bonus: Number(selectedPayrollDraft.bonus || 0),
        tax: Number(selectedPayrollDraft.tax || 0),
        payout_method: selectedPayrollDraft.payout_method,
      });
      const response = await payrollApi.payoutRecord(selectedPayrollDraft.id, {
        payout_method: selectedPayrollDraft.payout_method,
        simulate_status: simulateStatus,
      });
      if (response.data.checkout_url) {
        window.location.href = response.data.checkout_url;
        return;
      }
      setFeedback({ tone: 'success', message: 'Payout action completed for the selected employee.' });
      await refetchAll();
    } catch (error: any) {
      setFeedback({ tone: 'error', message: error?.response?.data?.message || 'Failed to process payout for the selected employee.' });
    } finally {
      setIsSaving(false);
    }
  };

  const primaryRunAction = useMemo(() => {
    if (!selectedRun) return null;
    if (!isValidated) return { label: 'Validate Run', helper: 'Confirm payroll readiness and reveal blockers before approval.', onClick: validateRun, disabled: false };
    if (runStage === 'draft' || runStage === 'validated') return { label: 'Manager Approve', helper: 'Sign off the reviewed run before finance approval.', onClick: () => void approveRun(), disabled: runWarnings.length > 0 };
    if (runStage === 'manager_approved') return { label: 'Finance Approve', helper: 'Finance approval unlocks processing and payout.', onClick: () => void updateRunStage('finance_approved', 'Finance approval recorded.'), disabled: false };
    if (runStage === 'finance_approved') return { label: 'Process Payroll', helper: 'Mark draft payroll items as processed for payout.', onClick: () => void processRun(), disabled: false };
    if (runStage === 'processed' && summary.readyForPayout > 0) return { label: 'Run Payouts', helper: 'Submit eligible processed payroll items for payout.', onClick: () => void payoutRun(), disabled: false };
    return { label: 'Publish Payslips', helper: 'Generate payslips for this run after payroll is paid.', onClick: () => void publishPayslips(), disabled: runStage !== 'paid' };
  }, [approveRun, isValidated, processRun, publishPayslips, payoutRun, runStage, runWarnings.length, selectedRun, summary.readyForPayout]);

  const employeeRows = useMemo(() => items.map((item) => ({
    ...item,
    setupState: item.payroll_profile ? 'Profile ready' : 'Missing profile',
    alertCount: item.warnings?.length || 0,
  })), [items]);

  const visibleEmployeeRows = useMemo(
    () => generateEmployeeId ? employeeRows.filter((item) => item.user_id === Number(generateEmployeeId)) : employeeRows,
    [employeeRows, generateEmployeeId]
  );

  if (employeesQuery.isLoading || runsQuery.isLoading || (selectedRunId && runDetailQuery.isLoading)) {
    return <PageLoadingState label="Loading pay runs..." />;
  }

  if (runsQuery.isError || employeesQuery.isError) {
    return <PageErrorState message={(runsQuery.error as any)?.response?.data?.message || (employeesQuery.error as any)?.response?.data?.message || 'Failed to load payroll runs.'} onRetry={() => void refetchAll()} />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Payroll operations"
        title="Pay Runs"
        description="Operational workspace for validating payroll runs, driving the approval-to-payout sequence, and handling employee-level payroll exceptions."
      />

      {feedback ? <FeedbackBanner tone={feedback.tone} message={feedback.message} /> : null}

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <div>
          <FieldLabel>Payroll Month</FieldLabel>
          <TextInput type="month" value={payrollMonth} onChange={(event) => setPayrollMonth(event.target.value)} />
        </div>
        <div>
          <FieldLabel>Generate For</FieldLabel>
          <EmployeeSelect
            employees={employeesQuery.data || []}
            value={generateEmployeeId}
            onChange={setGenerateEmployeeId}
            includeAllOption
          />
        </div>
        <div>
          <FieldLabel>Payout Method</FieldLabel>
          <SelectInput value={generatePayoutMethod} onChange={(event) => setGeneratePayoutMethod(event.target.value as 'mock' | 'stripe' | 'bank_transfer')}>
            <option value="mock">Mock</option>
            <option value="stripe">Stripe</option>
            <option value="bank_transfer">Bank transfer</option>
          </SelectInput>
        </div>
        <div className="flex items-end">
          <label className="flex min-h-11 items-center gap-2 rounded-[20px] border border-slate-200/90 bg-white/85 px-3.5 text-sm text-slate-700 shadow-[0_16px_30px_-24px_rgba(15,23,42,0.25)]">
            <input type="checkbox" checked={allowOverwrite} onChange={(event) => setAllowOverwrite(event.target.checked)} />
            Allow overwrite
          </label>
        </div>
        <div className="flex items-end">
          <Button variant="secondary" className="w-full" onClick={() => void refetchAll()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
        <div className="flex items-end">
          <Button variant="secondary" className="w-full" onClick={generateRun} disabled={isSaving}>
            Generate Payroll
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Run Gross" value={formatPayrollCurrency(summary.gross)} hint="Gross total for the selected run." icon={Wallet} accent="sky" />
        <MetricCard label="Run Net" value={formatPayrollCurrency(summary.net)} hint="Net pay total for the selected run." icon={Wallet} accent="emerald" />
        <MetricCard label="Ready For Payout" value={summary.readyForPayout} hint="Processed employees pending payout." icon={Send} accent="violet" />
        <MetricCard label="Validation Alerts" value={summary.warnings} hint="Warnings across selected run items." icon={AlertTriangle} accent="amber" />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <PayrollSectionCard title="Run Queue" description="Month-level pay runs generated from payroll records.">
            {(runsQuery.data || []).length === 0 ? (
              <EmptyStateCard title="No pay runs found" description="Generate payroll for the selected month to create a run." icon={Users} />
            ) : (
              <div className="space-y-3">
                {runsQuery.data?.map((run) => (
                  <button
                    key={run.id}
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    className={`grid w-full grid-cols-[1.2fr_0.75fr_auto] gap-3 rounded-[22px] border px-4 py-4 text-left transition ${selectedRunId === run.id ? 'border-sky-300 bg-sky-50/70' : 'border-slate-200/80 bg-slate-50/70 hover:bg-white'}`}
                  >
                    <div>
                      <p className="font-medium text-slate-950">{run.run_code}</p>
                      <p className="mt-1 text-sm text-slate-500">{run.payroll_month}</p>
                    </div>
                    <div>
                      <p className="text-sm text-slate-500">Employees</p>
                      <p className="font-semibold text-slate-950">{run.items_count || 0}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <PayrollStatusBadge status={run.status} />
                      <span className="text-xs text-slate-500">{run.warnings_count || 0} warnings</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </PayrollSectionCard>

          <PayrollSectionCard title="Workflow" description="The next action changes based on current payroll state, not just button availability.">
            {!selectedRun ? (
              <p className="text-sm text-slate-500">Select a pay run to review workflow state and controls.</p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium text-slate-950">{selectedRun.run_code}</p>
                      <p className="mt-1 text-sm text-slate-500">{selectedRun.payroll_month} | {items.length} employees</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <PayrollStatusBadge status={runStage} />
                      {isValidated ? <PayrollStatusBadge status="verified" /> : null}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {workflowSteps.map((step) => (
                    <div key={step.key} className={`rounded-[22px] border px-4 py-3 ${step.state === 'complete' ? 'border-emerald-200 bg-emerald-50/70' : step.state === 'current' ? 'border-sky-200 bg-sky-50/70' : 'border-slate-200/80 bg-slate-50/70'}`}>
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-slate-950">{step.label}</p>
                        <PayrollStatusBadge status={step.state === 'complete' ? 'approved' : step.state === 'current' ? 'pending' : 'inactive'} />
                      </div>
                      <p className="mt-2 text-sm text-slate-500">{step.detail}</p>
                    </div>
                  ))}
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-950">Priority action</p>
                      <p className="mt-1 text-sm text-slate-500">{primaryRunAction?.helper}</p>
                      <p className="mt-3 text-xs uppercase tracking-[0.18em] text-slate-500">Current stage</p>
                      <p className="mt-1 font-semibold text-slate-950">{currentWorkflowStep?.label || 'Publish Payslips'}</p>
                    </div>
                    {primaryRunAction ? (
                      <Button onClick={primaryRunAction.onClick} disabled={isSaving || primaryRunAction.disabled}>
                        <ShieldCheck className="h-4 w-4" />
                        {primaryRunAction.label}
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <Button size="sm" variant="ghost" onClick={validateRun} disabled={isSaving || isValidated}>Validate</Button>
                    <Button size="sm" variant="ghost" onClick={() => void approveRun()} disabled={isSaving || !isValidated || runWarnings.length > 0 || !['draft', 'validated'].includes(runStage)}>Manager Approve</Button>
                    <Button size="sm" variant="ghost" onClick={() => void updateRunStage('finance_approved', 'Finance approval recorded.')} disabled={isSaving || runStage !== 'manager_approved'}>Finance Approve</Button>
                    <Button size="sm" variant="ghost" onClick={processRun} disabled={isSaving || runStage !== 'finance_approved'}>Process</Button>
                    <Button size="sm" variant="ghost" onClick={payoutRun} disabled={isSaving || runStage !== 'processed' || summary.readyForPayout === 0}>Payout</Button>
                    <Button size="sm" variant="ghost" onClick={publishPayslips} disabled={isSaving || runStage !== 'paid'}>Payslips</Button>
                  </div>
                </div>

                {approvalTimeline.length > 0 ? (
                  <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <p className="text-sm font-semibold text-slate-950">Approval timeline</p>
                    <div className="mt-3 space-y-3">
                      {approvalTimeline.map((step: any) => (
                        <div key={step.id} className="flex items-start justify-between gap-3 rounded-[18px] border border-slate-200/80 bg-white/80 px-3 py-3">
                          <div>
                            <p className="font-medium text-slate-950">{String(step.stage || '').replace(/_/g, ' ')}</p>
                            <p className="mt-1 text-sm text-slate-500">{step.actor?.name || 'Awaiting action'}{step.action_at ? ` | ${new Date(step.action_at).toLocaleString()}` : ''}</p>
                            {step.comment ? <p className="mt-1 text-sm text-slate-500">{step.comment}</p> : null}
                          </div>
                          <PayrollStatusBadge status={step.status} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}

                <PayrollWarningPanel title="Run validation" warnings={runWarnings} successMessage="No validation warnings are attached to this run." />
              </div>
            )}
          </PayrollSectionCard>
        </div>

        <div className="space-y-5">
          <PayrollSectionCard title="Run Employees" description="Employee-wise payroll view for setup gaps, payout state, and drilldown selection.">
            {!selectedRun?.items?.length ? (
              <EmptyStateCard title="No run items" description="Select a pay run with payroll records to review employee-level details." icon={Users} />
            ) : (
              <DataTable
                title="Run Employees"
                description={generateEmployeeId ? 'Focused employee view for the selected employee in this run.' : 'Operational employee grid for payroll status, payout readiness, and warnings.'}
                rows={visibleEmployeeRows}
                emptyMessage={generateEmployeeId ? 'The selected employee is not present in this pay run.' : 'No employees found in this run.'}
                columns={[
                  {
                    key: 'employee',
                    header: 'Employee',
                    className: 'min-w-[16rem]',
                    render: (item: PayrollRunItem & { setupState: string; alertCount: number }) => (
                      <button type="button" onClick={() => setSelectedItemId(item.id)} className="text-left">
                        <p className="font-medium text-slate-950">{item.user?.name || `User #${item.user_id}`}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.user?.email}</p>
                      </button>
                    ),
                  },
                  { key: 'status', header: 'Payroll', render: (item: PayrollRunItem) => <PayrollStatusBadge status={item.status} /> },
                  { key: 'payout', header: 'Payout', render: (item: PayrollRunItem) => <PayrollStatusBadge status={item.payout_status} /> },
                  {
                    key: 'setup',
                    header: 'Setup',
                    render: (item: PayrollRunItem & { setupState: string; alertCount: number }) => (
                      <div>
                        <p className="font-medium text-slate-950">{item.setupState}</p>
                        <p className="mt-1 text-sm text-slate-500">{item.alertCount} alerts</p>
                      </div>
                    ),
                  },
                  { key: 'net', header: 'Net Pay', render: (item: PayrollRunItem) => formatPayrollCurrency(item.net_pay, selectedRun.currency) },
                  {
                    key: 'action',
                    header: 'Action',
                    render: (item: PayrollRunItem) => (
                      <Button size="sm" variant={selectedItem?.id === item.id ? 'primary' : 'secondary'} onClick={() => setSelectedItemId(item.id)}>
                        Review
                      </Button>
                    ),
                  },
                ]}
              />
            )}
          </PayrollSectionCard>

          <PayrollSectionCard title="Employee Drilldown" description="Selected employee breakdown, validation warnings, payout history, and compatibility record controls.">
            {!selectedItem || !selectedPayrollDraft ? (
              <p className="text-sm text-slate-500">Select an employee within the run to review salary details and take action.</p>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3 rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <div>
                    <p className="font-medium text-slate-950">{selectedItem.user?.name || `User #${selectedItem.user_id}`}</p>
                    <p className="mt-1 text-sm text-slate-500">{selectedItem.user?.email}</p>
                  </div>
                  <Link to={`/payroll/employees/${selectedItem.user_id}`}>
                    <Button size="sm" variant="secondary">Open Payroll Record</Button>
                  </Link>
                </div>

                <PayrollWarningPanel title="Employee validation" warnings={selectedItem.warnings || []} successMessage="No validation issues were returned for this employee." />

                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div>
                    <FieldLabel>Basic Salary</FieldLabel>
                    <TextInput type="number" min={0} value={Number(selectedPayrollDraft.basic_salary || 0)} onChange={(event) => updateDraftField('basic_salary', Number(event.target.value || 0))} />
                  </div>
                  <div>
                    <FieldLabel>Allowances</FieldLabel>
                    <TextInput type="number" min={0} value={Number(selectedPayrollDraft.allowances || 0)} onChange={(event) => updateDraftField('allowances', Number(event.target.value || 0))} />
                  </div>
                  <div>
                    <FieldLabel>Bonus</FieldLabel>
                    <TextInput type="number" min={0} value={Number(selectedPayrollDraft.bonus || 0)} onChange={(event) => updateDraftField('bonus', Number(event.target.value || 0))} />
                  </div>
                  <div>
                    <FieldLabel>Deductions</FieldLabel>
                    <TextInput type="number" min={0} value={Number(selectedPayrollDraft.deductions || 0)} onChange={(event) => updateDraftField('deductions', Number(event.target.value || 0))} />
                  </div>
                  <div>
                    <FieldLabel>Tax</FieldLabel>
                    <TextInput type="number" min={0} value={Number(selectedPayrollDraft.tax || 0)} onChange={(event) => updateDraftField('tax', Number(event.target.value || 0))} />
                  </div>
                  <div>
                    <FieldLabel>Payout Method</FieldLabel>
                    <SelectInput value={selectedPayrollDraft.payout_method} onChange={(event) => updateDraftField('payout_method', event.target.value)}>
                      <option value="mock">Mock</option>
                      <option value="stripe">Stripe</option>
                      <option value="bank_transfer">Bank transfer</option>
                    </SelectInput>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Gross</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{formatPayrollCurrency(payrollGrossAmount(selectedPayrollDraft))}</p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Total deductions</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{formatPayrollCurrency(payrollTotalDeductions(selectedPayrollDraft))}</p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Net pay</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{formatPayrollCurrency(selectedPayrollDraft.net_salary)}</p>
                  </div>
                </div>

                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-sm font-semibold text-slate-950">Attendance summary</p>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-slate-500">Payable days</p>
                      <p className="font-semibold text-slate-950">{selectedItem.attendance_summary?.payable_days || selectedItem.payable_days || 0}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Worked time</p>
                      <p className="font-semibold text-slate-950">{formatPayrollDuration(Number(selectedItem.worked_seconds || 0))}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Overtime</p>
                      <p className="font-semibold text-slate-950">{formatPayrollDuration(Number(selectedItem.overtime_seconds || 0))}</p>
                    </div>
                    <div>
                      <p className="text-slate-500">Approved leave</p>
                      <p className="font-semibold text-slate-950">{selectedItem.approved_leave_days || 0}</p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-3">
                  <Button size="sm" variant="secondary" onClick={saveSelectedPayroll} disabled={isSaving}>Save Draft</Button>
                  <Button size="sm" onClick={processSelectedPayroll} disabled={isSaving}>Mark Processed</Button>
                  <Button size="sm" onClick={() => payoutSelectedPayroll()} disabled={isSaving}>
                    <Send className="h-4 w-4" />
                    Run Payout
                  </Button>
                  {selectedPayrollDraft.payout_method === 'mock' ? (
                    <>
                      <Button size="sm" variant="secondary" onClick={() => payoutSelectedPayroll('success')} disabled={isSaving}>Simulate Success</Button>
                      <Button size="sm" variant="secondary" onClick={() => payoutSelectedPayroll('pending')} disabled={isSaving}>Simulate Pending</Button>
                      <Button size="sm" variant="danger" onClick={() => payoutSelectedPayroll('failed')} disabled={isSaving}>Simulate Failed</Button>
                    </>
                  ) : null}
                </div>

                <div>
                  <p className="text-sm font-semibold text-slate-950">Payout history</p>
                  <div className="mt-3 space-y-3">
                    {(selectedItem.payroll?.transactions || []).length === 0 ? (
                      <p className="text-sm text-slate-500">No payout transactions recorded yet.</p>
                    ) : (selectedItem.payroll?.transactions || []).map((transaction) => (
                      <div key={transaction.id} className="rounded-[20px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-medium text-slate-950">{transaction.provider}</p>
                            <p className="mt-1 text-sm text-slate-500">{new Date(transaction.created_at).toLocaleString()}</p>
                          </div>
                          <PayrollStatusBadge status={transaction.status} />
                        </div>
                        <p className="mt-3 text-sm font-semibold text-slate-950">{formatPayrollCurrency(transaction.amount, transaction.currency)}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </PayrollSectionCard>
        </div>
      </div>
    </div>
  );
}
