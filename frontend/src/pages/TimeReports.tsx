import { Fragment, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { SelectInput, TextInput } from '@/components/ui/FormField';
import VarianceBar from '@/features/timereports/VarianceBar';
import { queryKeys } from '@/lib/queryKeys';
import { taskApi, userApi } from '@/services/api';
import type { Task } from '@/types';
import { cn } from '@/utils/cn';
import {
  formatMinutes,
  formatTrackedTime,
  getAssigneeNames,
  getTaskVariancePercent,
  titleCase,
} from '@/features/tasks/taskUtils';

type GroupAxis = 'assignee' | 'status' | 'department' | 'project';

const GROUP_OPTIONS: Array<{ value: GroupAxis; label: string }> = [
  { value: 'assignee', label: 'Assignee' },
  { value: 'status', label: 'Status' },
  { value: 'department', label: 'Department' },
  { value: 'project', label: 'Project' },
];

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

const defaultRange = () => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { start: toIso(start), end: toIso(end) };
};

interface VarianceRow {
  key: string;
  label: string;
  tasks: number;
  estimateMinutes: number;
  trackedSeconds: number;
  variance: number | null;
}

/**
 * Time Reports answers one question: where does our estimating break down?
 *
 * It used to stack three tables that each carried the same clamped progress
 * bar, and reported over every task that had ever existed with no date range at
 * all. Now the variance is the lead, and it is uncapped.
 */
