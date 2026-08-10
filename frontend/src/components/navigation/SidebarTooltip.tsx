/**
 * The label for a collapsed rail item.
 *
 * Portalled to `document.body` rather than positioned inside the rail: the nav
 * is an `overflow-y-auto` column, so a tooltip rendered as a child would be
 * clipped at the rail's edge — which is the one direction it needs to go.
 *
 * Hover *and* focus both open it, so a keyboard user tabbing down a collapsed
 * rail can still tell what each icon is.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { claimOverlay, releaseOverlay } from '@/components/navigation/overlayRegistry';

/** Long enough that sweeping the cursor across the rail doesn't flash six of them. */
const OPEN_DELAY_MS = 300;
const GAP_PX = 10;

export interface SidebarTooltipProps {
  label: string;
  /** Appended after the label, e.g. "7 pending". */
  detail?: string;
  /** When false the trigger renders alone — the expanded rail needs no tooltip. */
  enabled?: boolean;
  children: (props: {
    ref: (node: HTMLElement | null) => void;
    'aria-describedby': string | undefined;
    onMouseEnter: () => void;
    onMouseLeave: () => void;
    onFocus: () => void;
    onBlur: () => void;
  }) => ReactNode;
}

export default function SidebarTooltip({ label, detail, enabled = true, children }: SidebarTooltipProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const tooltipId = useId();

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const place = useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    setPosition({ top: rect.top + rect.height / 2, left: rect.right + GAP_PX });
  }, []);

  const hide = useCallback(() => {
    clearTimer();
    setOpen(false);
    releaseOverlay(hideRef.current);
  }, []);

  // The registry compares by identity, so it needs a stable reference.
  const hideRef = useRef(hide);
  hideRef.current = hide;

  const show = useCallback(
    (immediate: boolean) => {
      if (!enabled) return;
      clearTimer();
      const reveal = () => {
        // Shared with SidebarFlyout: a tooltip and a submenu must never be on
        // screen together.
        claimOverlay(hideRef.current);
        place();
        setOpen(true);
      };
      // Focus reveals immediately: a keyboard user has already committed to the
      // item, so a delay just reads as lag.
      if (immediate) reveal();
      else timerRef.current = window.setTimeout(reveal, OPEN_DELAY_MS);
    },
    [enabled, place]
  );

  // Collapsing the rail while a tooltip is open would leave it stranded.
  useEffect(() => {
    if (!enabled) hide();
  }, [enabled, hide]);

  // Unmounting while open would otherwise leave a dead closer in the registry.
  useEffect(
    () => () => {
      clearTimer();
      releaseOverlay(hideRef.current);
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    // Scrolling the nav moves the trigger out from under a fixed tooltip.
    const onScrollOrResize = () => hide();
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
    };
  }, [hide, open]);

  const setRef = useCallback((node: HTMLElement | null) => {
    triggerRef.current = node;
  }, []);

  return (
    <>
      {children({
        ref: setRef,
        'aria-describedby': open ? tooltipId : undefined,
        onMouseEnter: () => show(false),
        onMouseLeave: hide,
        onFocus: () => show(true),
        onBlur: hide,
      })}

      {open && position
        ? createPortal(
            <div
              id={tooltipId}
              role="tooltip"
              style={{ top: position.top, left: position.left }}
              className="pointer-events-none fixed z-[300] -translate-y-1/2 whitespace-nowrap rounded-md border border-white/12 bg-[#1D272F] px-2 py-1 text-xs font-medium text-[#E6EDF0] shadow-lg"
            >
              {label}
              {detail ? <span className="text-[#E6EDF0]/60"> · {detail}</span> : null}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
