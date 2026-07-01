import type { LucideIcon } from 'lucide-react';
import SurfaceCard from './SurfaceCard';

interface MetricCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon?: LucideIcon;
  accent?: 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';
}

const accentClasses: Record<NonNullable<MetricCardProps['accent']>, string> = {
  sky: 'bg-[rgba(93,150,157,0.1)] text-[#5D969D]',
  emerald: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-[rgba(227,168,66,0.12)] text-[#E3A842]',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-[rgba(155,148,152,0.12)] text-[#9B9498]',
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
          <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
            {label}
          </p>
          <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
        </div>
        {Icon ? (
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${accentClasses[accent]}`}>
            <Icon className="h-5 w-5" />
          </div>
        ) : null}
      </div>
    </SurfaceCard>
  );
}
