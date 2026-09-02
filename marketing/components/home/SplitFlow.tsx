'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, useInView, useScroll, useTransform } from 'motion/react';
import { cn } from '@/components/ui/primitives';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * §5 — the category-of-one moment. One captured hour, splitting into two jobs.
 *
 * Every competitor on the shortlist does one side of this. Time Doctor sees the
 * work and cannot pay for it; greytHR and Keka pay for work they never saw. The
 * section exists to make that structural, not rhetorical: a single line leaves
 * the captured hour and arrives in BOTH panels, and the reader watches it get
 * there.
 *
 * The two panels are `brand` and `accent` — the design system's own two hues.
 * Reaching for a third colour here (the brief says indigo) would introduce a
 * ramp that exists nowhere else on the site and does not invert with the theme.
 *
 * DIVISION OF LABOUR. Motion scrubs the panels in on scroll; anime.js draws the
 * path and flies the dot along it. That split is deliberate — `createDrawable`
 * and `createMotionPath` are the two things anime is genuinely better at, and
 * the dot in particular is doing real geometry (sampling a point and a tangent
 * along a curve) that would otherwise be hand-written trigonometry.
 *
 * The library is dynamically imported after the section is in view, so it never
 * touches the critical path — the same handling ChainHero gives it.
 */

interface Panel {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  points: ReadonlyArray<{ text: string; claim: string }>;
}

const PANELS: readonly [Panel, Panel] = [
  {
    key: 'see',
    eyebrow: 'See the work',
    title: 'The evidence and the hour are one record.',
    body: 'A desktop tracker with screenshots and OS-level idle detection, a browser extension for URL context, geofenced mobile punch. The hour is not asserted — it is shown.',
    points: [
      { text: 'Idle rewinds to the last real activity, recorded but never billed', claim: 'TIM-04' },
      { text: 'Captures queue to disk when the network drops', claim: 'TIM-01' },
      { text: 'A server-side sweep closes timers the desktop app cannot', claim: 'TIM-05' },
    ],
  },
  {
    key: 'pay',
    eyebrow: 'Pay for the work',
    title: 'The same record becomes the payslip.',
    body: 'Attendance resolves into the run. Structures, arrears, LOP, pro-rating and statutory deductions compute from it, and the bank file pays it. Nothing is re-keyed on the way.',
    points: [
      { text: 'Every payroll item versioned, with per-employee locks', claim: 'PAY-04' },
      { text: 'Arrears, LOP, pro-rating and F&F in the engine, not in a spreadsheet', claim: 'PAY-07' },
      { text: 'Unpayable people are returned as exclusions, never silently dropped', claim: 'BNK-02' },
    ],
  },
];

