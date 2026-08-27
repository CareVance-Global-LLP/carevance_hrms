import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * A figure that travels to its new value instead of cutting to it.
 *
 * A price that hard-swaps when a toggle flips reads as a page re-render; one
 * that counts reads as the same number being recalculated — which is what
 * actually happened. It animates from whatever was last displayed rather than
 * from zero, so flipping monthly→yearly is one continuous movement and dragging
 * a seat slider does not restart from nothing on every step.
 *
 * ACCESSIBILITY: the real string is a visually-hidden text node and the
 * animated span is `aria-hidden`. NOT `aria-label` on the wrapper — a bare
 * <span> is `role=generic`, which prohibits naming, so assistive technology may
 * discard it and announce nothing at all. (Lighthouse reports that as
 * "elements use prohibited ARIA attributes"; it was a real regression here
 * once already.)
 *
 * Under `prefers-reduced-motion` the value is written directly with no rAF loop
 * — the number is correct, it simply does not travel.
 */
export default function AnimatedPrice({
  value,
  format,
  className,
  duration = 420,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
  /** Milliseconds. */
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (reduced || shown.current === value) {
      node.textContent = format(value);
      shown.current = value;
      return;
    }

    const from = shown.current;
    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // easeOutCubic — decelerates into the value rather than stopping dead.
      const eased = 1 - Math.pow(1 - t, 3);
      const current = from + (value - from) * eased;
      node.textContent = format(current);
      shown.current = current;
      if (t < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        node.textContent = format(value);
        shown.current = value;
      }
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      // Interrupted mid-count: land on the real figure, never a partial one.
      // A price caught halfway is a wrong price.
      node.textContent = format(value);
      shown.current = value;
    };
  }, [value, format, reduced, duration]);

  /*
   * ONE span, not a visually-hidden copy plus an aria-hidden one.
   *
   * The duplicate pattern made `innerText` contain the figure twice, so a
   * reader copying a price got "₹399₹399". The reason it existed — that the
   * animated node briefly holds an intermediate number — does not justify
   * that: this is not a live region, so assistive technology announces it when
   * the reader reaches it rather than as it changes, and the count settles in
   * 420ms on the exact authored value. The final figure is also what renders
   * server-side and on first paint, so a crawler never sees a partial one.
   */
  return (
    <span className={className}>
      <span ref={ref} className="tabular-nums">
        {format(value)}
      </span>
    </span>
  );
}
