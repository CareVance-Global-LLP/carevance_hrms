import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Download, Plus, History, Loader2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

const FILING_TYPES = [
  { key: 'pf_ecr', label: 'PF ECR', desc: 'EPFO monthly return' },
  { key: 'esi_challan', label: 'ESI Challan', desc: 'ESI monthly challan' },
  { key: 'form_24q', label: 'Form 24Q', desc: 'Quarterly TDS return' },
  { key: 'form_16', label: 'Form 16', desc: 'TDS certificate' },
  { key: 'form_12ba', label: 'Form 12BA', desc: 'Perquisites statement' },
  { key: 'pt_return', label: 'PT Return', desc: 'Professional Tax return' },
  { key: 'lwf_return', label: 'LWF Return', desc: 'Labour Welfare Fund' },
  { key: 'bonus_form_c', label: 'Bonus Form C', desc: 'Bonus Act return' },
];

interface FilingButtonProps {
  label: string;
  desc: string;
  onClick: () => void;
  disabled?: boolean;
}

function FilingButton({ label, desc, onClick, disabled }: FilingButtonProps) {
  return (
    <SurfaceCard
      className={`p-4 cursor-pointer hover:shadow-md hover:border-blue-300 transition-all ${
        disabled ? 'opacity-50 pointer-events-none' : ''
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h3 className="font-semibold text-slate-900 text-sm">{label}</h3>
          <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
        </div>
      </div>
    </SurfaceCard>
  );
}

export default function FilingsDashboard() {
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'generate' | 'history'>('generate');

  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.getPayrollRuns(),
  });

  const { data: filings, isLoading: filingsLoading } = useQuery({
    queryKey: ['payroll-filings'],
    queryFn: () => payrollApi.listFilings(),
    enabled: activeTab === 'history',
  });

  const generateAllMutation = useMutation({
    mutationFn: (runId: number) => payrollApi.generateAllFilings(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll-filings'] });
    },
  });

  const generateSingleMutation = useMutation({
    mutationFn: ({ type, runId }: { type: string; runId: number }) => {
      switch (type) {
        case 'pf_ecr': return payrollApi.generatePfEcr(runId);
        case 'esi_challan': return payrollApi.generateEsiChallan(runId);
        case 'form_24q': return payrollApi.generateForm24Q(runId);
        case 'form_12ba': return payrollApi.generateForm12BA(runId);
        case 'lwf_return': return payrollApi.generateLwfReturn(runId);
        case 'pt_return': return payrollApi.generatePtReturn(runId, '');
        default: throw new Error('Unknown filing type');
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payroll-filings'] }),
  });

  const runsList = Array.isArray(runs) ? runs : (runs as any)?.runs ?? [];
  const filingsList = Array.isArray(filings) ? filings : (filings as any)?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button
          variant={activeTab === 'generate' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setActiveTab('generate')}
        >
          Generate
        </Button>
        <Button
          variant={activeTab === 'history' ? 'primary' : 'secondary'}
          size="sm"
          iconLeft={<History className="h-4 w-4" />}
          onClick={() => setActiveTab('history')}
        >
          Filing History
        </Button>
      </div>

      {activeTab === 'generate' ? (
        <>
          <SurfaceCard className="p-5">
            <label className="block text-sm font-medium text-slate-700 mb-2">
              Select Payroll Run
            </label>
            <select
              value={selectedRun ?? ''}
              onChange={(e) => setSelectedRun(Number(e.target.value) || null)}
              className="w-full max-w-md border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="">Choose a payroll run...</option>
              {runsList.map((run: any) => (
                <option key={run.id} value={run.id}>
                  {run.month_year} — {run.status}
                </option>
              ))}
            </select>
          </SurfaceCard>

          {selectedRun && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {FILING_TYPES.map((ft) => (
                  <FilingButton
                    key={ft.key}
                    label={ft.label}
                    desc={ft.desc}
                    onClick={() => generateSingleMutation.mutate({ type: ft.key, runId: selectedRun })}
                    disabled={generateSingleMutation.isPending}
                  />
                ))}
              </div>

              <div className="flex justify-center pt-2">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => generateAllMutation.mutate(selectedRun)}
                  disabled={generateAllMutation.isPending}
                  iconLeft={generateAllMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
                >
                  {generateAllMutation.isPending ? 'Generating All...' : 'Generate All Filings'}
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <SurfaceCard className="overflow-hidden">
          {filingsLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filingsList.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">No filings generated yet</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Period</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Generated</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filingsList.map((filing: any) => (
                  <tr key={filing.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-900">{filing.type}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {filing.period_month || filing.period_quarter}/{filing.period_year}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                        filing.status === 'generated' ? 'bg-emerald-50 text-emerald-700' :
                        filing.status === 'filed' ? 'bg-blue-50 text-blue-700' :
                        filing.status === 'error' ? 'bg-rose-50 text-rose-700' :
                        'bg-slate-100 text-slate-700'
                      }`}>
                        {filing.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {filing.generated_at ? new Date(filing.generated_at).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {filing.file_path && (
                        <Button
                          variant="ghost"
                          size="sm"
                          iconLeft={<Download className="h-4 w-4" />}
                          onClick={() => payrollApi.downloadFiling(filing.id)}
                        >
                          Download
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SurfaceCard>
      )}
    </div>
  );
}
