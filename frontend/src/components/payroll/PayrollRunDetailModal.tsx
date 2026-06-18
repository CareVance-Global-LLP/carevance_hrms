import { useState } from 'react';
import {
  X, Lock, ShieldCheck, Send, Loader2, IndianRupee, Users, Calendar, FileText,
  AlertCircle, AlertTriangle, Landmark, Plus, Check,
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

  const { data: detailData, isLoading } = useQuery({
    queryKey: ['payroll', 'run-detail', runId],
    queryFn: () => runId ? payrollApi.getPayrollRunDetail(runId).then((r) => r.data) : null,
    enabled: !!runId && isOpen,
  });

  // List of employees missing bank details — drives the warning card + inline form
  const { data: missingBank } = useQuery({
    queryKey: ['payroll', 'run-missing-bank', runId],
    queryFn: () => runId ? payrollApi.getRunMissingBankDetails(runId).then((r) => r.data) : null,
    enabled: !!runId && isOpen,
  });

  const invalidateAll = () => {
    if (!runId) return;
    queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail', runId] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'run-missing-bank', runId] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'department'] });
    queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
  };

  const lockMutation = useMutation({
    mutationFn: () => runId ? payrollApi.lockPayrollRun(runId).then((r) => r.data) : null,
    onSuccess: () => {
      invalidateAll();
      show({ kind: 'success', message: 'Run locked. Ready for approval.' });
    },
    onError: (e: any) => {
      const msg = getApiErrorMessage(e, 'Failed to lock run');
      setError(msg);
      show({ kind: 'error', message: msg });
    },
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

  const handleDownloadBankFile = async () => {
    if (!runId) return;
    try {
      const res = await payrollApi.generateBankFile(runId);
      const data: any = res.data;
      const skippedCount = data?.skipped_employees?.length ?? 0;
      const included = data?.entries?.length ?? 0;

      // Trigger browser download of the CSV
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
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate bank file') });
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

  const isMutating = lockMutation.isPending || approveMutation.isPending || releaseMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-slate-200 p-5 flex items-center justify-between z-10">
          <div>
            <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Payroll Run Detail
              <InfoTooltip
                content="Every payroll run moves through 5 stages. Disbursed runs are immutable for compliance — you can\'t delete or re-process them."
                title="Run lifecycle"
              />
            </h2>
            <p className="text-xs text-slate-500 mt-1 flex items-center gap-1">
              <Calendar className="h-3 w-3" />
              {run?.month_year ?? monthYear ?? 'Unknown month'}
              {run?.id && <> · Run #{run.id}</>}
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

              {/* Totals */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <SummaryStat icon={Users} label="Employees" value={totals.employees} />
                <SummaryStat icon={IndianRupee} label="Gross" value={formatCurrency(totals.gross)} accent="violet" />
                <SummaryStat icon={IndianRupee} label="Deductions" value={formatCurrency(totals.deductions)} accent="amber" />
                <SummaryStat icon={IndianRupee} label="Net Pay" value={formatCurrency(totals.net)} accent="emerald" />
              </div>

              {/* Missing bank details warning */}
              {missingCount > 0 && (
                <MissingBankCard
                  missingEmployees={missingEmployees}
                  runId={runId}
                  onAdded={() => invalidateAll()}
                  showToast={show}
                />
              )}

              {/* Action Bar */}
              <SurfaceCard className="p-4 border-blue-200 bg-blue-50/40">
                <h4 className="text-sm font-semibold text-slate-900 mb-3">Next steps</h4>
                <div className="flex flex-wrap gap-2">
                  {currentState === 'draft' && (
                    <Button
                      variant="primary"
                      iconLeft={lockMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                      onClick={() => lockMutation.mutate()}
                      disabled={isMutating || items.length === 0}
                    >
                      Lock Run
                    </Button>
                  )}
                  {currentState === 'locked' && (
                    <Button
                      variant="primary"
                      iconLeft={approveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                      onClick={() => approveMutation.mutate()}
                      disabled={isMutating}
                    >
                      Approve Run
                    </Button>
                  )}
                  {currentState === 'approved' && (
                    <Button
                      variant="primary"
                      iconLeft={releaseMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                      onClick={() => releaseMutation.mutate()}
                      disabled={isMutating}
                    >
                      Release Run
                    </Button>
                  )}
                  {currentState === 'disbursed' && (
                    <div className="text-sm text-slate-600 flex items-center gap-2">
                      <Lock className="h-4 w-4 text-slate-400" />
                      This run is disbursed and immutable for compliance.
                    </div>
                  )}
                  {['draft', 'locked', 'approved', 'released'].includes(currentState) && (
                    <Button variant="secondary" onClick={handleDownloadBankFile}>
                      <Landmark className="h-4 w-4 mr-1" /> Download Bank File
                    </Button>
                  )}
                </div>
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
                  No payslips in this run yet.
                </div>
              )}
            </>
          )}
        </div>
      </SurfaceCard>
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
