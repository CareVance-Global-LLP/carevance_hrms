import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, CheckCircle, XCircle } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import RejectReasonModal from '@/components/ui/RejectReasonModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const STATUS_OPTIONS = ['draft', 'approved', 'rejected'];

export default function LeaveEncashmentPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const [rejecting, setRejecting] = useState<{ id: number; name: string } | null>(null);
  const [approving, setApproving] = useState<{ id: number; name: string } | null>(null);

  const { data: encashmentsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['leave-encashments', statusFilter, userFilter],
    queryFn: () => payrollApi.listLeaveEncashments({ status: statusFilter || undefined }).then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveLeaveEncashment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
      setApproving(null);
      show({ kind: 'success', message: 'Leave encashment approved.' });
    },
    onError: (e: any) => {
      setApproving(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve leave encashment.') });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectLeaveEncashment(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leave-encashments'] });
      setRejecting(null);
      show({ kind: 'success', message: 'Leave encashment rejected.' });
    },
    onError: (e: any) => {
      setRejecting(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject leave encashment.') });
    },
  });

  const encashments = Array.isArray(encashmentsData) ? encashmentsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: encashments.length,
    draft: encashments.filter(a => a.status === 'draft').length,
    approved: encashments.filter(a => a.status === 'approved').length,
    rejected: encashments.filter(a => a.status === 'rejected').length,
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Leave Encashment"
        description="Pay out unused earned/privilege leaves — typically at exit, or annually per company policy."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <HowItWorksCard
          whatIsThis="Converts unused earned leaves into cash. Per-day rate = (Monthly Basic ÷ Working Days). Tax-free up to ₹25 lakh for non-government employees at exit."
          whenToUse={[
            'At exit (most common — pay out unused earned leaves as part of F&F)',
            'Annually (some companies encash up to a cap each year)',
            'When an employee crosses the maximum accumulation limit',
          ]}
          howItFlows={[
            { step: 1, label: 'Pick employee', desc: 'And select leave type (earned, casual, sick, compensatory)' },
            { step: 2, label: 'Enter days', desc: 'How many days to encash — system checks leave balance' },
            { step: 3, label: 'Calculate', desc: 'Per-day Basic × days encashed' },
            { step: 4, label: 'Approve', desc: 'Admin approves, amount flows into next payroll run' },
          ]}
          commonMistakes={[
            'Encashing leaves that don\'t qualify (e.g. sick leave usually can\'t be encashed)',
            'Confusing "leave balance" with "leave type" — only earned/privilege leaves are typically encashable',
            'Forgetting that encashed leaves are taxable as salary',
          ]}
        />

        {/* Filters */}
        <SurfaceCard className="p-5">
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Status</label>
              <SelectInput
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
              </SelectInput>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Employee</label>
              <SelectInput
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                <option value="">All Employees</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </SelectInput>
            </div>
            <div className="flex-1 min-w-[200px]">
              <label className="block text-sm font-medium text-slate-700 mb-1">Search</label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <TextInput
                  placeholder="Search leave type, notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </SurfaceCard>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard label="Total" value={stats.total} accent="sky" icon={FileText} />
          <MetricCard label="Draft" value={stats.draft} accent="slate" />
          <MetricCard label="Approved" value={stats.approved} accent="emerald" />
          <MetricCard label="Rejected" value={stats.rejected} accent="rose" />
        </div>

        {/* Encashments Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <PageLoadingState label="Loading leave encashments…" />
          ) : isError ? (
            <PageEmptyState
              title="Couldn't load leave encashments"
              description={getApiErrorMessage(error, 'Please try again.')}
              action={
                <Button variant="secondary" size="sm" onClick={() => refetch()}>
                  Retry
                </Button>
              }
            />
          ) : encashments.length === 0 ? (
            <PageEmptyState
              title="No leave encashment requests found"
              description="When leave encashment requests are created, they'll appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Month</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Leave Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Eligible Days</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Encashed Days</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {encashments
                    .filter(a => !searchQuery ||
                      a.leave_type?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      a.notes?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((enc: any) => (
                    <tr key={enc.id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{enc.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{enc.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{enc.month_year || '-'}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] bg-[rgba(93,150,157,0.1)] text-[#5D969D]">
                          {titleCase(enc.leave_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{enc.eligible_days || 0}</td>
                      <td className="px-4 py-3 text-slate-900">{enc.encashed_days || 0}</td>
                      <td className="px-4 py-3 text-slate-900">{formatPayrollAmount(enc.total_amount, { compact: true })}</td>
                      <td className="px-4 py-3 font-medium text-emerald-600">{formatPayrollAmount(enc.net_amount, { compact: true })}</td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={payrollStatusTone(enc.status)}>{titleCase(enc.status)}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {enc.status === 'draft' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => setApproving({ id: enc.id, name: enc.user?.name || 'this request' })}
                                disabled={approveMutation.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
                                onClick={() => setRejecting({ id: enc.id, name: enc.user?.name || 'this request' })}
                                disabled={rejectMutation.isPending}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SurfaceCard>
      </div>

      <RejectReasonModal
        isOpen={rejecting !== null}
        title="Reject leave encashment"
        description={rejecting ? `Provide a reason for rejecting the leave encashment request for ${rejecting.name}.` : undefined}
        onSubmit={(reason) => {
          if (rejecting) rejectMutation.mutate({ id: rejecting.id, reason });
        }}
        onClose={() => !rejectMutation.isPending && setRejecting(null)}
        isLoading={rejectMutation.isPending}
      />

      <ConfirmDialog
        isOpen={approving !== null}
        title="Approve leave encashment"
        message={approving ? `Approve the leave encashment request for ${approving.name}?` : ''}
        confirmLabel="Approve"
        onConfirm={() => {
          if (approving) approveMutation.mutate(approving.id);
        }}
        onClose={() => !approveMutation.isPending && setApproving(null)}
        isLoading={approveMutation.isPending}
      />
    </div>
  );
}
