import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FileText, Search, CheckCircle, XCircle, Plus } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import RejectReasonModal from '@/components/ui/RejectReasonModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';
import { useAuth } from '@/contexts/AuthContext';

const STATUS_OPTIONS = ['draft', 'approved', 'rejected'];

export default function LeaveEncashmentPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const [rejecting, setRejecting] = useState<{ id: number; name: string } | null>(null);
  const [approving, setApproving] = useState<{ id: number; name: string } | null>(null);

  const { data: encashmentsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['leave-encashments', statusFilter, userFilter],
    queryFn: () => payrollApi.listLeaveEncashments({ status: statusFilter || undefined, user_id: userFilter ? parseInt(userFilter) : undefined }).then(res => res.data?.data ?? res.data ?? []),
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
    <div className="space-y-6">
      <ModuleHeader
        title="Leave Encashment"
        description="Pay out unused earned/privilege leaves — typically at exit, or annually per company policy."
      />
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
        <FilterPanel>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <FieldLabel>Status</FieldLabel>
              <SelectInput
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="">All Status</option>
                {STATUS_OPTIONS.map(s => <option key={s} value={s}>{titleCase(s)}</option>)}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Employee</FieldLabel>
              <SelectInput
                value={userFilter}
                onChange={(e) => setUserFilter(e.target.value)}
              >
                <option value="">All Employees</option>
                {users.map((u: any) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </SelectInput>
            </div>
            <div className="flex-1 min-w-[200px]">
              <FieldLabel>Search</FieldLabel>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <TextInput
                  placeholder="Search leave type, notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            {isAdmin && (
              <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => {
                show({ kind: 'info', message: 'Select an employee from the Employee Payroll Cards page to process leave encashment for them.' });
              }}>
                Process Encashment
              </Button>
            )}
          </div>
        </FilterPanel>

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
            <PageErrorState
              message={getApiErrorMessage(error, "Couldn't load leave encashments.")}
              onRetry={() => refetch()}
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
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Leave Days</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Per-Day Rate</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Amount</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Exempt (10(10AA))</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Taxable</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
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
                      <td className="px-4 py-3 text-center text-slate-900">{enc.encashed_days || 0}</td>
                      <td className="px-4 py-3 text-right text-slate-900">{formatPayrollAmount(enc.rate_per_day || 0, { compact: true })}</td>
                      <td className="px-4 py-3 text-right text-slate-900">{formatPayrollAmount(enc.total_amount || 0, { compact: true })}</td>
                      <td className="px-4 py-3 text-right text-emerald-600">{formatPayrollAmount((enc.total_amount || 0) - (enc.net_amount || 0), { compact: true })}</td>
                      <td className="px-4 py-3 text-right font-medium text-rose-600">{formatPayrollAmount(enc.net_amount || 0, { compact: true })}</td>
                      <td className="px-4 py-3 text-center">
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
