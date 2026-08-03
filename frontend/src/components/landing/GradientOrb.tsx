import { useRef } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';

interface GradientOrbProps {
  color?: string;
  size?: number;
  className?: string;
  speed?: number;
  blur?: number;
}

export default function GradientOrb({
  color = 'rgba(93, 150, 157, 0.12)',
  size = 400,
  className = '',
  speed = 0.1,
  blur = 80,
}: GradientOrbProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();

  const y = useTransform(scrollYProgress, [0, 1], [speed * 100, -speed * 100]);
  const x = useTransform(scrollYProgress, [0, 1], [speed * 30, -speed * 30]);

  return (
    <motion.div
      ref={ref}
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle, ${color}, transparent 70%)`,
        filter: `blur(${blur}px)`,
        y,
        x,
      }}
    />
  );
}
