import { useEffect, useRef, useState } from 'react';
import { useInView } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * §7 — the arrows drawn between the workflow step cards.
 *
 * A DECORATION THAT MUST NOT BECOME CONTENT. The steps are an ordered list and
 * already read as a sequence to anybody who cannot see this; the arrows say
 * nothing the list does not. So the whole overlay is `aria-hidden` and
 * absolutely positioned, never affecting layout — if the import fails, the
 * section is exactly what it was.
 *
 * Positioned by percentage across the row rather than measured from the cards.
 * A ResizeObserver reading four card positions would be more precise and far
 * more fragile: the grid is N equal columns with a fixed gap, so the gaps sit
 * at fixed fractions of the width. That is a fact of the layout, not something
 * to discover at runtime.
 *
 * Hidden below `lg`, where the cards stack vertically and a left-to-right arrow
 * would point at nothing.
 */
export default function StepArrows({ count = 4 }: { count?: number }) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [drawn, setDrawn] = useState(false);

  const gaps = Array.from({ length: count - 1 }, (_, i) => ((i + 1) / count) * 100);

  useEffect(() => {
    if (reduced || !inView || drawn) return;
    let cancelled = false;

    void import('animejs')
      .then(({ createTimeline, svg }) => {
        if (cancelled || !ref.current) return;
        const paths = ref.current.querySelectorAll<SVGPathElement>('[data-step-arrow]');
        if (!paths.length) return;

        const tl = createTimeline();
        paths.forEach((path, i) => {
          tl.add(
            svg.createDrawable(path),
            { draw: ['0 0', '0 1'], duration: 600, ease: 'inOut(2)' },
            // Each starts as the previous lands: the reader is following a
            // sequence, and arrows drawing at once would not be one.
            i * 700
          );
        });
        setDrawn(true);
      })
      .catch(() => setDrawn(true));

    return () => {
      cancelled = true;
    };
  }, [reduced, inView, drawn]);

  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none absolute inset-0 hidden lg:block">
      {gaps.map((left) => (
        <svg
          key={left}
          viewBox="0 0 40 16"
          fill="none"
          className="absolute top-16 h-4 w-10 -translate-x-1/2"
          style={{ left: `${left}%` }}
        >
          {/*
            No dash attributes here, so the arrow renders COMPLETE by default
            and `createDrawable` supplies them only when the draw actually runs.
            Authoring it hidden and revealing it with JS would leave the arrows
            permanently missing under `prefers-reduced-motion`, and for anyone
            whose bundle never arrives.
          */}
          <path
            data-step-arrow
            d="M2 8h30M26 3l6 5-6 5"
            stroke="rgb(var(--brand-400))"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ))}
    </div>
  );
}
