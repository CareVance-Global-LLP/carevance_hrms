import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import { PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { reportApi } from '@/services/api';
import { cn } from '@/utils/cn';
import {
  FULL_DAY_SECONDS,
  addDays,
  buildWeek,
  buildWeekGridRows,
  formatCell,
  formatDuration,
  formatTotal,
  formatWeekRange,
  startOfWeek,
  type CellState,
  type WeekGridRow,
} from '@/features/timesheets/weekGrid';

const CELL_CLASS: Record<CellState, string> = {
  full: 'bg-emerald-50',
  over: 'bg-amber-50 shadow-[inset_0_0_0_1px_theme(colors.amber.300)]',
  short: 'bg-surface-card',
  missing: 'bg-[repeating-linear-gradient(135deg,transparent_0_5px,theme(colors.slate.200)_5px_6px)]',
  'weekend-worked': 'bg-slate-50',
  future: 'bg-slate-50/50',
};

const toIso = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/**
 * Timesheets — people down, days across.
 *
 * The nav has always called this "Timesheets" while the page it pointed at was
 * a per-person totals table titled "Hours Tracked". That table can tell you
 * someone logged 38 hours; it cannot tell you they logged fourteen on Tuesday
 * and none on Wednesday, which is the question a timesheet exists to answer.
 *
 * The old report stays where it is at /reports/hours-tracked — it is a
 * legitimate report and eight other modes share its shell.
 */
export default function Timesheets() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  const week = useMemo(() => buildWeek(weekStart), [weekStart]);
  const startDate = toIso(weekStart);
  const endDate = toIso(addDays(weekStart, 6));

  const reportQuery = useQuery({
    queryKey: ['timesheets', 'week', startDate, endDate],
    queryFn: async () => (await reportApi.overall({ start_date: startDate, end_date: endDate })).data,
  });

  const [hideEmpty, setHideEmpty] = useState(false);

  const allRows: WeekGridRow[] = useMemo(() => {
    const payload: any = reportQuery.data;
    if (!payload) return [];
    return buildWeekGridRows({
      users: payload.users || [],
      byUser: payload.by_user || [],
      byUserDay: payload.by_user_day || [],
      week,
    });
  }, [reportQuery.data, week]);

  const emptyCount = useMemo(() => allRows.filter((row) => row.total <= 0).length, [allRows]);
  const rows = useMemo(
    () => (hideEmpty ? allRows.filter((row) => row.total > 0) : allRows),
    [allRows, hideEmpty]
  );

  const totals = useMemo(() => {
    const perDay = week.map((_, index) => rows.reduce((sum, row) => sum + row.cells[index].seconds, 0));
    const logged = rows.reduce((sum, row) => sum + row.total, 0);
    const expected = rows.reduce((sum, row) => sum + row.expected, 0);
    const overtime = rows.reduce((sum, row) => sum + row.overtime, 0);
    const missing = rows.reduce((sum, row) => sum + row.missingDays, 0);
    const idle = rows.reduce(
      (sum, row) => sum + row.cells.reduce((cellSum, cell) => cellSum + cell.idleSeconds, 0),
      0
    );
    return { perDay, logged, expected, overtime, missing, idle };
  }, [rows, week]);

  const isThisWeek = startOfWeek(new Date()).getTime() === weekStart.getTime();

  if (reportQuery.isLoading) return <PageLoadingState label="Loading timesheets..." />;

  if (reportQuery.isError) {
    return (
      <PageErrorState
        message={(reportQuery.error as any)?.response?.data?.message || 'Failed to load timesheets.'}
        onRetry={() => void reportQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">Timesheets</h1>
          <p className="mt-1 text-sm text-slate-600">
            Week of {formatWeekRange(weekStart)} · {rows.length} {rows.length === 1 ? 'person' : 'people'}
            {emptyCount > 0 ? (
              <>
                {' · '}
                <button
                  type="button"
                  onClick={() => setHideEmpty((current) => !current)}
                  className="font-medium text-blue-700 underline underline-offset-2 transition hover:text-blue-600"
                >
                  {hideEmpty ? `show ${emptyCount} with no time` : `hide ${emptyCount} with no time`}
                </button>
              </>
            ) : null}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            <button
              type="button"
              aria-label="Previous week"
              onClick={() => setWeekStart((current) => addDays(current, -7))}
              className="inline-flex min-h-10 items-center px-2.5 text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => setWeekStart(startOfWeek(new Date()))}
              disabled={isThisWeek}
              className="min-h-10 border-x border-slate-200 px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              This week
            </button>
            <button
              type="button"
              aria-label="Next week"
              onClick={() => setWeekStart((current) => addDays(current, 7))}
              className="inline-flex min-h-10 items-center px-2.5 text-slate-700 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Download className="h-4 w-4" />}
            onClick={() => {
              void reportApi
                .export({ start_date: startDate, end_date: endDate, report_type: 'hours-tracked' })
                .then((response) => {
                  const url = URL.createObjectURL(new Blob([response.data as any]));
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `timesheets-${startDate}-to-${endDate}.csv`;
                  link.click();
                  URL.revokeObjectURL(url);
                });
            }}
          >
            Export
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-5">
        {[
          { label: 'Logged', value: formatDuration(totals.logged) },
          { label: 'Expected', value: formatDuration(totals.expected) },
          {
            label: 'Overtime',
            value: formatDuration(totals.overtime),
            tone: totals.overtime > 0 ? 'text-amber-700' : undefined,
          },
          {
            label: 'Idle share',
            value: totals.logged > 0 ? `${((totals.idle / totals.logged) * 100).toFixed(1)}%` : '—',
          },
          {
            label: 'Days missing',
            value: String(totals.missing),
            tone: totals.missing > 0 ? 'text-rose-700' : undefined,
          },
        ].map((metric) => (
          <div key={metric.label} className="bg-surface-card px-3 py-2.5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">{metric.label}</dt>
            <dd className={cn('mt-1 text-lg font-semibold tabular-nums text-slate-950', metric.tone)}>{metric.value}</dd>
          </div>
        ))}
      </dl>

      {rows.length === 0 ? (
        <PageEmptyState title="No timesheets for this week" description="Nobody in view tracked time in this range." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-surface-card">
          <table className="w-full min-w-[52rem] border-collapse text-sm">
            <caption className="sr-only">Hours logged per person per day for the week of {formatWeekRange(weekStart)}</caption>
            <thead>
              <tr>
                <th
                  scope="col"
                  className="sticky left-0 z-10 border-b border-r border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600"
                >
                  Employee
                </th>
                {week.map((day) => (
                  <th
                    key={day.date}
                    scope="col"
                    className={cn(
                      'border-b border-slate-200 bg-slate-50 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.1em]',
                      day.isToday ? 'text-blue-700' : 'text-slate-600'
                    )}
                  >
                    {day.label} {day.dayNumber}
                  </th>
                ))}
                <th
                  scope="col"
                  className="border-b border-l border-slate-200 bg-slate-50 px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600"
                >
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.userId}>
                  <th
                    scope="row"
                    className="sticky left-0 z-10 min-w-[11rem] border-b border-r border-slate-100 bg-surface-card px-3 py-2 text-left font-normal"
                  >
                    <span className="block truncate font-medium text-slate-950">{row.name}</span>
                    {row.department ? (
                      <span className="block truncate text-xs text-slate-600">{row.department}</span>
                    ) : null}
                  </th>

                  {row.cells.map((cell, index) => {
                    const day = week[index];
                    const idleShare = cell.seconds > 0 ? Math.min(1, cell.idleSeconds / cell.seconds) : 0;

                    return (
                      <td
                        key={day.date}
                        className={cn('border-b border-slate-100 px-1 py-1.5 text-center', CELL_CLASS[cell.state])}
                      >
                        <span
                          className={cn(
                            'block text-sm tabular-nums',
                            cell.seconds > 0 ? 'font-medium text-slate-950' : 'text-slate-600'
                          )}
                          title={
                            cell.seconds > 0
                              ? `${formatCell(cell.seconds)} logged${cell.idleSeconds > 0 ? `, ${formatCell(cell.idleSeconds)} idle` : ''}`
                              : day.isFuture
                                ? 'Not yet'
                                : 'No entry'
                          }
                        >
                          {formatCell(cell.seconds)}
                        </span>

                        {cell.seconds > FULL_DAY_SECONDS * 1.05 ? (
                          <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                            +{formatCell(cell.seconds - FULL_DAY_SECONDS)}
                          </span>
                        ) : cell.seconds > 0 ? (
                          // Idle reads as a proportion under the hours rather
                          // than costing a whole extra column.
                          <span className="mx-auto mt-1 block h-0.5 w-8 overflow-hidden rounded-full bg-slate-200">
                            <span className="block h-full bg-amber-500" style={{ width: `${idleShare * 100}%` }} />
                          </span>
                        ) : null}
                      </td>
                    );
                  })}

                  <td className="border-b border-l border-slate-100 bg-slate-50 px-2 py-1.5 text-center">
                    <span className="block text-sm font-semibold tabular-nums text-slate-950">
                      {formatTotal(row.total)}
                    </span>
                    {row.overtime > 0 ? (
                      <span className="block text-[9px] font-semibold uppercase tracking-wide text-amber-700">
                        +{formatTotal(row.overtime)} OT
                      </span>
                    ) : row.missingDays > 0 ? (
                      <span className="block text-[9px] font-semibold uppercase tracking-wide text-rose-700">
                        {row.missingDays} missing
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th
                  scope="row"
                  className="sticky left-0 z-10 border-r border-t border-slate-200 bg-slate-50 px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600"
                >
                  Day total
                </th>
                {totals.perDay.map((seconds, index) => (
                  <td
                    key={week[index].date}
                    className="border-t border-slate-200 bg-slate-50 px-2 py-2 text-center text-sm font-semibold tabular-nums text-slate-950"
                  >
                    {formatTotal(seconds)}
                  </td>
                ))}
                <td className="border-l border-t border-slate-200 bg-slate-50 px-2 py-2 text-center text-sm font-semibold tabular-nums text-slate-950">
                  {formatTotal(totals.logged)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-600">
        <span className="font-semibold uppercase tracking-[0.14em] text-slate-600">Legend</span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-emerald-200 bg-emerald-50" aria-hidden="true" /> Full day
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-amber-300 bg-amber-50" aria-hidden="true" /> Over 8h
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-3 w-3 rounded-sm border border-slate-200 bg-surface-card" aria-hidden="true" /> Short day
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="h-3 w-3 rounded-sm border border-slate-200 bg-[repeating-linear-gradient(135deg,transparent_0_3px,theme(colors.slate.300)_3px_4px)]"
            aria-hidden="true"
          />{' '}
          No entry
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-1 w-5 rounded-full bg-amber-500" aria-hidden="true" /> Idle share within the day
        </span>
      </div>
    </div>
  );
}
