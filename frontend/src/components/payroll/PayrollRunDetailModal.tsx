import { useMemo, useState } from 'react';
import {
  X, Lock, ShieldCheck, Send, Loader2, IndianRupee, Users, Calendar, FileText,
  AlertCircle, AlertTriangle, Landmark, Plus, Check, Unlock, Wallet, PlayCircle,
  ListChecks, Info, LayoutDashboard, Search, ChevronUp, ChevronDown,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, employeeWorkspaceApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Modal from '@/components/ui/dialog/Modal';
import SlideOver from '@/components/ui/dialog/SlideOver';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/utils/cn';
import PayrollRunLifecycleStepper, { RunLifecycleState } from './PayrollRunLifecycleStepper';
import PayrollOutcome from './PayrollOutcome';
import RunPayrollChecklist from './RunPayrollChecklist';
import RunActivityLog from './RunActivityLog';

interface PayrollRunDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  runId: number | null;
  monthYear?: string;
}

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function PayrollRunDetailModal({
  isOpen,
  onClose,
  runId,
  monthYear,
}: PayrollRunDetailModalProps) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { user } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [showDisburseConfirm, setShowDisburseConfirm] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [partialLockData, setPartialLockData] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'employees' | 'activity'>('overview');
  const [showReverseDialog, setShowReverseDialog] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  const { data: detailData, isLoading } = useQuery({
    queryKey: ['payroll', 'run-detail', runId],
    queryFn: () => runId ? payrollApi.getPayrollRunDetail(runId).then((r) => r.data) : null,
    enabled: !!runId && isOpen,
  });

  const { data: missingBank } = useQuery({
    queryKey: ['payroll', 'run-missing-bank', runId],
    queryFn: () => runId ? payrollApi.getRunMissingBankDetails(runId).then((r) => r.data) : null,
    enabled: !!runId && isOpen,
  });

  // Completeness drives the "Process Remaining" CTA and the Lock-blocked state
  const { data: completeness } = useQuery({
    queryKey: ['payroll', 'run-completeness', runId],
    queryFn: () => runId ? payrollApi.getRunCompleteness(runId).then((r) => r.data) : null,
    enabled: !!runId && isOpen,
    refetchInterval: 5000,
  });

  const invalidateAll = () => {
    if (!runId) return;
    queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail', runId] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'run-missing-bank', runId] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'run-completeness', runId] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups'] });
  };

  const lockMutation = useMutation({
    mutationFn: (opts?: { force?: boolean; reason?: string }) =>
      runId ? payrollApi.lockPayrollRun(runId, opts).then((r) => r.data) : Promise.reject(new Error('no run')),
    onSuccess: (data) => {
      invalidateAll();
      if (data?.completeness && !data.completeness.is_complete) {
        show({ kind: 'warning', message: 'Run locked with override. Partial run audited.', durationMs: 6000 });
      } else {
        show({ kind: 'success', message: 'Run locked. Ready for approval.' });
      }
    },
    onError: (e: any) => {
      const data = e?.response?.data;
      // Special case: 422 with `incomplete: true` — open the partial-lock dialog
      if (data?.incomplete && data?.completeness) {
        setPartialLockData(data);
      } else {
        const msg = getApiErrorMessage(e, 'Failed to lock run');
        setError(msg);
        show({ kind: 'error', message: msg });
      }
    },
  });

  const unlockMutation = useMutation({
    mutationFn: (reason: string) =>
      runId ? payrollApi.unlockPayrollRun(runId, reason).then((r) => r.data) : Promise.reject(new Error('no run')),
    onSuccess: () => {
      invalidateAll();
      setShowUnlockDialog(false);
      setUnlockReason('');
      show({ kind: 'success', message: 'Run unlocked. Edits are now allowed again.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to unlock run') }),
  });

  const approveMutation = useMutation({
    mutationFn: () => runId ? payrollApi.approvePayrollRun(runId).then((r) => r.data) : null,
    onSuccess: () => {
      invalidateAll();
      show({ kind: 'success', message: 'Run approved. Ready to release.' });
    },
    onError: (e: any) => {
      const msg = getApiErrorMessage(e, 'Failed to approve run');
      setError(msg);
      show({ kind: 'error', message: msg });
    },
  });

  const releaseMutation = useMutation({
    mutationFn: () => runId ? payrollApi.releasePayrollRun(runId).then((r) => r.data) : null,
    onSuccess: () => {
      invalidateAll();
      show({ kind: 'success', message: 'Run released. Bank file is now available.' });
    },
    onError: (e: any) => {
      const msg = getApiErrorMessage(e, 'Failed to release run');
      setError(msg);
      show({ kind: 'error', message: msg });
    },
  });

  const disburseMutation = useMutation({
    mutationFn: () => runId ? payrollApi.disburseRun(runId).then((r) => r.data) : null,
    onSuccess: () => {
      invalidateAll();
      setShowDisburseConfirm(false);
      show({ kind: 'success', message: 'Payments disbursed. Run is now immutable.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to disburse payments') }),
  });

  // Reversal history for a disbursed run
  const { data: reversals } = useQuery({
    queryKey: ['payroll', 'run-reversals', runId],
    queryFn: () => runId ? payrollApi.getRunReversals(runId).then((r) => r.data?.reversals ?? []) : [],
    enabled: !!runId && isOpen,
  });

  const reverseMutation = useMutation({
    mutationFn: (reason: string) =>
      runId ? payrollApi.reversePaymentRun(runId, reason).then((r) => r.data) : Promise.reject(new Error('no run')),
    onSuccess: (data: any) => {
      invalidateAll();
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-reversals', runId] });
      setShowReverseDialog(false);
      setReverseReason('');
      show({ kind: 'success', message: data?.message ?? 'Payment reversal initiated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reverse payment') }),
  });

  const notifyMutation = useMutation({
    mutationFn: () => runId ? payrollApi.notifyPayslips(runId).then((r) => r.data) : null,
    onSuccess: (data: any) => {
      invalidateAll();
      const failed = data?.payslip_notification?.failed_count ?? 0;
      show({
        kind: failed > 0 ? 'warning' : 'success',
        message: failed > 0
          ? `Payslip notifications resent (${data?.payslip_notification?.sent_count ?? 0} sent, ${failed} failed).`
          : 'Payslip notifications resent to all employees.',
      });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to notify employees') }),
  });

  const processRemainingMutation = useMutation({
    mutationFn: () => runId ? payrollApi.processRemainingForRun(runId).then((r) => r.data) : null,
    onSuccess: (data: any) => {
      invalidateAll();
      if (data?.skipped_no_ctc > 0) {
        show({
          kind: 'warning',
          message: `${data.succeeded} processed, ${data.failed} failed, ${data.skipped_no_ctc} skipped (no annual CTC). Add CTCs in salary templates to include them.`,
          durationMs: 8000,
        });
      } else {
        show({ kind: 'success', message: `${data?.succeeded ?? 0} employees processed.` });
      }
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to process remaining employees') }),
  });

  const handleDownloadBankFile = async () => {
    if (!runId) return;
    try {
      const res = await payrollApi.generateBankFile(runId);
      const data: any = res.data;
      const skippedCount = data?.skipped_employees?.length ?? 0;
      const included = data?.entries?.length ?? 0;

      const blob = new Blob([data?.content ?? ''], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data?.filename ?? `bank_file_${runId}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (skippedCount > 0) {
        const names = data.skipped_employees.map((e: any) => e.name).slice(0, 3).join(', ');
        const more = skippedCount > 3 ? ` and ${skippedCount - 3} more` : '';
        show({
          kind: 'warning',
          message: `Bank file generated for ${included} of ${included + skippedCount} employees. ${skippedCount} excluded (${names}${more}). Add their bank details to include them.`,
          durationMs: 8000,
        });
      } else {
        show({ kind: 'success', message: `Bank file generated for ${included} employee${included === 1 ? '' : 's'}.` });
      }
    } catch (e: any) {
      const data = e?.response?.data;
      // Special case: bank file only available after approved status
      if (data?.allowed_statuses) {
        show({
          kind: 'warning',
          message: `Bank file is only available after the run is approved. Current status: ${data.current_status}. Lock the run and approve it first.`,
          durationMs: 7000,
        });
      } else {
        show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate bank file') });
      }
    }
  };

  if (!isOpen) return null;

  const run = detailData?.run ?? (detailData as any)?.run ?? null;
  const items = detailData?.items ?? (detailData as any)?.items ?? [];
  const currentState: RunLifecycleState = (run?.status ?? 'draft') as RunLifecycleState;
  const missingEmployees: any[] = missingBank?.missing_employees ?? [];
  const missingCount = missingBank?.missing_count ?? 0;

  const toFiniteMoney = (v: unknown): number => {
    const n = typeof v === 'string' ? parseFloat(v) : (v as number);
    return Number.isFinite(n) ? (n as number) : 0;
  };

  const runGrossFromBackend = toFiniteMoney((run as any)?.total_gross ?? (run as any)?.gross_total);
  const runDeductionsFromBackend = toFiniteMoney((run as any)?.total_deductions);
  const runNetFromBackend = toFiniteMoney((run as any)?.total_net_pay);

  const itemsGross = items.reduce(
    (s: number, i: any) =>
      s +
      toFiniteMoney(
        i.gross_salary ??
          i.total_earnings ??
          i.basic_salary ??
          toFiniteMoney(i.basic) +
            toFiniteMoney(i.hra) +
            toFiniteMoney(i.special_allowance) +
            toFiniteMoney(i.conveyance),
      ),
    0,
  );

  const totals = {
    employees: items.length,
    gross: itemsGross > 0 ? itemsGross : runGrossFromBackend,
    deductions:
      items.reduce((s: number, i: any) => s + toFiniteMoney(i.total_deductions), 0) ||
      runDeductionsFromBackend,
    net:
      items.reduce((s: number, i: any) => s + toFiniteMoney(i.net_pay), 0) ||
      runNetFromBackend,
  };

  const isMutating =
    lockMutation.isPending ||
    unlockMutation.isPending ||
    approveMutation.isPending ||
    releaseMutation.isPending ||
    disburseMutation.isPending ||
    notifyMutation.isPending ||
    processRemainingMutation.isPending;

  const completenessInfo: any = completeness;
  const isIncomplete = completenessInfo && completenessInfo.is_complete === false;
  const expectedCount = completenessInfo?.expected_count ?? 0;
  const processedCount = completenessInfo?.processed_count ?? items.length;
  const missingForCompletion = completenessInfo?.missing_count ?? 0;

  return (
    <SlideOver open onClose={onClose} titleId="payroll-run-detail-title" widthClassName="max-w-4xl">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-3 flex items-center justify-between z-10 flex-shrink-0">
          <div>
            <h2 id="payroll-run-detail-title" className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Run #{run?.id ?? '—'} · {run?.month_year ?? monthYear ?? 'Unknown month'}
              <InfoTooltip
                content="Every payroll run moves through 6 stages. Disbursed runs are immutable for compliance — you can't delete or re-process them."
                title="Run lifecycle"
              />
            </h2>
            <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {expectedCount > 0
                ? `${processedCount}/${expectedCount} employees processed`
                : `${totals.employees} employee${totals.employees === 1 ? '' : 's'}`}
              <span className="ml-1 text-slate-300">·</span>
              <span className="uppercase tracking-wider">
                Step {(['draft', 'processing', 'locked', 'approved', 'released', 'disbursed'].indexOf(currentState) + 1)} of 6
              </span>
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Close">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {error && (
          <div className="mx-5 mt-3 mb-0 p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-rose-700 flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
          </div>
        )}

        {isLoading ? (
          <div className="text-center py-12 flex-1">
            <Loader2 className="h-8 w-8 text-blue-600 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-500">Loading run details…</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-0">
              {/* ── LEFT SIDEBAR (sticky) ──────────────────────────── */}
              <aside className="border-b lg:border-b-0 lg:border-r border-slate-200 bg-slate-50/60 p-5 space-y-5 lg:sticky lg:top-0 lg:self-start">
                {/* Lifecycle */}
                <section>
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Lifecycle
                  </h3>
                  <PayrollRunLifecycleStepper
                    currentState={currentState}
                    completedAt={{
                      ...((run?.locked_at && { locked: run.locked_at }) as any),
                      ...((run?.approved_at && { approved: run.approved_at }) as any),
                      ...((run?.released_at && { released: run.released_at }) as any),
                      ...((run?.disbursed_at && { disbursed: run.disbursed_at }) as any),
                    }}
                  />
                </section>

              {/* Summary */}
              <section className="pt-4 border-t border-slate-200">
                <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                  Summary
                </h3>
                <div className="space-y-3">
                  <div className="p-3 bg-white rounded-lg border">
                    <p className="text-xs text-slate-500 mb-1">Employees</p>
                    <p className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      <Users className="h-5 w-5 text-slate-500" />
                      {totals.employees}
                    </p>
                  </div>
                  
                  <div className="space-y-2">
                    <div className="p-3 bg-white rounded-lg border">
                      <p className="text-xs text-slate-500 mb-1">Gross Pay</p>
                      <p className="text-lg font-bold text-slate-900">{formatCurrency(totals.gross)}</p>
                    </div>
                    
                    <div className="p-3 bg-white rounded-lg border">
                      <p className="text-xs text-slate-500 mb-1">Deductions</p>
                      <p className="text-lg font-bold text-amber-600">{formatCurrency(totals.deductions)}</p>
                    </div>
                    
                    <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-200">
                      <p className="text-xs text-emerald-600 mb-1">Net Pay</p>
                      <p className="text-lg font-bold text-emerald-700">{formatCurrency(totals.net)}</p>
                    </div>
                  </div>
                </div>
              </section>

                {/* Actions */}
                <section className="pt-4 border-t border-slate-200">
                  <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">
                    Next steps
                  </h3>
                  <ActionBar
                    currentState={currentState}
                    isIncomplete={!!isIncomplete}
                    isMutating={isMutating}
                    itemsCount={items.length}
                    onLock={() => lockMutation.mutate(undefined)}
                    onUnlockClick={() => setShowUnlockDialog(true)}
                    onApprove={() => approveMutation.mutate()}
                    onRelease={() => releaseMutation.mutate()}
                    onDisburseClick={() => setShowDisburseConfirm(true)}
                    onDownloadBankFile={handleDownloadBankFile}
                    onNotify={() => notifyMutation.mutate()}
                    lockPending={lockMutation.isPending}
                    unlockPending={unlockMutation.isPending}
                    approvePending={approveMutation.isPending}
                    releasePending={releaseMutation.isPending}
                    disbursePending={disburseMutation.isPending}
                    notifyPending={notifyMutation.isPending}
                    payslipNotifiedStatus={(run as any)?.payslips_notified_status}
                    payslipNotifiedAt={(run as any)?.payslips_notified_at}
                    payslipNotifiedFailed={(run as any)?.payslips_notified_failed_count}
                    canReverse={['admin', 'super_admin'].includes((user as any)?.role)}
                    onReverseClick={() => setShowReverseDialog(true)}
                    reversePending={reverseMutation.isPending}
                  />
                </section>
              </aside>

              {/* ── RIGHT PANEL ───────────────────────────────────── */}
              <section className="p-5 space-y-5">
                {/* Tabs */}
                <div className="flex items-center gap-1 border-b border-slate-200 -mb-px">
                  <TabButton
                    label="Overview"
                    icon={LayoutDashboard}
                    active={activeTab === 'overview'}
                    onClick={() => setActiveTab('overview')}
                  />
                  <TabButton
                    label={`Employees (${items.length})`}
                    icon={Users}
                    active={activeTab === 'employees'}
                    onClick={() => setActiveTab('employees')}
                    disabled={items.length === 0}
                  />
                  <TabButton
                    label="Activity"
                    icon={ListChecks}
                    active={activeTab === 'activity'}
                    onClick={() => setActiveTab('activity')}
                  />
                </div>

                {activeTab === 'overview' && (
                  <div className="space-y-5">
                    {/* Pre-flight checklist */}
                    <RunPayrollChecklist runId={runId!} />

                    {/* Completeness */}
                    {isIncomplete && (currentState === 'draft' || currentState === 'locked') && (
                      <CompletenessCard
                        expected={expectedCount}
                        processed={processedCount}
                        missing={missingForCompletion}
                        missingEmployees={completenessInfo?.missing_employees ?? []}
                        isProcessing={processRemainingMutation.isPending}
                        onProcessRemaining={() => processRemainingMutation.mutate()}
                        state={currentState}
                      />
                    )}

                    {/* Financial summary */}
                    <FinancialSummaryCard totals={totals} />

                    {/* Statutory breakdown (existing component) */}
                    {items.length > 0 && (
                      <PayrollOutcome run={run as any} items={items as any} />
                    )}

                    {/* Reversal history */}
                    {currentState === 'disbursed' && (reversals?.length ?? 0) > 0 && (
                      <ReversalHistoryCard reversals={reversals ?? []} formatCurrency={formatCurrency} />
                    )}
                    {missingCount > 0 && (currentState === 'approved' || currentState === 'released') && (
                      <MissingBankCard
                        missingEmployees={missingEmployees}
                        runId={runId}
                        onAdded={() => invalidateAll()}
                        showToast={show}
                      />
                    )}
                  </div>
                )}

                {activeTab === 'employees' && (
                  <EmployeesTable items={items} formatCurrency={formatCurrency} />
                )}

                {activeTab === 'activity' && (
                  <RunActivityLog runId={runId!} />
                )}

                {items.length === 0 && !isLoading && activeTab === 'overview' && (
                  <div className="text-center py-8 text-slate-500 text-sm">
                    No payslips in this run yet. Process employees to populate this run.
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

      {/* Disburse confirmation dialog */}
      {showDisburseConfirm && (
        <ConfirmDialog
          icon={Wallet}
          title="Disburse Payments"
          tone="warning"
          message={`This will mark all ${totals.employees} pending payslip(s) as paid and set the run to "Disbursed". Once disbursed, the run becomes IMMUTABLE — no further edits are possible.`}
          confirmLabel="Disburse Payments"
          isPending={disburseMutation.isPending}
          onCancel={() => setShowDisburseConfirm(false)}
          onConfirm={() => disburseMutation.mutate()}
        />
      )}

      {/* Unlock reason dialog */}
      {showUnlockDialog && (
        <ReasonDialog
          icon={Unlock}
          title="Unlock Run"
          tone="warning"
          message={`This will roll the run back from "${currentState}" to "Draft" so you can make changes. The action is audit-logged.`}
          placeholder="Why are you unlocking? (e.g. corrected LOP days for Employee X)"
          confirmLabel="Unlock Run"
          isPending={unlockMutation.isPending}
          onCancel={() => { setShowUnlockDialog(false); setUnlockReason(''); }}
          onConfirm={() => unlockMutation.mutate(unlockReason)}
          reason={unlockReason}
          setReason={setUnlockReason}
        />
      )}

      {/* Reverse payment dialog */}
      {showReverseDialog && (
        <ReasonDialog
          icon={AlertTriangle}
          title="Reverse this Payment"
          tone="danger"
          message="This will initiate a reversal for every paid payslip in this run. The action is audit-logged and should only be used to claw back a mistaken disbursement."
          placeholder="Reason for reversal (e.g. wrong net pay due to incorrect LOP days)"
          confirmLabel="Reverse Payment"
          isPending={reverseMutation.isPending}
          onCancel={() => { setShowReverseDialog(false); setReverseReason(''); }}
          onConfirm={() => reverseMutation.mutate(reverseReason.trim())}
          reason={reverseReason}
          setReason={setReverseReason}
        />
      )}

      {/* Partial-lock dialog (when backend returns 422 incomplete) */}
      {partialLockData && (
        <PartialLockDialog
          data={partialLockData}
          onCancel={() => setPartialLockData(null)}
          onConfirm={(reason) => {
            setPartialLockData(null);
            lockMutation.mutate({ force: true, reason });
          }}
          isPending={lockMutation.isPending}
        />
      )}
    </SlideOver>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Sub-components
// ──────────────────────────────────────────────────────────────────────────

interface CompletenessCardProps {
  expected: number;
  processed: number;
  missing: number;
  missingEmployees: Array<{ id: number; name: string; email: string }>;
  isProcessing: boolean;
  onProcessRemaining: () => void;
  state: RunLifecycleState;
}

function CompletenessCard({
  expected,
  processed,
  missing,
  missingEmployees,
  isProcessing,
  onProcessRemaining,
  state,
}: CompletenessCardProps) {
  const progressPercentage = expected > 0 ? (processed / expected) * 100 : 0;
  
  return (
    <SurfaceCard className="p-5 bg-amber-50 border-amber-200 rounded-lg">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-base font-bold text-amber-900">Run Completeness</h3>
            <span className="text-sm font-semibold text-amber-800">{processed}/{expected}</span>
          </div>
          
          <div className="w-full bg-amber-200 rounded-full h-2 mb-3">
            <div 
              className="bg-amber-500 h-2 rounded-full" 
              style={{ width: `${progressPercentage}%` }}
            ></div>
          </div>
          
          <p className="text-sm text-amber-800 mb-4">
            {missing} of {expected} expected employees haven't been processed for this run
          </p>
          
          <p className="text-xs text-amber-700 mb-4">
            {state === 'draft'
              ? 'Process all expected employees before locking. You can use "Process Remaining" to fill the gaps automatically.'
              : 'This run was force-locked with missing employees. To include them, unlock the run, then process the remaining employees.'}
          </p>

          {missingEmployees.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-semibold text-amber-900 mb-2">
                Missing Employees ({missingEmployees.length})
              </h4>
              <div className="max-h-32 overflow-y-auto border border-amber-200 rounded-lg bg-white">
                <ul className="divide-y divide-amber-100">
                  {missingEmployees.slice(0, 10).map((emp) => (
                    <li key={emp.id} className="p-2 text-sm">
                      <span className="font-medium text-amber-900">{emp.name}</span>
                      <span className="text-amber-700 block">({emp.email})</span>
                    </li>
                  ))}
                  {missingEmployees.length > 10 && (
                    <li className="p-2 text-xs text-amber-700 italic">+ {missingEmployees.length - 10} more…</li>
                  )}
                </ul>
              </div>
            </div>
          )}

          {state === 'draft' && expected > 0 && (
            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                iconLeft={isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                onClick={onProcessRemaining}
                disabled={isProcessing}
              >
                {isProcessing ? 'Processing…' : `Process Remaining (${missing})`}
              </Button>
              <InfoTooltip
                content="Bulk-process all unprocessed employees using their saved annual CTC from salary templates. Employees without a CTC set will be skipped."
                title="Process remaining"
              />
            </div>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}

interface ActionBarProps {
  currentState: RunLifecycleState;
  isIncomplete: boolean;
  isMutating: boolean;
  itemsCount: number;
  onLock: () => void;
  onUnlockClick: () => void;
  onApprove: () => void;
  onRelease: () => void;
  onDisburseClick: () => void;
  onDownloadBankFile: () => void;
  onNotify: () => void;
  lockPending: boolean;
  unlockPending: boolean;
  approvePending: boolean;
  releasePending: boolean;
  disbursePending: boolean;
  notifyPending: boolean;
  payslipNotifiedStatus?: string | null;
  payslipNotifiedAt?: string | null;
  payslipNotifiedFailed?: number | null;
  canReverse?: boolean;
  onReverseClick?: () => void;
  reversePending?: boolean;
}

function ActionBar({
  currentState,
  isIncomplete,
  isMutating,
  itemsCount,
  onLock,
  onUnlockClick,
  onApprove,
  onRelease,
  onDisburseClick,
  onDownloadBankFile,
  onNotify,
  lockPending,
  unlockPending,
  approvePending,
  releasePending,
  disbursePending,
  notifyPending,
  payslipNotifiedStatus,
  payslipNotifiedAt,
  payslipNotifiedFailed,
  canReverse,
  onReverseClick,
  reversePending,
}: ActionBarProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {currentState === 'draft' && (
        <>
          <Button
            variant="primary"
            iconLeft={lockPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
            onClick={onLock}
            disabled={isMutating || itemsCount === 0}
          >
            {isIncomplete ? 'Lock Run (incomplete)' : 'Lock Run'}
          </Button>
          {isIncomplete && (
            <p className="text-xs text-amber-700 flex items-center gap-1 self-center">
              <Info className="h-3 w-3" />
              Backend will require a reason to force-lock
            </p>
          )}
        </>
      )}

      {currentState === 'locked' && (
        <>
          <Button
            variant="primary"
            iconLeft={approvePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            onClick={onApprove}
            disabled={isMutating}
          >
            Approve Run
          </Button>
          <Button
            variant="secondary"
            iconLeft={unlockPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
            onClick={onUnlockClick}
            disabled={isMutating}
          >
            Unlock (Admin)
          </Button>
        </>
      )}

      {currentState === 'approved' && (
        <>
          <Button
            variant="primary"
            iconLeft={releasePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            onClick={onRelease}
            disabled={isMutating}
          >
            Release Run
          </Button>
          <Button
            variant="secondary"
            iconLeft={unlockPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
            onClick={onUnlockClick}
            disabled={isMutating}
          >
            Unlock (Admin)
          </Button>
        </>
      )}

      {currentState === 'released' && (
        <>
          <Button
            variant="primary"
            iconLeft={disbursePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            onClick={onDisburseClick}
            disabled={isMutating}
          >
            Disburse Payments
          </Button>
          <Button
            variant="secondary"
            iconLeft={<Landmark className="h-4 w-4" />}
            onClick={onDownloadBankFile}
            disabled={isMutating}
          >
            Download Bank File
          </Button>
          <Button
            variant="secondary"
            iconLeft={unlockPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
            onClick={onUnlockClick}
            disabled={isMutating}
          >
            Unlock (Admin)
          </Button>
        </>
      )}

      {currentState === 'disbursed' && (
        <div className="w-full space-y-3">
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <Check className="h-4 w-4" />
            <span>
              <strong>Disbursed.</strong> All payments recorded. This run is immutable for compliance.
            </span>
          </div>
          <PayrollNotificationStatus
            status={payslipNotifiedStatus}
            notifiedAt={payslipNotifiedAt}
            failedCount={payslipNotifiedFailed}
            isSending={notifyPending}
            onResend={onNotify}
          />
          {canReverse && (
            <Button
              variant="danger"
              iconLeft={reversePending ? <Loader2 className="h-4 w-4 animate-spin" /> : <AlertTriangle className="h-4 w-4" />}
              onClick={onReverseClick}
              disabled={reversePending}
            >
              Reverse this Payment
            </Button>
          )}
          <p className="text-xs text-slate-500">
            Bank file download remains available for your records.
          </p>
          <Button
            variant="ghost"
            iconLeft={<Landmark className="h-4 w-4" />}
            onClick={onDownloadBankFile}
            className="mt-2"
          >
            Download Bank File (record copy)
          </Button>
        </div>
      )}

      {/* Bank file unavailable hint for locked runs (drafts have no bank file card; approved+ have the active button) */}
      {currentState === 'locked' && (
        <Button
          variant="ghost"
          iconLeft={<Landmark className="h-4 w-4" />}
          onClick={onDownloadBankFile}
          title="Bank file becomes available after the run is approved."
        >
          Bank File (unavailable until Approved)
        </Button>
      )}
    </div>
  );
}

interface MissingBankCardProps {
  missingEmployees: any[];
  runId: number | null;
  onAdded: () => void;
  showToast: (t: { kind?: 'success' | 'error' | 'warning' | 'info'; message: string; durationMs?: number }) => void;
}

function MissingBankCard({ missingEmployees, runId: _runId, onAdded, showToast }: MissingBankCardProps) {
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  return (
    <SurfaceCard className="p-5 bg-amber-50 border-amber-200 rounded-lg">
      <div className="flex items-start gap-4 mb-4">
        <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-amber-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-amber-900 mb-1">
            {missingEmployees.length} Employee{missingEmployees.length === 1 ? '' : 's'} Missing Bank Details
          </h3>
          <p className="text-sm text-amber-800">
            Bank file will exclude them until their account number & IFSC are added.
          </p>
        </div>
      </div>
      
      <div className="space-y-3">
        {missingEmployees.map((emp: any) => (
          <div key={emp.user_id} className="bg-white border border-amber-200 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between p-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 text-sm truncate">{emp.name}</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-slate-100 text-slate-800">
                    {emp.email}
                  </span>
                  {emp.missing_fields?.length > 0 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-amber-100 text-amber-800">
                      Missing: {emp.missing_fields.join(', ')}
                    </span>
                  )}
                  {emp.has_partial_account && emp.missing_fields?.length === 0 && (
                    <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                      Partial account on file
                    </span>
                  )}
                </div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Plus className="h-3 w-3" />}
                onClick={() => setExpandedUserId(expandedUserId === emp.user_id ? null : emp.user_id)}
              >
                {expandedUserId === emp.user_id ? 'Cancel' : 'Add Details'}
              </Button>
            </div>
            {expandedUserId === emp.user_id && (
              <div className="border-t border-amber-200 p-4 bg-amber-50">
                <BankDetailsInlineForm
                  userId={emp.user_id}
                  userName={emp.name}
                  onSaved={() => {
                    setExpandedUserId(null);
                    onAdded();
                    showToast({
                      kind: 'success',
                      message: `Bank details saved for ${emp.name}.`,
                    });
                  }}
                  showToast={showToast}
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

interface BankDetailsInlineFormProps {
  userId: number;
  userName: string;
  onSaved: () => void;
  showToast: (t: { kind?: 'success' | 'error' | 'warning' | 'info'; message: string; durationMs?: number }) => void;
}

function BankDetailsInlineForm({ userId, userName, onSaved, showToast }: BankDetailsInlineFormProps) {
  const [accountHolderName, setAccountHolderName] = useState(userName);
  const [bankName, setBankName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [ifscSwift, setIfscSwift] = useState('');
  const [branch, setBranch] = useState('');
  const [accountType, setAccountType] = useState('savings');
  const [payoutMethod] = useState('bank_transfer');

  const saveMutation = useMutation({
    mutationFn: () => employeeWorkspaceApi.saveBankAccount(userId, {
      account_holder_name: accountHolderName,
      bank_name: bankName,
      account_number: accountNumber,
      ifsc_swift: ifscSwift,
      branch: branch || null,
      account_type: accountType,
      payout_method: payoutMethod,
      is_default: true,
      verification_status: 'pending',
    } as any),
    onSuccess: () => onSaved(),
    onError: (e: any) => showToast({
      kind: 'error',
      message: getApiErrorMessage(e, `Failed to save bank details for ${userName}`),
    }),
  });

  return (
    <div className="border-t border-amber-200 bg-amber-50/40 p-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <FieldLabel>Account Holder Name</FieldLabel>
          <TextInput value={accountHolderName} onChange={(e) => setAccountHolderName(e.target.value)} placeholder="As per bank records" />
        </div>
        <div>
          <FieldLabel>Bank Name</FieldLabel>
          <TextInput value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. HDFC Bank" />
        </div>
        <div>
          <FieldLabel>Account Number <span className="text-rose-600">*</span></FieldLabel>
          <TextInput value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="9–18 digits" />
        </div>
        <div>
          <FieldLabel>IFSC Code <span className="text-rose-600">*</span></FieldLabel>
          <TextInput value={ifscSwift} onChange={(e) => setIfscSwift(e.target.value.toUpperCase())} placeholder="e.g. HDFC0001234" maxLength={11} />
        </div>
        <div>
          <FieldLabel>Branch</FieldLabel>
          <TextInput value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="Optional" />
        </div>
        <div>
          <FieldLabel>Account Type</FieldLabel>
          <SelectInput value={accountType} onChange={(e) => setAccountType(e.target.value)}>
            <option value="savings">Savings</option>
            <option value="current">Current</option>
          </SelectInput>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 mt-4">
        <Button
          variant="primary"
          size="sm"
          iconLeft={saveMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !accountNumber || !ifscSwift}
        >
          {saveMutation.isPending ? 'Saving…' : 'Save Bank Details'}
        </Button>
      </div>
    </div>
  );
}

interface ConfirmDialogProps {
  icon: any;
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'default' | 'warning' | 'danger';
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ icon: Icon, title, message, confirmLabel, tone, isPending, onCancel, onConfirm }: ConfirmDialogProps) {
  const toneClasses = {
    default: 'bg-blue-600 hover:bg-blue-700',
    warning: 'bg-amber-600 hover:bg-amber-700',
    danger: 'bg-rose-600 hover:bg-rose-700',
  };
  return (
    <Modal open onClose={onCancel} titleId="run-confirm-dialog-title" size="md" busy={isPending}>
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${tone === 'warning' ? 'bg-amber-100' : tone === 'danger' ? 'bg-rose-100' : 'bg-blue-100'}`}>
              <Icon className={`h-5 w-5 ${tone === 'warning' ? 'text-amber-600' : tone === 'danger' ? 'text-rose-600' : 'text-blue-600'}`} />
            </div>
            <div className="flex-1">
              <h3 id="run-confirm-dialog-title" className="text-lg font-semibold text-slate-900">{title}</h3>
              <p className="text-sm text-slate-600 mt-1">{message}</p>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className={toneClasses[tone]}
              iconLeft={isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
              onClick={onConfirm}
              disabled={isPending}
            >
              {isPending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </div>
    </Modal>
  );
}

interface ReasonDialogProps {
  icon: any;
  title: string;
  message: string;
  placeholder: string;
  confirmLabel: string;
  tone: 'default' | 'warning' | 'danger';
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  reason: string;
  setReason: (s: string) => void;
}

function ReasonDialog({
  icon: Icon, title, message, placeholder, confirmLabel, tone, isPending,
  onCancel, onConfirm, reason, setReason,
}: ReasonDialogProps) {
  const toneClasses = {
    default: 'bg-blue-600 hover:bg-blue-700',
    warning: 'bg-amber-600 hover:bg-amber-700',
    danger: 'bg-rose-600 hover:bg-rose-700',
  };
  return (
    <Modal open onClose={onCancel} titleId="run-reason-dialog-title" size="md" busy={isPending}>
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${tone === 'warning' ? 'bg-amber-100' : 'bg-rose-100'}`}>
              <Icon className={`h-5 w-5 ${tone === 'warning' ? 'text-amber-600' : 'text-rose-600'}`} />
            </div>
            <div className="flex-1">
              <h3 id="run-reason-dialog-title" className="text-lg font-semibold text-slate-900">{title}</h3>
              <p className="text-sm text-slate-600 mt-1">{message}</p>
            </div>
          </div>
          <div className="mb-4">
            <FieldLabel>Reason for the audit log <span className="text-rose-600">*</span></FieldLabel>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={placeholder}
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className={toneClasses[tone]}
              iconLeft={isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
              onClick={onConfirm}
              disabled={isPending || !reason.trim()}
            >
              {isPending ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </div>
    </Modal>
  );
}

interface PartialLockDialogProps {
  data: any;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  isPending: boolean;
}

function PartialLockDialog({ data, onCancel, onConfirm, isPending }: PartialLockDialogProps) {
  const [reason, setReason] = useState('');
  const missing = data?.completeness?.missing_count ?? 0;
  const expected = data?.completeness?.expected_count ?? 0;

  return (
    <Modal open onClose={onCancel} titleId="partial-lock-dialog-title" size="lg" busy={isPending}>
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 id="partial-lock-dialog-title" className="text-lg font-semibold text-slate-900">Lock Partial Run?</h3>
              <p className="text-sm text-slate-600 mt-1">
                <strong>{missing} of {expected}</strong> expected employees haven't been processed yet.
                You can lock anyway, but they'll be excluded from this run.
              </p>
            </div>
          </div>

          <div className="mb-4">
            <FieldLabel>Reason for force-locking <span className="text-rose-600">*</span></FieldLabel>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Awaiting onboarding docs for 2 new joiners; will run corrections next cycle."
              rows={3}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-slate-500 mt-1">
              This reason is recorded in the audit log for compliance review.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onCancel} disabled={isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              className="bg-amber-600 hover:bg-amber-700"
              iconLeft={isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              onClick={() => onConfirm(reason.trim())}
              disabled={isPending || !reason.trim()}
            >
              {isPending ? 'Locking…' : 'Force-Lock Anyway'}
            </Button>
          </div>
        </div>
    </Modal>
  );
}

interface TabButtonProps {
  label: string;
  icon: any;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function TabButton({ label, icon: Icon, active, disabled, onClick }: TabButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
        active
          ? 'border-blue-600 text-blue-700'
          : 'border-transparent text-slate-500 hover:text-slate-700',
        disabled && 'opacity-40 cursor-not-allowed hover:text-slate-500',
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </button>
  );
}

interface PayrollNotificationStatusProps {
  status?: string | null;
  notifiedAt?: string | null;
  failedCount?: number | null;
  isSending: boolean;
  onResend: () => void;
}

function PayrollNotificationStatus({
  status,
  notifiedAt,
  failedCount,
  isSending,
  onResend,
}: PayrollNotificationStatusProps) {
  const tone =
    status === 'sent'
      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
      : status === 'failed'
        ? 'bg-rose-50 border-rose-200 text-rose-700'
        : 'bg-slate-50 border-slate-200 text-slate-600';

  const label =
    status === 'sent'
      ? 'Payslips notified'
      : status === 'failed'
        ? `Payslip notifications sent with ${failedCount ?? 0} failure(s)`
        : 'Payslips not yet notified';

  return (
    <div className={`rounded-lg border p-3 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Send className="h-4 w-4 flex-shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{label}</p>
            {notifiedAt && (
              <p className="text-xs opacity-80">
                {new Date(notifiedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
            )}
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          iconLeft={isSending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
          onClick={onResend}
          disabled={isSending}
        >
          {isSending ? 'Sending…' : 'Resend'}
        </Button>
      </div>
    </div>
  );
}

interface ReversalHistoryCardProps {
  reversals: any[];
  formatCurrency: (n: number) => string;
}

function ReversalHistoryCard({ reversals, formatCurrency }: ReversalHistoryCardProps) {
  const statusTone: Record<string, string> = {
    pending: 'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    completed: 'bg-emerald-100 text-emerald-700',
    failed: 'bg-rose-100 text-rose-700',
    rejected: 'bg-slate-100 text-slate-600',
  };

  return (
    <SurfaceCard className="p-5 bg-rose-50 border-rose-200 rounded-lg">
      <div className="flex items-start gap-4 mb-4">
        <div className="h-10 w-10 rounded-full bg-rose-100 flex items-center justify-center flex-shrink-0">
          <AlertTriangle className="h-5 w-5 text-rose-600" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-rose-900 mb-1">
            Payment Reversal{(reversals.length > 1 ? 's' : '')} ({reversals.length})
          </h3>
          <p className="text-sm text-rose-800">
            Reversal request{(reversals.length > 1 ? 's' : '')} for this run. Each is processed by the bank.
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {reversals.map((rev: any) => (
          <div key={rev.id} className="bg-white border border-rose-200 rounded-lg p-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-slate-900 text-sm truncate">{rev.user?.name ?? `Employee #${rev.user_id}`}</p>
              <p className="text-xs text-slate-500 truncate">{rev.reason}</p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-semibold text-slate-900">{formatCurrency(rev.amount)}</p>
              <span className={`inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider ${statusTone[rev.status] ?? 'bg-slate-100 text-slate-600'}`}>
                {rev.status}
              </span>
            </div>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

interface FinancialSummaryCardProps {
  totals: { gross: number; deductions: number; net: number };
}

function FinancialSummaryCard({ totals }: FinancialSummaryCardProps) {
  const employerContrib = Math.max(0, totals.gross - totals.deductions - totals.net);
  
  // Calculate percentages for visual representation
  const netPercentage = totals.gross > 0 ? (totals.net / totals.gross) * 100 : 0;
  const deductionPercentage = totals.gross > 0 ? (totals.deductions / totals.gross) * 100 : 0;
  const employerPercentage = totals.gross > 0 ? (employerContrib / totals.gross) * 100 : 0;
  
  return (
    <SurfaceCard className="p-5">
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
          <IndianRupee className="h-5 w-5 text-blue-600" />
          Financial Summary
        </h4>
        <div className="text-right">
          <p className="text-xs text-slate-500">Total Cost</p>
          <p className="text-lg font-bold text-slate-900">{formatCurrency(totals.gross)}</p>
        </div>
      </div>
      
      <div className="space-y-4">
        {/* Employee Take-home */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-sm font-medium text-slate-700">Employee Take-home</span>
            <span className="text-sm font-semibold text-emerald-600">{formatCurrency(totals.net)}</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div 
              className="bg-emerald-500 h-2 rounded-full" 
              style={{ width: `${netPercentage}%` }}
            ></div>
          </div>
          <div className="text-right mt-1">
            <span className="text-xs text-slate-500">{netPercentage.toFixed(1)}% of total</span>
          </div>
        </div>
        
        {/* Statutory Deductions */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-sm font-medium text-slate-700">Statutory Deductions</span>
            <span className="text-sm font-semibold text-amber-600">{formatCurrency(totals.deductions)}</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div 
              className="bg-amber-500 h-2 rounded-full" 
              style={{ width: `${deductionPercentage}%` }}
            ></div>
          </div>
          <div className="text-right mt-1">
            <span className="text-xs text-slate-500">{deductionPercentage.toFixed(1)}% of total</span>
          </div>
        </div>
        
        {/* Employer Contributions */}
        <div>
          <div className="flex justify-between mb-1">
            <span className="text-sm font-medium text-slate-700">Employer Contributions</span>
            <span className="text-sm font-semibold text-violet-600">{formatCurrency(employerContrib)}</span>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-2">
            <div 
              className="bg-violet-500 h-2 rounded-full" 
              style={{ width: `${employerPercentage}%` }}
            ></div>
          </div>
          <div className="text-right mt-1">
            <span className="text-xs text-slate-500">{employerPercentage.toFixed(1)}% of total</span>
          </div>
        </div>
      </div>
      
      <div className="mt-4 pt-3 border-t border-slate-200">
        <div className="flex justify-between">
          <span className="text-sm font-medium text-slate-700">Net Pay to Employees</span>
          <span className="text-base font-bold text-emerald-700">{formatCurrency(totals.net)}</span>
        </div>
      </div>
    </SurfaceCard>
  );
}

interface EmployeesTableProps {
  items: any[];
  formatCurrency: (n: number) => string;
}

type SortKey = 'name' | 'department' | 'gross' | 'deductions' | 'net_pay' | 'status';
type SortDir = 'asc' | 'desc';

function EmployeesTable({ items, formatCurrency }: EmployeesTableProps) {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'paid' | 'failed'>('all');
  const [sortKey, setSortKey] = useState<SortKey>('net_pay');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((it) => {
      if (q) {
        const name = String(it.employee_name ?? it.user_name ?? '').toLowerCase();
        const dept = String(it.department ?? '').toLowerCase();
        if (!name.includes(q) && !dept.includes(q)) return false;
      }
      if (statusFilter !== 'all') {
        const ps = String(it.payment_status ?? 'pending').toLowerCase();
        if (statusFilter === 'paid' && ps !== 'paid' && ps !== 'disbursed') return false;
        if (statusFilter === 'pending' && (ps === 'paid' || ps === 'disbursed')) return false;
        if (statusFilter === 'failed' && ps !== 'failed') return false;
      }
      return true;
    });
  }, [items, query, statusFilter]);

  const sorted = useMemo(() => {
    const out = [...filtered];
    out.sort((a, b) => {
      let av: any;
      let bv: any;
      switch (sortKey) {
        case 'name':
          av = String(a.employee_name ?? a.user_name ?? '').toLowerCase();
          bv = String(b.employee_name ?? b.user_name ?? '').toLowerCase();
          break;
        case 'department':
          av = String(a.department ?? '').toLowerCase();
          bv = String(b.department ?? '').toLowerCase();
          break;
        case 'gross':
          av = Number(a.gross_salary ?? 0);
          bv = Number(b.gross_salary ?? 0);
          break;
        case 'deductions':
          av = Number(a.total_deductions ?? 0);
          bv = Number(b.total_deductions ?? 0);
          break;
        case 'net_pay':
          av = Number(a.net_pay ?? 0);
          bv = Number(b.net_pay ?? 0);
          break;
        case 'status':
          av = String(a.payment_status ?? 'pending').toLowerCase();
          bv = String(b.payment_status ?? 'pending').toLowerCase();
          break;
      }
      if (av < bv) return sortDir === 'asc' ? -1 : 1;
      if (av > bv) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
    return out;
  }, [filtered, sortKey, sortDir]);

  function toggleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'department' || key === 'status' ? 'asc' : 'desc');
    }
  }

  function SortHeader({ k, label, align = 'left' }: { k: SortKey; label: string; align?: 'left' | 'right' }) {
    const active = sortKey === k;
    return (
      <button
        type="button"
        onClick={() => toggleSort(k)}
        className={cn(
          'flex items-center gap-1 text-xs font-semibold uppercase tracking-wider hover:text-blue-700 transition-colors',
          align === 'right' && 'ml-auto',
          active ? 'text-blue-700' : 'text-slate-500',
        )}
      >
        {label}
        <span className="flex flex-col">
          <ChevronUp className={cn(
            'h-2.5 w-2.5 -mb-1',
            active && sortDir === 'asc' ? 'text-blue-700' : 'text-slate-300'
          )} />
          <ChevronDown className={cn(
            'h-2.5 w-2.5 -mt-1',
            active && sortDir === 'desc' ? 'text-blue-700' : 'text-slate-300'
          )} />
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or department…"
            className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as any)}
          className="px-4 py-2.5 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition"
        >
          <option value="all">All Status</option>
          <option value="paid">Paid</option>
          <option value="pending">Pending</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="border border-slate-200 rounded-lg overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-slate-50 sticky top-0">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider text-slate-500 whitespace-nowrap w-[28%]">
                  <SortHeader k="name" label="Employee" />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider text-slate-500 whitespace-nowrap w-[18%]">
                  <SortHeader k="department" label="Department" />
                </th>
                <th className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider text-slate-500 whitespace-nowrap w-[13%]">
                  <SortHeader k="gross" label="Gross" align="right" />
                </th>
                <th className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider text-slate-500 whitespace-nowrap w-[13%]">
                  <SortHeader k="deductions" label="Deductions" align="right" />
                </th>
                <th className="px-4 py-3 text-right font-semibold text-xs uppercase tracking-wider text-slate-500 whitespace-nowrap w-[13%]">
                  <SortHeader k="net_pay" label="Net Pay" align="right" />
                </th>
                <th className="px-4 py-3 text-left font-semibold text-xs uppercase tracking-wider text-slate-500 whitespace-nowrap w-[15%]">
                  <SortHeader k="status" label="Status" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-16 text-center">
                    <Users className="h-12 w-12 mx-auto text-slate-300 mb-3" />
                    <p className="text-sm font-medium text-slate-500">No employees found</p>
                    <p className="text-xs text-slate-500 mt-1">Try adjusting your search or filter criteria</p>
                  </td>
                </tr>
              ) : (
                sorted.map((it, idx) => {
                  const name = it.employee_name ?? it.user_name ?? `Employee #${it.user_id}`;
                  const initials = String(name)
                    .split(' ')
                    .map((s) => s[0])
                    .filter(Boolean)
                    .slice(0, 2)
                    .join('')
                    .toUpperCase();
                  const ps = String(it.payment_status ?? 'pending').toLowerCase();
                  const psTone =
                    ps === 'paid' || ps === 'disbursed'
                      ? 'bg-emerald-100 text-emerald-800' 
                      : ps === 'failed'
                        ? 'bg-rose-100 text-rose-800'
                        : 'bg-amber-100 text-amber-800';
                  return (
                    <tr key={it.id ?? idx} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-blue-500 to-violet-500 text-white text-sm font-semibold flex items-center justify-center flex-shrink-0">
                            {initials || '?'}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 text-sm whitespace-nowrap">
                              {name}
                            </div>
                            <div className="text-xs text-slate-500 whitespace-nowrap">
                              {it.designation || 'No designation'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-sm text-slate-600 whitespace-nowrap">
                        {it.department || '—'}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-medium text-slate-900 whitespace-nowrap">
                        {formatCurrency(Number(it.gross_salary ?? 0))}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-medium text-amber-600 whitespace-nowrap">
                        {formatCurrency(Number(it.total_deductions ?? 0))}
                      </td>
                      <td className="px-4 py-3.5 text-right text-sm font-bold text-emerald-600 whitespace-nowrap">
                        {formatCurrency(Number(it.net_pay ?? 0))}
                      </td>
                      <td className="px-4 py-3.5">
                        <span className={cn(
                          'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium capitalize whitespace-nowrap',
                          psTone
                        )}>
                          {it.payment_status === 'disbursed' ? 'Paid' : it.payment_status || 'Pending'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        
        {sorted.length > 0 && (
          <div className="px-5 py-3 bg-slate-50 border-t border-slate-200 text-xs text-slate-600 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span>Showing {sorted.length} of {items.length} employees</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
