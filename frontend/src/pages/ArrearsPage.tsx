import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Calculator, Search, Loader2, CheckCircle, XCircle, Plus } from 'lucide-react';
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

const STATUS_OPTIONS = ['draft', 'approved', 'rejected', 'paid'];

export default function ArrearsPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const [rejecting, setRejecting] = useState<{ id: number; name: string } | null>(null);
  const [approving, setApproving] = useState<{ id: number; name: string } | null>(null);

  const { data: arrearsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['arrears', statusFilter, userFilter],
    queryFn: () => payrollApi.listArrears({ status: statusFilter || undefined, user_id: userFilter ? parseInt(userFilter) : undefined }).then((res) => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then((res) => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => payrollApi.createArrear(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
      show({ kind: 'success', message: 'Arrear saved.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to save arrear.') }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveArrear(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
      setApproving(null);
      show({ kind: 'success', message: 'Arrear approved.' });
    },
    onError: (e: any) => {
      setApproving(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve arrear.') });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectArrear(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['arrears'] });
      setRejecting(null);
      show({ kind: 'success', message: 'Arrear rejected.' });
    },
    onError: (e: any) => {
      setRejecting(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject arrear.') });
    },
  });

  const arrears = Array.isArray(arrearsData) ? arrearsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: arrears.length,
    draft: arrears.filter((a: any) => a.status === 'draft').length,
    approved: arrears.filter((a: any) => a.status === 'approved').length,
    rejected: arrears.filter((a: any) => a.status === 'rejected').length,
    paid: arrears.filter((a: any) => a.status === 'paid').length,
  };

  const filteredArrears = arrears.filter(
    (a: any) =>
      !searchQuery ||
      a.reason?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.arrear_type?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const activeRunMonth = arrears.length > 0 ? (arrears[0]?.arrear_month || arrears[0]?.calculation_month || 'Current') : 'Current';

  return (
    <div className="space-y-6">
      <ModuleHeader
        title={`Pending Arrears — ${activeRunMonth} Run`}
        description="Retroactive salary payments — for increments, promotions, or revisions applied after the effective date."
      />
        <HowItWorksCard
          whatIsThis="Salary paid for past months when something changed retrospectively — e.g. an increment approved in October but effective from April. The system calculates the differential for each affected month and pays the total in the current run."
          whenToUse={[
            'Annual increment processed late (effective date in the past)',
            'Promotion approved retroactively after a delayed review',
            'Settlement of any retrospective pay correction',
          ]}
          howItFlows={[
            { step: 1, label: 'Detect or create', desc: 'Use "Detect" on an employee/month, or create manually' },
            { step: 2, label: 'Pick arrear type', desc: 'Salary, increment, promotion, retrospective, or settlement' },
            { step: 3, label: 'Enter months + delta', desc: 'Which months, and the new-vs-old differential per month' },
            { step: 4, label: 'Approve & pay', desc: "Add to current month's payroll run for disbursement" },
          ]}
          commonMistakes={[
            'Paying arrears for a month that already had a disbursed run — needs re-processing',
            'Forgetting to update the employee template for the new CTC going forward',
            'Calculating arrears on Basic alone instead of full CTC differential',
          ]}
        />

        {/* Filters */}
        <FilterPanel>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <FieldLabel>Status</FieldLabel>
              <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Status</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </SelectInput>
            </div>
            <div>
              <FieldLabel>Employee</FieldLabel>
              <SelectInput value={userFilter} onChange={(e) => setUserFilter(e.target.value)}>
                <option value="">All Employees</option>
                {users.map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.email})
                  </option>
                ))}
              </SelectInput>
            </div>
            <div className="flex-1 min-w-[200px]">
              <FieldLabel>Search</FieldLabel>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <TextInput
                  placeholder="Search reason, type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Plus className="h-4 w-4" />}
              onClick={() => {
                const user = users[0];
                if (user) {
                  createMutation.mutate({
                    user_id: user.id,
                    arrear_type: 'salary',
                    reason: 'Manual arrear',
                    gross_diff: 0,
                    net_arrear: 0,
                    status: 'draft',
                  });
                }
              }}
              disabled={createMutation.isPending || users.length === 0}
            >
              {createMutation.isPending ? 'Creating...' : 'Manual Arrear'}
            </Button>
          </div>
        </FilterPanel>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <MetricCard label="Total" value={stats.total} accent="sky" icon={Calculator} />
          <MetricCard label="Draft" value={stats.draft} accent="slate" />
          <MetricCard label="Approved" value={stats.approved} accent="emerald" />
          <MetricCard label="Rejected" value={stats.rejected} accent="rose" />
          <MetricCard label="Paid" value={stats.paid} accent="violet" />
        </div>

        {/* Arrears Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <PageLoadingState label="Loading arrears…" />
          ) : isError ? (
            <PageErrorState
              message={getApiErrorMessage(error, "Couldn't load arrears.")}
              onRetry={() => refetch()}
            />
          ) : filteredArrears.length === 0 ? (
            <PageEmptyState
              title="No arrears records found"
              description="When retroactive pay corrections are created, they'll appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Arrear Month</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gross Diff</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Arrear</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Reason</th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredArrears.map((arrear: any) => (
                    <tr key={arrear.id} className="transition-colors hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{arrear.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{arrear.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{titleCase(arrear.arrear_type || 'salary')}</td>
                      <td className="px-4 py-3 text-slate-900">{arrear.arrear_month || '-'}</td>
                      <td className="px-4 py-3 text-right text-slate-900">{formatPayrollAmount(arrear.gross_difference || 0, { compact: true })}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{formatPayrollAmount(arrear.net_arrear_amount || 0, { compact: true })}</td>
                      <td className="px-4 py-3 text-slate-900 max-w-[200px] truncate">{arrear.reason || '-'}</td>
                      <td className="px-4 py-3 text-center">
                        <StatusBadge tone={payrollStatusTone(arrear.status)}>{titleCase(arrear.status)}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {arrear.status === 'draft' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => setApproving({ id: arrear.id, name: arrear.user?.name || 'this arrear' })}
                                disabled={approveMutation.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
                                onClick={() => setRejecting({ id: arrear.id, name: arrear.user?.name || 'this arrear' })}
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
        title="Reject arrear"
        description={rejecting ? `Provide a reason for rejecting the arrear for ${rejecting.name}.` : undefined}
        onSubmit={(reason) => {
          if (rejecting) rejectMutation.mutate({ id: rejecting.id, reason });
        }}
        onClose={() => !rejectMutation.isPending && setRejecting(null)}
        isLoading={rejectMutation.isPending}
      />

      <ConfirmDialog
        isOpen={approving !== null}
        title="Approve arrear"
        message={approving ? `Approve the arrear for ${approving.name}? It will be added to the current payroll run.` : ''}
        confirmLabel="Approve"
        onConfirm={() => {
          if (approving) approveMutation.mutate(approving.id);
        }}
        onClose={() => !approveMutation.isPending && setApproving(null)}
        isLoading={approveMutation.isPending}
      />

      {createMutation.isPending && (
        <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-md">
          <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
          Saving…
        </div>
      )}
    </div>
  );
}
