import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface SettingRowProps {
  icon?: LucideIcon;
  title: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
  className?: string;
}

/**
 * A labelled row with its control on the right. Rows stack inside a card and
 * divide themselves, so a card never has to know how many it holds.
 */
export default function SettingRow({ icon: Icon, title, description, control, className }: SettingRowProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-3 border-t border-slate-200 py-3 first:border-t-0 first:pt-0 last:pb-0',
        className
      )}
    >
      {Icon ? (
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-surface-sunken text-slate-600">
          <Icon className="h-4 w-4" />
        </span>
      ) : null}
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-medium text-slate-900">{title}</p>
        {description ? <p className="mt-0.5 text-xs leading-5 text-slate-600">{description}</p> : null}
      </div>
      {control ? <div className="flex shrink-0 items-center gap-3">{control}</div> : null}
    </div>
  );
}
