import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, IndianRupee, Ban, ThumbsUp, Eye, Search } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel, TextareaInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';
import { useToast } from '@/components/ui/Toast';
import RejectReasonModal from '@/components/ui/RejectReasonModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import Modal from '@/components/ui/dialog/Modal';
import SlideOver from '@/components/ui/dialog/SlideOver';
import PayrollDataTable, { type PayrollDataTableColumn } from '@/components/payroll/PayrollDataTable';
import StatusFilter from '@/components/payroll/StatusFilter';
import EmployeePicker from '@/components/payroll/EmployeePicker';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { payrollStatusTone, titleCase } from '@/utils/payrollStatus';

const LOAN_TYPES = [
  { value: 'advance', label: 'Salary Advance' },
  { value: 'loan', label: 'Loan' },
];

interface Loan {
  id: number;
  user_id: number;
  loan_type: 'advance' | 'loan';
  amount: number;
  emi_amount: number;
  total_installments: number;
  paid_installments: number;
  remaining_amount: number;
  purpose: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'closed';
  rejection_reason: string | null;
  created_at: string;
  user?: { id: number; name: string; email: string };
}

export default function LoansPage() {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const { user } = useAuth();
  // Was `user?.role === 'admin' || user?.role === 'super_admin'`, which
  // silently downgraded HR and payroll_manager to "request only" — even
  // though PayrollAdminRoute permits them. Use the same gate the rest of
  // the payroll module uses.
  const isAdmin = hasStrictAdminAccess(user);
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);

  const adminQuery = useQuery({
    queryKey: ['loans-admin', statusFilter],
    queryFn: () => payrollApi.listLoans({ status: statusFilter || undefined }).then((res) => res.data),
    enabled: isAdmin,
  });

  const myQuery = useQuery({
    queryKey: ['my-loans'],
    queryFn: () => payrollApi.getMyLoans().then((res) => res.data),
    enabled: !isAdmin,
  });

  const activeQuery = isAdmin ? adminQuery : myQuery;
  const adminData = adminQuery.data;
  const myData = myQuery.data;

  const loans: Loan[] = isAdmin ? (adminData?.loans || []) : (myData?.loans || []);
  const activeLoan: Loan | null = isAdmin ? null : (myData?.active_loan || null);

  const filteredLoans = loans.filter((l) => {
    if (!search) return true;
    const needle = search.toLowerCase();
    return (
      (l.user?.name ?? '').toLowerCase().includes(needle) ||
      (l.purpose ?? '').toLowerCase().includes(needle)
    );
  });

  const stats = {
    total: loans.length,
    pending: loans.filter((l) => l.status === 'pending').length,
    approved: loans.filter((l) => l.status === 'approved').length,
    outstanding: loans
      .filter((l) => l.status === 'approved')
      .reduce((sum, l) => sum + Number(l.remaining_amount || 0), 0),
  };

  const columns: PayrollDataTableColumn<Loan>[] = [
    ...(isAdmin ? [{
      key: 'employee',
      header: 'Employee',
      render: (l: Loan) => (
        <div>
          <p className="font-medium text-slate-900">{l.user?.name || 'Unknown'}</p>
          <p className="text-xs text-slate-500">{l.user?.email}</p>
        </div>
      ),
    } as PayrollDataTableColumn<Loan>] : []),
    {
      key: 'principal',
      header: 'Principal',
      align: 'right',
      render: (l) => <span className="font-medium">{formatPayrollAmount(l.amount)}</span>,
    },
    {
      key: 'emi',
      header: 'EMI',
      align: 'right',
      render: (l) => formatPayrollAmount(l.emi_amount),
    },
    {
      key: 'outstanding',
      header: 'Outstanding',
      align: 'right',
      render: (l) => formatPayrollAmount(l.remaining_amount),
    },
    {
      key: 'progress',
      header: 'Progress',
      align: 'center',
      render: (l) => {
        const pct = l.total_installments > 0
          ? Math.round((l.paid_installments / l.total_installments) * 100)
          : 0;
        return (
          <div className="flex items-center gap-2 min-w-[120px]">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-xs text-slate-500 min-w-[32px]">{pct}%</span>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: 'Status',
      align: 'center',
      render: (l) => <StatusBadge tone={payrollStatusTone(l.status)}>{titleCase(l.status)}</StatusBadge>,
    },
    ...(isAdmin ? [{
      key: 'actions',
      header: 'Actions',
      align: 'center' as const,
      render: (l: Loan) => (
        <div className="flex items-center gap-2 justify-center">
          {l.status === 'pending' && (
            <LoanAdminActions loan={l} onChanged={() => {
              queryClient.invalidateQueries({ queryKey: ['loans-admin'] });
              queryClient.invalidateQueries({ queryKey: ['my-loans'] });
            }} />
          )}
          {l.status === 'approved' && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelectedLoan(l)}
              title="View Schedule"
            >
              <Eye className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    } as PayrollDataTableColumn<Loan>] : []),
  ];

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Active Loans"
        description="Salary advances and EMI-based loans — recovered automatically from monthly payroll."
      />

      <HowItWorksCard
        whatIsThis="Money given to an employee in advance of salary, or as a formal loan with monthly EMI deductions from payroll."
        whenToUse={[
          'Salary advance — employee needs a portion of next month\'s salary early',
          'Personal loan — formal loan with EMI schedule (3–24 months typical)',
          'Emergency loan — one-time recovery in next payroll',
        ]}
        howItFlows={[
          { step: 1, label: 'Employee requests', desc: 'Loan type, amount, reason, and recovery schedule' },
          { step: 2, label: 'Manager / HR approves', desc: 'One-click approve, reject, or send back for edits' },
          { step: 3, label: 'Disbursed', desc: 'Amount credited in next payroll run (advance) or via separate payment' },
          { step: 4, label: 'EMI recovered', desc: 'Deducted automatically from Gross every month until cleared' },
        ]}
        commonMistakes={[
          'Setting EMI amount that exceeds 40–50% of take-home (employee won\'t be able to repay)',
          'Forgetting to mark loan as closed when fully recovered',
          'Approving loan without checking existing outstanding loans',
        ]}
      />

      {activeLoan && (
        <SurfaceCard className="p-5 border-l-4 border-l-blue-500">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-4">
              <div className="p-2 bg-blue-100 rounded-lg">
                <IndianRupee className="h-6 w-6 text-blue-700" />
              </div>
              <div>
                <p className="font-semibold text-slate-900">
                  Active {activeLoan.loan_type === 'advance' ? 'Advance' : 'Loan'}
                </p>
                <p className="text-sm text-slate-500">
                  EMI: {formatPayrollAmount(activeLoan.emi_amount)} / month · Remaining: {formatPayrollAmount(activeLoan.remaining_amount)} · {activeLoan.paid_installments}/{activeLoan.total_installments} installments paid
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-right">
                <p className="text-xs text-slate-500">Progress</p>
                <p className="text-lg font-bold text-blue-700">
                  {activeLoan.total_installments > 0
                    ? Math.round((activeLoan.paid_installments / activeLoan.total_installments) * 100)
                    : 0}%
                </p>
              </div>
            </div>
          </div>
        </SurfaceCard>
      )}

      <FilterPanel>
        <div className="flex flex-wrap items-end gap-4">
          {isAdmin && (
            <StatusFilter namespace="loans" value={statusFilter} onChange={setStatusFilter} />
          )}
          <div className="flex-1 min-w-[200px]">
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
              <TextInput
                placeholder={isAdmin ? 'Search employee, purpose...' : 'Search purpose...'}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Button variant="primary" size="sm" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowRequestModal(true)}>
            {isAdmin ? 'Record Advance / Loan' : 'Request Advance / Loan'}
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Total" value={stats.total} accent="sky" icon={IndianRupee} />
        <MetricCard label="Pending" value={stats.pending} accent="amber" />
        <MetricCard label="Approved" value={stats.approved} accent="emerald" />
        <MetricCard
          label="Outstanding"
          value={formatPayrollAmount(stats.outstanding, { compact: true })}
          accent="violet"
        />
      </div>

      <SurfaceCard className="overflow-hidden">
        {activeQuery.isLoading ? (
          <PageLoadingState label="Loading loans…" />
        ) : activeQuery.isError ? (
          <PageErrorState
            message={getApiErrorMessage(activeQuery.error, "Couldn't load loans.")}
            onRetry={() => activeQuery.refetch()}
          />
        ) : (
          <PayrollDataTable
            columns={columns}
            rows={filteredLoans}
            rowKey={(l) => l.id}
            emptyState={
              <PageEmptyState
                title={loans.length === 0 ? 'No loan requests found' : 'No matching loans'}
                description={
                  loans.length === 0
                    ? isAdmin
                      ? 'No employee has an advance or loan on record yet.'
                      : 'You have no advances or loans. Use the button above to request one.'
                    : 'No loan matches your filters. Clear them to see all.'
                }
              />
            }
            ariaLabel="Loans"
          />
        )}
      </SurfaceCard>

      {showRequestModal && (
        <LoanRequestModal
          isAdmin={isAdmin}
          onClose={() => setShowRequestModal(false)}
          onSuccess={(msg) => {
            show({ kind: 'success', message: msg });
            setShowRequestModal(false);
            queryClient.invalidateQueries({ queryKey: ['my-loans'] });
            queryClient.invalidateQueries({ queryKey: ['loans-admin'] });
          }}
        />
      )}

      <SlideOver
        open={!!selectedLoan}
        onClose={() => setSelectedLoan(null)}
        title="Repayment Schedule"
        widthClassName="max-w-md"
      >
        {selectedLoan ? (
          <div className="space-y-4">
            <DetailRow label="Type" value={titleCase(selectedLoan.loan_type)} />
            <DetailRow label="Total Amount" value={formatPayrollAmount(selectedLoan.amount)} />
            <DetailRow label="EMI" value={`${formatPayrollAmount(selectedLoan.emi_amount)}/mo`} />
            <DetailRow label="Progress" value={`${selectedLoan.paid_installments}/${selectedLoan.total_installments}`} />
            <DetailRow label="Remaining" value={formatPayrollAmount(selectedLoan.remaining_amount)} />
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Installments paid</span>
                <span>{Math.round((selectedLoan.paid_installments / selectedLoan.total_installments) * 100)}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (selectedLoan.paid_installments / selectedLoan.total_installments) * 100)}%` }}
                />
              </div>
            </div>
            {selectedLoan.rejection_reason && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
                Rejection reason: {selectedLoan.rejection_reason}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={() => setSelectedLoan(null)}>Close</Button>
            </div>
          </div>
        ) : null}
      </SlideOver>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}

function LoanAdminActions({ loan, onChanged }: { loan: Loan; onChanged: () => void }) {
  const { show } = useToast();
  const [confirmApprove, setConfirmApprove] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [showReject, setShowReject] = useState(false);
  const [pending, setPending] = useState<null | 'approve' | 'reject' | 'close'>(null);

  const doApprove = async () => {
    setPending('approve');
    try {
      await payrollApi.approveLoan(loan.id);
      show({ kind: 'success', message: 'Loan approved.' });
      onChanged();
    } catch (e) {
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to approve loan.') });
    }
    setPending(null);
    setConfirmApprove(false);
  };

  const doReject = async (reason: string) => {
    setPending('reject');
    try {
      await payrollApi.rejectLoan(loan.id, reason);
      show({ kind: 'success', message: 'Loan rejected.' });
      onChanged();
    } catch (e) {
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to reject loan.') });
    }
    setPending(null);
    setShowReject(false);
  };

  const doClose = async () => {
    setPending('close');
    try {
      await payrollApi.closeLoan(loan.id);
      show({ kind: 'success', message: 'Loan closed.' });
      onChanged();
    } catch (e) {
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to close loan.') });
    }
    setPending(null);
    setConfirmClose(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setConfirmApprove(true)}
        disabled={pending === 'approve'}
        iconLeft={<ThumbsUp className="h-4 w-4 text-emerald-600" />}
        title="Approve"
      />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setShowReject(true)}
        disabled={pending === 'reject'}
        iconLeft={<Ban className="h-4 w-4 text-rose-600" />}
        title="Reject"
      />
      <RejectReasonModal
        isOpen={showReject}
        title="Reject loan request"
        description={loan.user?.name ? `Provide a reason for rejecting the loan request for ${loan.user.name}.` : 'Provide a reason for rejecting this loan request.'}
        onSubmit={doReject}
        onClose={() => !pending && setShowReject(false)}
        isLoading={pending === 'reject'}
      />
      <ConfirmDialog
        isOpen={confirmApprove}
        title="Approve loan request"
        message={loan.user?.name ? `Approve the loan request for ${loan.user.name}?` : 'Approve this loan request?'}
        confirmLabel="Approve"
        onConfirm={doApprove}
        onClose={() => !pending && setConfirmApprove(false)}
        isLoading={pending === 'approve'}
      />
      <ConfirmDialog
        isOpen={confirmClose}
        title="Close loan"
        message={loan.user?.name ? `Mark ${loan.user.name}'s loan as fully recovered and close it?` : 'Mark this loan as fully recovered and close it?'}
        confirmLabel="Close"
        onConfirm={doClose}
        onClose={() => !pending && setConfirmClose(false)}
        isLoading={pending === 'close'}
      />
    </>
  );
}

