import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  titleClassName?: string;
  description?: string;
  actions?: ReactNode;
}

export default function PageHeader({ eyebrow, title, titleClassName, description, actions }: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
      <div>
        <h1 className={cn('text-2xl font-semibold tracking-tight text-slate-950', titleClassName)}>{title}</h1>
        {eyebrow ? <p className="mt-3 text-sm font-medium text-slate-900">{eyebrow}</p> : null}
        {description ? <p className="mt-1 max-w-3xl text-xs text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center">{actions}</div> : null}
    </div>
  );
}
