import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, Search, Plus, CheckCircle, XCircle,
  Clock, AlertCircle, Paperclip, X, FileText, Check,
} from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import RejectReasonModal from '@/components/ui/RejectReasonModal';
import Modal from '@/components/ui/dialog/Modal';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import PayrollDataTable, { type PayrollDataTableColumn } from '@/components/payroll/PayrollDataTable';
import MonthPicker from '@/components/ui/MonthPicker';
import SubmitClaimModal from './Reimbursements/SubmitClaimModal';
import MarkPaidModal from './Reimbursements/MarkPaidModal';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const CATEGORIES = [
  { value: 'travel', label: 'Travel' },
  { value: 'meals', label: 'Meals & Entertainment' },
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'communication', label: 'Communication' },
  { value: 'medical', label: 'Medical' },
  { value: 'training', label: 'Training & Development' },
  { value: 'other', label: 'Other' },
];

// Persists the selected review month across refreshes. Cleared on logout
// (see AuthContext.logout) so a fresh login defaults to the current month.
const REIMBURSEMENT_MONTH_KEY = 'reimbursement_month_filter';

function currentMonthValue(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${d.getFullYear()}-${m}`;
}

function initialMonthFilter(): string {
  try {
    const stored = localStorage.getItem(REIMBURSEMENT_MONTH_KEY);
    if (stored !== null) return stored;
  } catch {
    /* ignore */
  }
  return currentMonthValue();
}

type Tab = 'inbox' | 'my_submissions' | 'history' | 'pending_payments';

type ApproveTarget =
  | { kind: 'manager'; id: number; name: string }
  | { kind: 'admin'; id: number; name: string }
  | { kind: 'bulk' }
  | null;

export default function ReimbursementsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();

  const isStrictAdmin = hasStrictAdminAccess(user);
  const isAdmin = isStrictAdmin || (user?.hierarchy_level ?? 100) < 100;
  const isManager = !isStrictAdmin && (user?.hierarchy_level ?? 100) > 10 && (user?.hierarchy_level ?? 100) < 100;

  // URL-synced tab state — refreshing the page now restores the active tab
  // (e.g. /payroll/employee-pay?type=reimbursements&tab=inbox).
  const defaultTab: Tab = isStrictAdmin || isManager ? 'inbox' : 'my_submissions';
  const requestedTab = searchParams.get('tab') as Tab | null;
  const activeTab: Tab = (requestedTab && ['inbox', 'my_submissions', 'history', 'pending_payments'].includes(requestedTab))
    ? requestedTab
    : defaultTab;

  const setActiveTab = (tab: Tab) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (tab === defaultTab) {
        next.delete('tab');
      } else {
        next.set('tab', tab);
      }
      return next;
    });
  };

  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [showMarkPaidModal, setShowMarkPaidModal] = useState<{ open: boolean; id: number | null }>({ open: false, id: null });
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [monthFilter, setMonthFilter] = useState<string>(initialMonthFilter);
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [approveTarget, setApproveTarget] = useState<ApproveTarget>(null);

  // Persist month changes.
  useEffect(() => {
    try {
      localStorage.setItem(REIMBURSEMENT_MONTH_KEY, monthFilter);
    } catch {
      /* ignore */
    }
  }, [monthFilter]);

  // ─── Queries ───────────────────────────────────────────────

  const myQuery = useQuery({
    queryKey: ['reimbursements', 'mine', monthFilter],
    queryFn: () => payrollApi.myReimbursements({ month_year: monthFilter || undefined }).then((r) => r.data),
  });

  const managerQuery = useQuery({
    queryKey: ['reimbursements', 'manager-inbox', search, monthFilter],
    queryFn: () => payrollApi.managerInbox({ search, month_year: monthFilter || undefined }).then((r) => r.data),
    enabled: isManager && activeTab === 'inbox',
  });

  const adminQuery = useQuery({
    queryKey: ['reimbursements', 'admin-inbox', search, monthFilter],
    queryFn: () => payrollApi.adminInbox({ search, month_year: monthFilter || undefined }).then((r) => r.data),
    enabled: isStrictAdmin && activeTab === 'inbox',
  });

  const historyQuery = useQuery({
    queryKey: ['reimbursements', 'history', monthFilter],
    queryFn: () => payrollApi.listReimbursements({ month_year: monthFilter || undefined }).then((r) => r.data),
    enabled: activeTab === 'history',
  });

  const pendingPaymentsQuery = useQuery({
    queryKey: ['reimbursements', 'pending-payments', monthFilter],
    queryFn: () => payrollApi.pendingPayments({ month_year: monthFilter || undefined }).then((r) => r.data),
    enabled: isStrictAdmin && activeTab === 'pending_payments',
  });

  const summaryQuery = useQuery({
    queryKey: ['reimbursements', 'summary', monthFilter],
    queryFn: () => payrollApi.reimbursementSummary({ month_year: monthFilter || undefined }).then((r) => r.data),
  });

  const claimDetailQuery = useQuery({
    queryKey: ['reimbursements', 'detail', selectedClaimId],
    queryFn: () => payrollApi.getReimbursementDetail(selectedClaimId!).then((r) => r.data),
    enabled: selectedClaimId !== null,
  });

  // ─── Mutations ─────────────────────────────────────────────

  const managerApproveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.managerApproveReimbursement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setApproveTarget(null);
      show({ kind: 'success', message: 'Claim approved.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve claim.') }),
  });

  const managerRejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.managerRejectReimbursement(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setRejectingId(null);
      show({ kind: 'success', message: 'Claim rejected.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject claim.') }),
  });

  const adminApproveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveReimbursement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setApproveTarget(null);
      show({ kind: 'success', message: 'Claim approved.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve claim.') }),
  });

  const adminRejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectReimbursement(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setRejectingId(null);
      show({ kind: 'success', message: 'Claim rejected.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject claim.') }),
  });

  const markReadMutation = useMutation({
    mutationFn: (id: number) => payrollApi.markReimbursementRead(id, isStrictAdmin ? 'admin' : 'manager'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements', 'manager-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['reimbursements', 'admin-inbox'] });
    },
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () =>
      isStrictAdmin
        ? payrollApi.bulkAdminApproveReimbursements(selectedIds)
        : payrollApi.bulkManagerApproveReimbursements(selectedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setSelectedIds([]);
      setApproveTarget(null);
      show({ kind: 'success', message: 'Claims approved.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve claims.') }),
  });

  const bulkRejectMutation = useMutation({
    mutationFn: (reason: string) =>
      isStrictAdmin
        ? payrollApi.bulkAdminRejectReimbursements(selectedIds, reason)
        : payrollApi.bulkManagerRejectReimbursements(selectedIds, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setSelectedIds([]);
      setRejectingId(null);
      show({ kind: 'success', message: 'Claims rejected.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject claims.') }),
  });

  // Mark a claim as read when opened from an inbox.
  useEffect(() => {
    if (selectedClaimId === null) return;
    if (activeTab !== 'inbox') return;
    markReadMutation.mutate(selectedClaimId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClaimId, activeTab]);

  // ─── Derived data ──────────────────────────────────────────

  const summary = summaryQuery.data || {
    total_count: 0, total_amount: 0,
    pending_manager_count: 0, pending_manager_amount: 0,
    pending_admin_count: 0, pending_admin_amount: 0,
    approved_count: 0, approved_amount: 0,
    rejected_count: 0,
    pending_payment_count: 0, pending_payment_amount: 0,
  };

  const activeData: any[] = (() => {
    switch (activeTab) {
      case 'inbox':
        if (isStrictAdmin) return adminQuery.data || [];
        if (isManager) return managerQuery.data || [];
        return [];
      case 'my_submissions':
        return myQuery.data || [];
      case 'history':
        return (historyQuery.data || []).filter((r: any) =>
          r.approval_level === 'approved' || r.approval_level === 'rejected'
        );
      case 'pending_payments':
        return pendingPaymentsQuery.data || [];
      default:
        return [];
    }
  })();

  const filteredData = search
    ? activeData.filter((r: any) =>
        r.title?.toLowerCase().includes(search.toLowerCase()) ||
        r.description?.toLowerCase().includes(search.toLowerCase()) ||
        r.employee?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : activeData;

  const activeQuery = activeTab === 'inbox'
    ? (isStrictAdmin ? adminQuery : managerQuery)
    : activeTab === 'my_submissions' ? myQuery
    : activeTab === 'pending_payments' ? pendingPaymentsQuery
    : historyQuery;

  const isLoading = activeTab === 'inbox'
    ? (isStrictAdmin ? adminQuery.isLoading : managerQuery.isLoading)
    : activeTab === 'my_submissions' ? myQuery.isLoading
    : activeTab === 'pending_payments' ? pendingPaymentsQuery.isLoading
    : historyQuery.isLoading;

  // ─── Tab configuration ────────────────────────────────────

  const tabs: { key: Tab; label: string; count?: number }[] = [];
  if (isStrictAdmin) tabs.push({ key: 'inbox', label: 'Admin Inbox', count: summary.pending_admin_count });
  if (isManager) tabs.push({ key: 'inbox', label: 'Manager Inbox', count: summary.pending_manager_count });
  tabs.push({ key: 'my_submissions', label: 'My Submissions' });
  if (isStrictAdmin) tabs.push({ key: 'pending_payments', label: 'Pending Payments', count: summary.pending_payment_count });
  tabs.push({ key: 'history', label: 'History' });

  // ─── Table columns ─────────────────────────────────────────

  const columns: PayrollDataTableColumn<any>[] = [
    ...(activeTab === 'inbox' ? [{
      key: 'select',
      header: '',
      width: 'w-10',
      render: (r: any) => (
        <input
          type="checkbox"
          aria-label="Select row"
          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
          checked={selectedIds.includes(r.id)}
          onChange={(e) => {
            if (e.target.checked) {
              setSelectedIds([...selectedIds, r.id]);
            } else {
              setSelectedIds(selectedIds.filter((id) => id !== r.id));
            }
          }}
        />
      ),
    } as PayrollDataTableColumn<any>] : []),
    ...(activeTab !== 'my_submissions' ? [{
      key: 'employee',
      header: 'Employee',
      render: (r: any) => (
        <div>
          <div className="font-medium text-slate-900">{r.employee?.name || 'Unknown'}</div>
          <div className="text-xs text-slate-500">{r.employee?.email || ''}</div>
        </div>
      ),
    } as PayrollDataTableColumn<any>] : []),
    {
      key: 'title',
      header: 'Title',
      cellClassName: 'max-w-[200px] truncate',
      render: (r) => <span className="text-slate-600">{r.title || r.description || '-'}</span>,
    },
    {
      key: 'category',
      header: 'Category',
      render: (r) => (
        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-blue-500/10 text-blue-600">
          {CATEGORIES.find((c) => c.value === r.category)?.label || r.category || 'Other'}
        </span>
      ),
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (r) => <span className="font-medium text-slate-900">{formatPayrollAmount(r.amount, { compact: true })}</span>,
    },
    {
      key: 'date',
      header: 'Expense Date',
      render: (r) => <span className="text-slate-600">{r.expense_date || '-'}</span>,
    },
    {
      key: 'submitted',
      header: 'Submitted',
      render: (r) => <span className="text-slate-600 text-xs">{r.created_at ? String(r.created_at).slice(0, 10) : '-'}</span>,
    },
    ...(activeTab === 'inbox' && isStrictAdmin ? [{
      key: 'manager',
      header: 'Manager',
      render: (r: any) => <span className="text-slate-600 text-xs">{r.managerApprover?.name || '-'}</span>,
    } as PayrollDataTableColumn<any>] : []),
    {
      key: 'status',
      header: 'Status',
      render: (r) => (
        <div>
          <StatusBadge tone={payrollStatusTone(r.approval_level)}>{titleCase(r.approval_level)}</StatusBadge>
          {r.rejection_reason && (
            <p className="text-xs text-rose-500 mt-1 max-w-[150px] truncate" title={r.rejection_reason}>
              {r.rejection_reason}
            </p>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (r) => (
        <div className="flex gap-1 justify-end">
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<FileText className="h-3.5 w-3.5 text-slate-500" />}
            onClick={() => setSelectedClaimId(r.id)}
          >
            View
          </Button>
          {activeTab === 'inbox' && isManager && r.approval_level === 'pending_manager' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<CheckCircle className="h-3.5 w-3.5 text-emerald-600" />}
                onClick={() => setApproveTarget({ kind: 'manager', id: r.id, name: r.employee?.name || 'this claim' })}
                disabled={managerApproveMutation.isPending}
              >
                Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<XCircle className="h-3.5 w-3.5 text-rose-600" />}
                onClick={() => setRejectingId(r.id)}
                disabled={managerRejectMutation.isPending}
              >
                Reject
              </Button>
            </>
          )}
          {activeTab === 'inbox' && isStrictAdmin && r.approval_level === 'pending_admin' && (
            <>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<CheckCircle className="h-3.5 w-3.5 text-emerald-600" />}
                onClick={() => setApproveTarget({ kind: 'admin', id: r.id, name: r.employee?.name || 'this claim' })}
                disabled={adminApproveMutation.isPending}
              >
                Final Approve
              </Button>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<XCircle className="h-3.5 w-3.5 text-rose-600" />}
                onClick={() => setRejectingId(r.id)}
                disabled={adminRejectMutation.isPending}
              >
                Reject
              </Button>
            </>
          )}
          {activeTab === 'pending_payments' && isStrictAdmin && (
            <Button
              variant="ghost"
              size="sm"
              iconLeft={<CheckCircle className="h-3.5 w-3.5 text-violet-600" />}
              onClick={() => setShowMarkPaidModal({ open: true, id: r.id })}
            >
              Mark Paid
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Reimbursements"
        description="Submit and manage expense claims with manager and admin approval."
      />
      <HowItWorksCard
        whatIsThis="Refunds for out-of-pocket business expenses. Employee submits a claim with receipts, manager verifies, admin gives final approval, and the amount is added to payroll."
        whenToUse={[
          'Business travel (flights, hotels, taxi, meals)',
          'Work-from-home setup (internet, chair, monitor)',
          'Team meals, client meetings, conference fees',
        ]}
        howItFlows={[
          { step: 1, label: 'Employee submits', desc: 'Upload receipts and describe the expense' },
          { step: 2, label: 'Manager approves', desc: 'Verifies business purpose and receipt validity' },
          { step: 3, label: 'Admin approves', desc: 'Final review and tax-free treatment confirmed' },
          { step: 4, label: 'Added to payroll', desc: 'Approved amount is included in next payroll run' },
        ]}
        commonMistakes={[
          'Approving without receipt (audit risk — receipts must be retained 8 years)',
          'Treating personal expenses as reimbursable (commute to/from home is not)',
          'Forgetting GST — reimbursements including GST require GST-compliant invoices',
        ]}
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        <MetricCard
          label="Total Claims"
          value={summary.total_count}
          hint={formatPayrollAmount(summary.total_amount, { compact: true })}
          icon={Receipt}
          accent="sky"
        />
        {isManager && (
          <MetricCard
            label="Pending Manager"
            value={summary.pending_manager_count}
            hint={formatPayrollAmount(summary.pending_manager_amount, { compact: true })}
            icon={Clock}
            accent="amber"
          />
        )}
        {isStrictAdmin && (
          <MetricCard
            label="Pending Admin"
            value={summary.pending_admin_count}
            hint={formatPayrollAmount(summary.pending_admin_amount, { compact: true })}
            icon={AlertCircle}
            accent="sky"
          />
        )}
        {isStrictAdmin && (
          <MetricCard
            label="Awaiting Payout"
            value={summary.pending_payment_count}
            hint={formatPayrollAmount(summary.pending_payment_amount, { compact: true })}
            icon={Paperclip}
            accent="violet"
          />
        )}
        <MetricCard
          label="Approved"
          value={summary.approved_count}
          hint={formatPayrollAmount(summary.approved_amount, { compact: true })}
          icon={CheckCircle}
          accent="emerald"
        />
        <MetricCard
          label="Rejected"
          value={summary.rejected_count || 0}
          hint={formatPayrollAmount(summary.rejected_amount || 0, { compact: true })}
          icon={XCircle}
          accent="rose"
        />
      </div>

      <FilterPanel>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-1 border-b border-slate-200 -mb-px">
            {tabs.map((tab) => (
              <button
                key={`${tab.key}-${tab.label}`}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
                {tab.count !== undefined && tab.count > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">
                    {tab.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <MonthPicker value={monthFilter} onChange={setMonthFilter} />
            {monthFilter && (
              <button
                type="button"
                onClick={() => setMonthFilter('')}
                className="text-slate-500 hover:text-slate-600"
                aria-label="Clear month filter"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="relative w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <TextInput
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="pl-9"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Plus className="h-4 w-4" />}
              onClick={() => setShowSubmitModal(true)}
            >
              Submit Claim
            </Button>
          </div>
        </div>
      </FilterPanel>

      {activeTab === 'inbox' && selectedIds.length > 0 && (
        <div className="flex items-center justify-between gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-2.5">
          <span className="text-sm font-medium text-blue-800">
            {selectedIds.length} claim{selectedIds.length > 1 ? 's' : ''} selected
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              iconLeft={<CheckCircle className="h-4 w-4" />}
              onClick={() => setApproveTarget({ kind: 'bulk' })}
              disabled={bulkApproveMutation.isPending}
            >
              {bulkApproveMutation.isPending ? 'Approving…' : `Approve ${isStrictAdmin ? 'Final' : ''}`}
            </Button>
            <Button
              variant="danger"
              size="sm"
              iconLeft={<XCircle className="h-4 w-4" />}
              onClick={() => setRejectingId(-1)}
              disabled={bulkRejectMutation.isPending}
            >
              Reject
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedIds([])}
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <PageLoadingState label="Loading reimbursements…" />
        ) : activeQuery.isError ? (
          <PageErrorState
            message={getApiErrorMessage(activeQuery.error, "Couldn't load reimbursements.")}
            onRetry={() => activeQuery.refetch()}
          />
        ) : (
          <PayrollDataTable
            columns={columns}
            rows={filteredData}
            rowKey={(r) => r.id}
            emptyState={
              <PageEmptyState
                title={
                  activeTab === 'inbox'
                    ? 'No pending reimbursements'
                    : activeTab === 'my_submissions'
                      ? 'No claims yet'
                      : 'No reimbursements found'
                }
                description={
                  activeTab === 'my_submissions'
                    ? 'Click "Submit Claim" to get started.'
                    : undefined
                }
              />
            }
            ariaLabel="Reimbursements"
          />
        )}
      </SurfaceCard>

      <SubmitClaimModal
        open={showSubmitModal}
        onClose={() => setShowSubmitModal(false)}
        onSubmitted={() => {/* success step handled inside modal */}}
      />

      <MarkPaidModal
        open={showMarkPaidModal.open}
        onClose={() => setShowMarkPaidModal({ open: false, id: null })}
        claimId={showMarkPaidModal.id ?? 0}
      />

      <RejectReasonModal
        isOpen={rejectingId !== null}
        title={rejectingId === -1 ? `Reject ${selectedIds.length} Claim(s)` : 'Reject Reimbursement'}
        description="Provide a reason for rejecting this claim."
        onSubmit={(reason) => {
          if (rejectingId === null) return;
          if (rejectingId === -1) {
            bulkRejectMutation.mutate(reason);
          } else if (activeTab === 'inbox' && isManager) {
            managerRejectMutation.mutate({ id: rejectingId, reason });
          } else {
            adminRejectMutation.mutate({ id: rejectingId, reason });
          }
        }}
        onClose={() => setRejectingId(null)}
        isLoading={
          rejectingId === null
            ? false
            : rejectingId === -1
              ? bulkRejectMutation.isPending
              : isManager
                ? managerRejectMutation.isPending
                : adminRejectMutation.isPending
        }
      />

      <ConfirmDialog
        isOpen={approveTarget !== null}
        title={
          approveTarget?.kind === 'bulk'
            ? 'Approve selected claims'
            : 'Approve claim'
        }
        message={
          approveTarget?.kind === 'bulk'
            ? `Approve ${selectedIds.length} selected claim(s)? They will move to the next approval stage.`
            : approveTarget
              ? `Approve the claim for ${approveTarget.name}?`
              : ''
        }
        confirmLabel="Approve"
        onConfirm={() => {
          if (!approveTarget) return;
          if (approveTarget.kind === 'manager') managerApproveMutation.mutate(approveTarget.id);
          else if (approveTarget.kind === 'admin') adminApproveMutation.mutate(approveTarget.id);
          else bulkApproveMutation.mutate();
        }}
        onClose={() => {
          if (
            !managerApproveMutation.isPending &&
            !adminApproveMutation.isPending &&
            !bulkApproveMutation.isPending
          ) {
            setApproveTarget(null);
          }
        }}
        isLoading={
          (approveTarget?.kind === 'manager' && managerApproveMutation.isPending) ||
          (approveTarget?.kind === 'admin' && adminApproveMutation.isPending) ||
          (approveTarget?.kind === 'bulk' && bulkApproveMutation.isPending)
        }
      />

      <Modal
        open={selectedClaimId !== null}
        onClose={() => setSelectedClaimId(null)}
        title="Claim Details"
        size="lg"
      >
        <ClaimDetailBody
          loading={claimDetailQuery.isLoading}
          data={claimDetailQuery.data}
          isStrictAdmin={isStrictAdmin}
          onMarkPaid={(id) => {
            setSelectedClaimId(null);
            setShowMarkPaidModal({ open: true, id });
          }}
        />
      </Modal>
    </div>
  );
}

function ClaimDetailBody({
  loading,
  data,
  isStrictAdmin,
  onMarkPaid,
}: {
  loading: boolean;
  data: any;
  isStrictAdmin: boolean;
  onMarkPaid: (id: number) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
      </div>
    );
  }
  if (!data) return null;
  return (
    <div className="space-y-5 px-6 py-4">
      <div className="space-y-3 text-sm">
        <Row label="Title" value={data.title || data.description} />
        <Row label="Category" value={CATEGORIES.find((c) => c.value === data.category)?.label || data.category || 'Other'} />
        <Row label="Amount" value={formatPayrollAmount(data.amount, { compact: true })} />
        <Row label="Expense Date" value={data.expense_date || '-'} />
        {data.merchant_name && <Row label="Merchant" value={data.merchant_name} />}
        {data.location && <Row label="Location" value={data.location} />}
        <Row label="Description" value={data.description} alignRight />
        {data.receipt_url && (
          <div className="flex justify-between items-start gap-4">
            <span className="text-slate-500 pt-0.5">Receipt</span>
            <div className="max-w-[320px] w-full">
              <ReceiptViewer url={data.receipt_url} />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100" />

      <div>
        <h4 className="text-sm font-semibold text-slate-900 mb-3">Approval Timeline</h4>
        <div className="space-y-0">
          <TimelineStep
            done
            title="Submitted"
            actor={data.submitter?.name || data.employee?.name}
            at={data.created_at}
          />
          {(data.approval_level === 'pending_manager' || data.manager_approved_by || (data.approval_level === 'rejected' && !data.approved_by)) && (
            <TimelineStep
              done={!!data.manager_approved_by}
              rejected={data.approval_level === 'rejected' && !data.approved_by}
              title={
                data.manager_approved_by
                  ? data.approval_level === 'rejected' && !data.approved_by
                    ? 'Rejected by Manager'
                    : 'Manager Approved'
                  : 'Manager Review'
              }
              actor={data.managerApprover?.name}
              at={data.manager_approved_at}
              pendingHint={!data.manager_approved_by && data.approval_level === 'pending_manager' ? 'Awaiting manager approval' : undefined}
            />
          )}
          <TimelineStep
            done={!!data.approved_by}
            rejected={data.approval_level === 'rejected' && !!data.approved_by}
            title={
              data.approved_by
                ? data.approval_level === 'rejected' ? 'Rejected by Admin' : 'Admin Approved'
                : 'Admin Review'
            }
            actor={data.approver?.name}
            at={data.approved_at}
            pendingHint={!data.approved_by && data.approval_level === 'pending_admin' ? 'Awaiting admin approval' : undefined}
            isLast
          />
        </div>
      </div>

      {data.rejection_reason && (
        <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
          <p className="text-xs font-semibold text-rose-700 mb-1">Rejection Reason</p>
          <p className="text-sm text-rose-600">{data.rejection_reason}</p>
        </div>
      )}

      {isStrictAdmin && data.approval_level === 'approved' && (
        <div className="mt-4 p-3 bg-violet-50 border border-violet-200 rounded-lg">
          {data.paid_at ? (
            <div>
              <p className="text-xs font-semibold text-violet-700 mb-1">Paid</p>
              <p className="text-sm text-violet-600">
                {data.payout_mode === 'outside_payroll' ? 'Outside Payroll' : 'Via Payroll'}
                {data.payment_reference ? ` · Ref: ${data.payment_reference}` : ''}
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                {new Date(data.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </p>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-violet-700">Approved — awaiting payout</p>
              <Button variant="primary" size="sm" onClick={() => onMarkPaid(data.id)}>
                Mark Paid
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, alignRight }: { label: string; value: string; alignRight?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`font-medium text-slate-900 ${alignRight ? 'text-right max-w-[280px]' : ''}`}>{value}</span>
    </div>
  );
}

function TimelineStep({
  done,
  rejected,
  title,
  actor,
  at,
  pendingHint,
  isLast,
}: {
  done: boolean;
  rejected?: boolean;
  title: string;
  actor?: string;
  at?: string;
  pendingHint?: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex flex-col items-center">
        {done ? (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${rejected ? 'bg-rose-100' : 'bg-emerald-100'}`}>
            {rejected ? <XCircle className="h-3.5 w-3.5 text-rose-600" /> : <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />}
          </div>
        ) : (
          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
            <Clock className="h-3.5 w-3.5 text-slate-500" />
          </div>
        )}
        {!isLast && <div className="w-px flex-1 bg-slate-200 my-1" />}
      </div>
      <div className={`pb-${isLast ? '2' : '4'}`}>
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {actor && <p className="text-xs text-slate-500">by {actor}</p>}
        {at && (
          <p className="text-xs text-slate-500 mt-0.5">
            {new Date(at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
          </p>
        )}
        {pendingHint && <p className="text-xs text-amber-500 mt-0.5">{pendingHint}</p>}
      </div>
    </div>
  );
}

