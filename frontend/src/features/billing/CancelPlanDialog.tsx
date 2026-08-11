import { useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { billingApi } from '@/services/api';

interface CancelPlanDialogProps {
  planLabel: string;
  periodEnd?: string | null;
  onClose: () => void;
  onCancelled: () => void;
}

const formatDate = (value?: string | null) => {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
};

export default function CancelPlanDialog({ planLabel, periodEnd, onClose, onCancelled }: CancelPlanDialogProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');

  const until = formatDate(periodEnd);

  const submit = async () => {
    setIsProcessing(true);
    setError('');
    try {
      await billingApi.cancelPlan();
      onCancelled();
      // The plan change alters what the whole app may show, so a reload is the
      // honest way to pick up the new entitlements everywhere.
      window.location.reload();
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to cancel plan. Please try again.');
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Cancel plan"
        className="w-full max-w-md rounded-2xl border border-slate-200 bg-surface-raised p-6 shadow-modal"
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight text-slate-950">Cancel {planLabel}?</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1.5 text-slate-600 transition hover:text-slate-900"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" />
          <div className="text-xs leading-5 text-amber-800">
            <p className="font-semibold">What happens next</p>
            <p className="mt-1">
              Your workspace moves to a 14-day Basic trial and loses the features this plan includes.
              {until ? ` You have already paid through ${until}.` : ''}
            </p>
          </div>
        </div>

        <p className="mt-4 text-xs leading-5 text-slate-600">
          Nothing is deleted. People, projects, time entries and payroll history all stay exactly as they are, and
          resubscribing restores access to them.
        </p>

        {error ? <p className="mt-4 text-center text-xs text-red-600">{error}</p> : null}

        <div className="mt-6 flex gap-3">
          <Button variant="secondary" className="flex-1 justify-center" onClick={onClose} disabled={isProcessing}>
            Keep plan
          </Button>
          <Button
            variant="danger"
            className="flex-1 justify-center"
            onClick={submit}
            disabled={isProcessing}
            loading={isProcessing}
          >
            Cancel plan
          </Button>
        </div>
      </div>
    </div>
  );
}
