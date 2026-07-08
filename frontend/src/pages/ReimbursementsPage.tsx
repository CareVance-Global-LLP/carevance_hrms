import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt, Search, Loader2, Plus, CheckCircle, XCircle, IndianRupee,
  Clock, ArrowRight, FileText, Filter, Upload, X, Paperclip, AlertCircle, Check,
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import { useAuth } from '@/contexts/AuthContext';

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

const APPROVAL_LEVEL_LABELS: Record<string, string> = {
  pending_manager: 'Awaiting Manager',
  pending_admin: 'Awaiting Admin',
  approved: 'Approved',
  rejected: 'Rejected',
};

const APPROVAL_LEVEL_CLASSES: Record<string, string> = {
  pending_manager: 'bg-amber-50 text-amber-700 border border-amber-200',
  pending_admin: 'bg-blue-50 text-blue-700 border border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-200',
};

function fmt(amount: number | null | undefined): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '₹0';
  return '₹' + n.toLocaleString('en-IN');
}

type Tab = 'inbox' | 'my_submissions' | 'all' | 'history' | 'pending_payments';

export default function ReimbursementsPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const hierarchyLevel = user?.hierarchy_level ?? (user?.role === 'employee' ? 100 : user?.role === 'manager' ? 50 : 10);
  const isStrictAdmin = hierarchyLevel <= 10;
  const isAdmin = hierarchyLevel < 100;
  const isManager = hierarchyLevel > 10 && hierarchyLevel < 100;
  const isEmployee = hierarchyLevel >= 100;

  // Tab state
  const [activeTab, setActiveTab] = useState<Tab>(
    isStrictAdmin ? 'inbox' : isManager ? 'inbox' : 'my_submissions'
  );

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    title: '',
    category: 'travel',
    amount: '',
    description: '',
    expense_date: '',
    receipt_url: '',
    merchant_name: '',
    location: '',
  });

  // Receipt upload state
  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string>('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState('');
  const [submitError, setSubmitError] = useState('');

  // Confirmation & success state
  const [showConfirm, setShowConfirm] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [lastCreatedId, setLastCreatedId] = useState<number | null>(null);

  // Reject modal
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // Claim detail modal
  const [selectedClaimId, setSelectedClaimId] = useState<number | null>(null);

  // Bulk selection (inbox tabs)
  const [selectedIds, setSelectedIds] = useState<number[]>([]);

  // Mark-paid modal
  const [payingId, setPayingId] = useState<number | null>(null);
  const [payoutMode, setPayoutMode] = useState<'payroll' | 'outside_payroll'>('payroll');
  const [paymentReference, setPaymentReference] = useState('');

  // Search
  const [search, setSearch] = useState('');

  // Month filter (YYYY-MM) — defaults to the current running month, but
  // persists the user's selection across refreshes via localStorage.
  const [monthFilter, setMonthFilter] = useState<string>(initialMonthFilter);

  // ─── Queries ───────────────────────────────────────────────

  const { data: myData, isLoading: myLoading } = useQuery({
    queryKey: ['reimbursements', 'mine', monthFilter],
    queryFn: () => payrollApi.myReimbursements({ month_year: monthFilter || undefined }).then(r => r.data),
  });

  const { data: managerInboxData, isLoading: managerLoading } = useQuery({
    queryKey: ['reimbursements', 'manager-inbox', search, monthFilter],
    queryFn: () => payrollApi.managerInbox({ search, month_year: monthFilter || undefined }).then(r => r.data),
    enabled: isManager && activeTab === 'inbox',
  });

  const { data: adminInboxData, isLoading: adminLoading } = useQuery({
    queryKey: ['reimbursements', 'admin-inbox', search, monthFilter],
    queryFn: () => payrollApi.adminInbox({ search, month_year: monthFilter || undefined }).then(r => r.data),
    enabled: isStrictAdmin && activeTab === 'inbox',
  });

  const { data: allData, isLoading: allLoading } = useQuery({
    queryKey: ['reimbursements', 'all', monthFilter],
    queryFn: () => payrollApi.listReimbursements({ month_year: monthFilter || undefined }).then(r => r.data),
    enabled: activeTab === 'all' || activeTab === 'history',
  });

  const { data: pendingPaymentsData, isLoading: pendingPaymentsLoading } = useQuery({
    queryKey: ['reimbursements', 'pending-payments', monthFilter],
    queryFn: () => payrollApi.pendingPayments({ month_year: monthFilter || undefined }).then(r => r.data),
    enabled: isStrictAdmin && activeTab === 'pending_payments',
  });

  const { data: summaryData } = useQuery({
    queryKey: ['reimbursements', 'summary', monthFilter],
    queryFn: () => payrollApi.reimbursementSummary({ month_year: monthFilter || undefined }).then(r => r.data),
  });

  const { data: claimDetailData, isLoading: claimDetailLoading } = useQuery({
    queryKey: ['reimbursements', 'detail', selectedClaimId],
    queryFn: () => payrollApi.getReimbursementDetail(selectedClaimId!).then(r => r.data),
    enabled: selectedClaimId !== null,
  });

  // ─── Mutations ─────────────────────────────────────────────

  const createMutation = useMutation({
    mutationFn: () => payrollApi.createReimbursement({
      title: formData.title || formData.description,
      category: formData.category,
      amount: parseFloat(formData.amount),
      description: formData.description,
      expense_date: formData.expense_date,
      receipt_url: formData.receipt_url || undefined,
      merchant_name: formData.merchant_name || undefined,
      location: formData.location || undefined,
    }),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setLastCreatedId(res?.data?.reimbursement?.id || null);
      setShowConfirm(false);
      setSubmitError('');
      setShowSuccess(true);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Submission failed. Please try again.';
      setSubmitError(msg);
    },
  });

  const managerApproveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.managerApproveReimbursement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reimbursements'] }),
  });

  const managerRejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.managerRejectReimbursement(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setRejectingId(null);
      setRejectReason('');
    },
  });

  const adminApproveMutation = useMutation({
    mutationFn: (id: number) => payrollApi.approveReimbursement(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['reimbursements'] }),
  });

  const adminRejectMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) => payrollApi.rejectReimbursement(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setRejectingId(null);
      setRejectReason('');
    },
  });

  // Mark a claim as read when opened from an inbox so the sidebar badge
  // decrements like an unread chat message.
  const markReadMutation = useMutation({
    mutationFn: (id: number) =>
      payrollApi.markReimbursementRead(id, isStrictAdmin ? 'admin' : 'manager'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements', 'manager-inbox'] });
      queryClient.invalidateQueries({ queryKey: ['reimbursements', 'admin-inbox'] });
    },
  });

  // ─── Mark claim read when opened from an inbox ────────────

  useEffect(() => {
    if (selectedClaimId === null) return;
    if (activeTab !== 'inbox') return;
    markReadMutation.mutate(selectedClaimId);
  }, [selectedClaimId, activeTab, markReadMutation]);

  // ─── Bulk approve/reject mutations ──────────────────────

  const bulkApproveMutation = useMutation({
    mutationFn: () =>
      isStrictAdmin
        ? payrollApi.bulkAdminApproveReimbursements(selectedIds)
        : payrollApi.bulkManagerApproveReimbursements(selectedIds),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setSelectedIds([]);
    },
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
      setRejectReason('');
    },
  });

  // ─── Mark paid mutation ──────────────────────────────────

  const markPaidMutation = useMutation({
    mutationFn: () =>
      payrollApi.markReimbursementPaid(payingId!, { payout_mode: payoutMode, payment_reference: paymentReference || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      setPayingId(null);
      setPaymentReference('');
      setPayoutMode('payroll');
    },
  });

  // ─── Receipt upload ──────────────────────────────────────────

  const handleReceiptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
    setReceiptError('');

    setUploadingReceipt(true);
    try {
      const res = await payrollApi.uploadReimbursementReceipt(file);
      setFormData(prev => ({ ...prev, receipt_url: res.data.url }));
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Upload failed. Please try again.';
      setReceiptError(msg);
    } finally {
      setUploadingReceipt(false);
    }
  };

  const removeReceipt = () => {
    setReceiptFile(null);
    setReceiptPreview('');
    setReceiptError('');
    setFormData(prev => ({ ...prev, receipt_url: '' }));
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  };

  const resetForm = () => {
    setFormData({ title: '', category: 'travel', amount: '', description: '', expense_date: '', receipt_url: '', merchant_name: '', location: '' });
    setReceiptFile(null);
    setReceiptPreview('');
    setReceiptError('');
    setUploadingReceipt(false);
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  };

  const handleSubmitClick = () => {
    setSubmitError('');
    setShowConfirm(true);
  };

  const handleConfirmSubmit = () => {
    setSubmitError('');
    createMutation.mutate();
  };

  // ─── Derived data ──────────────────────────────────────────

  const summary = summaryData || {
    total_count: 0, total_amount: 0,
    pending_manager_count: 0, pending_manager_amount: 0,
    pending_admin_count: 0, pending_admin_amount: 0,
    approved_count: 0, approved_amount: 0,
    rejected_count: 0,
    pending_payment_count: 0, pending_payment_amount: 0,
  };

  const getActiveData = (): any[] => {
    switch (activeTab) {
      case 'inbox':
        if (isStrictAdmin) return adminInboxData || [];
        if (isManager) return managerInboxData || [];
        return [];
      case 'my_submissions':
        return myData || [];
      case 'history':
        // Post-inbox ledger: approved / rejected / removed claims.
        // (Removed claims keep approval_level='approved', so they are included.)
        return (allData || []).filter((r: any) =>
          r.approval_level === 'approved' || r.approval_level === 'rejected'
        );
      case 'pending_payments':
        return pendingPaymentsData || [];
      default:
        return [];
    }
  };

  const activeData = getActiveData();
  const filteredData = search
    ? activeData.filter((r: any) =>
        r.title?.toLowerCase().includes(search.toLowerCase()) ||
        r.description?.toLowerCase().includes(search.toLowerCase()) ||
        r.employee?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : activeData;

  const isLoading = activeTab === 'inbox'
    ? (isStrictAdmin ? adminLoading : managerLoading)
    : activeTab === 'my_submissions' ? myLoading
    : activeTab === 'pending_payments' ? pendingPaymentsLoading
    : allLoading;

  // ─── Tabs ──────────────────────────────────────────────────

  const tabs: { key: Tab; label: string; count?: number }[] = [];

  if (isStrictAdmin) {
    tabs.push({ key: 'inbox', label: 'Admin Inbox', count: summary.pending_admin_count });
  }
  if (isManager) {
    tabs.push({ key: 'inbox', label: 'Manager Inbox', count: summary.pending_manager_count });
  }
  tabs.push({ key: 'my_submissions', label: 'My Submissions' });
  if (isStrictAdmin) {
    tabs.push({ key: 'pending_payments', label: 'Pending Payments', count: summary.pending_payment_count });
  }
  // "All Reimbursements" was merged into "History" — History already covers
  // approved / rejected / removed claims (the post-inbox ledger).
  tabs.push({ key: 'history', label: 'History' });

  // If manager, merge inbox into manager inbox
  const visibleTabs = isAdmin
    ? tabs.filter(t => t.key !== 'inbox' || isAdmin)
    : isManager
      ? tabs
      : tabs.filter(t => t.key === 'my_submissions' || t.key === 'history');

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Reimbursements"
        description="Submit and manage expense claims with manager and admin approval."
      />

      <div className="p-6 max-w-7xl mx-auto space-y-6">
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

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <SurfaceCard className="p-4">
            <p className="text-xs text-slate-500 mb-1">Total Claims</p>
            <p className="text-xl font-bold text-slate-900">{summary.total_count}</p>
            <p className="text-xs text-slate-500">{fmt(summary.total_amount)}</p>
          </SurfaceCard>
          {isManager && (
            <SurfaceCard className="p-4">
              <p className="text-xs text-amber-600 mb-1">Pending Manager</p>
              <p className="text-xl font-bold text-amber-600">{summary.pending_manager_count}</p>
              <p className="text-xs text-slate-500">{fmt(summary.pending_manager_amount)}</p>
            </SurfaceCard>
          )}
          {isStrictAdmin && (
            <SurfaceCard className="p-4">
              <p className="text-xs text-blue-600 mb-1">Pending Admin</p>
              <p className="text-xl font-bold text-blue-600">{summary.pending_admin_count}</p>
              <p className="text-xs text-slate-500">{fmt(summary.pending_admin_amount)}</p>
            </SurfaceCard>
          )}
          {isStrictAdmin && (
            <SurfaceCard className="p-4">
              <p className="text-xs text-violet-600 mb-1">Awaiting Payout</p>
              <p className="text-xl font-bold text-violet-600">{summary.pending_payment_count}</p>
              <p className="text-xs text-slate-500">{fmt(summary.pending_payment_amount)}</p>
            </SurfaceCard>
          )}
          <SurfaceCard className="p-4">
            <p className="text-xs text-emerald-600 mb-1">Approved</p>
            <p className="text-xl font-bold text-emerald-600">{summary.approved_count}</p>
            <p className="text-xs text-slate-500">{fmt(summary.approved_amount)}</p>
          </SurfaceCard>
        </div>

        {/* Tabs + Action Bar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-1 border-b border-slate-200 -mb-px">
            {visibleTabs.map((tab) => (
              <button
                key={tab.key}
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
            {/* Month filter — review claims by the month the expense was incurred */}
            <div className="relative flex items-center">
              <Filter className="absolute left-3 h-4 w-4 text-slate-400 pointer-events-none" />
              <input
                type="month"
                value={monthFilter}
                onChange={(e) => {
                  const v = e.target.value;
                  setMonthFilter(v);
                  try {
                    localStorage.setItem(REIMBURSEMENT_MONTH_KEY, v);
                  } catch {
                    /* ignore */
                  }
                }}
                className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                aria-label="Filter by month"
              />
              {monthFilter && (
                <button
                  type="button"
                  onClick={() => {
                    setMonthFilter('');
                    try {
                      localStorage.setItem(REIMBURSEMENT_MONTH_KEY, '');
                    } catch {
                      /* ignore */
                    }
                  }}
                  className="absolute right-2 text-slate-400 hover:text-slate-600"
                  aria-label="Clear month filter"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
              />
            </div>
            <Button
              variant="primary"
              size="sm"
              iconLeft={<Plus className="h-4 w-4" />}
              onClick={() => setShowForm(true)}
            >
              Submit Claim
            </Button>
          </div>
        </div>

        {/* Bulk action bar — visible only in inbox tabs with a selection */}
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
                onClick={() => bulkApproveMutation.mutate()}
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

        {/* Create Form — Keka Style */}
        {showForm && !showSuccess && (
          <SurfaceCard className="p-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-900">New Expense Claim</h3>
              <button onClick={() => { setShowForm(false); resetForm(); }} className="text-slate-400 hover:text-slate-600 transition-colors">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Category — First */}
            <div className="mb-5">
              <FieldLabel>Category *</FieldLabel>
              <SelectInput value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
                {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </SelectInput>
            </div>

            <div className="border-t border-slate-100 my-5" />

            {/* Expense Details */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <FieldLabel>Amount *</FieldLabel>
                  <TextInput
                    type="number"
                    value={formData.amount}
                    onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <FieldLabel>Date of Expense *</FieldLabel>
                  <TextInput
                    type="date"
                    value={formData.expense_date}
                    onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                  />
                </div>
                <div>
                  <FieldLabel>Merchant / Vendor</FieldLabel>
                  <TextInput
                    value={formData.merchant_name}
                    onChange={(e) => setFormData({ ...formData, merchant_name: e.target.value })}
                    placeholder="e.g., Uber, Taj Hotels"
                  />
                </div>
              </div>

              <div>
                <FieldLabel>Title *</FieldLabel>
                <TextInput
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="e.g., Client meeting travel"
                />
              </div>

              <div>
                <FieldLabel>Description *</FieldLabel>
                <TextareaInput
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe the expense and business purpose..."
                  rows={2}
                />
              </div>

              <div>
                <FieldLabel>Location</FieldLabel>
                <TextInput
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  placeholder="e.g., Mumbai, Bangalore"
                />
              </div>
            </div>

            <div className="border-t border-slate-100 my-5" />

            {/* Receipt — Hyperlink Style */}
            <div>
              <FieldLabel>Receipt / Bill</FieldLabel>
              <input
                ref={receiptInputRef}
                type="file"
                accept="image/*,.pdf"
                className="hidden"
                onChange={handleReceiptSelect}
              />
              {receiptPreview ? (
                <div className="flex items-start gap-3 p-3 border border-slate-200 rounded-lg bg-slate-50">
                  {receiptFile?.type.startsWith('image/') ? (
                    <img src={receiptPreview} alt="Receipt" className="h-16 w-16 object-cover rounded border border-slate-200" />
                  ) : (
                    <div className="h-16 w-16 flex items-center justify-center bg-slate-100 rounded border border-slate-200">
                      <FileText className="h-6 w-6 text-slate-400" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{receiptFile?.name}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {receiptFile ? `${(receiptFile.size / 1024).toFixed(0)} KB` : ''}
                    </p>
                    {uploadingReceipt && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <Loader2 className="h-3 w-3 animate-spin text-blue-600" />
                        <span className="text-xs text-blue-600">Uploading...</span>
                      </div>
                    )}
                    {receiptError && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <AlertCircle className="h-3 w-3 text-red-500" />
                        <span className="text-xs text-red-500">{receiptError}</span>
                        <button
                          type="button"
                          onClick={() => { setReceiptError(''); receiptInputRef.current?.click(); }}
                          className="text-xs text-blue-600 hover:underline ml-1"
                        >
                          Retry
                        </button>
                      </div>
                    )}
                    {!uploadingReceipt && !receiptError && formData.receipt_url && (
                      <div className="flex items-center gap-1.5 mt-1">
                        <Check className="h-3 w-3 text-emerald-600" />
                        <span className="text-xs text-emerald-600">Uploaded</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={removeReceipt}
                    className="text-slate-400 hover:text-red-500 transition-colors shrink-0"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => receiptInputRef.current?.click()}
                  disabled={uploadingReceipt}
                  className="flex items-center gap-2 text-sm text-slate-600 hover:text-blue-600 transition-colors"
                >
                  <Paperclip className="h-4 w-4" />
                  <span>Attach receipt (optional)</span>
                  <span className="text-xs text-slate-400">— JPG, PNG, PDF up to 5MB</span>
                </button>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-slate-100">
              <Button variant="secondary" onClick={() => { setShowForm(false); resetForm(); }}>Cancel</Button>
              <Button
                variant="primary"
                iconLeft={<Receipt className="h-4 w-4" />}
                onClick={handleSubmitClick}
                disabled={!formData.title || !formData.amount || !formData.description || !formData.expense_date || uploadingReceipt}
              >
                Submit Claim
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Success State */}
        {showForm && showSuccess && (
          <SurfaceCard className="p-8 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <CheckCircle className="h-7 w-7 text-emerald-600" />
            </div>
            <h3 className="text-lg font-semibold text-slate-900 mb-1">Claim Submitted Successfully</h3>
            <p className="text-sm text-slate-500 mb-6">
              Your expense claim has been submitted and is awaiting approval.
              {lastCreatedId && <span className="block text-xs text-slate-400 mt-1">Claim #{lastCreatedId}</span>}
            </p>
            <div className="flex items-center justify-center gap-3">
              <Button
                variant="secondary"
                onClick={() => { resetForm(); setShowSuccess(false); }}
                iconLeft={<Plus className="h-4 w-4" />}
              >
                Submit Another
              </Button>
              <Button
                variant="primary"
                onClick={() => { setShowForm(false); setShowSuccess(false); resetForm(); setActiveTab('my_submissions'); }}
              >
                View My Claims
              </Button>
            </div>
          </SurfaceCard>
        )}

        {/* Confirmation Modal */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <SurfaceCard className="w-full max-w-md p-6">
              <h3 className="text-lg font-semibold text-slate-900 mb-1">Confirm Submission</h3>
              <p className="text-sm text-slate-500 mb-4">Please review your expense claim before submitting.</p>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-slate-500">Category</span>
                  <span className="font-medium text-slate-900">{CATEGORIES.find(c => c.value === formData.category)?.label}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Amount</span>
                  <span className="font-medium text-slate-900">{fmt(parseFloat(formData.amount) || 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Date of Expense</span>
                  <span className="font-medium text-slate-900">{formData.expense_date}</span>
                </div>
                {formData.title && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Title</span>
                    <span className="font-medium text-slate-900 text-right max-w-[200px] truncate">{formData.title}</span>
                  </div>
                )}
                {formData.merchant_name && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Merchant</span>
                    <span className="font-medium text-slate-900">{formData.merchant_name}</span>
                  </div>
                )}
                <div className="flex justify-between items-start">
                  <span className="text-slate-500">Description</span>
                  <span className="font-medium text-slate-900 text-right max-w-[240px]">{formData.description}</span>
                </div>
                {formData.receipt_url && (
                  <div className="flex justify-between">
                    <span className="text-slate-500">Receipt</span>
                    <span className="font-medium text-emerald-600 flex items-center gap-1">
                      <Paperclip className="h-3 w-3" /> Attached
                    </span>
                  </div>
                )}
              </div>

              {submitError && (
                <div className="flex items-center gap-2 p-3 mb-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{submitError}</span>
                </div>
              )}
              <div className="flex justify-end gap-2 mt-6">
                <Button variant="secondary" onClick={() => { setShowConfirm(false); setSubmitError(''); }}>Edit</Button>
                <Button
                  variant="primary"
                  iconLeft={<CheckCircle className="h-4 w-4" />}
                  onClick={handleConfirmSubmit}
                  disabled={createMutation.isPending}
                >
                  {createMutation.isPending ? 'Submitting...' : 'Confirm & Submit'}
                </Button>
              </div>
            </SurfaceCard>
          </div>
        )}

        {/* Table */}
        <SurfaceCard className="overflow-hidden">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
            </div>
          ) : filteredData.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-500">
                {activeTab === 'inbox'
                  ? 'No pending reimbursements in inbox'
                  : activeTab === 'my_submissions'
                    ? 'No reimbursement claims yet. Click "Submit Claim" to get started.'
                    : 'No reimbursements found'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50">
                    {activeTab === 'inbox' && (
                      <th className="w-10 px-3 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          checked={filteredData.length > 0 && filteredData.every((r: any) => selectedIds.includes(r.id))}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedIds(filteredData.map((r: any) => r.id));
                            } else {
                              setSelectedIds([]);
                            }
                          }}
                        />
                      </th>
                    )}
                    {activeTab !== 'my_submissions' && (
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Title</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Category</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Amount</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Expense Date</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Submitted</th>
                    {activeTab === 'inbox' && isStrictAdmin && (
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Manager</th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredData.map((reim: any) => (
                    <tr key={reim.id} className="hover:bg-slate-50">
                      {activeTab === 'inbox' && (
                        <td className="px-3 py-3">
                          <input
                            type="checkbox"
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            checked={selectedIds.includes(reim.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedIds([...selectedIds, reim.id]);
                              } else {
                                setSelectedIds(selectedIds.filter((id) => id !== reim.id));
                              }
                            }}
                          />
                        </td>
                      )}
                      {activeTab !== 'my_submissions' && (
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-900">{reim.employee?.name || 'Unknown'}</div>
                          <div className="text-xs text-slate-500">{reim.employee?.email || ''}</div>
                        </td>
                      )}
                      <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate">
                        {reim.title || reim.description || '-'}
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                          {CATEGORIES.find(c => c.value === reim.category)?.label || reim.category || 'Other'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{fmt(reim.amount)}</td>
                      <td className="px-4 py-3 text-slate-600">{reim.expense_date || '-'}</td>
                      <td className="px-4 py-3 text-slate-600 text-xs">{reim.created_at ? String(reim.created_at).slice(0, 10) : '-'}</td>
                      {activeTab === 'inbox' && isStrictAdmin && (
                        <td className="px-4 py-3 text-slate-600 text-xs">
                          {reim.managerApprover?.name || '-'}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${APPROVAL_LEVEL_CLASSES[reim.approval_level] || 'bg-slate-50 text-slate-700'}`}>
                          {APPROVAL_LEVEL_LABELS[reim.approval_level] || reim.approval_level}
                        </span>
                        {reim.rejection_reason && (
                          <p className="text-xs text-rose-500 mt-1 max-w-[150px] truncate" title={reim.rejection_reason}>
                            {reim.rejection_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-1 justify-end">
                          <Button
                            variant="ghost"
                            size="sm"
                            iconLeft={<FileText className="h-3.5 w-3.5 text-slate-500" />}
                            onClick={() => setSelectedClaimId(reim.id)}
                          >
                            View
                          </Button>
                          {/* Manager approve/reject for pending_manager */}
                          {activeTab === 'inbox' && isManager && reim.approval_level === 'pending_manager' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3.5 w-3.5 text-emerald-600" />}
                                onClick={() => managerApproveMutation.mutate(reim.id)}
                                disabled={managerApproveMutation.isPending}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3.5 w-3.5 text-rose-600" />}
                                onClick={() => setRejectingId(reim.id)}
                                disabled={managerRejectMutation.isPending}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {/* Admin final approve/reject for pending_admin */}
                          {activeTab === 'inbox' && isStrictAdmin && reim.approval_level === 'pending_admin' && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<CheckCircle className="h-3.5 w-3.5 text-emerald-600" />}
                                onClick={() => adminApproveMutation.mutate(reim.id)}
                                disabled={adminApproveMutation.isPending}
                              >
                                Final Approve
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                iconLeft={<XCircle className="h-3.5 w-3.5 text-rose-600" />}
                                onClick={() => setRejectingId(reim.id)}
                                disabled={adminRejectMutation.isPending}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {/* Mark Paid action for approved-but-unpaid claims */}
                          {activeTab === 'pending_payments' && isStrictAdmin && (
                            <Button
                              variant="ghost"
                              size="sm"
                              iconLeft={<CheckCircle className="h-3.5 w-3.5 text-violet-600" />}
                              onClick={() => { setPayingId(reim.id); setPayoutMode('payroll'); setPaymentReference(''); }}
                            >
                              Mark Paid
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
      </div>

      {/* Reject Reason Modal */}
      {rejectingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <SurfaceCard className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">
              {rejectingId === -1 ? `Reject ${selectedIds.length} Claim(s)` : 'Reject Reimbursement'}
            </h3>
            <p className="text-sm text-slate-500 mb-4">Provide a reason for rejecting this claim.</p>
            <TextareaInput
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Reason for rejection..."
              rows={3}
            />
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="secondary" onClick={() => { setRejectingId(null); setRejectReason(''); }}>
                Cancel
              </Button>
              <Button
                variant="danger"
                iconLeft={<XCircle className="h-4 w-4" />}
                onClick={() => {
                  if (!rejectReason.trim()) return;
                  if (rejectingId === -1) {
                    // Bulk reject mode
                    bulkRejectMutation.mutate(rejectReason);
                  } else if (activeTab === 'inbox' && isManager) {
                    managerRejectMutation.mutate({ id: rejectingId, reason: rejectReason });
                  } else {
                    adminRejectMutation.mutate({ id: rejectingId, reason: rejectReason });
                  }
                }}
                disabled={!rejectReason.trim() || bulkRejectMutation.isPending}
              >
                {bulkRejectMutation.isPending ? 'Rejecting…' : 'Reject'}
              </Button>
            </div>
          </SurfaceCard>
        </div>
      )}

      {/* Claim Detail Modal */}
      {selectedClaimId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <SurfaceCard className="w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-900">Claim Details</h3>
              <button onClick={() => setSelectedClaimId(null)} className="text-slate-400 hover:text-slate-600">
                <X className="h-5 w-5" />
              </button>
            </div>

            {claimDetailLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
              </div>
            ) : claimDetailData ? (
              <div className="space-y-5">
                {/* Claim Info */}
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Title</span>
                    <span className="font-medium text-slate-900 text-right max-w-[280px]">{claimDetailData.title || claimDetailData.description}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Category</span>
                    <span className="font-medium text-slate-900">{CATEGORIES.find(c => c.value === claimDetailData.category)?.label || claimDetailData.category || 'Other'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Amount</span>
                    <span className="font-medium text-slate-900">{fmt(claimDetailData.amount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Expense Date</span>
                    <span className="font-medium text-slate-900">{claimDetailData.expense_date || '-'}</span>
                  </div>
                  {claimDetailData.merchant_name && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Merchant</span>
                      <span className="font-medium text-slate-900">{claimDetailData.merchant_name}</span>
                    </div>
                  )}
                  {claimDetailData.location && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Location</span>
                      <span className="font-medium text-slate-900">{claimDetailData.location}</span>
                    </div>
                  )}
                  <div className="flex justify-between items-start">
                    <span className="text-slate-500">Description</span>
                    <span className="font-medium text-slate-900 text-right max-w-[280px]">{claimDetailData.description}</span>
                  </div>
                  {claimDetailData.receipt_url && (
                    <div className="flex justify-between">
                      <span className="text-slate-500">Receipt</span>
                      <a
                        href={claimDetailData.receipt_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-emerald-600 hover:underline flex items-center gap-1"
                      >
                        <Paperclip className="h-3 w-3" /> View Receipt
                      </a>
                    </div>
                  )}
                </div>

                <div className="border-t border-slate-100" />

                {/* Approval Timeline */}
                <div>
                  <h4 className="text-sm font-semibold text-slate-900 mb-3">Approval Timeline</h4>
                  <div className="space-y-0">
                    {/* Step 1: Submitted */}
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                          <Check className="h-3.5 w-3.5 text-blue-600" />
                        </div>
                        <div className="w-px flex-1 bg-slate-200 my-1" />
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium text-slate-900">Submitted</p>
                        <p className="text-xs text-slate-500">
                          by {claimDetailData.submitter?.name || claimDetailData.employee?.name || 'Employee'}
                        </p>
                        {claimDetailData.created_at && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {new Date(claimDetailData.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Step 2: Manager Review */}
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        {claimDetailData.manager_approved_by ? (
                          <>
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                              claimDetailData.approval_level === 'rejected'
                                ? 'bg-rose-100'
                                : 'bg-emerald-100'
                            }`}>
                              {claimDetailData.approval_level === 'rejected' ? (
                                <XCircle className="h-3.5 w-3.5 text-rose-600" />
                              ) : (
                                <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                              )}
                            </div>
                            <div className="w-px flex-1 bg-slate-200 my-1" />
                          </>
                        ) : (
                          <>
                            <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                              <Clock className="h-3.5 w-3.5 text-slate-400" />
                            </div>
                            <div className="w-px flex-1 bg-slate-200 my-1" />
                          </>
                        )}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium text-slate-900">
                          {claimDetailData.manager_approved_by
                            ? (claimDetailData.approval_level === 'rejected' && !claimDetailData.approved_by
                              ? 'Rejected by Manager'
                              : 'Manager Approved')
                            : 'Manager Review'}
                        </p>
                        {claimDetailData.managerApprover?.name && (
                          <p className="text-xs text-slate-500">by {claimDetailData.managerApprover.name}</p>
                        )}
                        {claimDetailData.manager_approved_at && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {new Date(claimDetailData.manager_approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                        {!claimDetailData.manager_approved_by && claimDetailData.approval_level === 'pending_manager' && (
                          <p className="text-xs text-amber-500 mt-0.5">Awaiting manager approval</p>
                        )}
                      </div>
                    </div>

                    {/* Step 3: Admin Review */}
                    <div className="flex gap-3">
                      <div className="flex flex-col items-center">
                        {claimDetailData.approved_by ? (
                          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                            claimDetailData.approval_level === 'rejected'
                              ? 'bg-rose-100'
                              : 'bg-emerald-100'
                          }`}>
                            {claimDetailData.approval_level === 'rejected' ? (
                              <XCircle className="h-3.5 w-3.5 text-rose-600" />
                            ) : (
                              <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                            )}
                          </div>
                        ) : (
                          <div className="w-7 h-7 rounded-full bg-slate-100 flex items-center justify-center shrink-0">
                            <Clock className="h-3.5 w-3.5 text-slate-400" />
                          </div>
                        )}
                      </div>
                      <div className="pb-2">
                        <p className="text-sm font-medium text-slate-900">
                          {claimDetailData.approved_by
                            ? (claimDetailData.approval_level === 'rejected'
                              ? 'Rejected by Admin'
                              : 'Admin Approved')
                            : 'Admin Review'}
                        </p>
                        {claimDetailData.approver?.name && (
                          <p className="text-xs text-slate-500">by {claimDetailData.approver.name}</p>
                        )}
                        {claimDetailData.approved_at && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {new Date(claimDetailData.approved_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                        )}
                        {!claimDetailData.approved_by && claimDetailData.approval_level === 'pending_admin' && (
                          <p className="text-xs text-amber-500 mt-0.5">Awaiting admin approval</p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rejection Reason */}
                {claimDetailData.rejection_reason && (
                  <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg">
                    <p className="text-xs font-semibold text-rose-700 mb-1">Rejection Reason</p>
                    <p className="text-sm text-rose-600">{claimDetailData.rejection_reason}</p>
                  </div>
                )}

                {/* Payment status / Mark Paid (admin only, once approved) */}
                {isStrictAdmin && claimDetailData.approval_level === 'approved' && (
                  <div className="mt-4 p-3 bg-violet-50 border border-violet-200 rounded-lg">
                    {claimDetailData.paid_at ? (
                      <div>
                        <p className="text-xs font-semibold text-violet-700 mb-1">Paid</p>
                        <p className="text-sm text-violet-600">
                          {claimDetailData.payout_mode === 'outside_payroll' ? 'Outside Payroll' : 'Via Payroll'}
                          {claimDetailData.payment_reference ? ` · Ref: ${claimDetailData.payment_reference}` : ''}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(claimDetailData.paid_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm text-violet-700">Approved — awaiting payout</p>
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={() => { setPayingId(claimDetailData.id); setPayoutMode('payroll'); setPaymentReference(''); }}
                        >
                          Mark Paid
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : null}
          </SurfaceCard>
        </div>
      )}

      {/* Mark Paid Modal */}
      {payingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <SurfaceCard className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-2">Mark as Paid</h3>
            <p className="text-sm text-slate-500 mb-4">Choose how this approved claim was paid.</p>
            <div className="space-y-4">
              <div>
                <FieldLabel>Payout Mode</FieldLabel>
                <SelectInput value={payoutMode} onChange={(e) => setPayoutMode(e.target.value as 'payroll' | 'outside_payroll')}>
                  <option value="payroll">Via Payroll (added to salary)</option>
                  <option value="outside_payroll">Outside Payroll (bank transfer)</option>
                </SelectInput>
              </div>
              {payoutMode === 'outside_payroll' && (
                <div>
                  <FieldLabel>Payment Reference</FieldLabel>
                  <TextInput
                    value={paymentReference}
                    onChange={(e) => setPaymentReference(e.target.value)}
                    placeholder="UTR / transaction id"
                  />
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="secondary" onClick={() => { setPayingId(null); setPaymentReference(''); }}>
                Cancel
              </Button>
              <Button
                variant="primary"
                iconLeft={<CheckCircle className="h-4 w-4" />}
                onClick={() => markPaidMutation.mutate()}
                disabled={markPaidMutation.isPending}
              >
                {markPaidMutation.isPending ? 'Saving…' : 'Confirm Paid'}
              </Button>
            </div>
          </SurfaceCard>
        </div>
      )}
    </div>
  );
}
