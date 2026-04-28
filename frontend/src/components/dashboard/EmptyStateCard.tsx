import type { LucideIcon } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface EmptyStateCardProps {
  title: string;
  description: string;
  icon: LucideIcon;
  className?: string;
}

export default function EmptyStateCard({
  title,
  description,
  icon: Icon,
  className = '',
}: EmptyStateCardProps) {
  return (
    <SurfaceCard className={`p-4 ${className}`.trim()}>
      <div className="flex items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
          <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
      </div>
    </SurfaceCard>
  );
}
