import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface ScrollRevealBackgroundProps {
  children: ReactNode;
  fromColor?: string;
  toColor?: string;
  className?: string;
}

export default function ScrollRevealBackground({
  children,
  fromColor = 'rgba(255, 255, 255, 1)',
  toColor = 'rgba(243, 246, 251, 1)',
  className = '',
}: ScrollRevealBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const backgroundColor = useTransform(
    scrollYProgress,
    [0, 0.3, 0.7, 1],
    [fromColor, toColor, toColor, fromColor]
  );

  return (
    <motion.div
      ref={ref}
      className={className}
      style={{ backgroundColor }}
    >
      {children}
    </motion.div>
  );
}
