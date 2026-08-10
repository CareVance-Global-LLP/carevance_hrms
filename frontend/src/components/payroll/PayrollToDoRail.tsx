import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ListChecks,
  AlertTriangle,
  AlertCircle,
  Info,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { payrollApi } from '@/services/api';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';

interface PayrollToDoRailProps {
  monthYear: string;
  onOpenProcessAndPay?: () => void;
  onOpenFilings?: () => void;
}

type Alert = {
  id: string;
  type: 'critical' | 'warning' | 'info' | string;
  title: string;
  message: string;
  action?: string;
  action_url?: string;
  count?: number;
};

const TYPE_STYLES: Record<string, { icon: typeof Info; iconClass: string }> = {
  critical: { icon: AlertCircle, iconClass: 'text-rose-600 bg-rose-50' },
  warning: { icon: AlertTriangle, iconClass: 'text-amber-600 bg-amber-50' },
  info: { icon: Info, iconClass: 'text-blue-600 bg-blue-500/10' },
};

export default function PayrollToDoRail({
  monthYear,
  onOpenProcessAndPay,
  onOpenFilings,
}: PayrollToDoRailProps) {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'dashboard-data', monthYear],
    queryFn: () => payrollApi.getDashboardData({ month_year: monthYear }).then((r) => r.data),
  });

  const alerts = useMemo<Alert[]>(() => {
    const list = (data as any)?.data?.alerts ?? [];
    return Array.isArray(list) ? (list as Alert[]) : [];
  }, [data]);

  const handleAction = (alert: Alert) => {
    const url = alert.action_url ?? '';
    // Keep the "run payroll" action on this page via the Process & Pay modal
    // instead of navigating away.
    if (url.startsWith('/payroll?action=run')) {
      onOpenProcessAndPay?.();
      return;
    }
    if (url.startsWith('/filings') || url.startsWith('/payroll/filings')) {
      onOpenFilings?.();
      return;
    }
    if (url) navigate(url);
  };

  return (
    <SurfaceCard className="p-5">
      <div className="mb-4 flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600">
          <ListChecks className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-slate-900">To-Do</h2>
          <p className="text-sm text-slate-500">Items that need your attention this month</p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-slate-100" />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-6 w-6" />
          </div>
          <p className="mt-3 text-sm font-medium text-slate-700">You're all caught up</p>
          <p className="text-xs text-slate-500">No pending payroll actions for {monthYear}.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {alerts.map((alert) => {
            const style = TYPE_STYLES[alert.type] ?? TYPE_STYLES.info;
            const Icon = style.icon;
            return (
              <div
                key={alert.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3 transition-colors hover:bg-slate-50"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg', style.iconClass)}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium text-slate-900">{alert.title}</p>
                      {alert.count !== undefined && alert.count > 0 && (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                          {alert.count}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-500">{alert.message}</p>
                  </div>
                </div>
                {alert.action && (
                  <button
                    type="button"
                    onClick={() => handleAction(alert)}
                    className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium text-blue-600 hover:underline"
                  >
                    {alert.action}
                    <ArrowRight className="h-4 w-4" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </SurfaceCard>
  );
}
