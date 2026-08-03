import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface ParallaxSectionProps {
  children: ReactNode;
  speed?: number;
  className?: string;
  direction?: 'y' | 'x';
  as?: keyof JSX.IntrinsicElements;
}

export default function ParallaxSection({
  children,
  speed = 0.15,
  className = '',
  direction = 'y',
  as = 'div',
}: ParallaxSectionProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const factor = speed * 80;
  const y = useTransform(scrollYProgress, [0, 1], [factor, -factor]);
  const x = direction === 'x' ? useTransform(scrollYProgress, [0, 1], [factor, -factor]) : undefined;

  const Tag = motion[as] as typeof motion.div;

  return (
    <Tag ref={ref} className={className} style={direction === 'y' ? { y } : { x: x! }}>
      {children}
    </Tag>
  );
}
