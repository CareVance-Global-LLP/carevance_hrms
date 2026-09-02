'use client';

import { useRef, useState, type ReactNode } from 'react';
import {
  AnimatePresence,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from 'motion/react';
import { cn } from '@/components/ui/primitives';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';
import { useLenisWhileInView } from '@/components/motion/useLenisWhileInView';

/**
 * §4 — the scroll-linked product tour. Track → Attend → Approve → Pay.
 *
 * A sticky frame on the left holds one real screen at a time; four step blocks
 * scroll past on the right and decide which one that is. The reader controls
 * the pace, which is the whole advantage over a product video: nobody can pause
 * a video on the frame they did not understand and read the annotation beside
 * it.
 *
 * FOUR THINGS ARE LOAD-BEARING.
 *
 * 1. THE SCREENS ARRIVE AS PROPS. This is a client component; importing
 *    lib/demo or components/product/screens here would pull the entire demo
 *    dataset and every screen mock into the browser bundle for the four this
 *    actually renders. The server page builds the array. Same rule as
 *    ChainHero, and the same ~9 KB at stake.
 *
 * 2. THE STEP INDEX IS FLOORED, NOT ROUNDED. Rounding a 0→1 progress mapped
 *    onto [0,1,2,3] switches the frame at the MIDDLE of each block — the screen
 *    changes while the reader is still on the paragraph describing the previous
 *    one. Flooring switches exactly at the boundary between blocks, which is
 *    where the reader's eye already is.
 *
 * 3. THE MOBILE FALLBACK IS NOT THIS. Below `lg` the sticky column is dropped
 *    entirely and each step renders its own screen inline, as a plain stacked
 *    list. Pinning a section on a phone fights the browser's own address-bar
 *    collapse, and it is where scrollytelling reliably turns to jank.
 *
 * 4. EVERY STEP'S TEXT IS IN THE SERVER HTML at all times, and only the imagery
 *    is swapped. A crawler, an answer engine and a reader whose JS failed all
 *    get the complete argument; the choreography is enhancement on top of it.
 */

export interface TourCallout {
  /** Percentage position over the sticky frame. */
  x: number;
  y: number;
  text: string;
}

export interface TourStep {
  key: string;
  label: string;
  title: string;
  body: string;
  claim: string;
  screen: ReactNode;
  callouts: readonly TourCallout[];
}

export function ProductTour({ steps }: { steps: readonly TourStep[] }) {
  const reduced = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLOListElement>(null);
  const [step, setStep] = useState(0);

  const { scrollYProgress } = useScroll({
    target: trackRef,
    offset: ['start start', 'end end'],
  });

  useMotionValueEvent(scrollYProgress, 'change', (p) => {
    if (reduced) return;
    const next = Math.min(steps.length - 1, Math.max(0, Math.floor(p * steps.length)));
    setStep(next);
  });

  /* The rail's fill. Scaled from the top, so it reads as a line being drawn
     downward rather than a bar growing out of nothing. */
  const railScale = useTransform(scrollYProgress, (p) => Math.max(0.02, p));

  useLenisWhileInView(sectionRef, !reduced);

  const current = steps[step] ?? steps[0];

  return (
    <div ref={sectionRef} className="relative">
      <div className="lg:grid lg:grid-cols-[1.5rem_minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-x-8 xl:gap-x-12">
        {/* ── The rail ─────────────────────────────────────────────────── */}
        <div className="hidden lg:block" aria-hidden="true">
          <div className="sticky top-28 flex justify-center">
            {/* One rail: the dots sit ON the line, not under it. A detached
                column of dots beside a separate bar reads as two indicators
                disagreeing about the same thing. */}
            <div className="relative h-44 w-px bg-n-200">
              <motion.div
                className="absolute inset-x-0 top-0 h-full origin-top bg-brand-600"
                style={reduced ? { scaleY: 1 } : { scaleY: railScale }}
              />
              {steps.map((s, i) => (
                <span
                  key={s.key}
                  style={{ top: `${(i / (steps.length - 1)) * 100}%` }}
                  className={cn(
                    'absolute left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-sunken transition-colors duration-300',
                    i <= step ? 'bg-brand-600' : 'bg-n-300'
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        {/* ── The sticky frame ─────────────────────────────────────────── */}
        <div className="hidden lg:block">
          {/*
            Centred in the viewport, not pinned to its top. The step copy beside
            it is vertically centred in a full-height block, and a frame stuck to
            `top-28` sits visibly higher than the sentence describing it.
          */}
          <div className="sticky top-24 flex min-h-[calc(100vh-11rem)] items-center">
            {/*
              A reserved box. The four screens are different heights, and a
              sticky frame that resizes on every swap makes the markers jump —
              so the tallest wins and the rest sit centred inside it.
            */}
            <div className="relative flex min-h-[26rem] w-full items-center">
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={current.key}
                  initial={reduced ? false : { opacity: 0, scale: 0.965 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={reduced ? undefined : { opacity: 0, scale: 0.985 }}
                  transition={{ duration: 0.4, ease: [0.22, 0.61, 0.36, 1] }}
                  className="w-full min-w-0"
                >
                  {current.screen}
                </motion.div>
              </AnimatePresence>

              {/* Callouts sit above the frame and are keyed to the step, so
                  they arrive with their screen and leave with it. */}
              <AnimatePresence initial={false}>
                {current.callouts.map((c, i) => (
                  <Callout
                    key={`${current.key}-${c.text}`}
                    callout={c}
                    index={i}
                    delay={0.3 + i * 0.12}
                    reduced={reduced}
                  />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* ── The steps ────────────────────────────────────────────────── */}
        <ol ref={trackRef} className="grid gap-12 lg:block">
          {steps.map((s, i) => (
            <li
              key={s.key}
              data-claim={s.claim}
              className="flex flex-col justify-center lg:min-h-screen"
            >
              <div
                className={cn(
                  'transition-opacity duration-500',
                  /* Off-step blocks recede on desktop, so the reader is told
                     which paragraph the frame is currently answering. */
                  !reduced && i !== step ? 'lg:opacity-45' : 'lg:opacity-100'
                )}
              >
                <p className="text-caption uppercase text-brand-700">
                  Step {i + 1} · {s.label}
                </p>
                <h3 className="mt-3 font-display text-2xl leading-tight font-bold text-balance text-n-900">
                  {s.title}
                </h3>
                <p className="mt-3 leading-7 text-pretty text-n-600">{s.body}</p>

                {/* The legend the markers on the frame point at. Numbers, not
                    bullets — ② here is ② over there. On mobile the markers are
                    absent along with the sticky frame, and this still reads as
                    an ordinary list. */}
                <ol className="mt-4 grid gap-2">
                  {s.callouts.map((c, ci) => (
                    <li key={c.text} className="flex gap-2.5 text-[13.5px] leading-6 text-n-700">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-bold text-brand-800 tnum">
                        {ci + 1}
                      </span>
                      <span>{c.text}</span>
                    </li>
                  ))}
                </ol>

                {/* The mobile fallback: the screen, inline, nothing pinned. */}
                <div className="mt-6 lg:hidden">{s.screen}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

/**
 * A numbered marker over the frame.
 *
 * IT CARRIES NO LABEL, AND THAT IS THE POINT. The first version put the caption
 * on the screenshot beside its dot, which covered the exact table row it was
 * pointing at — "Override #418 — named, not just diffed" sat on top of the
 * Override #418 row. An annotation that hides its own subject is worse than no
 * annotation.
 *
 * So the marker is a number and the sentence lives in the numbered list beside
 * the frame, where there is room for it to be a full sentence and where a
 * screen reader reaches it as text rather than as a floating label. The reader
 * matches ② on the screen to ② in the list, which is how every annotated
 * diagram in print has worked for a century.
 *
 * The pulse is a SEPARATE absolutely-positioned ring rather than an animation
 * on the marker itself: scaling the marker would scale its digit too, and a
 * number that breathes is a number nobody can read.
 */
function Callout({
  callout,
  index,
  delay,
  reduced,
}: {
  callout: TourCallout;
  index: number;
  delay: number;
  reduced: boolean;
}) {
  return (
    <motion.div
      /*
       * The coordinate is the marker's CENTRE, not its top-left corner. With
       * the corner as the anchor a marker placed at the row it refers to lands
       * ON that row's first word — the first version put ① squarely over the
       * word "Draft". Centring it, and keeping x near the frame's left edge,
       * puts the marker half in the gutter and half on the border, where it
       * indicates a row without covering one.
       */
      className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${callout.x}%`, top: `${callout.y}%` }}
      initial={reduced ? false : { opacity: 0, scale: 0.7 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reduced ? undefined : { opacity: 0 }}
      transition={{ duration: 0.35, delay: reduced ? 0 : delay, ease: [0.22, 0.61, 0.36, 1] }}
    >
      <span className="relative flex h-5 w-5">
        {!reduced && (
          <motion.span
            className="absolute inset-0 rounded-full bg-brand-500"
            animate={{ scale: [1, 2], opacity: [0.5, 0] }}
            transition={{ duration: 2, repeat: Infinity, ease: 'easeOut' }}
          />
        )}
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-brand-700 text-[11px] font-bold text-on-brand tnum ring-2 ring-card">
          {index + 1}
        </span>
      </span>
    </motion.div>
  );
}
