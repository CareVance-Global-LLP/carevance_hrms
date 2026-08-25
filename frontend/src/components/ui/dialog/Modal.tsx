import { useId, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';
import { DialogDepthProvider, useDialogBehavior } from './useDialogBehavior';

/**
 * Sizes map 1:1 onto Tailwind's own max-w scale — `size="3xl"` is
 * `max-w-3xl`, nothing to translate. An earlier draft used a semantic scale
 * (lg -> max-w-2xl, xl -> max-w-4xl) and the first four migrations all had to
 * look up what their width had become.
 */
type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '6xl';

const sizeClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  '6xl': 'max-w-6xl',
};

/** Stand-in for SurfaceCard when `bare` is set — layout only, no surface. */
function BarePanelSurface({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={className}>{children}</div>;
}

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Rendered as the dialog heading. Exactly one of title or titleId is required. */
  title?: string;
  /** Id of a heading already inside children, for panels with a bespoke header. */
  titleId?: string;
  subtitle?: string;
  size?: ModalSize;
  /** Overrides `size` for a panel with a bespoke width, e.g. `max-w-[560px]`. */
  widthClassName?: string;
  /** Merged onto the panel. Migrations use it to keep a non-default max height. */
  panelClassName?: string;
  /**
   * Skip the SurfaceCard wrapper. For panels that already render their own
   * card — wrapping those in a second one doubles the border and shadow.
   * The child is then responsible for the panel's own surface and padding.
   */
  bare?: boolean;
  role?: 'dialog' | 'alertdialog';
  busy?: boolean;
  dismissOnBackdrop?: boolean;
  ariaDescribedBy?: string;
  showCloseButton?: boolean;
  /**
   * Focus this on open instead of the panel. Only for panels that previously
   * carried `autoFocus` on a field — the default panel focus would win over it
   * silently and leave the field unfocused.
   */
  initialFocusRef?: RefObject<HTMLElement>;
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
  widthClassName,
  panelClassName,
  bare = false,
  role = 'dialog',
  busy = false,
  dismissOnBackdrop = true,
  ariaDescribedBy,
  showCloseButton = true,
  initialFocusRef,
  footer,
  children,
}: ModalProps) {
  const generatedTitleId = useId();
  const { panelRef, backdropProps, panelProps, zIndex, depth } = useDialogBehavior({
    open,
    onClose,
    busy,
    dismissOnBackdrop,
    initialFocusRef,
  });

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const headingId = titleId ?? (title ? generatedTitleId : undefined);
  const PanelSurface = bare ? BarePanelSurface : SurfaceCard;

  return createPortal(
    <div
      data-dialog-backdrop=""
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex }}
      {...backdropProps}
    >
      <PanelSurface className={cn('w-full', widthClassName ?? sizeClasses[size])}>
        <div
          ref={panelRef}
          role={role}
          aria-labelledby={headingId}
          aria-describedby={ariaDescribedBy}
          className={cn(
            'flex flex-col outline-none motion-safe:animate-dialog-in',
            bare ? 'max-h-full' : 'max-h-[85vh]',
            panelClassName,
          )}
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
                  className="shrink-0 rounded-lg p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 disabled:opacity-40"
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
      </PanelSurface>
    </div>,
    document.body,
  );
}
