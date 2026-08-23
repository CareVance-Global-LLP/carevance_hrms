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
        {/*
          An eyebrow goes ABOVE the title, small and quiet.

          It used to render below the h1 at text-sm / font-medium / slate-900 —
          the same colour and nearly the same weight as the title — so every
          page opened with two headings competing, and on several of them they
          said the same thing twice ("Employees" under "Employee Management").
          Above, muted and lettered, it reads as the section you are in, which
          is what it is for.
        */}
        {eyebrow ? (
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{eyebrow}</p>
        ) : null}
        <h1 className={cn('text-2xl font-semibold tracking-tight text-slate-950', eyebrow && 'mt-1', titleClassName)}>{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-xs text-slate-500">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-col gap-3 sm:flex-row sm:items-center">{actions}</div> : null}
    </div>
  );
}
