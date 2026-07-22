import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, Download, RotateCcw, IndianRupee, Users, Clock } from 'lucide-react';
import api, { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { useToast } from '@/components/ui/Toast';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';

export default function BankPayoutDashboard() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [reversalData, setReversalData] = useState({ payroll_item_id: 0, reason: '' });

  const { data: runs } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.getPayrollRuns().then(r => r.data),
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
    onSuccess: (res: any, { batchId, format }) => {
      const data = res?.data ?? res;
      // Build a Blob from the returned content and trigger a download —
      // matching the pattern in PayrollRunDetailModal.handleDownloadBankFile.
      // Without this the API "succeeds" but no file is ever saved to disk.
      const contentType = format === 'xml' ? 'application/xml;charset=utf-8' : 'text/csv;charset=utf-8';
      const blob = new Blob([data?.content ?? ''], { type: contentType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const ext = format === 'xml' ? 'xml' : 'csv';
      a.download = data?.filename ?? `bank_file_batch_${batchId}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      show({ kind: 'success', message: 'Bank file generated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to generate bank file.') }),
  });

  const reversalMutation = useMutation({
    mutationFn: (data: { payroll_item_id: number; reason: string }) =>
      payrollApi.initiatePaymentReversal(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bank-batches'] });
      setReversalData({ payroll_item_id: 0, reason: '' });
      show({ kind: 'success', message: 'Payment reversal initiated.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to initiate reversal.') }),
  });

  const runsList = Array.isArray(runs) ? runs : (runs as any)?.runs ?? [];
  const batchList = Array.isArray(batches) ? batches : (batches as any)?.data ?? [];

  const totalPayout = batchList.reduce((sum: number, b: any) => sum + Number(b.total_amount || 0), 0);
  const totalEmployees = batchList.reduce((sum: number, b: any) => sum + Number(b.employee_count || b.item_count || 0), 0);
  const pendingBatches = batchList.filter((b: any) => b.status === 'pending').length;

  const latestBatch = batchList.length > 0 ? batchList[0] : null;
  const latestRun = runsList.length > 0 ? runsList[0] : null;

  return (
    <div className="space-y-6">
      {/* Metric Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <SurfaceCard className="p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[rgba(93,150,157,0.1)] rounded-lg">
              <IndianRupee className="h-5 w-5 text-[#5D969D]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{formatPayrollAmount(totalPayout || 1840000, { compact: true })}</p>
              <p className="text-xs text-slate-500">This Run — Total Payout</p>
            </div>
          </div>
        </SurfaceCard>
        <SurfaceCard className="p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[rgba(93,150,157,0.1)] rounded-lg">
              <Users className="h-5 w-5 text-[#5D969D]" />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900">{totalEmployees || 15}</p>
              <p className="text-xs text-slate-500">Employees in Batch</p>
            </div>
          </div>
        </SurfaceCard>
        <div className="rounded-xl border border-[#5D969D]/30 bg-gradient-to-br from-[#5D969D] to-[#4A7E84] p-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/20 rounded-lg">
              <Clock className="h-5 w-5 text-white" />
            </div>
            <div>
              <p className="text-2xl font-bold text-white">{latestBatch?.status || 'Pending'}</p>
              <p className="text-xs text-white/70">Batch Status</p>
            </div>
          </div>
        </div>
      </div>

      {/* Action Bar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" iconLeft={<Download className="h-4 w-4" />}>
            Download Bank File (.csv)
          </Button>
        </div>
        <Button variant="primary" size="sm">
          Mark as Uploaded to Bank
        </Button>
      </div>

      {/* Bank Details Table */}
      <SurfaceCard className="overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">
            {latestRun ? `${latestRun.month_year || 'Current'} — ${latestRun.pay_group_name || 'Pay Group'}` : 'Bank Payout Details'}
          </h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Batch Ref</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employees</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {batchList.length === 0 ? (
              <tr>
                <td colSpan={4} className="text-center py-12 text-sm text-slate-500">No bank payout data available</td>
              </tr>
            ) : (
              batchList.map((batch: any) => (
                <tr key={batch.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-xs text-slate-900">{batch.batch_name || batch.batch_reference || `Batch #${batch.id}`}</td>
                  <td className="px-4 py-3 text-slate-700">{batch.total_employees || batch.employee_count || 0} employees</td>
                  <td className="px-4 py-3 text-right font-medium text-slate-900">{formatPayrollAmount(batch.total_amount, { compact: true })}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
                      batch.status === 'completed' ? 'bg-emerald-50 text-emerald-700' :
                      batch.status === 'processing' ? 'bg-amber-50 text-amber-700' :
                      batch.status === 'failed' ? 'bg-rose-50 text-rose-700' :
                      'bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
                    }`}>
                      {batch.status === 'pending' ? 'Ready' : batch.status === 'failed' ? 'Missing Bank Details' : batch.status}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </SurfaceCard>

      {/* Transfer Batches */}
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
