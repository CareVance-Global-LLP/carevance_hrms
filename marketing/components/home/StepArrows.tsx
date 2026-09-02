'use client';

import { useEffect, useRef, useState } from 'react';
import { useInView } from 'motion/react';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * §7 — the two arrows between the three switching steps.
 *
 * A DECORATION THAT MUST NOT BECOME CONTENT. The steps are an ordered list and
 * already read as a sequence to anybody who cannot see this; the arrows say
 * nothing the `<ol>` does not. So the whole thing is `aria-hidden` and lives in
 * an absolutely-positioned overlay that never affects layout — if it fails to
 * load, the section is exactly what it was.
 *
 * Hidden below `lg`, where the cards stack vertically and a left-to-right arrow
 * would point at nothing.
 *
 * Positioned by percentage across the row rather than measured from the cards.
 * A ResizeObserver reading three card positions would be more precise and far
 * more fragile — the grid is three equal columns with a fixed gap, so the gaps
 * are at fixed fractions of the width, and that is a fact of the layout rather
 * than something to discover at runtime.
 */
export function StepArrows() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.4 });
  const [drawn, setDrawn] = useState(false);

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
            // The second arrow starts as the first lands: the reader follows a
            // sequence, and two arrows drawing at once would not be one.
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
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 hidden lg:block"
    >
      {[33.3, 66.6].map((left) => (
        <svg
          key={left}
          viewBox="0 0 40 16"
          fill="none"
          className="absolute top-12 h-4 w-10 -translate-x-1/2"
          style={{ left: `${left}%` }}
        >
          {/*
            No dash attributes here, so the arrow renders COMPLETE by default
            and `createDrawable` supplies them only when the draw actually runs.
            Authoring it hidden and revealing it with JS would leave the arrows
            permanently missing under `prefers-reduced-motion` and for anyone
            whose bundle never arrives — the same fail-visible rule the hero
            chain follows.
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
