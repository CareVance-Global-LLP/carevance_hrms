'use client';

import { useRef, useState, type ReactNode } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';
import { usePrefersReducedMotion } from '@/components/motion/usePrefersReducedMotion';

/**
 * §1 — the hero's entrance.
 *
 * A NOTE THAT SHOULD BE READ BEFORE EDITING THIS FILE.
 *
 * The h1 below is the page's LCP element, and the obvious way to animate it
 * costs LCP outright: an element at `opacity: 0` is not a candidate for Largest
 * Contentful Paint, so hiding the words in the server HTML defers the metric
 * until hydration has run AND the reveal has finished.
 *
 * This does not do that. The headline is server-rendered as one plain sentence
 * and the split-and-animate version only replaces it after hydration, which
 * `usePrefersReducedMotion`'s server snapshot arranges for free. MEASURED on
 * the production build: FCP 256 ms, LCP 256 ms, LCP element still the h1 — the
 * animation costs the metric nothing.
 *
 * What that ordering costs instead is that the reveal cannot start until
 * hydration, so on a slow device it would replay a headline the reader has
 * already read. `HYDRATION_BUDGET_MS` below is what stops it.
 *
 *   · the reveal starts on mount, with NO in-view gate and no lead-in delay
 *   · 0.05s between words, 0.38s each — the whole headline is done in ~0.6s
 *   · the words are real text in the server HTML, so a reader with no JS gets
 *     the headline and a crawler indexes one sentence, not seven fragments
 */

const EASE = [0.22, 0.61, 0.36, 1] as const;

/**
 * Past this many milliseconds from navigation start, the entrance is abandoned
 * rather than played.
 *
 * MEASURED, and the reason this gate exists at all: the headline is
 * server-rendered as plain text, so it paints at FCP (256 ms locally) and LCP
 * is recorded on it — the metric is protected. The cost of that ordering is
 * that the reveal can only begin once hydration has run. On a fast connection
 * that is a couple of hundred milliseconds later and reads as an entrance. On a
 * slow mid-range Android it can be a second and a half, by which point the
 * reader has finished the sentence — and animating it then is not an entrance,
 * it is the headline inexplicably falling over and getting back up.
 *
 * So the animation is a reward for a fast load, never a penalty for a slow one.
 * The alternative — hiding the words in the server HTML so the reveal is always
 * the first thing painted — delays LCP by exactly the animation's duration and
 * leaves the hero permanently blank if the bundle never arrives.
 */
const HYDRATION_BUDGET_MS = 500;

/** True when this client render is too late for an entrance to make sense. */
function useLateHydration(): boolean {
  // useState initialiser: evaluated once, on the first render, which is the
  // moment we want to measure. Reading it in an effect would be too late.
  const [late] = useState(() =>
    typeof window === 'undefined' ? true : performance.now() > HYDRATION_BUDGET_MS
  );
  return late;
}

/**
 * The headline, rising a word at a time.
 *
 * Words are wrapped in an inline-block with `overflow: hidden` on the outer
 * span, so each word rises out of its own line box rather than sliding over the
 * one above it. The text is one string in the DOM's accessible name — screen
 * readers get "The hours are the payslip.", not seven separate words.
 */
export function WordReveal({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const late = useLateHydration();
  const words = text.split(' ');

  if (reduced || late) {
    return <h1 className={className}>{text}</h1>;
  }

  return (
    <h1 className={className} aria-label={text}>
      {words.map((word, i) => (
        <span
          key={`${word}-${i}`}
          aria-hidden="true"
          className="inline-block overflow-hidden pb-[0.08em] align-bottom"
        >
          <motion.span
            className="inline-block"
            initial={{ y: '0.9em', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.38, delay: i * 0.05, ease: EASE }}
          >
            {word}
          </motion.span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </h1>
  );
}

/**
 * Everything under the headline, arriving on a chain.
 *
 * A plain `delay`, not an in-view observer: this is above the fold on every
 * viewport the site supports, so an IntersectionObserver would fire
 * immediately anyway and cost an observer to do it.
 */
export function FadeUp({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduced = usePrefersReducedMotion();
  const late = useLateHydration();

  if (reduced || late) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Mouse-tilt parallax for the chain.
 *
 * The transform lives on this WRAPPER and nowhere else. anime.js owns the
 * transform of every card inside it during the entrance timeline, and two
 * owners of one property fight — the rule ChainHero's header states. A parent
 * perspective sidesteps that entirely: the group tilts, the cards keep their
 * own transforms, and the connecting SVG tilts with them so the line never
 * drifts off the gaps it is drawn through.
 *
 * Springs, not raw pointer values: a tilt that tracks the cursor exactly reads
 * as a bug, because real objects have inertia.
 *
 * Touch devices never fire `pointermove` without a press, so this is inert on a
 * phone — which is correct. There is no touch equivalent worth inventing, and a
 * looping float would be motion nobody asked for.
 */
export function TiltGroup({
  children,
  className,
  maxDegrees = 3.5,
}: {
  children: ReactNode;
  className?: string;
  maxDegrees?: number;
}) {
  const reduced = usePrefersReducedMotion();
  const ref = useRef<HTMLDivElement>(null);

  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const spring = { stiffness: 150, damping: 20, mass: 0.6 };
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [maxDegrees, -maxDegrees]), spring);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-maxDegrees, maxDegrees]), spring);

  if (reduced) return <div className={className}>{children}</div>;

  return (
    <div
      ref={ref}
      className={className}
      style={{ perspective: 1400 }}
      onPointerMove={(e) => {
        // Coarse pointers (touch) report movement only mid-gesture; tilting the
        // hero because somebody started a scroll is not an interaction.
        if (e.pointerType !== 'mouse') return;
        const rect = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - rect.left) / rect.width - 0.5);
        py.set((e.clientY - rect.top) / rect.height - 0.5);
      }}
      onPointerLeave={() => {
        px.set(0);
        py.set(0);
      }}
    >
      <motion.div style={{ rotateX, rotateY, transformStyle: 'preserve-3d' }}>
        {children}
      </motion.div>
    </div>
  );
}
