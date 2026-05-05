import { Link, useLocation } from 'react-router-dom';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';

export interface PayrollWorkspaceTab {
  label: string;
  to: string;
}

export default function PayrollWorkspaceNav({
  tabs,
}: {
  tabs: PayrollWorkspaceTab[];
}) {
  const location = useLocation();

  return (
    <SurfaceCard className="p-3">
      <div className="flex flex-wrap gap-2">
        {tabs.map((tab) => {
          const isActive = tab.to === '/payroll'
            ? location.pathname === tab.to
            : location.pathname === tab.to || location.pathname.startsWith(`${tab.to}/`);
          return (
            <Link
              key={tab.to}
              to={tab.to}
              className={cn(
                'rounded-full px-4 py-2 text-sm font-medium transition',
                isActive
                  ? 'bg-slate-950 text-white shadow-[0_18px_38px_-26px_rgba(15,23,42,0.8)]'
                  : 'bg-slate-100 text-slate-600 hover:bg-white hover:text-slate-950'
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </SurfaceCard>
  );
}
