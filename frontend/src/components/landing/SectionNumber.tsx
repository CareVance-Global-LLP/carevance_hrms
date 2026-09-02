import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface SectionNumberProps {
  number: number;
  label?: string;
  className?: string;
}

/**
 * The oversized section numeral, scrubbed in as the section arrives.
 *
 * Under `prefers-reduced-motion` it renders in its final state — fully opaque,
 * unscaled, unmoved — rather than being scrubbed. The three transforms below
 * are motion values bound through `style`, which the page's `MotionConfig
 * reducedMotion="user"` does NOT intercept: that switches transform animations
 * off, and a bound value is not an animation.
 *
 * Note that dropping the scrub means dropping the OPACITY ramp too, not just
 * the movement. Left in place, the numeral would sit at `opacity: 0` until
 * scroll progress advanced — and since a scrub is not an animation, nothing
 * would ever fade it in. Half-disabling this effect makes the content
 * disappear, which is the failure mode worth watching for anywhere a scrub
 * controls visibility.
 */
export default function SectionNumber({ number, label, className = '' }: SectionNumberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.9', 'start 0.4'],
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 1]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.8, 1, 1]);
  const y = useTransform(scrollYProgress, [0, 0.5, 1], [40, 0, 0]);

  const formatted = number.toString().padStart(2, '0');
  const numeralStyle = reduced ? undefined : { opacity, scale, y };
  const labelStyle = reduced ? undefined : { opacity, y };

  return (
    <div ref={ref} className={`flex items-center gap-6 ${className}`}>
      <motion.div style={numeralStyle} className="flex items-baseline">
        <span className="text-7xl font-bold tracking-tighter text-slate-200/80 sm:text-8xl lg:text-9xl">
          {formatted}
        </span>
      </motion.div>
      {label && (
        <motion.span
          style={labelStyle}
          className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-500"
        >
          {label}
        </motion.span>
      )}
    </div>
  );
}
