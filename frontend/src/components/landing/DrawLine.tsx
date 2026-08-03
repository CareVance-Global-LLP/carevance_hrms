import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface DrawLineProps {
  className?: string;
  color?: string;
  strokeWidth?: number;
  height?: number;
  horizontal?: boolean;
}

export default function DrawLine({
  className = '',
  color = '#5D969D',
  strokeWidth = 2,
  height = 200,
  horizontal = false,
}: DrawLineProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start 0.8', 'start 0.2'],
  });

  const pathLength = useTransform(scrollYProgress, [0, 1], [0, 1]);

  if (horizontal) {
    return (
      <div ref={ref} className={`relative ${className}`} style={{ height: strokeWidth }}>
        <svg width="100%" height={strokeWidth} className="overflow-visible">
          <motion.line
            x1="0"
            y1={strokeWidth / 2}
            x2="100%"
            y2={strokeWidth / 2}
            stroke={color}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{ pathLength }}
          />
        </svg>
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative ${className}`} style={{ height }}>
      <svg width="2" height={height} className="absolute left-1/2 -translate-x-1/2 top-0 overflow-visible">
        <motion.line
          x1={1}
          y1={0}
          x2={1}
          y2={height}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          style={{ pathLength }}
        />
      </svg>
    </div>
  );
}
