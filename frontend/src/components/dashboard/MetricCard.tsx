import type { LucideIcon } from 'lucide-react';
import SurfaceCard from './SurfaceCard';

interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  accent?: 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';
}

const accentClasses: Record<NonNullable<MetricCardProps['accent']>, string> = {
  sky: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
};

export default function MetricCard({
  label,
  value,
  hint,
  icon: Icon,
  accent = 'sky',
}: MetricCardProps) {
  return (
    <SurfaceCard className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
          {hint ? <p className="mt-2 text-[11px] text-slate-500">{hint}</p> : null}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accentClasses[accent]}`}>
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </SurfaceCard>
  );
}
