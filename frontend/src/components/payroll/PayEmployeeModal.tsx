import { useState } from 'react';
import { X, Wallet, IndianRupee, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface PayEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  employee: {
    id: number;
    name: string;
    payrollItemId?: number;
    netPay?: number;
    monthYear?: string;
  } | null;
  onSuccess?: () => void;
}

function formatCurrency(amount: number): string {
  return '₹' + Number(amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/**
 * Marks a single employee payroll item as paid outside of the bulk bank-file flow.
 * Use case: hand-paid a cheque, UPI outside batch, correction for a missed employee, etc.
 */
export default function PayEmployeeModal({ isOpen, onClose, employee, onSuccess }: PayEmployeeModalProps) {
  const queryClient = useQueryClient();
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<'bank_transfer' | 'cash' | 'cheque' | 'upi'>('bank_transfer');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const markPaidMutation = useMutation({
    mutationFn: () => employee?.payrollItemId
      ? payrollApi.markItemPaid(employee.payrollItemId, reference || undefined, method).then((r) => r.data)
      : Promise.reject(new Error('No payroll item to mark paid')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payroll'] });
      setSuccess('Payment recorded.');
      setTimeout(() => {
        onSuccess?.();
        onClose();
      }, 800);
    },
    onError: (e: any) => setError(getApiErrorMessage(e, 'Failed to record payment')),
  });

  if (!isOpen || !employee) return null;

  const handleSubmit = () => {
    setError(null);
    setSuccess(null);
    if (!employee.payrollItemId) {
      setError('This employee has not been processed in a payroll run yet. Process the run first, then mark individual payments.');
      return;
    }
    markPaidMutation.mutate();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <Wallet className="h-5 w-5 text-blue-600" />
              Mark as Paid
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">Record a payment for this employee outside the bulk bank file.</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg" aria-label="Close">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-rose-700 flex-1 break-words">{error}</p>
              <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-600">×</button>
            </div>
          )}
          {success && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-emerald-700 flex-1">{success}</p>
            </div>
          )}

          <div className="bg-blue-50 rounded-lg p-4">
            <p className="text-xs text-blue-700">Employee</p>
            <p className="font-semibold text-blue-900">{employee.name}</p>
            {employee.monthYear && (
              <p className="text-xs text-blue-700 mt-1">For {employee.monthYear}</p>
            )}
            {employee.netPay !== undefined && (
              <p className="text-xl font-bold text-blue-900 mt-2 flex items-center gap-1">
                <IndianRupee className="h-4 w-4" />
                {formatCurrency(employee.netPay)}
                <span className="text-xs font-normal text-blue-600 ml-1">net pay</span>
              </p>
            )}
          </div>

          {!employee.payrollItemId && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
              Tip: For bulk payouts, use the bank file from the run detail. This is best for one-off corrections.
            </div>
          )}

          {employee.payrollItemId && (
            <>
              <div>
                <FieldLabel>Payment Method</FieldLabel>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value as any)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="bank_transfer">Bank transfer (NEFT/RTGS)</option>
                  <option value="cash">Cash</option>
                  <option value="cheque">Cheque</option>
                  <option value="upi">UPI</option>
                </select>
              </div>
              <div>
                <FieldLabel>Payment reference (optional)</FieldLabel>
                <TextInput
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder="e.g. NEFT-12345 / UPI ref"
                />
                <p className="text-xs text-slate-400 mt-1">Auto-generated if left blank.</p>
              </div>
            </>
          )}
        </div>

        <div className="flex gap-2 p-5 border-t border-slate-200 bg-slate-50">
          <Button variant="secondary" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          {employee.payrollItemId && (
            <Button
              variant="primary"
              className="flex-1"
              iconLeft={markPaidMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              onClick={handleSubmit}
              disabled={markPaidMutation.isPending}
            >
              {markPaidMutation.isPending ? 'Recording…' : 'Mark as Paid'}
            </Button>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
