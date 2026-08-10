import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface SlideOverProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
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
 */
export default function SlideOver({ open, title, subtitle, onClose, footer, children }: SlideOverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Callers almost always pass an inline arrow, so `onClose` gets a fresh
  // identity on every render. Holding it in a ref keeps it out of the effect's
  // dependencies — when it was a dependency, every keystroke inside the drawer
  // re-ran the effect, and `panelRef.focus()` pulled focus straight back out of
  // the field being typed into. Only the first character ever landed.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseRef.current();
    };
    document.addEventListener('keydown', onKeyDown);

    // Move focus into the drawer so keyboard users land where the action is.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = overflow;
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label={title}>
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/30"
      />

      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-lg flex-col border-l border-slate-200 bg-white shadow-modal focus:outline-none"
      >
        <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-bold tracking-[-0.02em] text-slate-950">{title}</h2>
            {subtitle ? <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}