function LoanRequestModal({ isAdmin, onClose, onSuccess }: { isAdmin: boolean; onClose: () => void; onSuccess: (msg: string) => void }) {
  const { show } = useToast();
  const [borrowerId, setBorrowerId] = useState('');
  const [loanType, setLoanType] = useState('advance');
  const [amount, setAmount] = useState('');
  const [emiAmount, setEmiAmount] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('1');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);

  /*
   * Amount, EMI and instalments are three views of one schedule.
   *
   * They used to be three independent text boxes, so a ₹40,000 loan could be
   * submitted as ₹6,000 over four instalments — ₹16,000 short — and nothing
   * objected. Editing any one now recomputes the others, and `lastEdited` stops
   * EMI and instalments overwriting each other in a loop: whichever the person
   * touched most recently is the one held fixed when the amount changes.
   *
   * The maths mirrors backend LoanSchedule exactly, and the server derives the
   * stored schedule itself rather than trusting these numbers.
   */
  const lastEdited = useRef<'emi' | 'installments'>('emi');

  const parseAmount = (v: string) => {
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  const recomputeFromEmi = (amt: number, emi: number) => {
    if (amt <= 0 || emi <= 0) return;
    setTotalInstallments(String(Math.max(1, Math.ceil(amt / emi))));
  };

  const recomputeFromInstallments = (amt: number, count: number) => {
    if (amt <= 0 || count <= 0) return;
    // Round UP to the paisa, or a residue turns an n-month loan into n+1.
    setEmiAmount(String(Math.ceil((amt / count) * 100) / 100));
  };

  const handleAmountChange = (value: string) => {
    setAmount(value);
    const amt = parseAmount(value);
    if (lastEdited.current === 'installments') {
      recomputeFromInstallments(amt, parseInt(totalInstallments, 10) || 0);
    } else {
      recomputeFromEmi(amt, parseAmount(emiAmount));
    }
  };

  const handleEmiChange = (value: string) => {
    lastEdited.current = 'emi';
    setEmiAmount(value);
    recomputeFromEmi(parseAmount(amount), parseAmount(value));
  };

  const handleInstallmentsChange = (value: string) => {
    lastEdited.current = 'installments';
    setTotalInstallments(value);
    recomputeFromInstallments(parseAmount(amount), parseInt(value, 10) || 0);
  };

  const schedule = (() => {
    const amt = parseAmount(amount);
    const emi = parseAmount(emiAmount);
    if (amt <= 0 || emi <= 0) return null;

    const count = Math.max(1, Math.ceil(amt / emi));
    const tail = Math.round((amt - emi * (count - 1)) * 100) / 100;
    const finalPayment = tail > 0 ? Math.min(tail, emi) : Math.min(amt, emi);

    return { count, emi, finalPayment, hasSmallerFinal: count > 1 && finalPayment < emi };
  })();

  // Borrowing headroom, so the limit is visible before the request is refused.
  const { data: eligibility } = useQuery({
    queryKey: ['payroll', 'loan-eligibility'],
    queryFn: () => payrollApi.getLoanEligibility().then((r) => r.data.eligibility),
    enabled: !isAdmin,
  });

  const overLimit = Boolean(
    eligibility?.has_salary &&
      parseAmount(emiAmount) > 0 &&
      parseAmount(emiAmount) > eligibility.max_emi
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !emiAmount || !totalInstallments) return;
    if (isAdmin && !borrowerId) return;
    setSubmitting(true);
    try {
      await payrollApi.requestLoan({
        loan_type: loanType,
        amount: parseFloat(amount),
        emi_amount: parseFloat(emiAmount),
        total_installments: parseInt(totalInstallments),
        purpose: purpose || undefined,
        // Ignored by the API for non-admins, who can only borrow for themselves.
        user_id: isAdmin && borrowerId ? parseInt(borrowerId) : undefined,
      });
      onSuccess('Loan request submitted for approval!');
    } catch (e: any) {
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to submit loan request.') });
    }
    setSubmitting(false);
  };

  return (
    <Modal
      open
      onClose={() => !submitting && onClose()}
      title={isAdmin ? 'Record Advance / Loan' : 'Request Advance / Loan'}
      size="lg"
      busy={submitting}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={(e) => handleSubmit(e as unknown as React.FormEvent)}
            disabled={submitting || !amount || !emiAmount || !totalInstallments || (isAdmin && !borrowerId)}
            loading={submitting}
          >
            Submit Request
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4 p-5">
        {isAdmin && (
          <EmployeePicker
            label="Employee"
            value={borrowerId}
            onChange={setBorrowerId}
            emptyLabel="Select employee…"
            required
          />
        )}

        <div>
          <FieldLabel>Type</FieldLabel>
          <SelectInput value={loanType} onChange={(e) => setLoanType(e.target.value)}>
            {LOAN_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </SelectInput>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>Amount (₹)</FieldLabel>
            <TextInput type="number" value={amount} onChange={(e) => handleAmountChange(e.target.value)} min="100" required />
          </div>
          <div>
            <FieldLabel>EMI per Month (₹)</FieldLabel>
            <TextInput type="number" value={emiAmount} onChange={(e) => handleEmiChange(e.target.value)} min="100" required />
          </div>
        </div>

        <div>
          <FieldLabel>Number of Installments</FieldLabel>
          <TextInput
            type="number"
            value={totalInstallments}
            onChange={(e) => handleInstallmentsChange(e.target.value)}
            min="1" max="60"
            required
          />
          {schedule && (
            <p className="text-xs text-slate-500 mt-1">
              {schedule.hasSmallerFinal ? (
                <>
                  {schedule.count} installments — {schedule.count - 1} ×{' '}
                  {formatPayrollAmount(schedule.emi)} then{' '}
                  {formatPayrollAmount(schedule.finalPayment)}
                </>
              ) : (
                <>
                  {schedule.count} {schedule.count === 1 ? 'installment' : 'installments'} of{' '}
                  {formatPayrollAmount(schedule.emi)}
                </>
              )}
            </p>
          )}
        </div>

        <div>
          <FieldLabel>Purpose (optional)</FieldLabel>
          <TextareaInput value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="Brief reason for the request" />
        </div>
      </form>
    </Modal>
  );
}
