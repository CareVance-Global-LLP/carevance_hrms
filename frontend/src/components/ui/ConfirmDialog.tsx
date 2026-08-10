import { useEffect, useRef } from 'react';
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
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  /*
   * This is the dialog that guards destructive actions, so it has to behave
   * like one. It previously rendered as plain divs: no dialog role, so screen
   * readers announced nothing; no focus move, so keyboard users stayed on the
   * page behind and could tab straight past the warning into the content it was
   * warning about; and no focus trap, so Tab walked out of the dialog entirely.
   */
  useEffect(() => {
    if (!isOpen) return;

    restoreFocusRef.current = document.activeElement as HTMLElement | null;

    // Focus the panel itself rather than a button — landing on "Confirm" makes
    // a stray Enter destroy something.
    panelRef.current?.focus();

    const focusable = () =>
      Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      ).filter((el) => el.offsetParent !== null);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isLoading) {
        onClose();
        return;
      }

      if (e.key !== 'Tab') return;

      const items = focusable();
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Put focus back where the user left it, or it lands on <body> and the
      // next Tab starts from the top of the page.
      restoreFocusRef.current?.focus?.();
    };
  }, [isOpen, isLoading, onClose]);

  if (!isOpen) return null;

  const isDanger = tone === 'danger';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-md">
        <div
          ref={panelRef}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          aria-describedby="confirm-dialog-message"
          tabIndex={-1}
          className="p-5 outline-none"
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
                isDanger
                  ? 'bg-rose-100 text-rose-600'
                  : 'bg-blue-500/10 text-blue-600'
              )}
            >
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 id="confirm-dialog-title" className="text-base font-semibold text-slate-900">{title}</h2>
              <p id="confirm-dialog-message" className="mt-1 text-sm text-slate-600">{message}</p>
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
