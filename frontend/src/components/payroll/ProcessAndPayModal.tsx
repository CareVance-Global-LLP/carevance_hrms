import { useState } from 'react';
import {
  X, Play, Loader2, IndianRupee, Users, AlertTriangle, Landmark,
  Check, Download, Wallet, Info, ChevronDown, ChevronUp, FileText,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { useToast } from '@/components/ui/Toast';

interface ProcessAndPayModalProps {
  isOpen: boolean;
  onClose: () => void;
  monthYear: string;
  pendingCount: number;
  expectedNetPay: number;
  onComplete?: () => void;
}

type Stage = 'review' | 'processing' | 'review-after' | 'ready' | 'disbursing' | 'done';

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatMonthLabel(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m) return monthYear;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

/**
 * The "Process & Pay" modal — the ONE place where payroll actually happens.
 *
 * User flow:
 *   1. Review screen: shows headcount, totals, exceptions (missing CTC,
 *      missing bank details). User can fix inline or click "Continue".
 *   2. Click "Process & Pay" → backend atomic flow runs (process→lock→
 *      approve→release). Modal shows inline spinner.
 *   3. Result screen: shows bank file download, skipped employees
 *      (with reasons), "I uploaded to bank" button.
 *   4. Click "I uploaded to bank" → backend marks as disbursed. Done.
 */
export default function ProcessAndPayModal({
  isOpen,
  onClose,
  monthYear,
  pendingCount,
  expectedNetPay,
  onComplete,
}: ProcessAndPayModalProps) {
  const { show } = useToast();
  const queryClient = useQueryClient();
  const [stage, setStage] = useState<Stage>('review');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  const processAndPayMutation = useMutation({
    mutationFn: () => payrollApi.processAndPay({
      month_year: monthYear,
      working_days: 26,
    }).then((r) => r.data),
    onSuccess: (data: any) => {
      setResult(data);
      setStage('ready');
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail'] });
      show({
        kind: 'success',
        message: data?.already_advanced
          ? `Payroll for ${monthYear} is already at "${data.run?.status}" — bank file is ready.`
          : `Payroll for ${monthYear} processed for ${data.summary?.employees_processed ?? 0} employees.`,
        durationMs: 6000,
      });
    },
    onError: (e: any) => {
      const msg = getApiErrorMessage(e, 'Failed to process payroll');
      setError(msg);
      show({ kind: 'error', message: msg, durationMs: 8000 });
      setStage('review');
    },
  });

  const disburseMutation = useMutation({
    mutationFn: (runId: number) => payrollApi.disburseRun(runId).then((r) => r.data),
    onSuccess: () => {
      setStage('done');
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail'] });
      show({ kind: 'success', message: 'Payroll disbursed. Run is now immutable for compliance.' });
      onComplete?.();
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to disburse') }),
  });

  if (!isOpen) return null;

  const handleProcessAndPay = () => {
    setError(null);
    setStage('processing');
    processAndPayMutation.mutate();
  };

  const handleDownloadBankFile = () => {
    const bf = result?.bank_file;
    if (!bf?.content) return;
    const blob = new Blob([bf.content], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = bf.filename ?? `payroll_${monthYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleConfirmUploaded = () => {
    const runId = result?.run?.id;
    if (!runId) return;
    disburseMutation.mutate(runId);
  };

  const handleClose = () => {
    if (stage === 'processing' || stage === 'disbursing') return; // Don't close during mutation
    if (stage === 'done') onComplete?.();
    onClose();
  };

  const run = result?.run;
  const summary = result?.summary;
  const bankFile = result?.bank_file;
  const skipped = bankFile?.skipped_employees ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 p-5 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Play className="h-5 w-5 text-blue-600" />
              Process &amp; Pay — {formatMonthLabel(monthYear)}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Process everyone, lock the numbers, generate the bank file — one click.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={stage === 'processing' || stage === 'disbursing'}
            className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-30"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700 flex-1">{error}</p>
              <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
            </div>
          )}

          {/* Stage: Review (before process) */}
          {stage === 'review' && (
            <>
              <SurfaceCard className="p-4 bg-slate-50">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Employees to process</p>
                    <p className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                      <Users className="h-5 w-5 text-slate-400" />
                      {pendingCount}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500 mb-1">Estimated net pay</p>
                    <p className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                      <IndianRupee className="h-5 w-5 text-slate-400" />
                      {formatCurrency(expectedNetPay)}
                    </p>
                  </div>
                </div>
              </SurfaceCard>

              <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900 flex items-start gap-2">
                <Info className="h-4 w-4 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">What happens when you click Process &amp; Pay:</p>
                  <ol className="text-xs mt-1 list-decimal list-inside space-y-0.5 text-blue-800">
                    <li>Calculates payroll for every active employee</li>
                    <li>Locks the numbers (no further edits)</li>
                    <li>Auto-approves as your org's authorized signatory</li>
                    <li>Generates the bank file (NEFT format) with auto-skip for missing bank details</li>
                  </ol>
                  <p className="text-xs mt-2 text-blue-700">
                    You'll then download the bank file, upload to your bank's portal, and click "I uploaded to bank" to finalize.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={handleClose}>Cancel</Button>
                <Button
                  variant="primary"
                  iconLeft={<Play className="h-4 w-4" />}
                  onClick={handleProcessAndPay}
                  disabled={pendingCount === 0}
                >
                  Process &amp; Pay {pendingCount > 0 ? `(${pendingCount})` : ''}
                </Button>
              </div>
            </>
          )}

          {/* Stage: Processing (in-flight) */}
          {stage === 'processing' && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Processing payroll…</h3>
              <p className="text-sm text-slate-600">
                Calculating salaries, applying PF/ESI/PT/TDS, locking the run, generating bank file.
              </p>
              <p className="text-xs text-slate-400 mt-2">This usually takes 5–15 seconds.</p>
            </div>
          )}

          {/* Stage: Ready (after process, before disburse) */}
          {stage === 'ready' && run && (
            <>
              <SurfaceCard className="p-5 bg-emerald-50 border-emerald-200">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <Check className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <p className="text-lg font-semibold text-emerald-900">Payroll processed. Ready to pay.</p>
                    <p className="text-sm text-emerald-700 mt-0.5">
                      {summary?.employees_processed ?? 0} employees processed.
                      {summary?.employees_skipped_no_ctc > 0 && ` ${summary.employees_skipped_no_ctc} skipped (no CTC).`}
                    </p>
                  </div>
                </div>
              </SurfaceCard>

              {/* Bank file download */}
              {bankFile && (
                <SurfaceCard className="p-4 border-blue-200">
                  <div className="flex items-center gap-3 mb-3">
                    <Landmark className="h-5 w-5 text-blue-600" />
                    <p className="text-sm font-semibold text-slate-900">Bank file ready</p>
                  </div>
                  <div className="bg-slate-50 rounded-lg p-3 mb-3">
                    <p className="text-xs text-slate-600">Filename</p>
                    <p className="font-mono text-sm text-slate-900">{bankFile.filename}</p>
                    <div className="grid grid-cols-3 gap-3 mt-3">
                      <div>
                        <p className="text-xs text-slate-500">Entries</p>
                        <p className="font-semibold text-slate-900">{bankFile.total_employees}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Total</p>
                        <p className="font-semibold text-slate-900">{formatCurrency(bankFile.total_amount)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500">Skipped</p>
                        <p className={`font-semibold ${skipped.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                          {skipped.length}
                        </p>
                      </div>
                    </div>
                  </div>
                  <Button
                    variant="primary"
                    iconLeft={<Download className="h-4 w-4" />}
                    onClick={handleDownloadBankFile}
                  >
                    Download Bank File (CSV)
                  </Button>
                  <p className="text-xs text-slate-500 mt-2">
                    Upload this to your bank's corporate portal (HDFC, ICICI, SBI, etc.).
                  </p>
                </SurfaceCard>
              )}

              {/* Skipped employees */}
              {skipped.length > 0 && (
                <SurfaceCard className="p-4 bg-amber-50 border-amber-200">
                  <div className="flex items-start gap-2 mb-3">
                    <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <p className="text-sm font-semibold text-amber-900">
                        {skipped.length} employee{skipped.length === 1 ? '' : 's'} skipped from bank file
                      </p>
                      <p className="text-xs text-amber-800 mt-0.5">
                        They will be excluded from this disbursement. Pay them separately (cash/cheque/UPI) or wait until they add bank details.
                      </p>
                    </div>
                  </div>
                  <ul className="space-y-1 text-sm">
                    {skipped.map((emp: any) => (
                      <li key={emp.user_id} className="flex items-center justify-between bg-white rounded px-3 py-2">
                        <span className="text-slate-900">{emp.name}</span>
                        <span className="text-xs text-amber-700">
                          missing: {emp.missing_fields?.join(', ')}
                        </span>
                      </li>
                    ))}
                  </ul>
                </SurfaceCard>
              )}

              {/* Advanced: lifecycle tracker + audit */}
              <details
                open={showAdvanced}
                onToggle={(e) => setShowAdvanced((e.target as HTMLDetailsElement).open)}
                className="rounded-lg border border-slate-200 overflow-hidden"
              >
                <summary className="px-4 py-3 cursor-pointer bg-slate-50 hover:bg-slate-100 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700 flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Lifecycle tracker (read-only)
                  </span>
                  {showAdvanced ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </summary>
                <div className="p-4 space-y-2 text-sm bg-white">
                  <LifecycleRow label="Created" timestamp={run.created_at} actor={run.created_by} />
                  <LifecycleRow label="Locked" timestamp={run.locked_at} actor={run.locked_by} />
                  <LifecycleRow label="Approved" timestamp={run.approved_at} actor={run.approved_by} />
                  <LifecycleRow label="Released" timestamp={run.released_at} actor={run.released_by} />
                  <LifecycleRow label="Disbursed" timestamp={run.disbursed_at} actor={run.disbursed_by} muted />
                </div>
              </details>

              {/* Primary action: confirm bank upload + disburse */}
              <SurfaceCard className="p-4 border-blue-200 bg-blue-50/40">
                <div className="flex items-start gap-3 mb-3">
                  <Wallet className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-slate-900">After uploading to bank:</p>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Once the bank processes the file (usually next business day), click below to mark all payslips as paid and lock the run.
                    </p>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <Button variant="ghost" onClick={handleClose}>Close for now</Button>
                  <Button
                    variant="primary"
                    iconLeft={disburseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
                    onClick={handleConfirmUploaded}
                    disabled={disburseMutation.isPending}
                  >
                    {disburseMutation.isPending ? 'Marking…' : 'I uploaded to bank — mark disbursed'}
                  </Button>
                </div>
              </SurfaceCard>
            </>
          )}

          {/* Stage: Disbursing */}
          {stage === 'disbursing' && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 text-emerald-600 animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Marking as disbursed…</h3>
            </div>
          )}

          {/* Stage: Done */}
          {stage === 'done' && (
            <div className="text-center py-12">
              <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <Check className="h-8 w-8 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-2">Disbursed ✅</h3>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                This run is now <strong>immutable for compliance</strong>. PF ECR, ESI contribution,
                and PT return will be generated from this run for statutory filing.
              </p>
              <Button variant="primary" className="mt-6" onClick={handleClose}>
                Done
              </Button>
            </div>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}

function LifecycleRow({ label, timestamp, actor, muted }: {
  label: string;
  timestamp?: string | null;
  actor?: number | string | null;
  muted?: boolean;
}) {
  const done = !!timestamp;
  return (
    <div className={`flex items-center justify-between py-1 ${muted && !done ? 'text-slate-400' : ''}`}>
      <span className="flex items-center gap-2">
        {done
          ? <Check className="h-4 w-4 text-emerald-600" />
          : <div className="h-4 w-4 rounded-full border-2 border-slate-300" />
        }
        {label}
      </span>
      <span className="text-xs text-slate-500">
        {done
          ? `${new Date(timestamp!).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}${actor ? ` by ${actor}` : ''}`
          : 'pending'}
      </span>
    </div>
  );
}
