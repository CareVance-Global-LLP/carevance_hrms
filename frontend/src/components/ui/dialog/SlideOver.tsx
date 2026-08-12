import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { DialogDepthProvider, useDialogBehavior } from './useDialogBehavior';

export interface SlideOverProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * A right-hand drawer for detail and edit surfaces.
 *
 * The employee settings form used to render *below* the directory table, so
 * clicking "Settings" on row 30 pushed a panel in underneath and left you
 * scrolling to find it, with the row you came from now off screen. A drawer
 * keeps the list in place and the context visible.
 *
 * Moved here from features/employees/ so it shares one behaviour hook with
 * Modal; that path is now a re-export and its call sites are unchanged.
 *
 * The backdrop used to be a full-size <button aria-label="Close panel">. That
 * is gone: dismissal now goes through backdropProps, and a focusable
 * full-screen button inside a focus trap is a control the keyboard user has to
 * Tab past before reaching any of the drawer's content.
 */
export default function SlideOver({
  open,
  title,
  subtitle,
  onClose,
  busy = false,
  dismissOnBackdrop = true,
  footer,
  children,
}: SlideOverProps) {
  const titleId = useId();
  const { panelRef, backdropProps, panelProps, zIndex, depth } = useDialogBehavior({
    open,
    onClose,
    busy,
    dismissOnBackdrop,
  });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      data-dialog-backdrop=""
      className="fixed inset-0 flex justify-end bg-black/30"
      style={{ zIndex }}
      {...backdropProps}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-labelledby={titleId}
        className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-modal outline-none motion-safe:animate-slide-in-right"
        {...panelProps}
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-base font-bold tracking-[-0.02em] text-slate-950">
              {title}
            </h2>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <DialogDepthProvider value={depth}>{children}</DialogDepthProvider>
        </div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
            <DialogDepthProvider value={depth}>{footer}</DialogDepthProvider>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
