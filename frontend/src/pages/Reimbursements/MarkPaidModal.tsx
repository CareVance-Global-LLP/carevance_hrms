import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CheckCircle } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import Modal from '@/components/ui/dialog/Modal';
import { useToast } from '@/components/ui/Toast';

interface MarkPaidModalProps {
  open: boolean;
  onClose: () => void;
  claimId: number;
}

/**
 * Mark-paid modal for admin on approved-but-unpaid claims.
 *
 * The previous inline form had a single button with no record of the
 * `payoutMode`/`paymentReference` shown afterwards. Surfaced this in the
 * detail panel via a tab refresh; here it stays a normal form.
 */
export default function MarkPaidModal({ open, onClose, claimId }: MarkPaidModalProps) {
  const queryClient = useQueryClient();
  const { show } = useToast();
  const [payoutMode, setPayoutMode] = useState<'payroll' | 'outside_payroll'>('payroll');
  const [paymentReference, setPaymentReference] = useState('');

  const mutation = useMutation({
    mutationFn: () => payrollApi.markReimbursementPaid(claimId, {
      payout_mode: payoutMode,
      payment_reference: paymentReference || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reimbursements'] });
      onClose();
      setPaymentReference('');
      setPayoutMode('payroll');
      show({ kind: 'success', message: 'Marked as paid.' });
    },
    onError: (e: any) => show({ kind: 'error', message: getApiErrorMessage(e, 'Failed to mark as paid.') }),
  });

  const handleClose = () => {
    if (mutation.isPending) return;
    setPaymentReference('');
    setPayoutMode('payroll');
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Mark as Paid"
      subtitle="Choose how this approved claim was paid."
      size="md"
      busy={mutation.isPending}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            iconLeft={<CheckCircle className="h-4 w-4" />}
            onClick={() => mutation.mutate()}
            loading={mutation.isPending}
          >
            Confirm Paid
          </Button>
        </>
      }
    >
      <div className="space-y-4 p-5">
        <div>
          <FieldLabel>Payout Mode</FieldLabel>
          <SelectInput
            value={payoutMode}
            onChange={(e) => setPayoutMode(e.target.value as 'payroll' | 'outside_payroll')}
          >
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
    </Modal>
  );
}
