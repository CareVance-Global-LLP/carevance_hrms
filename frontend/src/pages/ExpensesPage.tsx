import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Receipt,
  Plus,
  CheckCircle2,
  X,
  AlertCircle,
  Calendar,
  DollarSign,
  FileText,
  Filter,
  Search,
  Download,
  ChevronDown,
  ChevronUp,
  Trash2,
  Edit3,
  Clock,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { expenseApi, type Reimbursement } from '@/services/performanceApi';
import { useAuth } from '@/contexts/AuthContext';
import Button from '@/components/ui/Button';
import { TextInput, TextareaInput as TextArea, SelectInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import PageHeader from '@/components/dashboard/PageHeader';

const CATEGORIES = [
  { value: 'travel', label: 'Travel', icon: '✈️' },
  { value: 'meals', label: 'Meals', icon: '🍽️' },
  { value: 'office_supplies', label: 'Office Supplies', icon: '📎' },
  { value: 'training', label: 'Training', icon: '📚' },
  { value: 'medical', label: 'Medical', icon: '🏥' },
  { value: 'other', label: 'Other', icon: '📋' },
];

function ExpenseCard({
  expense,
  onApprove,
  onReject,
  onDelete,
  canManage,
}: {
  expense: Reimbursement;
  onApprove?: (id: number) => void;
  onReject?: (id: number) => void;
  onDelete: (id: number) => void;
  canManage: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved':
        return 'bg-emerald-100 text-emerald-700';
      case 'rejected':
        return 'bg-red-100 text-red-700';
      default:
        return 'bg-amber-100 text-amber-700';
    }
  };

  const categoryLabel = CATEGORIES.find((c) => c.value === expense.category)?.label || expense.category;

  return (
    <div className="border border-slate-200 rounded-lg p-4 hover:shadow-sm transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${getStatusColor(expense.status)}`}>
              {expense.status}
            </span>
            <span className="text-xs text-slate-500 capitalize">{categoryLabel}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <h3 className="text-lg font-semibold text-slate-900">
              {expense.currency} {expense.amount.toFixed(2)}
            </h3>
            <span className="text-sm text-slate-500">
              {new Date(expense.expense_date).toLocaleDateString()}
            </span>
          </div>
          <p className="text-sm text-slate-600 mt-1 line-clamp-2">{expense.description}</p>
          {expense.merchant_name && (
            <p className="text-xs text-slate-500 mt-1">Merchant: {expense.merchant_name}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {expense.status === 'pending' && canManage && (
            <>
              <button
                onClick={() => onApprove?.(expense.id)}
                className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-md transition-colors"
                title="Approve"
              >
                <CheckCircle className="h-4 w-4" />
              </button>
              <button
                onClick={() => onReject?.(expense.id)}
                className="p-1.5 text-red-600 hover:bg-red-50 rounded-md transition-colors"
                title="Reject"
              >
                <XCircle className="h-4 w-4" />
              </button>
            </>
          )}
          {expense.employee_id === (useAuth().user?.id) && expense.status === 'pending' && (
            <button
              onClick={() => onDelete(expense.id)}
              className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-md transition-colors"
          >
            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-slate-500">Category:</span>
              <span className="ml-2 text-slate-900 capitalize">{categoryLabel}</span>
            </div>
            <div>
              <span className="text-slate-500">Date:</span>
              <span className="ml-2 text-slate-900">
                {new Date(expense.expense_date).toLocaleDateString()}
              </span>
            </div>
            {expense.location && (
              <div>
                <span className="text-slate-500">Location:</span>
                <span className="ml-2 text-slate-900">{expense.location}</span>
              </div>
            )}
            <div>
              <span className="text-slate-500">Submitted:</span>
              <span className="ml-2 text-slate-900">
                {new Date(expense.created_at).toLocaleDateString()}
              </span>
            </div>
          </div>
          {expense.notes && (
            <div className="mt-3 p-3 bg-slate-50 rounded-lg">
              <span className="text-sm text-slate-500">Notes:</span>
              <p className="text-sm text-slate-700 mt-1">{expense.notes}</p>
            </div>
          )}
          {expense.receipt_url && (
            <div className="mt-3">
              <a
                href={expense.receipt_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-blue-600 hover:text-blue-700"
              >
                <Download className="h-4 w-4" />
                View Receipt
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showModal, setShowModal] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [formData, setFormData] = useState({
    category: 'travel',
    amount: '',
    currency: 'INR',
    expense_date: new Date().toISOString().split('T')[0],
    description: '',
    merchant_name: '',
    location: '',
    receipt_url: '',
  });

  const { data: expenses, isLoading, isError: isExpensesError, error: expensesError } = useQuery({
    queryKey: ['expenses'],
    queryFn: () => expenseApi.getReimbursements(),
    retry: false,
  });

  const { data: summary, isError: isSummaryError } = useQuery({
    queryKey: ['expense-summary'],
    queryFn: () => expenseApi.getSummary(),
    retry: false,
  });

  const payrollUnavailable = isExpensesError && (expensesError as any)?.response?.status === 403;

  const createMutation = useMutation({
    mutationFn: (data: any) => expenseApi.createReimbursement(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      setShowModal(false);
      setSuccessMessage('Expense submitted successfully.');
      resetForm();
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || err?.message || 'Failed to submit expense.');
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: number) => expenseApi.approveReimbursement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      setSuccessMessage('Expense approved.');
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || 'Failed to approve expense.');
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ id, notes }: { id: number; notes: string }) =>
      expenseApi.rejectReimbursement(id, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      setSuccessMessage('Expense rejected.');
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || 'Failed to reject expense.');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => expenseApi.deleteReimbursement(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['expense-summary'] });
      setSuccessMessage('Expense deleted.');
    },
    onError: (err: any) => {
      setErrorMessage(err?.response?.data?.message || 'Failed to delete expense.');
    },
  });

  const resetForm = () => {
    setFormData({
      category: 'travel',
      amount: '',
      currency: 'INR',
      expense_date: new Date().toISOString().split('T')[0],
      description: '',
      merchant_name: '',
      location: '',
      receipt_url: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const data = {
      ...formData,
      amount: parseFloat(formData.amount),
    };
    createMutation.mutate(data);
  };

  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';

  const filteredExpenses = expenses?.filter((expense) => {
    if (statusFilter !== 'all' && expense.status !== statusFilter) return false;
    if (categoryFilter !== 'all' && expense.category !== categoryFilter) return false;
    return true;
  });

  if (payrollUnavailable) {
    return (
      <div className="min-h-screen bg-slate-50">
        <PageHeader title="Expenses" description="Submit and manage expense reimbursements" />
        <div className="p-6 max-w-6xl mx-auto">
          <SurfaceCard className="p-12 text-center">
            <Receipt className="h-16 w-16 text-slate-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Payroll Feature Not Available</h2>
            <p className="text-slate-500 max-w-md mx-auto">
              Expense reimbursements are not included in your current plan. Please contact your organization admin to upgrade.
            </p>
          </SurfaceCard>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader title="Expenses" description="Submit and manage expense reimbursements" />

      <div className="p-6 max-w-6xl mx-auto space-y-6">
        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            <span className="text-sm text-emerald-800">{successMessage}</span>
            <button onClick={() => setSuccessMessage(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {errorMessage && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
            <AlertCircle className="h-5 w-5 text-red-600" />
            <span className="text-sm text-red-800">{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-auto">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <Receipt className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Total Expenses</p>
                  <p className="text-2xl font-bold text-slate-900">{summary.total_count}</p>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Clock className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Pending</p>
                  <p className="text-2xl font-bold text-slate-900">{summary.pending_count}</p>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Approved</p>
                  <p className="text-2xl font-bold text-slate-900">{summary.approved_count}</p>
                </div>
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <DollarSign className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-sm text-slate-500">Total Amount</p>
                  <p className="text-2xl font-bold text-slate-900">
                    ₹{summary.total_amount?.toFixed(2) || '0.00'}
                  </p>
                </div>
              </div>
            </SurfaceCard>
          </div>
        )}

        {/* Filters */}
        <SurfaceCard className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">Filters:</span>
            </div>
            <SelectInput
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-32"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </SelectInput>
            <SelectInput
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="w-40"
            >
              <option value="all">All Categories</option>
              {CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.icon} {cat.label}
                </option>
              ))}
            </SelectInput>
          </div>
        </SurfaceCard>

        {/* Expenses List */}
        <SurfaceCard className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Expenses</h2>
              <p className="text-sm text-slate-500">{filteredExpenses?.length || 0} expenses</p>
            </div>
            <Button onClick={() => { resetForm(); setShowModal(true); }}>
              <Plus className="h-4 w-4 mr-2" /> Submit Expense
            </Button>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div>
            </div>
          ) : filteredExpenses?.length === 0 ? (
            <div className="text-center py-12">
              <Receipt className="h-12 w-12 text-slate-300 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-slate-900 mb-2">No expenses yet</h3>
              <p className="text-sm text-slate-500 max-w-md mx-auto">
                Submit your expense reimbursements here.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredExpenses?.map((expense) => (
                <ExpenseCard
                  key={expense.id}
                  expense={expense}
                  onApprove={(id) => approveMutation.mutate(id)}
                  onReject={(id) => {
                    const notes = prompt('Enter rejection reason:');
                    if (notes) rejectMutation.mutate({ id, notes });
                  }}
                  onDelete={(id) => deleteMutation.mutate(id)}
                  canManage={isAdmin}
                />
              ))}
            </div>
          )}
        </SurfaceCard>

        {/* Submit Modal */}
        {showModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold text-slate-900">Submit Expense</h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Category *
                    </label>
                    <SelectInput
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      required
                    >
                      {CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.icon} {cat.label}
                        </option>
                      ))}
                    </SelectInput>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Currency
                    </label>
                    <SelectInput
                      value={formData.currency}
                      onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                    >
                      <option value="INR">INR (₹)</option>
                      <option value="USD">USD ($)</option>
                      <option value="EUR">EUR (€)</option>
                      <option value="GBP">GBP (£)</option>
                    </SelectInput>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Amount *
                    </label>
                    <TextInput
                      type="number"
                      step="0.01"
                      min="0.01"
                      value={formData.amount}
                      onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
                      placeholder="0.00"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Expense Date *
                    </label>
                    <TextInput
                      type="date"
                      value={formData.expense_date}
                      onChange={(e) => setFormData({ ...formData, expense_date: e.target.value })}
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Description *
                  </label>
                  <TextArea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    rows={3}
                    placeholder="Describe the expense..."
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Merchant Name
                  </label>
                  <TextInput
                    value={formData.merchant_name}
                    onChange={(e) => setFormData({ ...formData, merchant_name: e.target.value })}
                    placeholder="e.g., Uber, Amazon, etc."
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Location
                  </label>
                  <TextInput
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g., Mumbai, India"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Receipt URL
                  </label>
                  <TextInput
                    type="url"
                    value={formData.receipt_url}
                    onChange={(e) => setFormData({ ...formData, receipt_url: e.target.value })}
                    placeholder="https://..."
                  />
                  <p className="text-xs text-slate-500 mt-1">
                    Upload receipt to cloud storage and paste the link here
                  </p>
                </div>

                <div className="flex justify-end gap-3 pt-4 border-t border-slate-200">
                  <Button type="button" variant="secondary" onClick={() => setShowModal(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? 'Submitting...' : 'Submit Expense'}
                  </Button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
