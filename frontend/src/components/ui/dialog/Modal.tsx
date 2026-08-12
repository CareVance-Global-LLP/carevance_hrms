import { useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';
import { DialogDepthProvider, useDialogBehavior } from './useDialogBehavior';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Rendered as the dialog heading. Exactly one of title or titleId is required. */
  title?: string;
  /** Id of a heading already inside children, for panels with a bespoke header. */
  titleId?: string;
  subtitle?: string;
  size?: ModalSize;
  role?: 'dialog' | 'alertdialog';
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  ariaDescribedBy?: string;
  showCloseButton?: boolean;
  footer?: ReactNode;
  children: ReactNode;
}

/**
 * Centered modal dialog.
 *
 * Portals to document.body so an `overflow: hidden` or transformed ancestor
 * cannot clip it, and so its z-index is comparable with every other dialog
 * rather than with whatever stacking context it happened to be rendered in.
 *
 * `titleId` exists for panels that already have a bespoke header — an icon
 * beside a dynamic heading in a custom row. Passing `title` there would render
 * a second heading, and deleting theirs would be a redesign rather than a
 * chrome swap. Those panels keep their header, add an id to its heading, and
 * name the dialog through it.
 */
export default function Modal({
  open,
  onClose,
  title,
  titleId,
  subtitle,
  size = 'md',
  role = 'dialog',
  busy = false,
  dismissOnBackdrop = true,
  ariaDescribedBy,
  showCloseButton = true,
  footer,
  children,
}: ModalProps) {
  const generatedTitleId = useId();
  const { panelRef, backdropProps, panelProps, zIndex, depth } = useDialogBehavior({
    open,
    onClose,
    busy,
    dismissOnBackdrop,
  });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const headingId = titleId ?? (title ? generatedTitleId : undefined);

  return createPortal(
    <div
      data-dialog-backdrop=""
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex }}
      {...backdropProps}
    >
      <SurfaceCard className={cn('w-full', sizeClasses[size])}>
        <div
          ref={panelRef}
          role={role}
          aria-labelledby={headingId}
          aria-describedby={ariaDescribedBy}
          className="flex max-h-[85vh] flex-col outline-none motion-safe:animate-dialog-in"
          {...panelProps}
        >
          {title ? (
            <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
              <div className="min-w-0 flex-1">
                <h2 id={headingId} className="truncate text-base font-semibold text-slate-950">
                  {title}
                </h2>
                {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
              </div>
              {showCloseButton ? (
                <button
                  type="button"
                  onClick={onClose}
                  disabled={busy}
                  aria-label="Close"
                  className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto">
            <DialogDepthProvider value={depth}>{children}</DialogDepthProvider>
          </div>

          {footer ? (
            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">
              <DialogDepthProvider value={depth}>{footer}</DialogDepthProvider>
            </div>
          ) : null}
        </div>
      </SurfaceCard>
    </div>,
    document.body,
  );
}
