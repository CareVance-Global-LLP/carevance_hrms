import { useState } from 'react';
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
import { useAuth } from '@/contexts/AuthContext';
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
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [selectedLoan, setSelectedLoan] = useState<Loan | null>(null);

  const adminQuery = useQuery({
    queryKey: ['loans-admin', statusFilter],
    queryFn: () => payrollApi.listLoans({ status: statusFilter || undefined }).then(res => res.data),
    enabled: isAdmin,
  });

  const myQuery = useQuery({
    queryKey: ['my-loans'],
    queryFn: () => payrollApi.getMyLoans().then(res => res.data),
    enabled: !isAdmin,
  });

  const activeQuery = isAdmin ? adminQuery : myQuery;
  const adminData = adminQuery.data;
  const myData = myQuery.data;

  const loans: Loan[] = isAdmin ? (adminData?.loans || []) : (myData?.loans || []);
  const activeLoan: Loan | null = isAdmin ? null : (myData?.active_loan || null);
  const colCount = isAdmin ? 7 : 5;

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
    pending: loans.filter(l => l.status === 'pending').length,
    approved: loans.filter(l => l.status === 'approved').length,
    outstanding: loans
      .filter(l => l.status === 'approved')
      .reduce((sum, l) => sum + Number(l.remaining_amount || 0), 0),
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Active Loans"
        description="Salary advances and EMI-based loans — recovered automatically from monthly payroll."
      />

      <div className="space-y-6">
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
                    EMI: {formatPayrollAmount(activeLoan.emi_amount)} / month {'\u00B7'}
                    Remaining: {formatPayrollAmount(activeLoan.remaining_amount)} {'\u00B7'}
                    {activeLoan.paid_installments}/{activeLoan.total_installments} installments paid
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
              <div>
                <FieldLabel>Status</FieldLabel>
                <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="approved">Approved</option>
                  <option value="rejected">Rejected</option>
                  <option value="closed">Closed</option>
                </SelectInput>
              </div>
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
            {/*
              * This used to be `!isAdmin` only, so an admin had no way to raise
              * a loan at all. The endpoint now accepts a user_id from admins,
              * so the modal asks who it is for.
              */}
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
          ) : filteredLoans.length === 0 ? (
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
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {isAdmin && <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Employee</th>}
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Principal</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">EMI</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Outstanding</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Progress</th>
                  <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Status</th>
                  {isAdmin && <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {filteredLoans.map(loan => (
                    <LoanRow
                      key={loan.id}
                      loan={loan}
                      isAdmin={isAdmin}
                      colCount={colCount}
                      onAction={() => {
                        queryClient.invalidateQueries({ queryKey: ['loans-admin'] });
                        queryClient.invalidateQueries({ queryKey: ['my-loans'] });
                      }}
                      onViewSchedule={setSelectedLoan}
                    />
                ))}
              </tbody>
            </table>
          </div>
          )}
        </SurfaceCard>
      </div>

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

      {/* EMI Schedule Modal */}
      {selectedLoan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedLoan(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-900">Repayment Schedule</h3>
              <button className="p-1 text-slate-500 hover:text-slate-600" onClick={() => setSelectedLoan(null)}>
                <span className="sr-only">Close</span>
                ×
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Type</span>
                <span className="font-medium text-slate-900">{titleCase(selectedLoan.loan_type)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Total Amount</span>
                <span className="font-medium text-slate-900">{formatPayrollAmount(selectedLoan.amount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">EMI</span>
                <span className="font-medium text-slate-900">{formatPayrollAmount(selectedLoan.emi_amount)}/mo</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Progress</span>
                <span className="font-medium text-slate-900">{selectedLoan.paid_installments}/{selectedLoan.total_installments}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Remaining</span>
                <span className="font-medium text-slate-900">{formatPayrollAmount(selectedLoan.remaining_amount)}</span>
              </div>
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
            </div>
            <div className="mt-5 flex justify-end">
              <Button variant="secondary" onClick={() => setSelectedLoan(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LoanRow({ loan, isAdmin, colCount, onAction, onViewSchedule }: { loan: Loan; isAdmin: boolean; colCount: number; onAction: () => void; onViewSchedule: (loan: Loan) => void }) {
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
      onAction();
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
      onAction();
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
      onAction();
    } catch (e) {
      show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to close loan.') });
    }
    setPending(null);
    setConfirmClose(false);
  };

  return (
    <>
      <tr className="border-b border-slate-100 hover:bg-slate-50">
        {isAdmin && (
          <td className="p-3">
            <p className="font-medium text-slate-900">{loan.user?.name || 'Unknown'}</p>
            <p className="text-xs text-slate-500">{loan.user?.email}</p>
          </td>
        )}
        <td className="p-3 text-right font-medium">{formatPayrollAmount(loan.amount)}</td>
        <td className="p-3 text-right">{formatPayrollAmount(loan.emi_amount)}</td>
        <td className="p-3 text-right">{formatPayrollAmount(loan.remaining_amount)}</td>
        <td className="p-3">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 rounded-full transition-all"
                style={{
                  width: `${loan.total_installments > 0
                    ? Math.round((loan.paid_installments / loan.total_installments) * 100)
                    : 0}%`
                }}
              />
            </div>
            <span className="text-xs text-slate-500 min-w-[32px]">
              {loan.total_installments > 0
                ? Math.round((loan.paid_installments / loan.total_installments) * 100)
                : 0}%
            </span>
          </div>
        </td>
        <td className="p-3 text-center">
          <StatusBadge tone={payrollStatusTone(loan.status)}>{titleCase(loan.status)}</StatusBadge>
        </td>
        {isAdmin && (
          <td className="p-3">
            <div className="flex items-center gap-2 justify-center">
              {loan.status === 'pending' && (
                <>
                  <button
                    onClick={() => setConfirmApprove(true)}
                    disabled={pending === 'approve'}
                    className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                    title="Approve"
                  >
                    {pending === 'approve' ? <div className="animate-spin h-4 w-4 border-2 border-emerald-600 rounded-full border-t-transparent" /> : <ThumbsUp className="h-4 w-4" />}
                  </button>
                  <button
                    onClick={() => setShowReject(true)}
                    disabled={pending === 'reject'}
                    className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                    title="Reject"
                  >
                    <Ban className="h-4 w-4" />
                  </button>
                </>
              )}
              {loan.status === 'approved' && (
                <button
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-600 hover:bg-slate-100"
                  title="View Schedule"
                  onClick={() => onViewSchedule(loan)}
                >
                  <Eye className="h-4 w-4" />
                </button>
              )}
            </div>
          </td>
        )}
      </tr>
      {loan.rejection_reason && loan.status === 'rejected' && (
        <tr className="bg-rose-50">
          <td colSpan={colCount} className="p-2 px-3 text-xs text-rose-700">
            Reason: {loan.rejection_reason}
          </td>
        </tr>
      )}

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

  const { data: employeesData } = useQuery({
    queryKey: ['payroll-employees'],
    queryFn: () => payrollApi.getEmployees().then(res => res.data ?? []),
    enabled: isAdmin,
  });
  const employees = Array.isArray(employeesData) ? employeesData : [];

  const estimatedInstallments = emiAmount && amount && parseFloat(emiAmount) > 0
    ? Math.ceil(parseFloat(amount) / parseFloat(emiAmount))
    : 0;

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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">
            {isAdmin ? 'Record Advance / Loan' : 'Request Advance / Loan'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            {isAdmin && (
              <div>
                <FieldLabel>Employee</FieldLabel>
                <SelectInput value={borrowerId} onChange={(e) => setBorrowerId(e.target.value)} required>
                  <option value="">Select employee...</option>
                  {employees.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                  ))}
                </SelectInput>
              </div>
            )}

            <div>
              <FieldLabel>Type</FieldLabel>
              <SelectInput value={loanType} onChange={(e) => setLoanType(e.target.value)}>
                {LOAN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </SelectInput>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Amount (₹)</FieldLabel>
                <TextInput type="number" value={amount} onChange={(e) => setAmount(e.target.value)} min="100" required />
              </div>
              <div>
                <FieldLabel>EMI per Month (₹)</FieldLabel>
                <TextInput type="number" value={emiAmount} onChange={(e) => setEmiAmount(e.target.value)} min="100" required />
              </div>
            </div>

            <div>
              <FieldLabel>Number of Installments</FieldLabel>
              <TextInput
                type="number"
                value={totalInstallments}
                onChange={(e) => setTotalInstallments(e.target.value)}
                min="1" max="60"
                required
              />
              {estimatedInstallments > 0 && (
                <p className="text-xs text-slate-500 mt-1">
                  Estimated: {estimatedInstallments} {estimatedInstallments === 1 ? 'installment' : 'installments'} of {formatPayrollAmount(parseFloat(emiAmount))}
                </p>
              )}
            </div>

            <div>
              <FieldLabel>Purpose (optional)</FieldLabel>
              <TextareaInput value={purpose} onChange={(e) => setPurpose(e.target.value)} rows={2} placeholder="Brief reason for the request" />
            </div>

            <div className="flex items-center justify-end gap-3 pt-2">
              <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={submitting}>
                {submitting ? 'Submitting...' : 'Submit Request'}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
