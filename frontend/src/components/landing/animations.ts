import { type Variants, type Transition } from 'framer-motion';

export const easeOut = [0.22, 1, 0.36, 1] as const;

export const fadeSlideUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, ease: easeOut } },
};

export const fadeIn: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.5, ease: easeOut } },
};

export const staggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.05, delayChildren: 0.08, ease: easeOut },
  },
};

export function getItemDelay(index: number, baseDelay = 0.04): Transition {
  return { duration: 0.5, delay: index * baseDelay, ease: easeOut };
}

export const viewportOptions = { once: true, amount: 0.1 as const };
