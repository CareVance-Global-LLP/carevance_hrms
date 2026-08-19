import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { motion, useScroll, useTransform } from 'framer-motion';
import { useTheme } from '@/contexts/ThemeContext';

interface ScrollRevealBackgroundProps {
  children: ReactNode;
  fromColor?: string;
  toColor?: string;
  className?: string;
}

/**
 * framer-motion interpolates between two *resolved* colours, so this cannot
 * hand it `rgb(var(--surface-card))` the way a class would. It reads the token
 * off :root instead and re-reads whenever the theme flips — the defaults used
 * to be a literal `rgba(255, 255, 255, 1)`, which is the same inline-style trap
 * that left the landing navbar white in dark mode.
 */
const readSurfaceToken = (name: string, fallback: string) => {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return fallback;
  const channels = raw.split(/[\s,]+/).filter(Boolean);
  return channels.length >= 3 ? `rgba(${channels.slice(0, 3).join(', ')}, 1)` : fallback;
};

const FALLBACK_FROM = 'rgba(255, 255, 255, 1)';
const FALLBACK_TO = 'rgba(243, 246, 251, 1)';

export default function ScrollRevealBackground({
  children,
  fromColor,
  toColor,
  className = '',
}: ScrollRevealBackgroundProps) {
  const ref = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [tokens, setTokens] = useState(() => ({
    from: readSurfaceToken('--surface-card', FALLBACK_FROM),
    to: readSurfaceToken('--surface-sunken', FALLBACK_TO),
  }));

  useEffect(() => {
    setTokens({
      from: readSurfaceToken('--surface-card', FALLBACK_FROM),
      to: readSurfaceToken('--surface-sunken', FALLBACK_TO),
    });
  }, [theme]);

  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ['start end', 'end start'],
  });

  const from = fromColor ?? tokens.from;
  const to = toColor ?? tokens.to;
  // Kept stable between theme flips so useTransform is not rebuilt every render.
  const stops = useMemo(() => [from, to, to, from], [from, to]);

  const backgroundColor = useTransform(scrollYProgress, [0, 0.3, 0.7, 1], stops);

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
