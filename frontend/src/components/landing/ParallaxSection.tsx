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
  // Both transforms are created unconditionally — calling useTransform inside a
  // ternary changed the hook order between renders whenever `direction` did,
  // which React relies on being stable. Choosing between the two results is
  // free; conditionally creating them is not.
  const offset = useTransform(scrollYProgress, [0, 1], [factor, -factor]);

  const Tag = motion[as] as typeof motion.div;

  return (
    <Tag ref={ref} className={className} style={direction === 'x' ? { x: offset } : { y: offset }}>
      {children}
    </Tag>
  );
}
