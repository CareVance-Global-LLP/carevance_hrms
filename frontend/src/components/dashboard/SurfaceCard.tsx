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
      className={`glass-panel premium-ring rounded-[28px] border border-white/70 bg-white/80 shadow-[0_24px_70px_-46px_rgba(15,23,42,0.42)] ${className}`.trim()}
      tone="light"
      backgroundColor="rgba(255,255,255,0.8)"
    >
      {children}
    </AdaptiveSurface>
  );
}
