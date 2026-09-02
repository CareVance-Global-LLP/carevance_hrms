'use client';

import { useEffect, type RefObject } from 'react';

/**
 * Lenis smooth scroll, alive only while one section is on screen.
 *
 * The brief is explicit that Lenis is NOT site-wide: taking over the scroll for
 * a whole visit costs more than it returns — it desynchronises the scrollbar
 * thumb, fights trackpad momentum on macOS, and makes Find-in-page jump oddly.
 * What it genuinely buys is a scrubbed section, where the reader is dragging a
 * timeline rather than reading, and native scroll's per-event granularity shows
 * up as stepping.
 *
 * So it is instantiated when the tour intersects and destroyed when it leaves.
 * Two details make that switch invisible rather than jarring:
 *
 *   · A GENEROUS rootMargin. Lenis is running well before the section's first
 *     pixel arrives, so the handover happens where nobody is looking. Creating
 *     it exactly at the boundary is what would produce a visible lurch.
 *   · `lerp` close to 1 (light smoothing). Heavy smoothing inside a scrubbed
 *     section makes the sticky frame lag the scrollbar, which reads as jank
 *     rather than polish — the opposite of the point.
 *
 * Under `prefers-reduced-motion` no instance is ever created: smooth scroll is
 * exactly the interpolation that setting asks us to stop doing.
 */
export function useLenisWhileInView(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean
) {
  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    let lenis: { raf: (t: number) => void; destroy: () => void } | null = null;
    let raf = 0;
    let cancelled = false;

    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      lenis?.destroy();
      lenis = null;
    };

    const start = async () => {
      if (lenis || cancelled) return;
      // Dynamic import: Lenis is ~10 KB and is needed by exactly one section on
      // one route, so it must never sit in the initial bundle.
      const { default: Lenis } = await import('lenis');
      if (cancelled) return;

      lenis = new Lenis({ lerp: 0.14, wheelMultiplier: 1 });
      const tick = (time: number) => {
        lenis?.raf(time);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void start();
        else stop();
      },
      { rootMargin: '60% 0px 60% 0px' }
    );

    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
      stop();
    };
  }, [ref, enabled]);
}
