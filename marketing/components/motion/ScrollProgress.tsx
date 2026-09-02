'use client';

import { motion, useScroll, useSpring } from 'motion/react';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * The 2px rail at the top of the window (brief §14).
 *
 * Its job is to make a long page feel like one guided descent rather than an
 * unbounded scroll — the reader can always see how much of the argument is
 * left, which is the difference between "this is long" and "this is nearly
 * done".
 *
 * Spring-smoothed rather than raw: `scrollYProgress` updates per scroll event,
 * and on a trackpad that reads as a twitching bar. The spring costs nothing and
 * turns it into a single continuous movement.
 *
 * It sits ABOVE the navbar (z-50) deliberately — a progress bar the sticky
 * header covers is a progress bar nobody sees.
 *
 * `aria-hidden`: it duplicates the scrollbar, which assistive technology
 * already exposes. Announcing it a second time is noise.
 */
export function ScrollProgress() {
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 190,
    damping: 32,
    restDelta: 0.001,
  });

  // A progress bar IS motion — there is no static state worth rendering, so
  // under `prefers-reduced-motion` it is simply absent rather than frozen.
  if (reduced) return null;

  return (
    <motion.div
      aria-hidden="true"
      style={{ scaleX }}
      className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5 origin-left bg-brand-600"
    />
  );
}
