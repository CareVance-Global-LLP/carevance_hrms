import { useEffect, useState } from 'react';
import { X, Loader2 } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { FieldLabel, TextareaInput } from '@/components/ui/FormField';

interface RejectReasonModalProps {
  isOpen: boolean;
  title: string;
  description?: string;
  submitLabel?: string;
  placeholder?: string;
  onSubmit: (reason: string) => void;
  onClose: () => void;
  isLoading?: boolean;
}

/**
 * Modal that collects a required rejection reason. Replaces every
 * `prompt('Rejection reason:')` in the payroll pages. Submit is disabled
 * until a non-empty reason is provided.
 */
export default function RejectReasonModal({
  isOpen,
  title,
  description,
  submitLabel = 'Reject',
  placeholder = 'Enter the reason for rejection…',
  onSubmit,
  onClose,
  isLoading = false,
}: RejectReasonModalProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (isOpen) setReason('');
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const trimmed = reason.trim();
  const canSubmit = trimmed.length > 0 && !isLoading;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-md">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="text-base font-semibold text-slate-900">{title}</h2>
          <button
            onClick={onClose}
            disabled={isLoading}
            className="p-1.5 text-slate-500 hover:bg-slate-100 rounded-lg disabled:opacity-40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          {description ? <p className="text-sm text-slate-600">{description}</p> : null}
          <div>
            <FieldLabel>Reason</FieldLabel>
            <TextareaInput
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={placeholder}
              rows={4}
              disabled={isLoading}
              autoFocus
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 p-4">
          <Button variant="secondary" onClick={onClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={handleSubmit}
            disabled={!canSubmit}
            iconLeft={isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
          >
            {submitLabel}
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
}
