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
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`.trim()}
      tone="light"
      backgroundColor="#ffffff"
    >
      {children}
    </AdaptiveSurface>
  );
}
