import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Loader2, CheckCircle, XCircle, IndianRupee, Briefcase, ArrowLeft, FileText, Check, X } from 'lucide-react';
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
import { formatDate } from '@/lib/dateTime';

const STATUS_OPTIONS = ['draft', 'pending', 'approved', 'rejected', 'paid'];

/*
 * Settlement dates arrive as full ISO timestamps at IST midnight
 * (…T18:30:00.000000Z). Printed raw they read as machine output on a screen
 * showing gratuity and net pay, and rendered in UTC they land a day early.
 * formatDate resolves them in the display timezone.
 */
const settlementDate = (value?: string | null) => (value ? formatDate(value) : '-');

export default function FnFSettlementsPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [statusFilter, setStatusFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [userFilter, setUserFilter] = useState('');

  const [selectedSettlement, setSelectedSettlement] = useState<any>(null);
  const [rejecting, setRejecting] = useState<{ id: number; name: string } | null>(null);
  const [approving, setApproving] = useState<{ id: number; name: string } | null>(null);
  const [processing, setProcessing] = useState<{ id: number; name: string } | null>(null);

  const { data: settlementsData, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['fnf-settlements', statusFilter, userFilter],
    queryFn: () => payrollApi.listFnFSettlements({ status: statusFilter || undefined, user_id: userFilter ? parseInt(userFilter) : undefined }).then(res => res.data?.data ?? res.data ?? []),
  });

  const { data: usersData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => payrollApi.createFnFSettlement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
      show({ kind: 'success', message: 'F&F settlement created.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to create F&F settlement.') }),
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveFnFSettlement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
      setApproving(null);
      show({ kind: 'success', message: 'Settlement approved.' });
    },
    onError: (e: any) => {
      setApproving(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve settlement.') });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectFnFSettlement(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
      setRejecting(null);
      show({ kind: 'success', message: 'Settlement rejected.' });
    },
    onError: (e: any) => {
      setRejecting(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject settlement.') });
    },
  });

  const processPaymentMutation = useMutation({
    mutationFn: ({ id, method, reference }: { id: number; method: string; reference?: string }) =>
      payrollApi.processFnFPayment(id, method, reference),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['fnf-settlements'] });
      setProcessing(null);
      show({ kind: 'success', message: 'Payment processed.' });
    },
    onError: (e: any) => {
      setProcessing(null);
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to process payment.') });
    },
  });

  const settlements = Array.isArray(settlementsData) ? settlementsData : [];
  const users = Array.isArray(usersData) ? usersData : [];

  const stats = {
    total: settlements.length,
    draft: settlements.filter(s => s.status === 'draft').length,
    pending: settlements.filter(s => s.status === 'pending').length,
    approved: settlements.filter(s => s.status === 'approved').length,
    paid: settlements.filter(s => s.status === 'paid').length,
  };

  if (selectedSettlement) {
    const s = selectedSettlement;
    return (
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            {s.user?.name || 'Unknown'} — Last Working Day: {s.last_working_date || 'N/A'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">Full & Final Settlement</p>
        </div>
        <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" iconLeft={<ArrowLeft className="h-4 w-4" />} onClick={() => setSelectedSettlement(null)}>
              Back to List
            </Button>
            <StatusBadge tone={payrollStatusTone(s.status)}>{titleCase(s.status)}</StatusBadge>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Settlement Components */}
            <SurfaceCard className="p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <IndianRupee className="h-4 w-4 text-blue-600" />
                Settlement Components
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Pending Salary ({s.last_working_date || '1–15 Nov'})</span>
                  <span className="font-medium text-slate-900">{formatPayrollAmount(s.current_month_salary || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Leave Encashment</span>
                  <span className="font-medium text-slate-900">{formatPayrollAmount(s.leave_encashment || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Gratuity {Number(s.years_of_service || 0) < 5 ? '(not eligible — <5yrs)' : ''}</span>
                  <span className={`font-medium ${Number(s.years_of_service || 0) < 5 ? 'text-slate-400' : 'text-slate-900'}`}>
                    {formatPayrollAmount(s.gratuity_amount || 0)}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Loan Recovery</span>
                  <span className="font-medium text-rose-600">-{formatPayrollAmount(s.loan_recovery || 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-slate-600">Notice Period Shortfall {s.notice_period_days ? `(${s.notice_period_days} days)` : ''}</span>
                  <span className="font-medium text-rose-600">-{formatPayrollAmount(s.notice_pay_recovery || 0)}</span>
                </div>
                <div className="border-t border-slate-200 mt-3 pt-3">
                  <div className="flex justify-between">
                    <span className="font-semibold text-slate-900">Net Payable</span>
                    <span className={`text-lg font-bold ${(s.net_settlement_amount || 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                      {formatPayrollAmount(s.net_settlement_amount || 0)}
                    </span>
                  </div>
                  {(s.net_settlement_amount || 0) < 0 && (
                    <p className="text-xs text-rose-500 mt-1">(recoverable from employee)</p>
                  )}
                </div>
              </div>
            </SurfaceCard>

            {/* Clearance Checklist */}
            <SurfaceCard className="p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <FileText className="h-4 w-4 text-blue-600" />
                Clearance Checklist
              </h3>
              <div className="space-y-3">
                {(s.clearance_checklist ?? [
                  { item: 'Assets returned', status: s.assets_returned ? 'pass' : 'pending' },
                  { item: 'Manager sign-off', status: s.manager_signoff ? 'pass' : 'pending' },
                  { item: 'Finance recovery acknowledgement', status: s.finance_recovery ? 'pass' : 'pending' },
                ]).map((check: any, idx: number) => {
                  const isPass = check.status === 'pass' || check.status === 'completed';
                  const isFail = check.status === 'fail' || check.status === 'failed';
                  return (
                    <div key={idx} className="flex items-center justify-between text-sm">
                      <span className="text-slate-600">{check.item || check.label || check.name}</span>
                      <span className="flex items-center gap-1.5">
                        {isPass ? (
                          <Check className="h-4 w-4 text-emerald-500" />
                        ) : isFail ? (
                          <X className="h-4 w-4 text-rose-500" />
                        ) : (
                          <span className="h-4 w-4 rounded-full border-2 border-slate-300" />
                        )}
                        <span className={`text-xs font-medium ${isPass ? 'text-emerald-600' : isFail ? 'text-rose-600' : 'text-slate-400'}`}>
                          {isPass ? 'Pass' : isFail ? 'Fail' : 'Pending'}
                        </span>
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="mt-6 space-y-2">
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={s.status === 'paid' || s.status === 'rejected'}
                  onClick={() => {
                    if (s.status === 'approved') {
                      setProcessing({ id: s.id, name: s.user?.name || 'this settlement' });
                    } else {
                      setApproving({ id: s.id, name: s.user?.name || 'this settlement' });
                    }
                  }}
                >
                  {s.status === 'approved' ? 'Process Payment' : s.status === 'paid' ? 'Already Paid' : 'Approve Settlement'}
                </Button>
                <Button
                  variant="secondary"
                  className="w-full"
                  iconLeft={<FileText className="h-4 w-4" />}
                  onClick={() => {
                    const blob = new Blob([JSON.stringify(s, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `ff-settlement-${s.user?.name?.replace(/\s+/g, '_') || s.id}.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                    show({ kind: 'success', message: 'F&F statement downloaded.' });
                  }}
                >
                  Generate F&F Statement
                </Button>
              </div>
            </SurfaceCard>
          </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Full & Final Settlements"
        description="Used when an employee exits — calculates final dues (unpaid salary, leave encashment, gratuity) minus outstanding loans."
      />
        <HowItWorksCard
          whatIsThis="A one-time final payment to an exiting employee. Covers salary for days worked in the last month, encashment of unused earned leaves, and gratuity (if eligible) — minus any outstanding loans or advances."
          whenToUse={[
            'Employee submits resignation (use after the manager accepts and exit date is set)',
            'Retirement, termination, layoff, or death in service',
            'Annual/periodic settlements for long-pending exits',
          ]}
          howItFlows={[
            { step: 1, label: 'Create F&F', desc: 'Pick employee, exit date, and reason (resignation, termination, etc.)' },
            { step: 2, label: 'System calculates', desc: 'Salary for last month + leave encashment + gratuity − loans/advances' },
            { step: 3, label: 'Review & approve', desc: 'Admin verifies the breakdown and approves' },
            { step: 4, label: 'Process payment', desc: 'Pays via NEFT/RTGS from the bank file or one-off transfer' },
          ]}
          commonMistakes={[
            'Creating F&F before the manager accepts the resignation — wait until exit is confirmed',
            'Forgetting to mark loans as closed; they will double-deduct',
            'Not checking 5-year eligibility for gratuity before excluding it',
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
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <TextInput
                  placeholder="Search by employee name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>
          </div>
        </FilterPanel>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <MetricCard label="Total" value={stats.total} accent="sky" icon={Briefcase} />
          <MetricCard label="Draft" value={stats.draft} accent="slate" />
          <MetricCard label="Pending" value={stats.pending} accent="amber" />
          <MetricCard label="Approved" value={stats.approved} accent="emerald" />
          <MetricCard label="Paid" value={stats.paid} accent="violet" />
        </div>

        {/* Settlements Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <PageLoadingState label="Loading settlements…" />
          ) : isError ? (
            <PageErrorState
              message={getApiErrorMessage(error, "Couldn't load settlements.")}
              onRetry={() => refetch()}
            />
          ) : settlements.length === 0 ? (
            <PageEmptyState
              title="No F&F settlement records found"
              description="When an employee exit is processed, the settlement will appear here."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Exit Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Resignation</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Last Working</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Years</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gratuity</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Net Settlement</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {settlements
                    .filter(s => !searchQuery ||
                      s.user?.name?.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((settlement: any) => (
                    <tr key={settlement.id} className="hover:bg-slate-50 transition-colors cursor-pointer" onClick={() => setSelectedSettlement(settlement)}>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{settlement.user?.name || 'Unknown'}</div>
                        <div className="text-xs text-slate-500">{settlement.user?.email || ''}</div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] bg-blue-500/10 text-blue-600">
                          {titleCase(settlement.exit_type)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-900">{settlementDate(settlement.resignation_date)}</td>
                      <td className="px-4 py-3 text-slate-900">{settlementDate(settlement.last_working_date)}</td>
                      <td className="px-4 py-3 text-slate-900">{Number(settlement.years_of_service || 0).toFixed(1)}</td>
                      <td className="px-4 py-3 text-slate-900">{formatPayrollAmount(settlement.gratuity_amount, { compact: true })}</td>
                      <td className="px-4 py-3">
                        <span className="text-emerald-600 font-medium">{formatPayrollAmount(settlement.net_settlement_amount, { compact: true })}</span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge tone={payrollStatusTone(settlement.status)}>{titleCase(settlement.status)}</StatusBadge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          {(settlement.status === 'draft' || settlement.status === 'pending') && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3 w-3 text-emerald-600" />}
                                onClick={() => setApproving({ id: settlement.id, name: settlement.user?.name || 'this settlement' })}
                                disabled={approveMutation.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3 w-3 text-rose-600" />}
                                onClick={() => setRejecting({ id: settlement.id, name: settlement.user?.name || 'this settlement' })}
                                disabled={rejectMutation.isPending}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {settlement.status === 'approved' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              iconLeft={<IndianRupee className="h-3 w-3 text-emerald-600" />}
                              onClick={() => setProcessing({ id: settlement.id, name: settlement.user?.name || 'this settlement' })}
                              disabled={processPaymentMutation.isPending}
                            >
                              Pay
                            </Button>
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
        title="Reject settlement"
        description={rejecting ? `Provide a reason for rejecting the settlement for ${rejecting.name}.` : undefined}
        onSubmit={(reason) => {
          if (rejecting) rejectMutation.mutate({ id: rejecting.id, reason });
        }}
        onClose={() => !rejectMutation.isPending && setRejecting(null)}
        isLoading={rejectMutation.isPending}
      />

      <ConfirmDialog
        isOpen={approving !== null}
        title="Approve settlement"
        message={approving ? `Approve the settlement for ${approving.name}?` : ''}
        confirmLabel="Approve"
        onConfirm={() => {
          if (approving) approveMutation.mutate(approving.id);
        }}
        onClose={() => !approveMutation.isPending && setApproving(null)}
        isLoading={approveMutation.isPending}
      />

      <ConfirmDialog
        isOpen={processing !== null}
        title="Process payment"
        message={processing ? `Process payment for ${processing.name}? This will mark the settlement as paid.` : ''}
        confirmLabel="Process payment"
        onConfirm={() => {
          if (processing) processPaymentMutation.mutate({ id: processing.id, method: 'bank_transfer' });
        }}
        onClose={() => !processPaymentMutation.isPending && setProcessing(null)}
        isLoading={processPaymentMutation.isPending}
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
