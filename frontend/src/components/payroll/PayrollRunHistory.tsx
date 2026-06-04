import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calendar, CheckCircle, Lock, Send, DollarSign, FileDown, Download, AlertCircle, History, Loader2 } from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: any }> = {
  draft: { label: 'Draft', color: 'text-slate-600', bg: 'bg-slate-100', icon: AlertCircle },
  processing: { label: 'Processing', color: 'text-blue-600', bg: 'bg-blue-100', icon: Loader2 },
  processed: { label: 'Processed', color: 'text-blue-600', bg: 'bg-blue-100', icon: CheckCircle },
  locked: { label: 'Locked', color: 'text-amber-600', bg: 'bg-amber-100', icon: Lock },
  approved: { label: 'Approved', color: 'text-emerald-600', bg: 'bg-emerald-100', icon: CheckCircle },
  released: { label: 'Released', color: 'text-violet-600', bg: 'bg-violet-100', icon: Send },
  paid: { label: 'Paid', color: 'text-emerald-700', bg: 'bg-emerald-200', icon: DollarSign },
  not_started: { label: 'Not Started', color: 'text-slate-400', bg: 'bg-slate-100', icon: AlertCircle },
};

export default function PayrollRunHistory() {
  const queryClient = useQueryClient();
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const { data: runsData, isLoading } = useQuery({
    queryKey: ['payroll', 'runs'],
    queryFn: () => payrollApi.getPayrollRuns().then(res => res.data),
  });

  const runs = runsData?.runs || [];

  const handleLock = async (runId: number) => {
    setActionLoading(`lock-${runId}`);
    try {
      await payrollApi.lockPayrollRun(runId);
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    } catch (e) { console.error(e); }
    setActionLoading(null);
  };

  const handleApprove = async (runId: number) => {
    setActionLoading(`approve-${runId}`);
    try {
      await payrollApi.approvePayrollRun(runId);
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    } catch (e) { console.error(e); }
    setActionLoading(null);
  };

  const handleRelease = async (runId: number) => {
    setActionLoading(`release-${runId}`);
    try {
      await payrollApi.releasePayrollRun(runId);
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    } catch (e: any) {
      console.error(e);
      // Show detailed error message if available
      if (e?.response?.data?.message) {
        alert(e.response.data.message);
      }
    }
    setActionLoading(null);
  };

  const handlePay = async (runId: number) => {
    setActionLoading(`pay-${runId}`);
    try {
      await payrollApi.processRunPayment(runId);
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
    } catch (e) { console.error(e); }
    setActionLoading(null);
  };

  const handleDownloadBankFile = async (runId: number) => {
    setActionLoading(`bank-${runId}`);
    try {
      const res = await payrollApi.generateBankFile(runId);
      const data = res.data;
      if (data.success && data.content) {
        const blob = new Blob([data.content], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = data.filename;
        link.click();
      } else {
        alert('No pending employees with bank details found for this run.');
      }
    } catch (e) { console.error(e); }
    setActionLoading(null);
  };

  const handleDownloadPayslips = async (runId: number) => {
    setActionLoading(`payslips-${runId}`);
    try {
      const res = await payrollApi.generateBulkPayslips(runId);
      const data = res.data;
      if (data.success && data.payslips) {
        const json = JSON.stringify(data.payslips, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `payslips_${data.run.month_year}.json`;
        link.click();
      }
    } catch (e) { console.error(e); }
    setActionLoading(null);
  };

  if (runs.length === 0 && !isLoading) {
    return (
      <SurfaceCard className="p-6">
        <div className="text-center py-8">
          <History className="h-12 w-12 text-slate-300 mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-slate-900 mb-2">No Payroll Runs Yet</h3>
          <p className="text-slate-500">Start a payroll run from the dashboard to see history here.</p>
        </div>
      </SurfaceCard>
    );
  }

  return (
    <SurfaceCard className="overflow-hidden">
      <div className="p-5 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <History className="h-4 w-4 text-blue-600" />
          Payroll Run History
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Month</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Status</th>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase">Employees</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Gross</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase">Net Pay</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {isLoading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-500">Loading...</td></tr>
            ) : (
              runs.map((run: any) => {
                const cfg = STATUS_CONFIG[run.status] || STATUS_CONFIG.not_started;
                const StatusIcon = cfg.icon;
                return (
                  <tr key={run.id} className="hover:bg-slate-50">
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-slate-900">{run.month_year}</span>
                      </div>
                      {run.created_by_name && (
                        <p className="text-xs text-slate-500 mt-0.5">by {run.created_by_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${cfg.bg} ${cfg.color}`}>
                        <StatusIcon className="h-3 w-3" />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-sm text-slate-700">{run.total_employees}</td>
                    <td className="px-4 py-4 text-right text-sm text-slate-700">
                      ₹{run.total_gross?.toLocaleString('en-IN') || '0'}
                    </td>
                    <td className="px-4 py-4 text-right text-sm font-semibold text-emerald-700">
                      ₹{run.total_net_pay?.toLocaleString('en-IN') || '0'}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center justify-center gap-1">
                        {(run.status === 'draft' || run.status === 'processing') && (
                          <Button variant="ghost" size="sm" onClick={() => handleLock(run.id)} disabled={actionLoading === `lock-${run.id}`}>
                            <Lock className="h-3 w-3 mr-1" />{actionLoading === `lock-${run.id}` ? '...' : 'Lock'}
                          </Button>
                        )}
                        {run.status === 'locked' && (
                          <Button variant="ghost" size="sm" onClick={() => handleApprove(run.id)} disabled={actionLoading === `approve-${run.id}`}>
                            <CheckCircle className="h-3 w-3 mr-1" />{actionLoading === `approve-${run.id}` ? '...' : 'Approve'}
                          </Button>
                        )}
                        {(run.status === 'approved' || run.status === 'locked') && (
                          <Button variant="ghost" size="sm" onClick={() => handleRelease(run.id)} disabled={actionLoading === `release-${run.id}`}>
                            <Send className="h-3 w-3 mr-1" />{actionLoading === `release-${run.id}` ? '...' : 'Release'}
                          </Button>
                        )}
                        {(run.status === 'released' || run.status === 'approved') && (
                          <>
                            <Button variant="ghost" size="sm" onClick={() => handlePay(run.id)} disabled={actionLoading === `pay-${run.id}`}>
                              <DollarSign className="h-3 w-3 mr-1" />{actionLoading === `pay-${run.id}` ? '...' : 'Pay'}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => handleDownloadBankFile(run.id)} disabled={actionLoading === `bank-${run.id}`}>
                              <Download className="h-3 w-3 mr-1" />{actionLoading === `bank-${run.id}` ? '...' : 'Bank'}
                            </Button>
                          </>
                        )}
                        {run.status === 'released' && (
                          <Button variant="ghost" size="sm" onClick={() => handleDownloadPayslips(run.id)} disabled={actionLoading === `payslips-${run.id}`}>
                            <FileDown className="h-3 w-3 mr-1" />{actionLoading === `payslips-${run.id}` ? '...' : 'Payslips'}
                          </Button>
                        )}
                        {run.status === 'paid' && (
                          <span className="text-xs text-emerald-600 font-medium">Completed</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </SurfaceCard>
  );
}
