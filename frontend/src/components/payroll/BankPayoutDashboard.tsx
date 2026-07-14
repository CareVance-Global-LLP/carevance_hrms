import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, RotateCcw } from 'lucide-react';
import api, { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { useToast } from '@/components/ui/Toast';

export default function BankPayoutDashboard() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [reversalData, setReversalData] = useState({ payroll_item_id: 0, reason: '' });

  const { data: runs } = useQuery({
    queryKey: ['payroll-runs-payment'],
    queryFn: () => payrollApi.getPayrollRuns(),
  });

  const { data: batches } = useQuery({
    queryKey: ['bank-batches'],
    queryFn: () => api.get<any>('/payroll/bank/batches'),
  });

  const createBatchMutation = useMutation({
    mutationFn: (runId: number) => payrollApi.createTransferBatch(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-batches'] });
      show({ kind: 'success', message: 'Transfer batch created.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to create transfer batch.') }),
  });

  const processBatchMutation = useMutation({
    mutationFn: (batchId: number) => payrollApi.processBatch(batchId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-batches'] });
      show({ kind: 'success', message: 'Batch processed.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to process batch.') }),
  });

  const generateFileMutation = useMutation({
    mutationFn: ({ batchId, format }: { batchId: number; format: string }) =>
      payrollApi.generateBatchBankFile(batchId, format),
    onSuccess: () => show({ kind: 'success', message: 'Bank file generated.' }),
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate bank file.') }),
  });

  const reversalMutation = useMutation({
    mutationFn: (data: { payroll_item_id: number; reason: string }) =>
      payrollApi.initiatePaymentReversal(data),
    onSuccess: () => {
      setReversalData({ payroll_item_id: 0, reason: '' });
      show({ kind: 'success', message: 'Payment reversal initiated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to initiate reversal.') }),
  });

  const runsList = Array.isArray(runs) ? runs : (runs as any)?.runs ?? [];
  const batchList = Array.isArray(batches) ? batches : (batches as any)?.data ?? [];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <SurfaceCard className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Create Transfer Batch</h3>
          <div className="flex gap-3">
            <select
              value={selectedRunId ?? ''}
              onChange={(e) => setSelectedRunId(Number(e.target.value) || null)}
              className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select payroll run...</option>
              {runsList.map((run: any) => (
                <option key={run.id} value={run.id}>{run.month_year} — {run.status}</option>
              ))}
            </select>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Upload className="h-4 w-4" />}
              disabled={!selectedRunId || createBatchMutation.isPending}
              onClick={() => createBatchMutation.mutate(selectedRunId!)}
            >
              {createBatchMutation.isPending ? 'Creating...' : 'Create Batch'}
            </Button>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <h3 className="text-sm font-semibold text-slate-900 mb-4">Initiate Payment Reversal</h3>
          <div className="space-y-3">
            <input
              type="number"
              placeholder="Payroll Item ID"
              value={reversalData.payroll_item_id || ''}
              onChange={(e) => setReversalData(prev => ({ ...prev, payroll_item_id: Number(e.target.value) }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <input
              type="text"
              placeholder="Reason for reversal"
              value={reversalData.reason}
              onChange={(e) => setReversalData(prev => ({ ...prev, reason: e.target.value }))}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <Button
              variant="danger"
              size="sm"
              className="w-full"
              iconLeft={<RotateCcw className="h-4 w-4" />}
              disabled={!reversalData.payroll_item_id || !reversalData.reason || reversalMutation.isPending}
              onClick={() => reversalMutation.mutate(reversalData)}
            >
              Initiate Reversal
            </Button>
          </div>
        </SurfaceCard>
      </div>

      <SurfaceCard className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">Transfer Batches</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Batch Ref</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Bank</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batchList.map((batch: any) => (
              <tr key={batch.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3 font-mono text-xs text-slate-900">{batch.batch_reference}</td>
                <td className="px-4 py-3 text-slate-700">{batch.bank_name}</td>
                <td className="px-4 py-3 font-medium text-slate-900">₹{Number(batch.total_amount ?? 0).toLocaleString()}</td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                    batch.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                    batch.status === 'processing' ? 'bg-amber-50 text-amber-700' :
                    batch.status === 'failed' ? 'bg-rose-50 text-rose-700' :
                    'bg-slate-100 text-slate-700'
                  }`}>
                    {batch.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex gap-2 justify-end">
                    {batch.status === 'pending' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => processBatchMutation.mutate(batch.id)}
                        disabled={processBatchMutation.isPending}
                      >
                        Process
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Download className="h-4 w-4" />}
                      onClick={() => generateFileMutation.mutate({ batchId: batch.id, format: 'csv' })}
                    >
                      CSV
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      iconLeft={<Download className="h-4 w-4" />}
                      onClick={() => generateFileMutation.mutate({ batchId: batch.id, format: 'xml' })}
                    >
                      XML
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {batchList.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-12 text-sm text-slate-500">No transfer batches yet</td>
              </tr>
            )}
          </tbody>
        </table>
      </SurfaceCard>
    </div>
  );
}
