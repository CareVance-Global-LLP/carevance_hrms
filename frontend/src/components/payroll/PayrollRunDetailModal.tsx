import { useState } from 'react';
import { X, Lock, ShieldCheck, Send, Loader2, IndianRupee, Users, Calendar, FileText, AlertCircle } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import InfoTooltip from '@/components/ui/InfoTooltip';
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
  const [error, setError] = useState<string | null>(null);

  const { data: detailData, isLoading } = useQuery({
    queryKey: ['payroll', 'run-detail', runId],
    queryFn: () => runId ? payrollApi.getPayrollRunDetail(runId).then((r) => r.data) : null,
    enabled: !!runId && isOpen,
  });

  const lockMutation = useMutation({
    mutationFn: () => runId ? payrollApi.lockPayrollRun(runId).then((r) => r.data) : null,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail', runId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    },
    onError: (e: any) => setError(e?.response?.data?.message || 'Failed to lock run'),
  });

  const approveMutation = useMutation({
    mutationFn: () => runId ? payrollApi.approvePayrollRun(runId).then((r) => r.data) : null,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail', runId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    },
    onError: (e: any) => setError(e?.response?.data?.message || 'Failed to approve run'),
  });

  const releaseMutation = useMutation({
    mutationFn: () => runId ? payrollApi.releasePayrollRun(runId).then((r) => r.data) : null,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'run-detail', runId] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    },
    onError: (e: any) => setError(e?.response?.data?.message || 'Failed to release run'),
  });

  if (!isOpen) return null;

  const run = detailData?.run ?? (detailData as any)?.run ?? null;
  const items = detailData?.items ?? (detailData as any)?.items ?? [];
  const currentState: RunLifecycleState = (run?.status ?? 'draft') as RunLifecycleState;

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
                    <Button variant="secondary" onClick={() => runId && window.open(`/payroll/runs/${runId}/bank-file`, '_blank')}>
                      Download Bank File
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
