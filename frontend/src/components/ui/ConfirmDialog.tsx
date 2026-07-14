import { useEffect } from 'react';
import { X, AlertTriangle, Loader2 } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { cn } from '@/utils/cn';

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onConfirm: () => void;
  onClose: () => void;
  isLoading?: boolean;
}

/**
 * Generic confirm modal matching the existing modal chrome
 * (fixed-inset overlay + SurfaceCard). Used for destructive
 * confirmations that previously used window.confirm.
 */
export default function ConfirmDialog({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onClose,
  isLoading = false,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const isDanger = tone === 'danger';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-md">
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                isDanger
                  ? 'bg-rose-100 text-rose-600'
                  : 'bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              <p className="mt-1 text-sm text-slate-600">{message}</p>
            </div>
            <button
              onClick={onClose}
              disabled={isLoading}
              className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg disabled:opacity-40"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isLoading}>
              {cancelLabel}
            </Button>
            <Button
              variant={isDanger ? 'danger' : 'primary'}
              onClick={onConfirm}
              disabled={isLoading}
              iconLeft={isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
