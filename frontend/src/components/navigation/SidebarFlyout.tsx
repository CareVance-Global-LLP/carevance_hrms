/**
 * The submenu that opens beside a collapsed group.
 *
 * A group is a disclosure in both rail states: expanded it opens its children
 * below itself, collapsed it opens the same children beside itself. Same
 * semantics, same `aria-expanded` — only the position changes.
 *
 * The defining behaviour is that it **does not close on mouse-leave**. That is
 * deliberate, not an oversight. A hover menu that closes on leave has to defend
 * against the diagonal path from the icon to the item, which passes outside
 * both — the usual fixes are close-delays and "safe triangle" hit-testing.
 * Staying open removes the problem instead of compensating for it, and makes
 * the panel reachable by any route.
 *
 * It still closes on everything that means "done": a click outside, Escape,
 * opening another overlay, tabbing past the last link, scrolling, resizing, or
 * clicking a link inside it.
 */

import { useCallback, useEffect, useId, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { claimOverlay, releaseOverlay } from '@/components/navigation/overlayRegistry';
import { cn } from '@/utils/cn';

/** Enough that sweeping the cursor down the rail doesn't fire every panel. */
const HOVER_INTENT_MS = 150;
/** Keep the panel off the very edge of the viewport. */
const EDGE_PX = 8;
/** Nudge up so the panel's first item lines up near the icon, not below it. */
const RISE_PX = 8;
/** Rows arrive in sequence; enough to feel deliberate, not enough to delay. */
export const ROW_STAGGER_MS = 30;

export interface FlyoutTriggerProps {
  ref: (node: HTMLElement | null) => void;
  'aria-haspopup': 'true';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onFocus: () => void;
}

export interface SidebarFlyoutProps {
  /** Group name; becomes the panel's heading and its accessible label. */
  label: string;
  /** The group's own icon — shown in the header chip and as the watermark. */
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  /** One line on what the section is for. */
  blurb?: string;
  /** How many links the panel holds. */
  count?: number;
  /** False on the expanded rail, where children render inline instead. */
  enabled?: boolean;
  /** The group's links. */
  children: ReactNode;
  trigger: (props: FlyoutTriggerProps) => ReactNode;
}

export default function SidebarFlyout({
  label,
  icon: Icon,
  blurb,
  count,
  enabled = true,
  children,
  trigger,
}: SidebarFlyoutProps) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; originY: number } | null>(null);

  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<number | null>(null);
  const panelId = useId();
  const headingId = `${panelId}-heading`;

  const clearTimer = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const close = useCallback(() => {
    clearTimer();
    setOpen(false);
    releaseOverlay(closeRef.current);
  }, []);

  // The registry compares by identity, so it needs a stable reference.
  const closeRef = useRef(close);
  closeRef.current = close;

  const place = useCallback(() => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const panelHeight = panelRef.current?.offsetHeight ?? 0;

    // Flip upward rather than run off the bottom — Settings sits at the foot of
    // a rail of thirteen groups and its panel would otherwise be unreachable.
    let top = rect.top - RISE_PX;
    if (panelHeight && top + panelHeight > window.innerHeight - EDGE_PX) {
      top = Math.max(EDGE_PX, window.innerHeight - panelHeight - EDGE_PX);
    }

    /*
     * The panel butts against the rail's outer edge, not the trigger's — the
     * trigger is inset by the nav's padding, so anchoring to it would leave the
     * gap this is meant to remove. Measured from the rail so the join is exact
     * regardless of that padding.
     *
     * The gap could only be closed once the panel stopped closing on
     * mouse-leave: in a close-on-leave menu the gap is the cursor's route.
     */
    const rail = node.closest('[data-sidebar-rail]');
    const left = rail ? rail.getBoundingClientRect().right : rect.right;

    /*
     * The panel grows from where it meets the icon, which is the trigger's
     * centre — not the panel's top. On a flipped panel those are far apart, so
     * the origin is clamped inside the panel's own edges.
     */
    const iconCentre = rect.top + rect.height / 2;
    const originY = Math.min(Math.max(iconCentre - top, 16), Math.max(16, panelHeight - 16));

    setPosition({ top, left, originY });
  }, []);

  const show = useCallback(
    (immediate: boolean) => {
      if (!enabled) return;
      clearTimer();
      const reveal = () => {
        claimOverlay(closeRef.current);
        place();
        setOpen(true);
      };
      // Focus opens at once: a keyboard user has already committed.
      if (immediate) reveal();
      else timerRef.current = window.setTimeout(reveal, HOVER_INTENT_MS);
    },
    [enabled, place]
  );

  /** Cancels a pending open. Deliberately does not close an open panel. */
  const cancelPending = useCallback(() => clearTimer(), []);

  // Expanding the rail (or unmounting) must not strand a panel.
  useEffect(() => {
    if (!enabled) close();
  }, [close, enabled]);

  useEffect(
    () => () => {
      clearTimer();
      releaseOverlay(closeRef.current);
    },
    []
  );

  // Measure after the panel exists, so the flip decision uses a real height.
  useEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close();
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    };

    // The anchor moves when anything scrolls, so reposition rather than lie.
    const onScroll = () => close();
    const onResize = () => close();

    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [close, open]);

  /** Tab past the last link leaves the rail; don't leave the panel behind. */
  const handlePanelBlur = (event: React.FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Node | null;
    if (!next) return;
    if (panelRef.current?.contains(next) || triggerRef.current?.contains(next)) return;
    close();
  };

  return (
    <>
      {trigger({
        ref: (node) => {
          triggerRef.current = node;
        },
        'aria-haspopup': 'true',
        'aria-expanded': open,
        'aria-controls': open ? panelId : undefined,
        onMouseEnter: () => show(false),
        onMouseLeave: cancelPending,
        onFocus: () => show(true),
      })}

      {open && position
        ? createPortal(
            <div
              ref={panelRef}
              id={panelId}
              role="group"
              aria-labelledby={headingId}
              style={{ top: position.top, left: position.left, transformOrigin: `0px ${position.originY}px` }}
              onBlur={handlePanelBlur}
              // Selecting a destination ends the interaction.
              onClick={(event) => {
                if ((event.target as HTMLElement).closest('a')) close();
              }}
              className={cn(
                'fixed z-[220] w-[16.5rem] overflow-hidden',
                // Square on the left so it meets the rail as one surface;
                // rounded on the right where it is a free edge.
                'rounded-l-none rounded-r-lg border border-l-0 border-[var(--sidebar-flyout-border)]',
                'bg-[var(--sidebar-flyout-bg)] shadow-[0_20px_50px_-16px_rgba(0,0,0,0.7)]',
                'motion-safe:animate-[flyoutIn_.2s_cubic-bezier(.2,.9,.25,1)]'
              )}
            >
              {/*
                The group's own icon, oversized and barely there, bleeding off
                the corner. Costs nothing and stops the lower half of a short
                panel reading as dead space.
              */}
              <Icon
                aria-hidden="true"
                className="pointer-events-none absolute -bottom-6 -right-6 h-32 w-32 text-white opacity-[0.04]"
              />

              <div className="relative flex items-start gap-2.5 px-3.5 pb-2.5 pt-3.5">
                <span
                  aria-hidden="true"
                  className="grid h-[2.1rem] w-[2.1rem] shrink-0 place-items-center rounded-[0.55rem] bg-[var(--sidebar-accent-soft)] text-[var(--sidebar-accent)]"
                >
                  <Icon className="h-[0.95rem] w-[0.95rem]" aria-hidden="true" />
                </span>

                <span className="min-w-0 flex-1 pt-0.5">
                  <span id={headingId} className="block text-[0.92rem] font-bold leading-tight tracking-[-0.01em] text-[#EDF3F5]">
                    {label}
                  </span>
                  {blurb ? <span className="mt-0.5 block text-[0.68rem] leading-snug text-white/55">{blurb}</span> : null}
                </span>

                {count ? (
                  <span
                    aria-hidden="true"
                    className="mt-1 shrink-0 rounded-full border border-white/15 px-1.5 font-mono text-[0.62rem] leading-[1.15rem] text-white/55"
                  >
                    {count}
                  </span>
                ) : null}
              </div>

              <div aria-hidden="true" className="mx-3.5 mb-1 h-px bg-[var(--sidebar-flyout-line)]" />

              <div className="relative space-y-0.5 px-2 pb-2.5">{children}</div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
