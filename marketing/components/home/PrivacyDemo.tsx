'use client';

import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'motion/react';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * §8 — privacy, demonstrated rather than asserted.
 *
 * Time Doctor's page says "privacy-first". So does everyone's. The sentence
 * costs nothing to write and is therefore worth nothing to read, which is why
 * this section spends its budget on a two-second demonstration instead: the
 * capture on screen goes out of focus as the reader scrolls, and a lock takes
 * its place. Whatever else they forget, they remember that the screenshot
 * disappeared.
 *
 * The blur is scrubbed rather than triggered, because the point is the
 * THRESHOLD — the reader sees the capture legible, then not, and the crossing
 * is the argument. A single triggered transition would just look like a load
 * state.
 *
 * `filter` is the one property here that is not transform or opacity, and it is
 * a deliberate exception: blur is compositor-accelerated in every browser this
 * site supports, and there is no way to express "this became unreadable" in the
 * two cheap properties. It runs on ONE element, on one section, below the fold.
 *
 * Under `prefers-reduced-motion` the card renders in its blurred end state with
 * the lock already shown. The demonstration survives; only the scrub is gone.
 */

export function PrivacyDemo({
  capture,
  points,
}: {
  capture: ReactNode;
  points: ReadonlyArray<{ title: string; body: string; claim: string }>;
}) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.75', 'end 0.65'],
  });

  const filter = useTransform(scrollYProgress, [0.25, 0.65], ['blur(0px)', 'blur(9px)']);
  const captureOpacity = useTransform(scrollYProgress, [0.25, 0.65], [1, 0.55]);
  const lockOpacity = useTransform(scrollYProgress, [0.35, 0.7], [0, 1]);
  const lockScale = useTransform(scrollYProgress, [0.35, 0.7], [0.9, 1]);

  return (
    <section className="bg-sunken py-16 sm:py-20 lg:py-24">
      <div className="mx-auto w-full max-w-6xl px-5 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-caption uppercase text-brand-700">Monitoring people can live with</p>
          <h2 className="mt-3 font-display text-title text-balance text-n-900">
            The tracker asks first, and stops looking when told.
          </h2>
          <p className="mt-4 text-lg leading-8 text-pretty text-n-600">
            Consent is a gate every capture path passes through, not a checkbox in a settings page.
            An employee who withdraws it is not captured — the code path ends, rather than
            capturing and hiding.
          </p>
        </div>

        <div
          ref={ref}
          className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:items-center lg:gap-12"
        >
          {/* ── The demonstration ────────────────────────────────────── */}
          <div className="relative">
            <motion.div
              style={
                reduced
                  ? { filter: 'blur(9px)', opacity: 0.55 }
                  : { filter, opacity: captureOpacity }
              }
              className="will-change-[filter]"
            >
              {capture}
            </motion.div>

            <motion.div
              style={reduced ? { opacity: 1 } : { opacity: lockOpacity, scale: lockScale }}
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              <div className="flex max-w-[17rem] flex-col items-center rounded-xl border border-n-200 bg-card px-5 py-4 text-center shadow-modal">
                <svg
                  viewBox="0 0 24 24"
                  className="h-5 w-5 text-brand-700"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="4" y="10.5" width="16" height="10" rx="2" />
                  <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
                </svg>
                <p className="mt-2.5 text-[13.5px] leading-5 font-semibold text-n-900">
                  Consent withdrawn — capture stops
                </p>
                <p className="mt-1 text-[12px] leading-4 text-n-600">
                  Not captured and hidden. Not captured at all.
                </p>
              </div>
            </motion.div>
          </div>

          {/* ── The rules behind it ──────────────────────────────────── */}
          <ul className="grid gap-4">
            {points.map((p) => (
              <li
                key={p.title}
                data-claim={p.claim}
                className="rounded-xl border border-n-200 bg-card p-4 shadow-card"
              >
                <p className="text-[14px] font-semibold text-n-900">{p.title}</p>
                <p className="mt-1 text-[13px] leading-5 text-n-600">{p.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
