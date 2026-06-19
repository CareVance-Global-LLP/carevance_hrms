import { Activity, Lock, ShieldCheck, Send, Wallet, Unlock, FileText } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { cn } from '@/utils/cn';

interface RunActivityLogProps {
  runId: number;
  className?: string;
}

const ACTION_ICON: Record<string, any> = {
  'payroll_run.locked': Lock,
  'payroll_run.force_locked': Lock,
  'payroll_run.unlocked': Unlock,
  'payroll_run.approved': ShieldCheck,
  'payroll_run.released': Send,
  'payroll_run.disbursed': Wallet,
};

const ACTION_LABEL: Record<string, { label: string; tone: string }> = {
  'payroll_run.locked':       { label: 'Run locked', tone: 'text-amber-700' },
  'payroll_run.force_locked': { label: 'Run locked (override)', tone: 'text-amber-700' },
  'payroll_run.unlocked':     { label: 'Run unlocked', tone: 'text-rose-600' },
  'payroll_run.approved':     { label: 'Run approved', tone: 'text-blue-700' },
  'payroll_run.released':     { label: 'Bank file generated', tone: 'text-violet-700' },
  'payroll_run.disbursed':    { label: 'Disbursed', tone: 'text-emerald-700' },
};

function fallbackForAction(action: string): { label: string; tone: string } {
  // Strip the 'payroll_run.' prefix and humanize
  const stripped = action.replace(/^payroll_run\./, '').replace(/_/g, ' ');
  return { label: stripped.charAt(0).toUpperCase() + stripped.slice(1), tone: 'text-slate-700' };
}

/**
 * Chronological activity log for a payroll run.
 *
 * Reads from /payroll/runs/{id}/activity which surfaces the most recent
 * audit_logs entries (lock, approve, release, disburse, etc).
 */
export default function RunActivityLog({ runId, className }: RunActivityLogProps) {
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'run-activity', runId],
    queryFn: () => payrollApi.getRunActivity(runId).then((r) => r.data),
    enabled: !!runId,
  });

  if (isLoading) {
    return (
      <SurfaceCard className={cn('p-4', className)}>
        <div className="text-sm text-slate-500">Loading activity…</div>
      </SurfaceCard>
    );
  }

  const entries = data?.entries ?? [];

  return (
    <SurfaceCard className={cn('p-4', className)}>
      <div className="flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-900">Activity Log</h3>
      </div>

      {entries.length === 0 ? (
        <div className="text-center py-6 text-xs text-slate-400">
          <FileText className="h-8 w-8 mx-auto mb-2 text-slate-300" />
          No actions recorded yet for this run.
        </div>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry, idx) => {
            const meta = ACTION_LABEL[entry.action] ?? fallbackForAction(entry.action);
            const Icon = ACTION_ICON[entry.action] ?? Activity;
            const isLast = idx === entries.length - 1;
            return (
              <li key={entry.id} className="relative pl-7">
                {!isLast && (
                  <span className="absolute left-[13px] top-7 bottom-[-8px] w-px bg-slate-200" />
                )}
                <span className="absolute left-0 top-0.5 h-7 w-7 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div>
                  <p className={cn('text-sm font-medium', meta.tone)}>{meta.label}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(entry.created_at).toLocaleString('en-IN', {
                      day: 'numeric', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                    {entry.actor_name ? ` · ${entry.actor_name}` : ''}
                  </p>
                  {entry.ip_address && (
                    <p className="text-[10px] text-slate-400 font-mono">from {entry.ip_address}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </SurfaceCard>
  );
}
