import type { HTMLAttributes, ReactNode } from 'react';
import AdaptiveSurface from '@/components/ui/AdaptiveSurface';

interface SurfaceCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
}

export default function SurfaceCard({ children, className = '', ...props }: SurfaceCardProps) {
  return (
    <AdaptiveSurface
      {...props}
      className={`rounded-lg border border-slate-200 bg-surface-card shadow-sm ${className}`.trim()}
      // No explicit tone: the card is painted by the theme, so AdaptiveSurface
      // resolves the contrast tone from whichever theme is active.
      tone="auto"
      backgroundColor="#ffffff"
    >
      {children}
    </AdaptiveSurface>
  );
}
