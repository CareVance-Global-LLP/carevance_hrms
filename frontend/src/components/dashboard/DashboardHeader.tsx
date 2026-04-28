import type { ReactNode } from 'react';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

interface DashboardHeaderProps {
  eyebrow?: string;
  title: string;
  titleClassName?: string;
  description?: string;
  actions?: ReactNode;
  children?: ReactNode;
}

export default function DashboardHeader({
  eyebrow,
  title,
  titleClassName,
  description,
  actions,
  children,
}: DashboardHeaderProps) {
  return (
    <div className="relative z-20 space-y-4">
      <SurfaceCard className="relative z-20 overflow-visible p-4">
        <PageHeader eyebrow={eyebrow} title={title} titleClassName={titleClassName} description={description} actions={actions} />
        {children ? <div className="mt-5 border-t border-slate-200 pt-5">{children}</div> : null}
      </SurfaceCard>
    </div>
  );
}
