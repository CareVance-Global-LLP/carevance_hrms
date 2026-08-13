import type { ReactNode } from 'react';

interface ModuleHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
}

/**
 * Heading for a payroll sub-panel module.
 *
 * Deliberately an `h2`, not the `h1` that `dashboard/PageHeader` renders: these
 * modules are embedded inside the payroll tab shell, which already owns the
 * page's only `h1` (`PayrollShell.tsx`). Pages that reached for `PageHeader`
 * emitted a second `h1` and a heading a size larger than their siblings.
 */
export default function ModuleHeader({ title, description, actions }: ModuleHeaderProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {description ? (
          <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}