export function SplitFlow() {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.35 });
  const [drawn, setDrawn] = useState(false);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.85', 'start 0.25'],
  });

  const xLeft = useTransform(scrollYProgress, [0, 1], ['-11%', '0%']);
  const xRight = useTransform(scrollYProgress, [0, 1], ['11%', '0%']);
  const panelOpacity = useTransform(scrollYProgress, [0, 0.6], [0, 1]);

  useEffect(() => {
    if (reduced || !inView || drawn) return;
    let cancelled = false;

    void import('animejs')
      .then(({ createTimeline, svg }) => {
        if (cancelled || !svgRef.current) return;
        const root = svgRef.current;

        const paths = root.querySelectorAll<SVGPathElement>('[data-flow-path]');
        if (!paths.length) return;

        const tl = createTimeline();

        // Both branches draw from the junction outward, simultaneously — the
        // hour does not go to tracking FIRST and payroll second. It is one
        // record read two ways, and staggering them would argue otherwise.
        tl.add(
          svg.createDrawable(paths),
          { draw: ['0 0', '0 1'], duration: 1400, ease: 'inOut(2)' },
          0
        );

        paths.forEach((path, i) => {
          const dot = root.querySelector<SVGCircleElement>(`[data-flow-dot="${i}"]`);
          if (!dot) return;
          const motionPath = svg.createMotionPath(path);
          tl.add(
            dot,
            {
              translateX: motionPath.translateX,
              translateY: motionPath.translateY,
              opacity: [{ to: 1, duration: 120 }, { to: 0, duration: 220, delay: 900 }],
              duration: 1400,
              ease: 'inOut(2)',
            },
            0
          );
        });

        setDrawn(true);
      })
      .catch(() => {
        // The panels and their copy carry the section on their own; a missing
        // connector costs a flourish, not the argument.
        setDrawn(true);
      });

    return () => {
      cancelled = true;
    };
  }, [reduced, inView, drawn]);

  return (
    /*
     * `overflow-x-clip` is load-bearing, not tidying. The panels are scrubbed in
     * from ±11% of their own width, which by definition puts them outside the
     * layout box on the way in — at 390px that was 17px of horizontal page
     * scroll on every phone. `clip` rather than `hidden` because `hidden` makes
     * this a scroll container, which would break `position: sticky` for any
     * descendant a later edit puts inside it.
     */
    <section
      ref={ref}
      data-cursor-theme="dark"
      className="band-deep overflow-x-clip py-16 text-white sm:py-20 lg:py-24"
    >
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        {/* ── The junction ───────────────────────────────────────────── */}
        <div className="mx-auto max-w-md text-center">
          <p className="text-caption uppercase text-white/70">One record</p>
          <div className="mt-4 rounded-xl border border-white/20 bg-white/10 px-5 py-4 backdrop-blur-sm">
            <p className="font-display text-xl font-bold text-white">Every hour, captured</p>
            <p className="mt-1 text-[13px] leading-5 text-white/80">
              Mon 18 Aug · 7h 42m · 94% active · 18m idle rewound
            </p>
          </div>
        </div>

        {/*
          The connector. `preserveAspectRatio="none"` would shear the curve at
          wide viewports, so it scales uniformly and the panels meet it where
          they meet it — the branches are decorative geometry, not a diagram
          anybody measures.

          Hidden below `lg`, where the panels stack vertically and a Y-shaped
          splitter pointing at nothing would be worse than no splitter at all.
        */}
        <svg
          ref={svgRef}
          viewBox="0 0 1000 130"
          fill="none"
          aria-hidden="true"
          className="mt-2 hidden h-24 w-full lg:block"
        >
          <path
            data-flow-path
            d="M500 4 C500 60, 250 55, 220 126"
            stroke="rgb(var(--brand-400))"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            data-flow-path
            d="M500 4 C500 60, 750 55, 780 126"
            stroke="rgb(var(--accent-400))"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle data-flow-dot="0" r="4.5" fill="rgb(var(--brand-300))" opacity="0" />
          <circle data-flow-dot="1" r="4.5" fill="rgb(var(--accent-300))" opacity="0" />
        </svg>

        {/* ── The two jobs ───────────────────────────────────────────── */}
        <div className="mt-8 grid gap-5 lg:mt-2 lg:grid-cols-2 lg:gap-6">
          {PANELS.map((panel, i) => (
            <motion.div
              key={panel.key}
              style={
                reduced
                  ? undefined
                  : { x: i === 0 ? xLeft : xRight, opacity: panelOpacity }
              }
              className={cn(
                'rounded-2xl border p-6 sm:p-7',
                i === 0
                  ? 'border-brand-400/35 bg-brand-950/35'
                  : 'border-accent-400/35 bg-accent-900/30'
              )}
            >
              <p
                className={cn(
                  'text-caption uppercase',
                  i === 0 ? 'text-brand-200' : 'text-accent-200'
                )}
              >
                {panel.eyebrow}
              </p>
              <h3 className="mt-3 font-display text-xl leading-tight font-bold text-balance text-white sm:text-2xl">
                {panel.title}
              </h3>
              <p className="mt-3 text-[15px] leading-7 text-pretty text-white/80">{panel.body}</p>

              <ul className="mt-5 grid gap-2.5">
                {panel.points.map((p) => (
                  <li
                    key={p.text}
                    data-claim={p.claim}
                    className="flex gap-2.5 text-[13.5px] leading-6 text-white/85"
                  >
                    <span
                      className={cn(
                        'mt-2 h-1.5 w-1.5 shrink-0 rounded-full',
                        i === 0 ? 'bg-brand-300' : 'bg-accent-300'
                      )}
                      aria-hidden="true"
                    />
                    <span>{p.text}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-[15px] leading-7 text-pretty text-white/85">
          Hours captured become salary paid. No re-entry, no reconciliation, and no export between
          the tool that watched the work and the tool that pays for it.
        </p>
      </div>
    </section>
  );
}
