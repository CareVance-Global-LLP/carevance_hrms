import { type Variants, type Transition } from 'framer-motion';

export const easeOut = [0.22, 1, 0.36, 1] as const;
export const springConfig = { type: 'spring' as const, stiffness: 300, damping: 24 };
export const snappySpring = { type: 'spring' as const, stiffness: 500, damping: 30 };

// ── Basic fade/slide variants ────────────────────────────────────────────

export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const fadeSlideDown: Variants = {
  hidden: { opacity: 0, y: -24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const fadeSlideLeft: Variants = {
  hidden: { opacity: 0, x: 32 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const fadeSlideRight: Variants = {
  hidden: { opacity: 0, x: -32 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: easeOut } },
};

export const scaleIn: Variants = {
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, ease: easeOut } },
};

// ── 3D perspective variants ──────────────────────────────────────────────

export const perspectiveRotateIn: Variants = {
  hidden: { opacity: 0, rotateY: -12, scale: 0.95 },
  visible: {
    opacity: 1,
    rotateY: 0,
    scale: 1,
    transition: { duration: 0.7, ease: easeOut },
  },
};

// ── Container variants ───────────────────────────────────────────────────

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1, ease: easeOut },
  },
};

export const staggerContainerSlow: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1, delayChildren: 0.15, ease: easeOut },
  },
};

// ── Transition helpers ───────────────────────────────────────────────────

export function getItemDelay(index: number, baseDelay = 0.06): Transition {
  return { duration: 0.5, delay: index * baseDelay, ease: easeOut };
}

export const viewportOptions = { once: true, amount: 0.15 as const };
export const viewportOptionsDeep = { once: true, amount: 0.3 as const };

// ── Interactive hover/tap variants ───────────────────────────────────────

export const springHover = {
  whileHover: {
    y: -4,
    transition: { type: 'spring' as const, stiffness: 400, damping: 17 },
  },
};

export const springHoverLift = {
  whileHover: {
    y: -6,
    scale: 1.01,
    transition: { type: 'spring' as const, stiffness: 300, damping: 20 },
  },
};

export const cardHoverShadow = {
  whileHover: {
    y: -4,
    boxShadow: '0 10px 40px -12px rgba(93, 150, 157, 0.18)',
    transition: { type: 'spring' as const, stiffness: 400, damping: 17 },
  },
};

export const cardHoverEnhanced = {
  whileHover: {
    y: -6,
    boxShadow: '0 20px 60px -15px rgba(93, 150, 157, 0.22)',
    transition: { type: 'spring' as const, stiffness: 350, damping: 20 },
  },
};

// ── Text reveal (word-by-word) ──────────────────────────────────────────

export const textRevealContainer: Variants = {
  hidden: {},
  visible: {
    transition: { staggerChildren: 0.04, delayChildren: 0 },
  },
};

export const textRevealWord: Variants = {
  hidden: { opacity: 0, y: 16, filter: 'blur(4px)' },
  visible: {
    opacity: 1,
    y: 0,
    filter: 'blur(0px)',
    transition: { duration: 0.4, ease: easeOut },
  },
};

// ── Section-level scroll-linked variants ─────────────────────────────────

export const sectionParallax: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.7, ease: easeOut },
  },
};

// ── Bento grid card variants (different entry directions) ────────────────

export const bentoFromTop: Variants = {
  hidden: { opacity: 0, y: -32 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const bentoFromLeft: Variants = {
  hidden: { opacity: 0, x: -40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const bentoFromRight: Variants = {
  hidden: { opacity: 0, x: 40 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const bentoFromBottom: Variants = {
  hidden: { opacity: 0, y: 40 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
};

// ── Timeline step variants ───────────────────────────────────────────────

export const timelineStepLeft: Variants = {
  hidden: { opacity: 0, x: -48 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const timelineStepRight: Variants = {
  hidden: { opacity: 0, x: 48 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.6, ease: easeOut } },
};
