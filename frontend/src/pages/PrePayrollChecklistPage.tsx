import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle, AlertCircle, XCircle, Loader2, ClipboardList, Play, Search, Download } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { SelectInput, TextInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

const CHECK_STATUS = ['passed', 'failed', 'warning', 'pending'];

export default function PrePayrollChecklistPage() {
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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
    },
  });

  const resolveMutation = useMutation({
    mutationFn: ({ checkId, resolution }: { checkId: number; resolution: string }) =>
      payrollApi.resolveCheck(checkId, resolution),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist'] });
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
        {/* Run Selector */}
        <SurfaceCard className="p-5">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <FieldLabel>Select Payroll Run</FieldLabel>
              <SelectInput
                value={selectedRun ?? ''}
                onChange={(e) => setSelectedRun(Number(e.target.value) || null)}
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

        {/* Stats */}
        {selectedRun && checks.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <SurfaceCard className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-900">{stats.total}</p>
              <p className="text-sm text-slate-500">Total Checks</p>
            </SurfaceCard>
            <SurfaceCard className="p-4 text-center">
              <p className="text-2xl font-bold text-emerald-600">{stats.passed}</p>
              <p className="text-sm text-slate-500">Passed</p>
            </SurfaceCard>
            <SurfaceCard className="p-4 text-center">
              <p className="text-2xl font-bold text-rose-600">{stats.failed}</p>
              <p className="text-sm text-slate-500">Failed</p>
            </SurfaceCard>
            <SurfaceCard className="p-4 text-center">
              <p className="text-2xl font-bold text-amber-600">{stats.warning}</p>
              <p className="text-sm text-slate-500">Warnings</p>
            </SurfaceCard>
            <SurfaceCard className="p-4 text-center">
              <p className="text-2xl font-bold text-slate-600">{stats.pending}</p>
              <p className="text-sm text-slate-500">Pending</p>
            </SurfaceCard>
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
                      c.status?.charAt(0).toUpperCase() + c.status?.slice(1) || '',
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
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : checks.length === 0 ? (
              <div className="text-center py-12">
                <ClipboardList className="h-12 w-12 text-slate-300 mx-auto mb-3" />
                <p className="text-sm text-slate-500">No checks yet. Click "Run Validation" to start.</p>
              </div>
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
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                            check.status === 'passed' ? 'bg-emerald-50 text-emerald-700' :
                            check.status === 'failed' ? 'bg-rose-50 text-rose-700' :
                            check.status === 'warning' ? 'bg-amber-50 text-amber-700' :
                            'bg-slate-100 text-slate-700'
                          }`}>
                            {check.status?.charAt(0).toUpperCase() + check.status?.slice(1)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          {check.status === 'failed' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                const resolution = prompt('Resolution notes:');
                                if (resolution) resolveMutation.mutate({ checkId: check.id, resolution });
                              }}
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
    </div>
  );
}