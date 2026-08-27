import { motion, useScroll, useSpring } from 'framer-motion';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * The 2px reading-progress rail at the top of the window.
 *
 * KEPT under `prefers-reduced-motion`, unlike the custom cursor, and the
 * distinction is worth stating because it is the judgement this whole sweep
 * turns on.
 *
 * Reduced motion is a request to stop things moving unbidden — decorative
 * drift, parallax, a ring chasing the pointer. This bar moves only in direct
 * response to the reader's own scrolling: it is a scrollbar with a better
 * shape, and removing it would take away an orientation cue on a very long
 * page from the people most likely to need one. What IS removed is the spring:
 * the smoothing means the bar keeps travelling after the reader stops, which is
 * exactly the unbidden movement the setting is about. Bound straight to scroll
 * progress it moves if and only if the page does.
 *
 * `MotionConfig reducedMotion="user"` on the landing page cannot do this for
 * us — it switches transform *animations* off, and `scaleX` here is a motion
 * value bound through `style`, which is a live binding rather than an
 * animation.
 */
export default function ScrollProgress() {
  const reduced = usePrefersReducedMotion();
  const { scrollYProgress } = useScroll();
  const smoothed = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      className="fixed inset-x-0 top-0 z-[9999] h-[2px] origin-left"
      style={{
        scaleX: reduced ? scrollYProgress : smoothed,
        background: 'linear-gradient(90deg, #5D969D, #3D656B)',
      }}
    />
  );
}
