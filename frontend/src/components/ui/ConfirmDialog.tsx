import { useId } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/dialog/Modal';
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
 * Confirmation for destructive actions.
 *
 * The focus trap, Escape handling and focus restore that used to live here now
 * come from Modal — this file was one of only three in the codebase that got
 * them right, and that logic is the thing worth sharing. The props are
 * deliberately unchanged (`isOpen`, not `open`; `isLoading`, not `busy`) so the
 * 15 call sites are unaffected.
 *
 * role="alertdialog" is kept: this interrupts the user rather than offering an
 * optional surface.
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
  const messageId = useId();
  const isDanger = tone === 'danger';

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={title}
      role="alertdialog"
      size="md"
      busy={isLoading}
      ariaDescribedBy={messageId}
      footer={
        <>
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
        </>
      }
    >
      <div className="flex items-start gap-3 px-5 py-5">
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-full',
            isDanger ? 'bg-rose-100 text-rose-600' : 'bg-blue-500/10 text-blue-600',
          )}
        >
          <AlertTriangle className="h-5 w-5" />
        </div>
        <p id={messageId} className="text-sm text-slate-600">
          {message}
        </p>
      </div>
    </Modal>
  );
}
