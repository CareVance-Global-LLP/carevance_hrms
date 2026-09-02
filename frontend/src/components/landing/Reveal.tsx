import { motion } from 'framer-motion';
import type { ReactNode } from 'react';
import { easeOut } from './animations';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

/**
 * The one entrance. Use this instead of hand-writing `whileInView` again.
 *
 * Before this, entrance animations were written inline in every section with
 * slightly different distances, durations and viewport amounts — which is how a
 * page ends up feeling assembled rather than designed. The reader cannot name
 * what is wrong, but a 24px rise here and a 40px rise there reads as sloppiness.
 *
 * THREE RULES BAKED IN, so nobody has to remember them:
 *
 *   · `once: true`. Content the reader has already seen must never re-animate
 *     on scroll-up. Re-triggering is the single most common thing that makes a
 *     scroll-reveal site feel cheap.
 *   · `margin: '-80px'`. Fires slightly BEFORE the element reaches the
 *     viewport, so it has finished arriving by the time it is looked at rather
 *     than animating under the reader's eye.
 *   · Under `prefers-reduced-motion` this renders a plain element with no
 *     motion component at all — not a zero-duration animation. Same layout,
 *     same content, no movement.
 *
 * `<Stagger>` is the same contract for a list: it drives its children through
 * variants, so children use `<StaggerItem>` and specify nothing themselves.
 */

const DISTANCE = 24;

export function Reveal({
  children,
  delay = 0,
  className,
  as = 'div',
}: {
  children: ReactNode;
  /** Seconds. Prefer <Stagger> over hand-tuned delays. */
  delay?: number;
  className?: string;
  as?: 'div' | 'section' | 'li' | 'article';
}) {
  const reduced = usePrefersReducedMotion();
  const MotionTag = motion[as];

  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: DISTANCE }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.55, delay, ease: easeOut }}
    >
      {children}
    </MotionTag>
  );
}

/** Container. Children must be <StaggerItem>. */
export function Stagger({
  children,
  className,
  step = 0.07,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  /** Seconds between children. */
  step?: number;
  as?: 'div' | 'ul' | 'ol';
}) {
  const reduced = usePrefersReducedMotion();
  const MotionTag = motion[as];

  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      className={className}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, margin: '-80px' }}
      variants={{
        hidden: {},
        // Never stagger past ~8 children: beyond that the tail arrives long
        // after the reader's eye reached it, and reads as lag rather than
        // choreography. Callers with longer lists should chunk them.
        visible: { transition: { staggerChildren: step } },
      }}
    >
      {children}
    </MotionTag>
  );
}

export function StaggerItem({
  children,
  className,
  as = 'div',
}: {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'li' | 'article';
}) {
  const reduced = usePrefersReducedMotion();
  const MotionTag = motion[as];

  if (reduced) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      className={className}
      variants={{
        hidden: { opacity: 0, y: DISTANCE },
        visible: { opacity: 1, y: 0, transition: { duration: 0.55, ease: easeOut } },
      }}
    >
      {children}
    </MotionTag>
  );
}
