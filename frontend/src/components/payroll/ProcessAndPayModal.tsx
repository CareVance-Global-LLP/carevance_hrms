import { useCallback, useEffect, useState } from 'react';
import {
  X, Play, Loader2, IndianRupee, Users, AlertTriangle, Landmark,
  Check, Download, Wallet, Info, ChevronDown, ChevronUp, FileText,
  BarChart3, Calendar, Clock, Shield
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { useToast } from '@/components/ui/Toast';
import Modal from '@/components/ui/dialog/Modal';

type ProcessMode = 'modal' | 'inline';

interface ProcessAndPayPanelProps {
  monthYear: string;
  pendingCount: number;
  expectedNetPay: number;
  onClose?: () => void;
  onComplete?: () => void;
  mode?: ProcessMode;
  /**
   * Reports whether a process or disburse call is in flight. The panel already
   * refuses to close its own button mid-run; the modal wrapper needs the same
   * fact to stop Escape and a backdrop click abandoning a disbursement.
   */
  onBusyChange?: (busy: boolean) => void;
}

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
export function ProcessAndPayPanel({
  monthYear,
  pendingCount,
  expectedNetPay,
  onClose,
  onComplete,
  mode = 'modal',
  onBusyChange,
}: ProcessAndPayPanelProps) {
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

  const isBusy = stage === 'processing' || stage === 'disbursing';

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  const run = result?.run;
  const summary = result?.summary;
  const bankFile = result?.bank_file;
  const skipped = bankFile?.skipped_employees ?? [];

  return (
    <SurfaceCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-200 p-5 flex items-center justify-between z-10">
          <div>
            <h2 id="process-and-pay-title" className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <Play className="h-5 w-5 text-blue-600" />
              Process &amp; Pay — {formatMonthLabel(monthYear)}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Process everyone, lock the numbers, generate the bank file — one click.
            </p>
          </div>
          {mode === 'modal' && (
          <button
            onClick={handleClose}
            disabled={stage === 'processing' || stage === 'disbursing'}
            className="p-2 hover:bg-slate-100 rounded-lg disabled:opacity-30"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-slate-500" />
          </button>
          )}
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <SurfaceCard className="p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Employees to process</p>
                      <p className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <Users className="h-5 w-5 text-slate-500" />
                        {pendingCount}
                      </p>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center">
                      <Users className="h-6 w-6 text-blue-600" />
                    </div>
                  </div>
                </SurfaceCard>
                
                <SurfaceCard className="p-4 hover:shadow-md transition-shadow">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-500 mb-1">Estimated net pay</p>
                      <p className="text-2xl font-bold text-slate-900 flex items-center gap-2">
                        <IndianRupee className="h-5 w-5 text-slate-500" />
                        {formatCurrency(expectedNetPay)}
                      </p>
                    </div>
                    <div className="h-12 w-12 rounded-full bg-green-100 flex items-center justify-center">
                      <IndianRupee className="h-6 w-6 text-green-600" />
                    </div>
                  </div>
                </SurfaceCard>
              </div>

              <SurfaceCard className="p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <BarChart3 className="h-5 w-5 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-slate-900 mb-2">Payroll Overview</h3>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div className="p-3 bg-white rounded-lg">
                        <Calendar className="h-5 w-5 text-slate-500 mx-auto mb-1" />
                        <p className="text-xs text-slate-500">Period</p>
                        <p className="font-semibold text-slate-900">{formatMonthLabel(monthYear)}</p>
                      </div>
                      <div className="p-3 bg-white rounded-lg">
                        <Clock className="h-5 w-5 text-slate-500 mx-auto mb-1" />
                        <p className="text-xs text-slate-500">Status</p>
                        <p className="font-semibold text-slate-900">Pending</p>
                      </div>
                      <div className="p-3 bg-white rounded-lg">
                        <Shield className="h-5 w-5 text-slate-500 mx-auto mb-1" />
                        <p className="text-xs text-slate-500">Compliance</p>
                        <p className="font-semibold text-slate-900">Ready</p>
                      </div>
                    </div>
                  </div>
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-4 border border-slate-200 rounded-lg">
                <div className="flex items-start gap-3">
                  <Info className="h-5 w-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold text-slate-900 mb-2">Process & Pay Workflow</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="flex items-start gap-2">
                        <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-blue-600">1</span>
                        </div>
                        <div>
                          <p className="font-medium text-sm text-slate-900">Calculate &amp; Lock</p>
                          <p className="text-xs text-slate-500">Apply all components, then lock for compliance</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-blue-600">2</span>
                        </div>
                        <div>
                          <p className="font-medium text-sm text-slate-900">Approve</p>
                          <p className="text-xs text-slate-500">A different admin must approve when required</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-blue-600">3</span>
                        </div>
                        <div>
                          <p className="font-medium text-sm text-slate-900">Release Bank File</p>
                          <p className="text-xs text-slate-500">Generate NEFT file with auto-skipping</p>
                        </div>
                      </div>
                      <div className="flex items-start gap-2">
                        <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                          <span className="text-xs font-bold text-blue-600">4</span>
                        </div>
                        <div>
                          <p className="font-medium text-sm text-slate-900">Upload &amp; Confirm</p>
                          <p className="text-xs text-slate-500">Mark as disbursed after bank upload</p>
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-slate-500 mt-3">
                      When your organization requires a second approver, the run pauses after locking and a
                      <span className="font-medium text-slate-700"> different admin</span> must approve and release it
                      before it can be disbursed.
                    </p>
                  </div>
                </div>
              </SurfaceCard>

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
            <div className="py-8">
              <div className="text-center mb-8">
                <Loader2 className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-slate-900 mb-2">Processing payroll…</h3>
                <p className="text-sm text-slate-600 max-w-md mx-auto">
                  Calculating salaries, applying PF/ESI/PT/TDS, locking the run, generating bank file.
                </p>
                <p className="text-xs text-slate-500 mt-2">This usually takes 5–15 seconds.</p>
              </div>
              
              <div className="max-w-md mx-auto">
                <div className="flex justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Progress</span>
                  <span className="text-sm text-slate-500">4/4 steps</span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2.5">
                  <div className="bg-blue-600 h-2.5 rounded-full animate-pulse" style={{ width: '75%' }}></div>
                </div>
                
                <div className="grid grid-cols-4 gap-2 mt-4">
                  {['Calculating', 'Locking', 'Approving', 'Generating'].map((step, index) => (
                    <div key={index} className="text-center">
                      <div className={`h-8 w-8 rounded-full flex items-center justify-center mx-auto mb-1 ${
                        index < 3 ? 'bg-emerald-100' : 'bg-blue-100'
                      }`}>
                        {index < 3 ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Loader2 className="h-4 w-4 text-blue-600 animate-spin" />
                        )}
                      </div>
                      <span className="text-xs text-slate-600">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Stage: Ready (after process, before disburse) */}
          {stage === 'ready' && run && (
            <>
              <SurfaceCard className="p-5 bg-gradient-to-r from-emerald-50 to-teal-50 border-emerald-200 rounded-lg">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-100 flex items-center justify-center flex-shrink-0">
                    <Check className="h-6 w-6 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-emerald-900">Payroll Processed Successfully</h3>
                    <p className="text-sm text-emerald-700 mt-1">
                      {summary?.employees_processed ?? 0} employees processed.
                      {summary?.employees_skipped_no_ctc > 0 && ` ${summary.employees_skipped_no_ctc} skipped (no CTC).`}
                    </p>
                    
                    <div className="grid grid-cols-3 gap-3 mt-4">
                      <div className="p-3 bg-white rounded-lg border border-emerald-100">
                        <p className="text-xs text-emerald-600 mb-1">Processed</p>
                        <p className="font-bold text-emerald-900">{summary?.employees_processed ?? 0}</p>
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-amber-100">
                        <p className="text-xs text-amber-600 mb-1">Skipped</p>
                        <p className="font-bold text-amber-900">{summary?.employees_skipped_no_ctc ?? 0}</p>
                      </div>
                      <div className="p-3 bg-white rounded-lg border border-blue-100">
                        <p className="text-xs text-blue-600 mb-1">Net Pay</p>
                        <p className="font-bold text-blue-900">{formatCurrency(summary?.total_net_pay ?? 0)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </SurfaceCard>

              {result?.awaiting_second_approver && (
                <SurfaceCard className="p-5 bg-blue-50 border-blue-200 rounded-lg">
                  <div className="flex items-start gap-3">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                      <Shield className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-blue-900">Awaiting second approver</h3>
                      <p className="text-sm text-blue-800 mt-1">
                        This run is locked but cannot be released or disbursed by you. A
                        <span className="font-medium"> different admin</span> must approve and release it
                        from the payroll runs list before payslips can be published.
                      </p>
                    </div>
                  </div>
                </SurfaceCard>
              )}

              {/* Bank file download */}
              {bankFile && (
                <SurfaceCard className="p-5 border border-slate-200 rounded-lg">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-blue-100 flex items-center justify-center">
                      <Landmark className="h-5 w-5 text-blue-600" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-slate-900">Bank File Ready</h3>
                      <p className="text-xs text-slate-500">Upload to your bank's corporate portal</p>
                    </div>
                  </div>
                  
                  <div className="bg-slate-50 rounded-lg p-4 mb-4">
                    <div className="flex justify-between items-start mb-3">
                      <div>
                        <p className="text-xs text-slate-500">File Name</p>
                        <p className="font-mono text-sm text-slate-900 break-all">{bankFile.filename}</p>
                      </div>
                      <Button
                        variant="secondary"
                        size="sm"
                        iconLeft={<Download className="h-4 w-4" />}
                        onClick={handleDownloadBankFile}
                      >
                        Download
                      </Button>
                    </div>
                    
                    <div className="grid grid-cols-3 gap-4">
                      <div className="p-3 bg-white rounded-lg border">
                        <p className="text-xs text-slate-500 mb-1">Entries</p>
                        <p className="text-xl font-bold text-slate-900">{bankFile.total_employees}</p>
                      </div>
                      <div className="p-3 bg-white rounded-lg border">
                        <p className="text-xs text-slate-500 mb-1">Total Amount</p>
                        <p className="text-xl font-bold text-slate-900">{formatCurrency(bankFile.total_amount)}</p>
                      </div>
                      <div className="p-3 bg-white rounded-lg border">
                        <p className="text-xs text-slate-500 mb-1">Skipped</p>
                        <p className={`text-xl font-bold ${skipped.length > 0 ? 'text-amber-600' : 'text-slate-900'}`}>
                          {skipped.length}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center justify-between pt-2">
                    <div className="flex items-center gap-2">
                      <div className="h-6 w-6 rounded-full bg-blue-100 flex items-center justify-center">
                        <Info className="h-3 w-3 text-blue-600" />
                      </div>
                      <p className="text-xs text-slate-500">
                        Supported banks: HDFC, ICICI, SBI, Axis, Kotak
                      </p>
                    </div>
                  </div>
                </SurfaceCard>
              )}

              {/* Skipped employees */}
              {skipped.length > 0 && (
                <SurfaceCard className="p-5 bg-amber-50 border-amber-200 rounded-lg">
                  <div className="flex items-start gap-3 mb-4">
                    <div className="h-10 w-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                    </div>
                    <div className="flex-1">
                      <h3 className="text-base font-semibold text-amber-900">
                        {skipped.length} Employee{skipped.length === 1 ? '' : 's'} Skipped
                      </h3>
                      <p className="text-sm text-amber-800 mt-1">
                        These employees will be excluded from this disbursement. Pay them separately (cash/cheque/UPI) or wait until they add bank details.
                      </p>
                    </div>
                  </div>
                  
                  <div className="max-h-60 overflow-y-auto border border-amber-200 rounded-lg">
                    <table className="w-full text-sm">
                      <thead className="bg-amber-100 sticky top-0">
                        <tr>
                          <th className="text-left p-3 font-medium text-amber-900">Employee</th>
                          <th className="text-left p-3 font-medium text-amber-900">Missing Information</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100">
                        {skipped.map((emp: any) => (
                          <tr key={emp.user_id} className="bg-white hover:bg-amber-50">
                            <td className="p-3 font-medium text-slate-900">{emp.name}</td>
                            <td className="p-3 text-amber-700">
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-amber-100 text-amber-800">
                                {emp.missing_fields?.join(', ')}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
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

              {/* Primary action: confirm bank upload + disburse (only when no
                  second approver is pending) */}
              {!result?.awaiting_second_approver && (
              <SurfaceCard className="p-5 border border-slate-200 rounded-lg bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-start gap-4 mb-4">
                  <div className="h-12 w-12 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
                    <Wallet className="h-6 w-6 text-blue-600" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-base font-bold text-slate-900">Confirm Bank Upload</h3>
                    <p className="text-sm text-slate-600 mt-1">
                      Once the bank processes the file (usually next business day), click below to mark all payslips as paid and lock the run.
                    </p>
                    
                    <div className="mt-4 p-3 bg-white rounded-lg border border-blue-200">
                      <div className="flex items-center gap-2 mb-2">
                        <Shield className="h-4 w-4 text-blue-600" />
                        <span className="text-sm font-medium text-blue-900">Compliance Note</span>
                      </div>
                      <p className="text-xs text-blue-800">
                        After clicking this button, the payroll run becomes immutable for compliance purposes. 
                        All statutory reports (PF ECR, ESI, PT) will be generated from this locked data.
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-end gap-3 pt-2">
                  {mode === 'modal' && <Button variant="ghost" onClick={handleClose}>Close for now</Button>}
                  <Button
                    variant="primary"
                    size="lg"
                    iconLeft={disburseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                    onClick={handleConfirmUploaded}
                    disabled={disburseMutation.isPending}
                  >
                    {disburseMutation.isPending ? 'Marking as Disbursed…' : 'Confirm Upload & Mark Disbursed'}
                  </Button>
                </div>
              </SurfaceCard>
              )}
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
            <div className="text-center py-8">
              <div className="relative inline-block">
                <div className="h-20 w-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                  <Check className="h-10 w-10 text-emerald-600" />
                </div>
                <div className="absolute -top-2 -right-2 h-8 w-8 rounded-full bg-blue-500 flex items-center justify-center">
                  <Shield className="h-4 w-4 text-white" />
                </div>
              </div>
              
              <h3 className="text-2xl font-bold text-slate-900 mb-3">Payroll Disbursed Successfully</h3>
              <p className="text-base text-slate-600 max-w-md mx-auto mb-6">
                This payroll run is now <span className="font-semibold text-emerald-700">locked for compliance</span>. 
                All statutory reports will be generated from this immutable data.
              </p>
              
              <div className="max-w-md mx-auto grid grid-cols-3 gap-4 mb-8">
                <div className="p-3 bg-white rounded-lg border">
                  <FileText className="h-6 w-6 text-blue-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">PF ECR</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">Ready</p>
                </div>
                <div className="p-3 bg-white rounded-lg border">
                  <FileText className="h-6 w-6 text-emerald-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">ESI Return</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">Ready</p>
                </div>
                <div className="p-3 bg-white rounded-lg border">
                  <FileText className="h-6 w-6 text-amber-600 mx-auto mb-2" />
                  <p className="text-xs text-slate-500">PT Return</p>
                  <p className="text-sm font-semibold text-slate-900 mt-1">Ready</p>
                </div>
              </div>
              
              <Button variant="primary" size="lg" className="mt-2" onClick={() => (mode === 'modal' ? handleClose() : onComplete?.())}>
                Close & View Payroll Runs
              </Button>
            </div>
          )}
        </div>
      </SurfaceCard>
  );
}

export default function ProcessAndPayModal({
  isOpen,
  onClose,
  monthYear,
  pendingCount,
  expectedNetPay,
  onComplete,
}: ProcessAndPayModalProps) {
  const [busy, setBusy] = useState(false);

  if (!isOpen) return null;

  return (
    <Modal
      open
      onClose={onClose}
      titleId="process-and-pay-title"
      size="2xl"
      bare
      showCloseButton={false}
      busy={busy}
    >
      <ProcessAndPayPanel
        mode="modal"
        onBusyChange={setBusy}
        monthYear={monthYear}
        pendingCount={pendingCount}
        expectedNetPay={expectedNetPay}
        onClose={onClose}
        onComplete={onComplete}
      />
    </Modal>
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
    <div className={`flex items-center justify-between py-1 ${muted && !done ? 'text-slate-500' : ''}`}>
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
