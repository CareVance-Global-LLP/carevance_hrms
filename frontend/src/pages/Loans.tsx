import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Plus, CheckCircle, XCircle, Clock,
  IndianRupee, BadgeCheck, Ban, ThumbsUp
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel, TextareaInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';
import { useAuth } from '@/contexts/AuthContext';

function formatCurrency(amount: number): string {
  return '\u20B9' + amount.toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const { data: adminData } = useQuery({
    queryKey: ['loans-admin', statusFilter],
    queryFn: () => payrollApi.listLoans({ status: statusFilter || undefined }).then(res => res.data),
    enabled: isAdmin,
  });

  const { data: myData } = useQuery({
    queryKey: ['my-loans'],
    queryFn: () => payrollApi.getMyLoans().then(res => res.data),
    enabled: !isAdmin,
  });

  const loans: Loan[] = isAdmin ? (adminData?.loans || []) : (myData?.loans || []);
  const activeLoan: Loan | null = isAdmin ? null : (myData?.active_loan || null);
  const colCount = isAdmin ? 9 : 7;

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Loan & Advances" description="Request and manage salary advances and loans" />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle className="h-5 w-5 text-emerald-600" />
            <p className="text-sm text-emerald-800">{successMessage}</p>
          </div>
        )}

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
                    EMI: {formatCurrency(activeLoan.emi_amount)} / month {'\u00B7'}
                    Remaining: {formatCurrency(activeLoan.remaining_amount)} {'\u00B7'}
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

        <div className="flex items-center justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            {isAdmin && (
              <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="closed">Closed</option>
              </SelectInput>
            )}
          </div>
          {!isAdmin && (
            <Button variant="primary" iconLeft={<Plus className="h-4 w-4" />} onClick={() => setShowRequestModal(true)}>
              Request Advance / Loan
            </Button>
          )}
        </div>

        <SurfaceCard>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  {isAdmin && <th className="text-left p-3 font-medium text-slate-600">Employee</th>}
                  <th className="text-left p-3 font-medium text-slate-600">Type</th>
                  <th className="text-right p-3 font-medium text-slate-600">Amount</th>
                  <th className="text-right p-3 font-medium text-slate-600">EMI</th>
                  <th className="text-center p-3 font-medium text-slate-600">Installments</th>
                  <th className="text-right p-3 font-medium text-slate-600">Remaining</th>
                  <th className="text-center p-3 font-medium text-slate-600">Status</th>
                  <th className="text-left p-3 font-medium text-slate-600">Date</th>
                  {isAdmin && <th className="text-center p-3 font-medium text-slate-600">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {loans.length === 0 ? (
                  <tr><td colSpan={colCount} className="p-8 text-center text-slate-500">No loan requests found</td></tr>
                ) : (
                  loans.map(loan => (
                    <LoanRow
                      key={loan.id}
                      loan={loan}
                      isAdmin={isAdmin}
                      colCount={colCount}
                      onAction={() => {
                        queryClient.invalidateQueries({ queryKey: ['loans-admin'] });
                        queryClient.invalidateQueries({ queryKey: ['my-loans'] });
                      }}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </SurfaceCard>
      </div>

      {showRequestModal && (
        <LoanRequestModal
          onClose={() => setShowRequestModal(false)}
          onSuccess={(msg) => {
            setSuccessMessage(msg);
            setTimeout(() => setSuccessMessage(null), 3000);
            setShowRequestModal(false);
            queryClient.invalidateQueries({ queryKey: ['my-loans'] });
          }}
        />
      )}
    </div>
  );
}

function LoanRow({ loan, isAdmin, colCount, onAction }: { loan: Loan; isAdmin: boolean; colCount: number; onAction: () => void }) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);

  const handleApprove = async () => {
    setActionLoading('approve');
    try {
      await payrollApi.approveLoan(loan.id);
      onAction();
    } catch (e) { console.error(e); }
    setActionLoading(null);
  };

  const handleReject = async (reason: string) => {
    setActionLoading('reject');
    try {
      await payrollApi.rejectLoan(loan.id, reason);
      setShowRejectModal(false);
      onAction();
    } catch (e) { console.error(e); }
    setActionLoading(null);
  };

  const statusBadge = (status: string) => {
    const styles: Record<string, string> = {
      approved: 'bg-emerald-100 text-emerald-700',
      pending: 'bg-amber-100 text-amber-700',
      rejected: 'bg-rose-100 text-rose-700',
      closed: 'bg-slate-100 text-slate-600',
    };
    return (
      <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${styles[status] || 'bg-slate-100'}`}>
        {status === 'approved' && <CheckCircle className="h-3 w-3" />}
        {status === 'pending' && <Clock className="h-3 w-3" />}
        {status === 'rejected' && <XCircle className="h-3 w-3" />}
        {status === 'closed' && <BadgeCheck className="h-3 w-3" />}
        {status.charAt(0).toUpperCase() + status.slice(1)}
      </span>
    );
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
        <td className="p-3">
          <span className="capitalize">{loan.loan_type === 'advance' ? 'Salary Advance' : 'Loan'}</span>
        </td>
        <td className="p-3 text-right font-medium">{formatCurrency(loan.amount)}</td>
        <td className="p-3 text-right">{formatCurrency(loan.emi_amount)}</td>
        <td className="p-3 text-center">{loan.paid_installments}/{loan.total_installments}</td>
        <td className="p-3 text-right">{formatCurrency(loan.remaining_amount)}</td>
        <td className="p-3 text-center">{statusBadge(loan.status)}</td>
        <td className="p-3 text-xs text-slate-500">{new Date(loan.created_at).toLocaleDateString()}</td>
        {isAdmin && (
          <td className="p-3">
            {loan.status === 'pending' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleApprove}
                  disabled={actionLoading === 'approve'}
                  className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600 hover:bg-emerald-100 disabled:opacity-50"
                  title="Approve"
                >
                  {actionLoading === 'approve' ? <div className="animate-spin h-4 w-4 border-2 border-emerald-600 rounded-full border-t-transparent" /> : <ThumbsUp className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  disabled={actionLoading === 'reject'}
                  className="p-1.5 rounded-lg bg-rose-50 text-rose-600 hover:bg-rose-100 disabled:opacity-50"
                  title="Reject"
                >
                  <Ban className="h-4 w-4" />
                </button>
              </div>
            )}
            {loan.status === 'approved' && loan.remaining_amount > 0 && (
              <button
                onClick={async () => { try { await payrollApi.closeLoan(loan.id); onAction(); } catch(e) { console.error(e); } }}
                className="text-xs px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200"
              >
                Close
              </button>
            )}
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
      {showRejectModal && (
        <RejectForm
          onClose={() => setShowRejectModal(false)}
          onSubmit={handleReject}
        />
      )}
    </>
  );
}

function LoanRequestModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: (msg: string) => void }) {
  const [loanType, setLoanType] = useState('advance');
  const [amount, setAmount] = useState('');
  const [emiAmount, setEmiAmount] = useState('');
  const [totalInstallments, setTotalInstallments] = useState('1');
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const estimatedInstallments = emiAmount && amount && parseFloat(emiAmount) > 0
    ? Math.ceil(parseFloat(amount) / parseFloat(emiAmount))
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!amount || !emiAmount || !totalInstallments) return;
    setSubmitting(true);
    try {
      await payrollApi.requestLoan({
        loan_type: loanType,
        amount: parseFloat(amount),
        emi_amount: parseFloat(emiAmount),
        total_installments: parseInt(totalInstallments),
        purpose: purpose || undefined,
      });
      onSuccess('Loan request submitted for approval!');
    } catch (e: any) {
      console.error(e);
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="p-6">
          <h2 className="text-lg font-semibold text-slate-900 mb-4">Request Advance / Loan</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                  Estimated: {estimatedInstallments} {estimatedInstallments === 1 ? 'installment' : 'installments'} of {formatCurrency(parseFloat(emiAmount))}
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

function RejectForm({ onClose, onSubmit }: { onClose: () => void; onSubmit: (reason: string) => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    setLoading(true);
    await onSubmit(reason.trim());
    setLoading(false);
  };

  return (
    <tr>
      <td colSpan={99} className="p-4">
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Reject Loan Request</h3>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <FieldLabel>Reason for Rejection</FieldLabel>
                  <TextareaInput value={reason} onChange={(e) => setReason(e.target.value)} rows={3} required placeholder="Enter reason..." />
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="ghost" type="button" onClick={onClose}>Cancel</Button>
                  <Button variant="danger" type="submit" disabled={loading || !reason.trim()}>
                    {loading ? 'Rejecting...' : 'Reject'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
