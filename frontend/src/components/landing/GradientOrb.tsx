import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface GradientOrbProps {
  color?: string;
  size?: number;
  className?: string;
  speed?: number;
  blur?: number;
}

export default function GradientOrb({
  color = 'rgba(93, 150, 157, 0.12)',
  size = 400,
  className = '',
  speed = 0.1,
  blur = 80,
}: GradientOrbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll();

  const y = useTransform(scrollYProgress, [0, 1], [speed * 100, -speed * 100]);
  const x = useTransform(scrollYProgress, [0, 1], [speed * 30, -speed * 30]);

  /*
   * The parallax drift is dropped under `prefers-reduced-motion`, but the orb
   * itself stays.
   *
   * These are the hero's background wash — deleting them would change the
   * page's composition, not just its motion, and reduced-motion is a request to
   * stop things MOVING rather than to be served a different design. The global
   * CSS net in index.css cannot help here: framer-motion writes transforms as
   * inline styles via rAF, which no `transition-duration: 0` rule touches.
   */
  return (
    <motion.div
      ref={ref}
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color}, transparent 70%)`,
        filter: `blur(${blur}px)`,
        ...(reduced ? {} : { y, x }),
      }}
    />
  );
}
