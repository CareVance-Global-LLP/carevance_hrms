import type { ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface SettingsCardProps {
  title?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  id?: string;
}

/**
 * The one card shape every settings section uses. A section without a title is
 * still a card, so an untitled group (the profile hero) sits on the same rail
 * as a titled one.
 */
export default function SettingsCard({
  title,
  description,
  aside,
  children,
  className,
  bodyClassName,
  id,
}: SettingsCardProps) {
  const hasHeader = Boolean(title || description || aside);

  return (
    <section
      id={id}
      className={cn('rounded-xl border border-slate-200 bg-surface-card p-5 shadow-sm', className)}
    >
      {hasHeader ? (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title ? <h3 className="text-sm font-semibold text-slate-900">{title}</h3> : null}
            {description ? <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-600">{description}</p> : null}
          </div>
          {aside ? <div className="shrink-0">{aside}</div> : null}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
