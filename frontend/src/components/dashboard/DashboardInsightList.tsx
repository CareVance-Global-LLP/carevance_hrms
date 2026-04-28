import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageEmptyState } from '@/components/ui/PageState';
import { cn } from '@/utils/cn';

interface DashboardInsightItem {
  id: string;
  title: string;
  subtitle?: string;
  value?: string;
  tone?: 'default' | 'good' | 'warning' | 'critical';
}

interface DashboardInsightListProps {
  title: string;
  description: string;
  items: DashboardInsightItem[];
  emptyTitle?: string;
  emptyDescription?: string;
  footer?: string;
  className?: string;
  contentClassName?: string;
}

const toneClasses: Record<NonNullable<DashboardInsightItem['tone']>, string> = {
  default: 'bg-slate-100 text-slate-700',
  good: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  critical: 'bg-rose-100 text-rose-700',
};

export default function DashboardInsightList({
  title,
  description,
  items,
  emptyTitle = 'No items found',
  emptyDescription = 'There is nothing to show for this section yet.',
  footer,
  className,
  contentClassName,
}: DashboardInsightListProps) {
  return (
    <SurfaceCard className={cn('flex h-full min-h-[320px] max-h-[420px] flex-col p-4', className)}>
      <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{description}</p>

      <div className={cn('mt-5 min-h-0 flex-1 overflow-y-auto pr-1', contentClassName)}>
        {items.length === 0 ? (
          <PageEmptyState title={emptyTitle} description={emptyDescription} />
        ) : (
          <div className="space-y-3">
            {items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-4 rounded-lg border border-slate-100 bg-slate-50 px-4 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-950">{item.title}</p>
                  {item.subtitle ? <p className="mt-1 text-sm text-slate-500">{item.subtitle}</p> : null}
                </div>
                {item.value ? (
                  <span className={cn('shrink-0 rounded-full px-3 py-1 text-xs font-semibold', toneClasses[item.tone || 'default'])}>
                    {item.value}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {footer ? <p className="mt-4 text-xs leading-5 text-slate-500">{footer}</p> : null}
    </SurfaceCard>
  );
}
