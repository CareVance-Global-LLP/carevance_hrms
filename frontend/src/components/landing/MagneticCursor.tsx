import { useEffect, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export default function MagneticCursor() {
  const [isVisible, setIsVisible] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const reduced = usePrefersReducedMotion();

  const cursorX = useMotionValue(0);
  const cursorY = useMotionValue(0);
  const springX = useSpring(cursorX, { stiffness: 200, damping: 20, mass: 0.1 });
  const springY = useSpring(cursorY, { stiffness: 200, damping: 20, mass: 0.1 });

  useEffect(() => {
    /*
     * NOT RENDERED AT ALL under `prefers-reduced-motion`.
     *
     * A spring-lagged ring chasing the pointer is the single most disorienting
     * thing on this page for anyone with vestibular sensitivity: it is
     * permanent, it is in the reader's focus by definition, and it moves
     * whenever they do. Unlike the orbs there is no static version worth
     * keeping — a custom cursor that does not follow smoothly is just a worse
     * pointer — so it is absent rather than frozen, and the OS cursor takes
     * over.
     *
     * The listeners are skipped too, not merely the render: a `mousemove`
     * handler firing at pointer rate for a component drawing nothing is pure
     * cost on exactly the low-end devices this setting correlates with.
     */
    if (reduced) return;
    const isTouchDevice = 'ontouchstart' in window;
    if (isTouchDevice) return;

    const handleMouseMove = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      setIsVisible(true);
    };

    const handleMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isInteractive = target.closest('a, button, [role="button"]');
      setIsHovering(!!isInteractive);
    };

    const handleMouseLeave = () => setIsVisible(false);
    const handleMouseEnter = () => setIsVisible(true);

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mouseover', handleMouseOver, { passive: true });
    document.addEventListener('mouseleave', handleMouseLeave);
    document.addEventListener('mouseenter', handleMouseEnter);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseleave', handleMouseLeave);
      document.removeEventListener('mouseenter', handleMouseEnter);
    };
  }, [cursorX, cursorY, reduced]);

  if (reduced) return null;

  return (
    <motion.div
      className="pointer-events-none fixed left-0 top-0 z-[9999] hidden lg:block"
      style={{
        x: springX,
        y: springY,
        translateX: '-50%',
        translateY: '-50%',
      }}
    >
      <motion.div
        animate={{ scale: isHovering ? 1.8 : 1 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
        className="h-40 w-40 rounded-full"
        style={{
          background: 'radial-gradient(circle, rgba(93, 150, 157, 0.08) 0%, transparent 70%)',
          opacity: isVisible ? 1 : 0,
          transition: 'opacity 0.3s ease',
        }}
      />
    </motion.div>
  );
}
