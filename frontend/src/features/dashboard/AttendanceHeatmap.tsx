import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi } from '@/services/api';

/**
 * Turnout as a calendar grid, five weeks deep.
 *
 * A line chart of attendance averages the bad days away — which is precisely
 * backwards, because the bad days are the only ones anybody can act on. A grid
 * keeps every day its own cell, so the Monday after a long weekend stays
 * visible as a single dark square instead of dissolving into a monthly mean.
 *
 * Weekends and holidays are hatched, never coloured. A holiday shaded like a
 * poor turnout day is a false alarm, and the second false alarm is the one
 * that teaches somebody to stop looking.
 */
export default function AttendanceHeatmap() {
  const month = new Date().toISOString().slice(0, 7);

  const { data, isLoading } = useQuery({
    queryKey: ['ops', 'calendar', month],
    queryFn: async () => (await attendanceApi.calendar({ month, scope: 'overall' })).data,
    staleTime: 10 * 60_000,
  });

  /*
   * How much of the workforce this month's attendance actually covers.
   *
   * The rate below is present/total_employees, and total_employees is the
   * whole headcount. On a tenant where only three of ninety-one people punch —
   * because the rest are on a roster nobody has wired to a device yet — every
   * single day computes under 5% and the grid renders as a wall of red.
   *
   * That is not bad turnout, it is missing data, and colouring it as a failure
   * is a false statement about eighty-eight people. When coverage is thin the
   * grid switches to comparing days against the best day observed, and says so
   * in words underneath rather than implying a headcount denominator it does
   * not have.
   */
  const coverage = useMemo(() => {
    const days = data?.days ?? [];
    const head = days.find((d) => (d.total_employees ?? 0) > 0)?.total_employees ?? 0;
    const best = Math.max(0, ...days.map((d) => (d.present_count ?? 0) + (d.late_count ?? 0)));
    return { head, best, thin: head > 0 && best / head < 0.5 };
  }, [data]);

  const weeks = useMemo(() => {
    const days = data?.days ?? [];
    if (days.length === 0) return [];

    const cells = days.map((d) => {
      const total = d.total_employees ?? 0;
      const present = (d.present_count ?? 0) + (d.late_count ?? 0);
      // Against headcount normally; against the best day observed when
      // attendance covers only a sliver of the workforce.
      const denominator = coverage.thin ? coverage.best : total;
      const rate = denominator > 0 ? present / denominator : null;
      return {
        date: d.date,
        dow: new Date(`${d.date}T00:00:00`).getDay(),
        off: Boolean(d.is_weekend || d.is_holiday),
        rate,
        present,
        total,
        label: d.is_holiday ? 'Holiday' : d.is_weekend ? 'Weekend' : null,
      };
    });

    // Pad to Monday so columns line up under their weekday header.
    const first = cells[0];
    const lead = first ? (first.dow === 0 ? 6 : first.dow - 1) : 0;
    const padded: Array<(typeof cells)[number] | null> = [
      ...Array.from({ length: lead }, () => null),
      ...cells,
    ];

    const out: Array<Array<(typeof cells)[number] | null>> = [];
    for (let i = 0; i < padded.length; i += 7) out.push(padded.slice(i, i + 7));
    return out.slice(-5);
  }, [data, coverage]);

  if (isLoading) {
    return <div className="h-[230px] animate-pulse rounded-xl bg-surface-sunken" />;
  }

  if (weeks.length === 0) {
    return (
      <div className="rounded-xl border border-border-strong bg-surface-card p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Turnout</h3>
        <p className="mt-2 text-sm text-slate-600">No attendance has been recorded this month yet.</p>
      </div>
    );
  }

  const shade = (rate: number | null) => {
    if (rate === null) return 'bg-slate-200';
    // No red in thin-coverage mode: "under 80% of the best day" is not a
    // shortfall anybody should be paged about.
    if (rate < 0.8) return coverage.thin ? 'bg-blue-500/12' : 'bg-red-500/55';
    if (rate < 0.88) return 'bg-blue-500/25';
    if (rate < 0.94) return 'bg-blue-500/45';
    return 'bg-blue-500/70';
  };

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Turnout &middot; this month
      </h3>

      <div className="mt-3 grid grid-cols-7 gap-1.5">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
          <span key={`${d}${i}`} className="text-center text-[9.5px] font-bold tracking-wide text-slate-500">
            {d}
          </span>
        ))}

        {weeks.flat().map((cell, i) =>
          cell === null ? (
            <span key={`pad${i}`} />
          ) : (
            <span
              key={cell.date}
              title={
                cell.label
                  ? `${cell.date} — ${cell.label}`
                  : coverage.thin
                    ? `${cell.date} — ${cell.present} punched in`
                    : `${cell.date} — ${cell.present} of ${cell.total} in`
              }
              className={`aspect-square rounded ${
                cell.off
                  ? 'bg-[repeating-linear-gradient(45deg,var(--surface-sunken)_0_3px,transparent_3px_6px)] border border-slate-200'
                  : shade(cell.rate)
              }`}
            />
          ),
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10.5px] text-slate-500">
        <span className="flex items-center gap-1">
          Low
          <i className="inline-block h-3 w-3 rounded-sm bg-blue-500/25" />
          <i className="inline-block h-3 w-3 rounded-sm bg-blue-500/45" />
          <i className="inline-block h-3 w-3 rounded-sm bg-blue-500/70" />
          High
        </span>
        {/* The red key only appears when red can actually be drawn. */}
        {coverage.thin ? null : (
          <span className="flex items-center gap-1">
            <i className="inline-block h-3 w-3 rounded-sm bg-red-500/55" /> Under 80%
          </span>
        )}
        <span className="flex items-center gap-1">
          <i className="inline-block h-3 w-3 rounded-sm border border-slate-200" /> Weekend or holiday
        </span>
      </div>

      {coverage.thin ? (
        <p className="mt-2.5 rounded-lg bg-amber-500/[0.09] px-2.5 py-2 text-[11.5px] leading-relaxed text-amber-700">
          {/*
            Said plainly, because the alternative is a grid that looks like a
            catastrophe. The number the admin needs here is not a turnout rate,
            it is how many people are being tracked at all.
          */}
          <b>Attendance is recorded for {coverage.best} of {coverage.head} people.</b> Shading compares
          days with each other, not against headcount — a turnout percentage would describe the{' '}
          {Math.max(coverage.head - coverage.best, 0)} people with no punch data as absent, which is
          a device and roster question rather than an attendance one.
        </p>
      ) : null}
    </div>
  );
}
