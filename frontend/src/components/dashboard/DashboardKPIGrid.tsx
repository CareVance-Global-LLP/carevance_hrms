import type { LucideIcon } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface KPIItem {
  id: string;
  label: string;
  value: string | number;
  caption?: string;
  meta?: string;
  icon: LucideIcon;
  accent?: 'sky' | 'emerald' | 'violet' | 'amber' | 'rose' | 'slate';
}

interface DashboardKPIGridProps {
  items: KPIItem[];
  secondaryItems?: Array<{
    id: string;
    label: string;
    value: string | number;
  }>;
}

const accentClasses: Record<NonNullable<KPIItem['accent']>, string> = {
  sky: 'bg-blue-50 text-blue-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  violet: 'bg-violet-50 text-violet-600',
  amber: 'bg-amber-50 text-amber-600',
  rose: 'bg-rose-50 text-rose-600',
  slate: 'bg-slate-100 text-slate-600',
};

export default function DashboardKPIGrid({ items, secondaryItems = [] }: DashboardKPIGridProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {items.map((item) => {
          const Icon = item.icon;

          return (
            <SurfaceCard key={item.id} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs text-slate-500">{item.label}</p>
                  <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{item.value}</p>
                  {item.caption ? <p className="mt-2 text-[11px] text-slate-500">{item.caption}</p> : null}
                  {item.meta ? <p className="mt-1 text-[11px] text-slate-400">{item.meta}</p> : null}
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${accentClasses[item.accent || 'sky']}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </SurfaceCard>
          );
        })}
      </div>

      {secondaryItems.length > 0 ? (
        <SurfaceCard className="p-4">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {secondaryItems.map((item) => (
              <div key={item.id} className="rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{item.value}</p>
              </div>
            ))}
          </div>
        </SurfaceCard>
      ) : null}
    </div>
  );
}
