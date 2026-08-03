import { useRef, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface HorizontalScrollProps {
  children: ReactNode;
  className?: string;
  scrollHeight?: string;
}

export default function HorizontalScroll({
  children,
  className = '',
  scrollHeight = '300vh',
}: HorizontalScrollProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  const x = useTransform(scrollYProgress, [0, 1], ['0%', '-66.67%']);

  return (
    <div ref={containerRef} className={`relative ${className}`} style={{ height: scrollHeight }}>
      <div className="sticky top-0 h-screen overflow-hidden">
        <motion.div style={{ x, display: 'flex', gap: '1.5rem', height: '100%', alignItems: 'center', paddingLeft: 'max(1.5rem, calc((100vw - 80rem) / 2 + 1.5rem))' }}>
          {children}
        </motion.div>
      </div>
    </div>
  );
}