export default function TimeReports() {
  const [range, setRange] = useState(defaultRange);
  const [groupBy, setGroupBy] = useState<GroupAxis>('assignee');
  const [selectedUserId, setSelectedUserId] = useState('all');

  const tasksQuery = useQuery({
    queryKey: [...queryKeys.tasks, 'time-reports', range.start, range.end],
    queryFn: async () => (await taskApi.getAll({ start_date: range.start, end_date: range.end })).data || [],
  });

  const usersQuery = useQuery({
    queryKey: queryKeys.users({ period: 'all' }),
    queryFn: async () => (await userApi.getAll({ period: 'all' })).data || [],
  });

  const tasks = tasksQuery.data || [];
  const users = usersQuery.data || [];

  const filteredTasks = useMemo(() => {
    if (selectedUserId === 'all') return tasks;
    return tasks.filter(
      (task) =>
        String(task.assignee_id || '') === selectedUserId ||
        task.assignees?.some((member) => String(member.id) === selectedUserId)
    );
  }, [tasks, selectedUserId]);

  /** Only tasks with both an estimate and tracked time can have a variance. */
  const comparable = useMemo(
    () => filteredTasks.filter((task) => getTaskVariancePercent(task) !== null),
    [filteredTasks]
  );

  const summary = useMemo(() => {
    const trackedSeconds = filteredTasks.reduce(
      (total, task) => total + Number(task.time_entries_sum_duration || 0),
      0
    );
    const variances = comparable.map((task) => getTaskVariancePercent(task) as number).sort((a, b) => a - b);
    const median = variances.length
      ? variances.length % 2
        ? variances[(variances.length - 1) / 2]
        : Math.round((variances[variances.length / 2 - 1] + variances[variances.length / 2]) / 2)
      : null;

    return {
      total: filteredTasks.length,
      done: filteredTasks.filter((task) => task.status === 'done').length,
      overran: comparable.filter((task) => (getTaskVariancePercent(task) as number) > 0).length,
      trackedSeconds,
      median,
    };
  }, [filteredTasks, comparable]);

  const groupedRows = useMemo<VarianceRow[]>(() => {
    const buckets = new Map<string, VarianceRow>();

    // Only tasks that individually carry BOTH an estimate and tracked time can
    // be aggregated. Summing the whole set would compare one task's estimate
    // against a different task's tracked time and invent a percentage — which
    // is how this chart once showed "+1996%" while the header above it
    // correctly read "0 of 54 tasks have both".
    const source = comparable;

    const push = (key: string, label: string, task: Task) => {
      const existing = buckets.get(key) ?? {
        key,
        label,
        tasks: 0,
        estimateMinutes: 0,
        trackedSeconds: 0,
        variance: null,
      };
      existing.tasks += 1;
      existing.estimateMinutes += Number(task.estimated_time || 0);
      existing.trackedSeconds += Number(task.time_entries_sum_duration || 0);
      buckets.set(key, existing);
    };

    source.forEach((task) => {
      if (groupBy === 'assignee') {
        const names = getAssigneeNames(task);
        if (names.length === 0) push('unassigned', 'Unassigned', task);
        else names.forEach((name) => push(`a:${name}`, name, task));
        return;
      }
      if (groupBy === 'status') {
        push(task.status, titleCase(task.status), task);
        return;
      }
      if (groupBy === 'department') {
        push(`g:${task.group?.name || 'None'}`, task.group?.name || 'No department', task);
        return;
      }
      push(`p:${task.project?.name || 'None'}`, task.project?.name || 'No project', task);
    });

    return Array.from(buckets.values())
      .map((row) => {
        const estimateSeconds = row.estimateMinutes * 60;
        return {
          ...row,
          variance:
            estimateSeconds > 0 && row.trackedSeconds > 0
              ? Math.round(((row.trackedSeconds - estimateSeconds) / estimateSeconds) * 100)
              : null,
        };
      })
      .filter((row): row is VarianceRow & { variance: number } => row.variance !== null)
      .sort((a, b) => b.variance - a.variance);
  }, [comparable, groupBy]);

  /** Half the track is the largest deviation present, so the chart always fills. */
  const chartScale = useMemo(() => {
    const magnitudes = groupedRows
      .map((row) => (row.variance === null ? 0 : Math.abs(row.variance)))
      .filter((value) => value > 0);
    return magnitudes.length ? Math.max(50, Math.max(...magnitudes)) : 100;
  }, [groupedRows]);

  const taskRows = useMemo(
    () =>
      [...filteredTasks].sort((a, b) => {
        const aVariance = getTaskVariancePercent(a);
        const bVariance = getTaskVariancePercent(b);
        return (bVariance ?? Number.NEGATIVE_INFINITY) - (aVariance ?? Number.NEGATIVE_INFINITY);
      }),
    [filteredTasks]
  );

  const taskScale = useMemo(() => {
    const magnitudes = comparable
      .map((task) => Math.abs(getTaskVariancePercent(task) as number))
      .filter((value) => value > 0);
    return magnitudes.length ? Math.max(50, Math.max(...magnitudes)) : 100;
  }, [comparable]);

  if (tasksQuery.isLoading || usersQuery.isLoading) return <PageLoadingState label="Loading time reports..." />;

  if (tasksQuery.isError || usersQuery.isError) {
    return (
      <PageErrorState
        message={(tasksQuery.error as any)?.response?.data?.message || 'Failed to load report data.'}
        onRetry={() => {
          void tasksQuery.refetch();
          void usersQuery.refetch();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Time Reports</h1>
        <p className="text-sm text-slate-600">
          <span className="font-medium text-slate-700">{summary.total}</span> tasks ·{' '}
          <span className="font-medium text-slate-700">{comparable.length}</span> comparable
          {summary.overran > 0 ? (
            <>
              {' · '}
              <span className="font-medium text-rose-700">{summary.overran}</span> over estimate
            </>
          ) : null}
          {summary.trackedSeconds > 0 ? <> · {formatTrackedTime(summary.trackedSeconds)} tracked</> : null}
          {summary.median !== null
            ? ` · median ${summary.median > 0 ? 'overrun' : 'saving'} ${Math.abs(summary.median)}%`
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* This page previously had no date range at all — it silently reported
            across every task that had ever been created. */}
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          From
          <TextInput
            type="date"
            className="w-40"
            aria-label="Start date"
            value={range.start}
            max={range.end}
            onChange={(event) => setRange((current) => ({ ...current, start: event.target.value }))}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
          To
          <TextInput
            type="date"
            className="w-40"
            aria-label="End date"
            value={range.end}
            min={range.start}
            onChange={(event) => setRange((current) => ({ ...current, end: event.target.value }))}
          />
        </label>

        <SelectInput
          className="w-44"
          aria-label="Filter by user"
          value={selectedUserId}
          onChange={(event) => setSelectedUserId(event.target.value)}
        >
          <option value="all">All users</option>
          {users.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </SelectInput>

        <SelectInput
          className="w-40"
          aria-label="Group by"
          value={groupBy}
          onChange={(event) => setGroupBy(event.target.value as GroupAxis)}
        >
          {GROUP_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </SelectInput>
      </div>

      <SurfaceCard className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Estimate vs actual, by {groupBy}</h2>
            <p className="mt-1 text-sm text-slate-600">
              The centre line is the estimate. Bars grow left when work came in under it, right when it ran over.
            </p>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-600">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-emerald-500" aria-hidden="true" /> Under
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-sm bg-rose-500" aria-hidden="true" /> Over
            </span>
          </div>
        </div>

        {groupedRows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">
            Nothing to compare — no task in this range carries both an estimate and tracked time.
          </p>
        ) : (
          <div className="mt-5 space-y-1">
            {groupedRows.map((row) => (
              <div key={row.key} className="grid grid-cols-[minmax(6rem,9rem)_1fr_4rem] items-center gap-3">
                <span className="truncate text-right text-sm text-slate-700" title={row.label}>
                  {row.label}
                </span>
                <VarianceBar
                  percent={row.variance}
                  scale={chartScale}
                  label={`${row.label}: ${
                    row.variance === null
                      ? 'no estimate'
                      : `${row.variance > 0 ? 'over' : 'under'} estimate by ${Math.abs(row.variance)} percent`
                  }`}
                />
                <span
                  className={cn(
                    'text-right text-sm tabular-nums',
                    row.variance === null
                      ? 'text-slate-600'
                      : row.variance > 0
                        ? 'font-semibold text-rose-700'
                        : 'font-semibold text-emerald-700'
                  )}
                >
                  {row.variance === null ? '—' : `${row.variance > 0 ? '+' : ''}${row.variance}%`}
                </span>
              </div>
            ))}

            <div className="grid grid-cols-[minmax(6rem,9rem)_1fr_4rem] gap-3 pt-2">
              <span />
              <div className="flex justify-between text-[10px] tabular-nums text-slate-600">
                <span>−{chartScale}%</span>
                <span>On estimate</span>
                <span>+{chartScale}%</span>
              </div>
              <span />
            </div>
          </div>
        )}
      </SurfaceCard>

      <SurfaceCard className="overflow-hidden p-0">
        <div className="border-b border-slate-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-slate-950">Every task in range</h2>
          <p className="mt-1 text-sm text-slate-600">Worst overrun first.</p>
        </div>

        {taskRows.length === 0 ? (
          <div className="p-5">
            <PageEmptyState title="No tasks in this range" description="Widen the date range to see more." />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-600">
                  <th scope="col" className="px-5 py-2.5">Task</th>
                  <th scope="col" className="px-3 py-2.5">Assignee</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Estimate</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Tracked</th>
                  <th scope="col" className="px-3 py-2.5">Variance</th>
                  <th scope="col" className="px-3 py-2.5 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {taskRows.map((task) => {
                  const variance = getTaskVariancePercent(task);
                  return (
                    <Fragment key={task.id}>
                      <tr className="border-b border-slate-100 last:border-0">
                        <td className="max-w-[18rem] truncate px-5 py-2.5 font-medium text-slate-950" title={task.title}>
                          {task.title}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{getAssigneeNames(task).join(', ') || 'Unassigned'}</td>
                        <td className="px-3 py-2.5">
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                            {titleCase(task.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">
                          {formatMinutes(task.estimated_time)}
                        </td>
                        <td
                          className={cn(
                            'px-3 py-2.5 text-right tabular-nums',
                            variance !== null && variance > 0 ? 'font-semibold text-rose-700' : 'text-slate-700'
                          )}
                        >
                          {formatTrackedTime(task.time_entries_sum_duration)}
                        </td>
                        <td className="w-40 px-3 py-2.5">
                          <VarianceBar percent={variance} scale={taskScale} height="sm" label={`${task.title} variance`} />
                        </td>
                        <td
                          className={cn(
                            'px-3 py-2.5 text-right tabular-nums',
                            variance === null
                              ? 'text-slate-600'
                              : variance > 0
                                ? 'font-semibold text-rose-700'
                                : 'font-semibold text-emerald-700'
                          )}
                        >
                          {variance === null ? '—' : `${variance > 0 ? '+' : ''}${variance}%`}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>
    </div>
  );
}
