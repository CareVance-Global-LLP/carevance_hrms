import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, BarChart3, CalendarDays, CheckCircle2, Clock3, TimerReset, TrendingUp, UserRound } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import MetricCard from '@/components/dashboard/MetricCard';
import { PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { SelectInput } from '@/components/ui/FormField';
import { queryKeys } from '@/lib/queryKeys';
import { taskApi, userApi } from '@/services/api';
import type { Task } from '@/types';
import { cn } from '@/utils/cn';

const titleCase = (v: string) => v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const formatMinutes = (m: number) => {
  if (!m || m <= 0) return '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h && r) return `${h}h ${r}m`;
  if (h) return `${h}h`;
  return `${r}m`;
};
const formatSeconds = (s: number) => formatMinutes(Math.round((s || 0) / 60));

export default function TimeReports() {
  const [selectedUserId, setSelectedUserId] = useState('all');

  const tasksQuery = useQuery({
    queryKey: queryKeys.tasks,
    queryFn: async () => (await taskApi.getAll()).data || [],
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.users({ period: 'all' }),
    queryFn: async () => (await userApi.getAll({ period: 'all' })).data || [],
  });

  const tasks = tasksQuery.data || [];
  const users = usersQuery.data || [];

  const filteredTasks = useMemo(() => {
    if (selectedUserId === 'all') return tasks;
    return tasks.filter((t) =>
      t.assignee_id === Number(selectedUserId) ||
      t.assignees?.some((a) => a.id === Number(selectedUserId))
    );
  }, [tasks, selectedUserId]);

  const summary = useMemo(() => {
    const totalEstimate = filteredTasks.reduce((s, t) => s + Number(t.estimated_time || 0), 0);
    const totalTracked = filteredTasks.reduce((s, t) => s + Number(t.time_entries_sum_duration || 0), 0);
    const doneTasks = filteredTasks.filter((t) => t.status === 'done').length;
    const overdueTasks = filteredTasks.filter((t) => t.due_date && new Date(t.due_date).getTime() < Date.now() && t.status !== 'done').length;
    const trackedSeconds = filteredTasks.reduce((s, t) => s + Number(t.time_entries_sum_duration || 0), 0);
    return { totalTasks: filteredTasks.length, totalEstimate, totalTracked, doneTasks, overdueTasks, trackedSeconds };
  }, [filteredTasks]);

  const perUser = useMemo(() => {
    const map = new Map<string, { name: string; tasks: number; estimate: number; tracked: number; done: number }>();
    filteredTasks.forEach((t) => {
      const assignees = t.assignees?.length ? t.assignees : (t.assignee ? [t.assignee] : []);
      assignees.forEach((u) => {
        const key = String(u.id);
        const row = map.get(key) || { name: u.name, tasks: 0, estimate: 0, tracked: 0, done: 0 };
        row.tasks++;
        row.estimate += Number(t.estimated_time || 0);
        row.tracked += Number(t.time_entries_sum_duration || 0);
        if (t.status === 'done') row.done++;
        map.set(key, row);
      });
    });
    return Array.from(map.values()).sort((a, b) => b.tracked - a.tracked);
  }, [filteredTasks]);

  const perStatus = useMemo(() => {
    const map = new Map<string, { count: number; estimate: number; tracked: number }>();
    filteredTasks.forEach((t) => {
      const s = t.status || 'todo';
      const row = map.get(s) || { count: 0, estimate: 0, tracked: 0 };
      row.count++;
      row.estimate += Number(t.estimated_time || 0);
      row.tracked += Number(t.time_entries_sum_duration || 0);
      map.set(s, row);
    });
    return Array.from(map.entries()).map(([status, data]) => ({ status, ...data }));
  }, [filteredTasks]);

  if (tasksQuery.isLoading || usersQuery.isLoading) return <PageLoadingState label="Loading time reports..." />;

  if (tasksQuery.isError || usersQuery.isError) {
    return (
      <PageErrorState
        message={(tasksQuery.error as any)?.response?.data?.message || 'Failed to load report data.'}
        onRetry={() => { void tasksQuery.refetch(); void usersQuery.refetch(); }}
      />
    );
  }

  return (
    <div className="space-y-6">
      <SurfaceCard className="p-6 sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-600">Time Reports</p>
            <h1 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">Tracked time by task, user, and status</h1>
          </div>
          <SelectInput value={selectedUserId} onChange={(e) => setSelectedUserId(e.target.value)} className="w-52">
            <option value="all">All Users</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SelectInput>
        </div>
      </SurfaceCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Tasks" value={summary.totalTasks} icon={CheckCircle2} accent="sky" />
        <MetricCard label="Completed" value={summary.doneTasks} icon={TrendingUp} accent="emerald" />
        <MetricCard label="Overdue" value={summary.overdueTasks} icon={AlertTriangle} accent="rose" />
        <MetricCard label="Total Tracked" value={formatSeconds(summary.trackedSeconds)} icon={Clock3} accent="violet" />
      </div>

      <SurfaceCard className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-950">By Status</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Tasks</th>
                <th className="pb-3 pr-4">Estimate</th>
                <th className="pb-3 pr-4">Tracked</th>
                <th className="pb-3">Completion</th>
              </tr>
            </thead>
            <tbody>
              {perStatus.map((row) => (
                <tr key={row.status} className="border-b border-slate-100 last:border-0">
                  <td className="py-3 pr-4 font-medium text-slate-900">{titleCase(row.status)}</td>
                  <td className="py-3 pr-4 text-slate-700">{row.count}</td>
                  <td className="py-3 pr-4 text-slate-700">{formatMinutes(row.estimate)}</td>
                  <td className="py-3 pr-4 text-slate-700">{formatSeconds(row.tracked)}</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                        <div className={cn('h-full rounded-full', row.estimate > 0 && row.tracked >= row.estimate * 60 ? 'bg-emerald-500' : 'bg-sky-500')} style={{ width: `${row.estimate > 0 ? Math.min(100, Math.round((row.tracked / (row.estimate * 60)) * 100)) : 0}%` }} />
                      </div>
                      <span className="text-xs text-slate-500">{row.estimate > 0 ? `${Math.min(100, Math.round((row.tracked / (row.estimate * 60)) * 100))}%` : '-'}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SurfaceCard>

      <SurfaceCard className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <UserRound className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-950">By User</h2>
        </div>
        {perUser.length === 0 ? (
          <p className="text-sm text-slate-500">No data for the selected filter.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  <th className="pb-3 pr-4">User</th>
                  <th className="pb-3 pr-4">Tasks</th>
                  <th className="pb-3 pr-4">Done</th>
                  <th className="pb-3 pr-4">Estimate</th>
                  <th className="pb-3 pr-4">Tracked</th>
                  <th className="pb-3">Completion</th>
                </tr>
              </thead>
              <tbody>
                {perUser.map((row) => (
                  <tr key={row.name} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 pr-4 font-medium text-slate-900">{row.name}</td>
                    <td className="py-3 pr-4 text-slate-700">{row.tasks}</td>
                    <td className="py-3 pr-4 text-slate-700">{row.done}</td>
                    <td className="py-3 pr-4 text-slate-700">{formatMinutes(row.estimate)}</td>
                    <td className="py-3 pr-4 text-slate-700">{formatSeconds(row.tracked)}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${row.estimate > 0 ? Math.min(100, Math.round((row.tracked / (row.estimate * 60)) * 100)) : 0}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{row.estimate > 0 ? `${Math.min(100, Math.round((row.tracked / (row.estimate * 60)) * 100))}%` : '-'}</span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard className="p-6">
        <div className="mb-4 flex items-center gap-2">
          <TimerReset className="h-5 w-5 text-slate-500" />
          <h2 className="text-lg font-semibold text-slate-950">All Tasks</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                <th className="pb-3 pr-4">Task</th>
                <th className="pb-3 pr-4">Assignee</th>
                <th className="pb-3 pr-4">Status</th>
                <th className="pb-3 pr-4">Estimate</th>
                <th className="pb-3 pr-4">Tracked</th>
                <th className="pb-3 pr-4">Completion</th>
              </tr>
            </thead>
            <tbody>
              {filteredTasks.map((t) => {
                const assigneeName = t.assignees?.map((a) => a.name).join(', ') || t.assignee?.name || 'Unassigned';
                const pct = getCompletionPercent(t);
                return (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="py-3 pr-4 font-medium text-slate-900 max-w-[240px] truncate">{t.title}</td>
                    <td className="py-3 pr-4 text-slate-700">{assigneeName}</td>
                    <td className="py-3 pr-4">
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">{titleCase(t.status)}</span>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">{formatMinutes(t.estimated_time)}</td>
                    <td className="py-3 pr-4 text-slate-700">{formatTracked(t.time_entries_sum_duration)}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-sky-500')} style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">{pct}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SurfaceCard>
    </div>
  );
}

function getCompletionPercent(t: Task) {
  const e = Number(t.estimated_time || 0);
  const tr = Number(t.time_entries_sum_duration || 0);
  if (e <= 0 && tr <= 0) return 0;
  if (e <= 0) return tr > 0 ? 100 : 0;
  return Math.min(100, Math.round((tr / (e * 60)) * 100));
}

function formatTracked(s?: number | null) {
  if (!s || s <= 0) return '0m';
  const mins = Math.round(s / 60);
  return formatMinutes(mins);
}
