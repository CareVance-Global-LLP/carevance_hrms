import { useRef } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

interface MagneticButtonProps {
  children: React.ReactNode;
  className?: string;
  strength?: number;
}

export default function MagneticButton({
  children,
  className = '',
  strength = 8,
}: MagneticButtonProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const springX = useSpring(x, { stiffness: 150, damping: 15, mass: 0.1 });
  const springY = useSpring(y, { stiffness: 150, damping: 15, mass: 0.1 });

  const handleMouseMove = (e: React.MouseEvent) => {
    if (reduced || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    x.set(((e.clientX - centerX) / rect.width) * strength);
    y.set(((e.clientY - centerY) / rect.height) * strength);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  /*
   * The magnetic pull is dropped entirely under `prefers-reduced-motion` — a
   * button that leans toward the cursor is unrequested movement, and this wraps
   * every primary call to action on the page.
   *
   * A PLAIN <div>, not a motion one with the springs left connected. Handing
   * `style={{ x: springX }}` to a motion component keeps a spring subscribed
   * and re-rendering per frame to write `translate(0,0)` forever; returning
   * ordinary markup means there is nothing to animate at all. The springs above
   * are still constructed because hooks cannot be called conditionally — they
   * simply never receive a value.
   */
  if (reduced) {
    return (
      <div ref={ref} className={className}>
        {children}
      </div>
    );
  }

  return (
    <motion.div
      ref={ref}
      style={{ x: springX, y: springY }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={className}
    >
      {children}
    </motion.div>
  );
}