function ReceiptViewer({ url }: { url: string }) {
  const abs = url && !/^https?:\/\//i.test(url) ? window.location.origin + url : url;
  const ext = (url.split('.').pop() || '').toLowerCase();
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext);
  const [imgError, setImgError] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  if (!url) return null;
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="inline-flex items-center gap-1 font-medium text-emerald-600 hover:underline"
      >
        <Paperclip className="h-3 w-3" /> Show receipt
      </button>
    );
  }
  return (
    <div className="space-y-2">
      <div className="relative">
        {isImage ? (
          imgError ? (
            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
              <p className="text-xs text-rose-600">
                Receipt preview unavailable — the file may be missing or storage not configured.
              </p>
            </div>
          ) : (
            <img
              src={abs}
              alt="Receipt"
              onError={() => setImgError(true)}
              className="max-h-64 w-full rounded-lg border border-slate-200 object-contain"
            />
          )
        ) : (
          <iframe
            src={abs}
            title="Receipt"
            className="h-64 w-full rounded-lg border border-slate-200"
          />
        )}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Hide receipt"
          className="absolute right-2 top-2 rounded-full bg-white/80 p-1 text-slate-500 shadow hover:bg-white hover:text-slate-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <button
        type="button"
        onClick={() => window.open(`/receipt-viewer.html?url=${encodeURIComponent(url)}`, '_blank')}
        className="inline-flex items-center gap-1 font-medium text-emerald-600 hover:underline"
      >
        <Paperclip className="h-3 w-3" /> Open receipt
      </button>
    </div>
  );
}

function Loader2({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M21 12a9 9 0 1 1-6.219-8.56" strokeLinecap="round" />
    </svg>
  );
}
