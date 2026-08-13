import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';

const GAP = 6;
const EDGE = 8;

interface AnchoredMenuOptions {
  /** Which edge of the menu lines up with the anchor. Defaults to 'right'. */
  align?: 'left' | 'right';
  /** Menu width in px. Fixed rather than measured so the first paint is placed. */
  width: number;
  /** Called when the anchor scrolls out of sight. See the note in place(). */
  onDismiss?: () => void;
}

/**
 * Positions a fixed-position menu against an anchor, for menus that must escape
 * a scrolling ancestor.
 *
 * The employee roster's row menu was `absolute` inside the table's
 * `overflow-x-auto` wrapper. An absolutely-positioned box is still clipped by a
 * scroll container, so the menu was cut off at the wrapper's edge — on the last
 * row only the first item was visible, sliced in half. The wrapper cannot lose
 * its overflow (the table is genuinely wider than the viewport), so the menu
 * has to leave the container instead, via a portal, which means it also has to
 * carry its own coordinates.
 *
 * Distinct from useFloatingDropdown, which sizes the panel to the anchor's
 * width. That is right for a select, whose trigger is the full field; it is
 * wrong for a 28px icon button.
 */
export default function useAnchoredMenu(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  { align = 'right', width, onDismiss }: AnchoredMenuOptions,
) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [style, setStyle] = useState<CSSProperties | null>(null);

  // Held in a ref so `place` stays stable across renders; callers pass inline
  // arrows, and a changing identity would re-subscribe the scroll listener on
  // every scroll event it handles.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const rect = anchor.getBoundingClientRect();

    /*
     * Once the anchor has scrolled out of sight the menu has nothing to point
     * at, and the viewport clamp below would otherwise pin it to the edge of
     * the screen — a menu floating in the corner, acting on a row you can no
     * longer see. Close it instead.
     */
    if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) {
      onDismissRef.current?.();
      return;
    }
    // Measured when available so a menu with a Remove item flips on its real
    // height; the estimate only has to hold for the very first paint.
    const height = menuRef.current?.offsetHeight || 180;

    const spaceBelow = window.innerHeight - rect.bottom;
    const flipUp = spaceBelow < height + GAP && rect.top > spaceBelow;

    const unclamped = align === 'right' ? rect.right - width : rect.left;
    const left = Math.min(Math.max(unclamped, EDGE), Math.max(EDGE, window.innerWidth - width - EDGE));

    const room = (flipUp ? rect.top : spaceBelow) - GAP - EDGE;
    /*
     * Only cap the height when the menu genuinely does not fit. `overflow-y:
     * auto` computes `overflow-x` to `auto` as well, which clips a nested
     * flyout submenu — DepartmentBoard's "Move to department" opens sideways
     * out of its parent panel, so an unconditional scroller would trade one
     * clipping bug for another. These menus are a handful of rows; the cap is
     * a backstop for a short viewport, not the normal path.
     */
    const constrained = height > room;

    setStyle({
      position: 'fixed',
      left,
      width,
      zIndex: 80,
      ...(flipUp ? { bottom: window.innerHeight - rect.top + GAP } : { top: rect.bottom + GAP }),
      ...(constrained ? { maxHeight: room, overflowY: 'auto' as const } : null),
    });
  }, [anchorRef, align, width]);

  useLayoutEffect(() => {
    if (!open) {
      setStyle(null);
      return;
    }
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    /*
     * Capture phase so the horizontal scroll of the table wrapper counts, not
     * just the window's own scrolling — the anchor moves with it.
     */
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return { menuRef, style };
}
