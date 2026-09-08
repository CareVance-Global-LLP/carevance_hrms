import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  X, Paperclip, AlertCircle, Check, Loader2, Receipt, FileText,
} from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, TextareaInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Modal from '@/components/ui/dialog/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatPayrollAmount } from '@/components/ui/PayrollAmount';

const CATEGORIES = [
  { value: 'travel', label: 'Travel' },
  { value: 'meals', label: 'Meals & Entertainment' },
  { value: 'office_supplies', label: 'Office Supplies' },
  { value: 'communication', label: 'Communication' },
  { value: 'medical', label: 'Medical' },
  { value: 'training', label: 'Training & Development' },
  { value: 'other', label: 'Other' },
];

interface SubmitClaimModalProps {
  open: boolean;
  onClose: () => void;
  onSubmitted: (id: number) => void;
}

/**
 * Submit-a-claim modal.
 *
 * Extracted from ReimbursementsPage so the orchestrator stops carrying 700
 * lines of form state. Uses the project's <Modal> primitive instead of a
 * hand-rolled backdrop.
 */
export default function SubmitClaimModal({ open, onClose, onSubmitted }: SubmitClaimModalProps) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [step, setStep] = useState<'form' | 'confirm' | 'success'>('form');
  const [submitError, setSubmitError] = useState('');

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

  const receiptInputRef = useRef<HTMLInputElement>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string>('');
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState('');

  const resetForm = () => {
    setFormData({ title: '', category: 'travel', amount: '', description: '', expense_date: '', receipt_url: '', merchant_name: '', location: '' });
    setReceiptFile(null);
    setReceiptPreview('');
    setReceiptError('');
    setUploadingReceipt(false);
    setStep('form');
    setSubmitError('');
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

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
      setStep('success');
      setSubmitError('');
      show({ kind: 'success', message: 'Reimbursement submitted.' });
      onSubmitted(res?.data?.reimbursement?.id || 0);
    },
    onError: (err: any) => {
      const msg = err?.response?.data?.message || err?.message || 'Submission failed. Please try again.';
      setSubmitError(msg);
      setStep('form');
      show({ kind: 'error', message: getApiErrorMessage(err, 'Submission failed. Please try again.') });
    },
  });

  const handleReceiptSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setReceiptFile(file);
    setReceiptPreview(URL.createObjectURL(file));
    setReceiptError('');
    setUploadingReceipt(true);
    try {
      const res = await payrollApi.uploadReimbursementReceipt(file);
      setFormData((prev) => ({ ...prev, receipt_url: res.data.url }));
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
    setFormData((prev) => ({ ...prev, receipt_url: '' }));
    if (receiptInputRef.current) receiptInputRef.current.value = '';
  };

  const canSubmit = !!formData.title && !!formData.amount && !!formData.description && !!formData.expense_date && !uploadingReceipt;

  return (
    <Modal
      open={open}
      onClose={() => !createMutation.isPending && handleClose()}
      title={step === 'success' ? 'Claim Submitted' : 'New Expense Claim'}
      size="lg"
      busy={createMutation.isPending}
    >
      {step === 'form' && (
        <div className="space-y-5 px-6 py-4">
          <div>
            <FieldLabel>Category *</FieldLabel>
            <SelectInput value={formData.category} onChange={(e) => setFormData({ ...formData, category: e.target.value })}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </SelectInput>
          </div>

          <div className="border-t border-slate-100" />

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

          <div className="border-t border-slate-100" />

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
                    <FileText className="h-6 w-6 text-slate-500" />
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
                  className="text-slate-500 hover:text-red-500 transition-colors shrink-0"
                  aria-label="Remove receipt"
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
                <span className="text-xs text-slate-500">— JPG, PNG, PDF up to 5MB</span>
              </button>
            )}
          </div>

          {submitError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={handleClose} disabled={createMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              iconLeft={<Receipt className="h-4 w-4" />}
              onClick={() => setStep('confirm')}
              disabled={!canSubmit}
            >
              Review & Submit
            </Button>
          </div>
        </div>
      )}

      {step === 'confirm' && (
        <div className="space-y-4 px-6 py-4">
          <p className="text-sm text-slate-500">Please review your expense claim before submitting.</p>
          <div className="space-y-3 text-sm">
            <ReviewRow label="Category" value={CATEGORIES.find((c) => c.value === formData.category)?.label || ''} />
            <ReviewRow label="Amount" value={formatPayrollAmount(parseFloat(formData.amount) || 0, { compact: true })} />
            <ReviewRow label="Date of Expense" value={formData.expense_date} />
            {formData.title && <ReviewRow label="Title" value={formData.title} />}
            {formData.merchant_name && <ReviewRow label="Merchant" value={formData.merchant_name} />}
            <ReviewRow label="Description" value={formData.description} alignRight />
            {formData.receipt_url && (
              <div className="flex justify-between">
                <span className="text-slate-500">Receipt</span>
                <span className="font-medium text-emerald-600 flex items-center gap-1">
                  <Paperclip className="h-3 w-3" /> Attached
                </span>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStep('form')} disabled={createMutation.isPending}>
              Back
            </Button>
            <Button
              variant="primary"
              iconLeft={<Receipt className="h-4 w-4" />}
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
            >
              Confirm & Submit
            </Button>
          </div>
        </div>
      )}

      {step === 'success' && (
        <div className="p-8 text-center">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <Check className="h-7 w-7 text-emerald-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900 mb-1">Claim Submitted Successfully</h3>
          <p className="text-sm text-slate-500 mb-6">
            Your expense claim has been submitted and is awaiting approval.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button
              variant="secondary"
              onClick={resetForm}
              iconLeft={<Plus className="h-4 w-4" />}
            >
              Submit Another
            </Button>
            <Button variant="primary" onClick={handleClose}>
              Done
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

function ReviewRow({ label, value, alignRight }: { label: string; value: string; alignRight?: boolean }) {
  return (
    <div className="flex justify-between items-start gap-4">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`font-medium text-slate-900 ${alignRight ? 'text-right max-w-[280px]' : ''}`}>{value}</span>
    </div>
  );
}

function Plus({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}
