import { useState } from 'react';
import {
  X, Lock, ShieldCheck, Send, Loader2, IndianRupee, Users, Calendar, FileText,
  AlertCircle, AlertTriangle, Landmark, Plus, Check, Unlock, Wallet, PlayCircle,
  ListChecks, Info,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, employeeWorkspaceApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import InfoTooltip from '@/components/ui/InfoTooltip';
import { useToast } from '@/components/ui/Toast';
import PayrollRunLifecycleStepper, { RunLifecycleState } from './PayrollRunLifecycleStepper';

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
  const [error, setError] = useState<string | null>(null);
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [showDisburseConfirm, setShowDisburseConfirm] = useState(false);
  const [unlockReason, setUnlockReason] = useState('');
  const [partialLockData, setPartialLockData] = useState<any>(null);

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
    queryClient.invalidateQueries({ queryKey: ['payroll', 'department'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
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

  const totals = {
    employees: items.length,
    gross: items.reduce((s: number, i: any) => s + (i.gross_salary || i.basic_salary || 0), 0),
    deductions: items.reduce((s: number, i: any) => s + (i.total_deductions || 0), 0),
    net: items.reduce((s: number, i: any) => s + (i.net_pay || 0), 0),
  };

  const isMutating =
    lockMutation.isPending ||
    unlockMutation.isPending ||
    approveMutation.isPending ||
    releaseMutation.isPending ||
    disburseMutation.isPending ||
    processRemainingMutation.isPending;

  const completenessInfo: any = completeness;
  const isIncomplete = completenessInfo && completenessInfo.is_complete === false;
  const expectedCount = completenessInfo?.expected_count ?? 0;
  const processedCount = completenessInfo?.processed_count ?? items.length;
  const missingForCompletion = completenessInfo?.missing_count ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 p-5 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Payroll Run Detail
              <InfoTooltip
                content="Every payroll run moves through 5 stages. Disbursed runs are immutable for compliance — you can't delete or re-process them."
                title="Run lifecycle"
              />
            </h2>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {run?.month_year ?? monthYear ?? 'Unknown month'}
              {run?.id && <> · Run #{run.id}</>}
              {expectedCount > 0 && (
                <> · {processedCount}/{expectedCount} employees</>
              )}
            </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Close">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700 flex-1">{error}</p>
              <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
            </div>
          )}

          {isLoading ? (
            <div className="text-center py-12">
              <Loader2 className="h-8 w-8 text-blue-600 animate-spin mx-auto mb-3" />
              <p className="text-sm text-slate-500">Loading run details…</p>
            </div>
          ) : (
            <>
              {/* Lifecycle Stepper */}
              <SurfaceCard className="p-5 bg-slate-50">
                <PayrollRunLifecycleStepper currentState={currentState} />
              </SurfaceCard>

              {/* Completeness card — shown when run is draft/locked and incomplete */}
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

              {/* Totals */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryStat icon={Users} label="Employees" value={totals.employees} />
                <SummaryStat icon={IndianRupee} label="Gross" value={formatCurrency(totals.gross)} accent="violet" />
                <SummaryStat icon={IndianRupee} label="Deductions" value={formatCurrency(totals.deductions)} accent="amber" />
                <SummaryStat icon={IndianRupee} label="Net Pay" value={formatCurrency(totals.net)} accent="emerald" />
              </div>

              {/* Missing bank details warning — only relevant for approved+ */}
              {missingCount > 0 && (currentState === 'approved' || currentState === 'released') && (
                <MissingBankCard
                  missingEmployees={missingEmployees}
                  runId={runId}
                  onAdded={() => invalidateAll()}
                  showToast={show}
                />
              )}

              {/* Action Bar — drives lifecycle transitions */}
              <SurfaceCard className="p-4 border-blue-200 bg-blue-50/40">
                <h4 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
                  <ListChecks className="h-4 w-4 text-blue-600" />
                  Next steps
                </h4>
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
                  lockPending={lockMutation.isPending}
                  unlockPending={unlockMutation.isPending}
                  approvePending={approveMutation.isPending}
                  releasePending={releaseMutation.isPending}
                  disbursePending={disburseMutation.isPending}
                />
              </SurfaceCard>

              {/* Per-employee grid */}
              {items.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 mb-3">Payslips in this run</h4>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {items.slice(0, 50).map((it: any, idx: number) => (
                      <div key={it.id ?? idx} className="flex items-center justify-between p-3 bg-white border border-slate-200 rounded-lg text-sm">
                        <div>
                          <p className="font-medium text-slate-900">{it.user_name ?? it.employee_name ?? `Employee #${it.user_id}`}</p>
                          <p className="text-xs text-slate-500">{it.designation ?? it.department ?? ''}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold text-emerald-600">{formatCurrency(it.net_pay || 0)}</p>
                          <p className="text-xs text-slate-500">{it.payment_status ?? 'pending'}</p>
                        </div>
                      </div>
                    ))}
                    {items.length > 50 && (
                      <p className="text-xs text-slate-500 text-center py-2">
                        + {items.length - 50} more (use Bank File for full export)
                      </p>
                    )}
                  </div>
                </div>
              )}

              {!isLoading && items.length === 0 && (
                <div className="text-center py-8 text-slate-500 text-sm">
                  No payslips in this run yet. Process employees to populate this run.
                </div>
              )}
            </>
          )}
        </div>
      </SurfaceCard>

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
    </div>
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
  return (
    <SurfaceCard className="p-4 bg-amber-50 border-amber-200">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {missing} of {expected} expected employees haven't been processed for this run
          </p>
          <p className="text-xs text-amber-800 mt-1">
            {state === 'draft'
              ? 'Process all expected employees before locking. You can use "Process Remaining" to fill the gaps automatically.'
              : 'This run was force-locked with missing employees. To include them, unlock the run, then process the remaining employees.'}
          </p>

          {missingEmployees.length > 0 && (
            <details className="mt-3">
              <summary className="text-xs font-medium text-amber-900 cursor-pointer hover:underline">
                Show {missingEmployees.length} missing employee{missingEmployees.length === 1 ? '' : 's'}
              </summary>
              <ul className="mt-2 space-y-1 text-xs text-amber-900">
                {missingEmployees.slice(0, 10).map((emp) => (
                  <li key={emp.id} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    <span className="font-medium">{emp.name}</span>
                    <span className="text-amber-700">({emp.email})</span>
                  </li>
                ))}
                {missingEmployees.length > 10 && (
                  <li className="text-amber-700 italic">+ {missingEmployees.length - 10} more…</li>
                )}
              </ul>
            </details>
          )}

          {state === 'draft' && expected > 0 && (
            <div className="mt-3 flex items-center gap-2">
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
  lockPending: boolean;
  unlockPending: boolean;
  approvePending: boolean;
  releasePending: boolean;
  disbursePending: boolean;
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
  lockPending,
  unlockPending,
  approvePending,
  releasePending,
  disbursePending,
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
        <div className="w-full">
          <div className="flex items-center gap-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
            <Check className="h-4 w-4" />
            <span>
              <strong>Disbursed.</strong> All payments recorded. This run is immutable for compliance.
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-2">
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

function MissingBankCard({ missingEmployees, runId, onAdded, showToast }: MissingBankCardProps) {
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);

  return (
    <SurfaceCard className="p-4 bg-amber-50 border-amber-200">
      <div className="flex items-start gap-3">
        <AlertTriangle className="h-5 w-5 text-amber-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            {missingEmployees.length} employee{missingEmployees.length === 1 ? '' : 's'} missing bank details
          </p>
          <p className="text-xs text-amber-800 mt-1">
            Bank file will exclude them until their account number & IFSC are added.
          </p>
          <ul className="mt-3 space-y-2">
            {missingEmployees.map((emp: any) => (
              <li key={emp.user_id} className="bg-white border border-amber-200 rounded-lg overflow-hidden">
                <div className="flex items-center justify-between p-3">
                  <div className="min-w-0">
                    <p className="font-medium text-slate-900 text-sm truncate">{emp.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {emp.email}
                      {emp.missing_fields?.length > 0 && (
                        <> · missing: {emp.missing_fields.join(', ')}</>
                      )}
                      {emp.has_partial_account && emp.missing_fields?.length === 0 && (
                        <> · partial account on file</>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<Plus className="h-3 w-3" />}
                    onClick={() => setExpandedUserId(expandedUserId === emp.user_id ? null : emp.user_id)}
                  >
                    {expandedUserId === emp.user_id ? 'Cancel' : 'Add Bank Details'}
                  </Button>
                </div>
                {expandedUserId === emp.user_id && (
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
                )}
              </li>
            ))}
          </ul>
        </div>
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
  const [payoutMethod, setPayoutMethod] = useState('bank_transfer');

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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
      <SurfaceCard className="w-full max-w-md">
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${tone === 'warning' ? 'bg-amber-100' : tone === 'danger' ? 'bg-rose-100' : 'bg-blue-100'}`}>
              <Icon className={`h-5 w-5 ${tone === 'warning' ? 'text-amber-600' : tone === 'danger' ? 'text-rose-600' : 'text-blue-600'}`} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
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
      </SurfaceCard>
    </div>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
      <SurfaceCard className="w-full max-w-md">
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center flex-shrink-0 ${tone === 'warning' ? 'bg-amber-100' : 'bg-rose-100'}`}>
              <Icon className={`h-5 w-5 ${tone === 'warning' ? 'text-amber-600' : 'text-rose-600'}`} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
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
      </SurfaceCard>
    </div>
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60">
      <SurfaceCard className="w-full max-w-lg">
        <div className="p-5">
          <div className="flex items-start gap-3 mb-4">
            <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-900">Lock Partial Run?</h3>
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
      </SurfaceCard>
    </div>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  accent = 'blue',
}: {
  icon: any;
  label: string;
  value: string | number;
  accent?: 'blue' | 'emerald' | 'amber' | 'violet';
}) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
  };
  return (
    <SurfaceCard className="p-3">
      <div className="flex items-center gap-2 mb-1">
        <div className={`h-6 w-6 rounded flex items-center justify-center ${colors[accent]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <p className="text-xs font-medium text-slate-500">{label}</p>
      </div>
      <p className="text-lg font-bold text-slate-900">{value}</p>
    </SurfaceCard>
  );
}
