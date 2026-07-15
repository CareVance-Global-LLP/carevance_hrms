import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, XCircle, Loader2, ClipboardList, Play, Download } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import RejectReasonModal from '@/components/ui/RejectReasonModal';
import { checklistCheckTone, titleCase } from '@/utils/payrollStatus';

export default function PrePayrollChecklistPage({ runId = null }: { runId?: number | null }) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [selectedRunManual, setSelectedRunManual] = useState<number | null>(null);
  // When launched from the Run Payroll flow, a run is preselected by month and
  // the manual picker is hidden. Standalone usage passes no runId.
  const selectedRun = runId ?? selectedRunManual;
  const [resolving, setResolving] = useState<{ checkId: number; name: string } | null>(null);

  const { data: runs } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.getPayrollRuns().then(res => res.data?.runs ?? res.data ?? []),
  });

  const { data: checklistData, isLoading } = useQuery({
    queryKey: ['checklist', selectedRun],
    queryFn: () => selectedRun ? payrollApi.getChecklistStatus(selectedRun).then(res => res.data) : null,
    enabled: !!selectedRun,
  });

  const validateMutation = useMutation({
    mutationFn: (runId: number) => payrollApi.runPayrollValidation(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist'] });
      show({ kind: 'success', message: 'Validation complete.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to run validation.') }),
  });

  const resolveMutation = useMutation({
    mutationFn: ({ checkId, resolution }: { checkId: number; resolution: string }) =>
      payrollApi.resolveCheck(checkId, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist'] });
      setResolving(null);
      show({ kind: 'success', message: 'Check resolved.' });
    },
    onError: (e: any) => {
      setResolving(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to resolve check.') });
    },
  });

  const runsList = Array.isArray(runs) ? runs : [];
  const checks = Array.isArray(checklistData) ? checklistData : (checklistData as any)?.checks ?? (checklistData as any)?.items ?? [];
  const stats = {
    total: checks.length,
    passed: checks.filter((c: any) => c.status === 'passed').length,
    failed: checks.filter((c: any) => c.status === 'failed').length,
    warning: checks.filter((c: any) => c.status === 'warning').length,
    pending: checks.filter((c: any) => c.status === 'pending').length,
  };

  const canProcess = stats.failed === 0 && stats.pending === 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Pre-Payroll Checklist" description="Run validation checks before processing payroll" />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Run Selector — hidden when a run is preselected from the Run Payroll flow */}
        {!runId && (
          <SurfaceCard className="p-5">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex-1 min-w-[200px]">
                <FieldLabel>Select Payroll Run</FieldLabel>
                <SelectInput
                  value={selectedRun ?? ''}
                  onChange={(e) => setSelectedRunManual(Number(e.target.value) || null)}
                >
                  <option value="">Choose a run...</option>
                  {runsList.map((run: any) => (
                    <option key={run.id} value={run.id}>
                      {run.month_year} — {run.status}
                    </option>
                  ))}
                </SelectInput>
              </div>
              <Button
                variant="primary"
                iconLeft={validateMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                onClick={() => selectedRun && validateMutation.mutate(selectedRun)}
                disabled={!selectedRun || validateMutation.isPending}
              >
                {validateMutation.isPending ? 'Running...' : 'Run Validation'}
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Stats */}
        {selectedRun && checks.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <MetricCard label="Total Checks" value={stats.total} accent="sky" icon={ClipboardList} />
            <MetricCard label="Passed" value={stats.passed} accent="emerald" />
            <MetricCard label="Failed" value={stats.failed} accent="rose" />
            <MetricCard label="Warnings" value={stats.warning} accent="amber" />
            <MetricCard label="Pending" value={stats.pending} accent="slate" />
          </div>
        )}

        {/* Status Banner */}
        {selectedRun && checks.length > 0 && (
          <SurfaceCard className={`p-5 ${canProcess ? 'bg-emerald-50 border-emerald-200' : stats.failed > 0 ? 'bg-rose-50 border-rose-200' : 'bg-amber-50 border-amber-200'}`}>
            <div className="flex items-center gap-3">
              {canProcess ? (
                <CheckCircle className="h-6 w-6 text-emerald-600" />
              ) : stats.failed > 0 ? (
                <XCircle className="h-6 w-6 text-rose-600" />
              ) : (
                <AlertCircle className="h-6 w-6 text-amber-600" />
              )}
              <div>
                <h3 className={`font-semibold ${canProcess ? 'text-emerald-900' : stats.failed > 0 ? 'text-rose-900' : 'text-amber-900'}`}>
                  {canProcess ? 'All Checks Passed!' : stats.failed > 0 ? `${stats.failed} Check(s) Failed` : `${stats.warning + stats.pending} Check(s) Need Attention`}
                </h3>
                <p className={`text-sm ${canProcess ? 'text-emerald-700' : stats.failed > 0 ? 'text-rose-700' : 'text-amber-700'}`}>
                  {canProcess ? 'You can proceed to process this payroll run.' : 'Please resolve the issues before processing payroll.'}
                </p>
              </div>
            </div>
          </SurfaceCard>
        )}

        {/* Checklist Items */}
        {selectedRun && (
          <SurfaceCard className="overflow-hidden">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="text-lg font-semibold text-slate-900 flex items-center gap-2">
                <ClipboardList className="h-5 w-5" />
                Validation Checks
              </h3>
              {checks.length > 0 && (
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<Download className="h-4 w-4" />}
                  onClick={() => {
                    const headers = ['Check', 'Category', 'Message', 'Status'];
                    const rows = checks.map((c: any) => [
                      c.name || c.check_name || c.title || '',
                      c.category || '',
                      c.message || c.description || '',
                      titleCase(c.status),
                    ]);
                    const escapeCsv = (val: any) => {
                      const str = String(val ?? '');
                      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return '"' + str.replace(/"/g, '""') + '"';
                      }
                      return str;
                    };
                    const bom = '\uFEFF';
                    const csv = bom + [headers.join(','), ...rows.map(r => r.map(escapeCsv).join(','))].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `pre-payroll-checklist.csv`;
                    a.click();
                  }}
                >
                  Export CSV
                </Button>
              )}
            </div>
            {isLoading ? (
              <PageLoadingState label="Loading checks…" />
            ) : checks.length === 0 ? (
              <PageEmptyState
                title="No checks yet"
                description='Click "Run Validation" to start.'
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Check</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Message</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {checks.map((check: any) => (
                      <tr key={check.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-900">{check.name || check.check_name || check.title || '-'}</td>
                        <td className="px-4 py-3 text-slate-600">{check.category || '-'}</td>
                        <td className="px-4 py-3 text-slate-600 max-w-md">{check.message || check.description || '-'}</td>
                        <td className="px-4 py-3">
                          <StatusBadge tone={checklistCheckTone(check.status)}>{titleCase(check.status)}</StatusBadge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {check.status === 'failed' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => setResolving({ checkId: check.id, name: check.name || check.check_name || check.title || 'this check' })}
                              disabled={resolveMutation.isPending}
                            >
                              Resolve
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SurfaceCard>
        )}

        {!selectedRun && (
          <SurfaceCard className="p-12 text-center">
            <ClipboardList className="h-12 w-12 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 mb-4">Select a payroll run to view validation checks</p>
            <p className="text-xs text-slate-400">
              Pre-payroll checks verify attendance data, bank details, salary templates, and compliance configurations.
            </p>
          </SurfaceCard>
        )}
      </div>

      <RejectReasonModal
        isOpen={resolving !== null}
        title="Resolve check"
        description={resolving ? `Add resolution notes for "${resolving.name}".` : undefined}
        submitLabel="Resolve"
        placeholder="Resolution notes…"
        onSubmit={(resolution) => {
          if (resolving) resolveMutation.mutate({ checkId: resolving.checkId, resolution });
        }}
        onClose={() => !resolveMutation.isPending && setResolving(null)}
        isLoading={resolveMutation.isPending}
      />
    </div>
  );
}
