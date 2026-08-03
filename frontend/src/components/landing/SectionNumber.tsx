import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface SectionNumberProps {
  number: number;
  label?: string;
  className?: string;
}

export default function SectionNumber({ number, label, className = '' }: SectionNumberProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.9', 'start 0.4'],
  });

  const opacity = useTransform(scrollYProgress, [0, 0.5, 1], [0, 1, 1]);
  const scale = useTransform(scrollYProgress, [0, 0.5, 1], [0.8, 1, 1]);
  const y = useTransform(scrollYProgress, [0, 0.5, 1], [40, 0, 0]);

  const formatted = number.toString().padStart(2, '0');

  return (
    <div ref={ref} className={`flex items-center gap-6 ${className}`}>
      <motion.div
        style={{ opacity, scale, y }}
        className="flex items-baseline"
      >
        <span className="text-7xl font-bold tracking-tighter text-slate-200/80 sm:text-8xl lg:text-9xl">
          {formatted}
        </span>
      </motion.div>
      {label && (
        <motion.span
          style={{ opacity, y }}
          className="text-sm font-semibold uppercase tracking-[0.2em] text-slate-400"
        >
          {label}
        </motion.span>
      )}
    </div>
  );
}
