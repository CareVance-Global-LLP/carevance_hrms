import { useQuery } from '@tanstack/react-query';
import { opsDashboardApi } from '@/services/api';

/**
 * How well today's roster is actually covered.
 *
 * The three figures below answer three different questions and are never
 * merged, because merging them is how a shop floor loses an hour:
 *
 *   ROSTERED    somebody was told to be on a shift
 *   REST DAY    somebody was told they had the day off (a row with no shift)
 *   NOT ROSTERED nobody scheduled them at all (no row)
 *
 * A rest day is not an absence and neither is an unrostered day. Only the
 * first group can produce a no-show.
 */
export default function ShiftCoverage() {
  const { data, isLoading } = useQuery({
    queryKey: ['ops', 'today-summary'],
    queryFn: async () => (await opsDashboardApi.todaySummary()).data.data,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="h-[190px] animate-pulse rounded-xl bg-surface-sunken" />;
  }

  if (!data) return null;

  const { roster, rostered_absent: absent } = data;

  if (!roster.published) {
    return (
      <div className="rounded-xl border border-border-strong bg-surface-card p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Shift coverage</h3>
        <p className="mt-2 text-sm text-slate-600">
          No roster is published for today.
        </p>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-slate-500">
          {/* Not zero — unknowable. This is the distinction the whole card exists for. */}
          Absence is measured against what people were told to work, so without a published roster
          it is not being checked at all. That is different from nobody being absent.
        </p>
      </div>
    );
  }

  const present = Math.max(roster.rostered - absent.count, 0);
  const pct = roster.rostered > 0 ? Math.round((present / roster.rostered) * 100) : 100;

  // Circumference of an r=33 circle, so the arc reads as a true proportion.
  const C = 2 * Math.PI * 33;
  const filled = (pct / 100) * C;

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Shift coverage</h3>

      <div className="mt-3 flex items-center gap-4">
        <svg width="84" height="84" viewBox="0 0 84 84" role="img" aria-label={`${pct} percent of rostered staff are present`}>
          <circle cx="42" cy="42" r="33" fill="none" className="stroke-slate-200" strokeWidth="9" />
          <circle
            cx="42"
            cy="42"
            r="33"
            fill="none"
            className={absent.count > 0 ? 'stroke-amber-500' : 'stroke-emerald-600'}
            strokeWidth="9"
            strokeLinecap="round"
            strokeDasharray={`${filled.toFixed(1)} ${C.toFixed(1)}`}
            transform="rotate(-90 42 42)"
          />
          <text
            x="42"
            y="47"
            textAnchor="middle"
            className="fill-slate-900 font-display"
            style={{ fontSize: '15px', fontWeight: 700 }}
          >
            {pct}%
          </text>
        </svg>

        <ul className="min-w-0 flex-1 space-y-1.5 text-[12.5px]">
          <li className="flex items-baseline justify-between gap-2">
            <span className="text-slate-600">Rostered on a shift</span>
            <span className="font-bold tabular-nums text-slate-900">{roster.rostered}</span>
          </li>
          <li className="flex items-baseline justify-between gap-2">
            <span className="text-slate-600">Not turned up</span>
            <span className={`font-bold tabular-nums ${absent.count > 0 ? 'text-red-700' : 'text-slate-900'}`}>
              {absent.count}
            </span>
          </li>
          <li className="flex items-baseline justify-between gap-2">
            <span className="text-slate-600">Rostered off (rest day)</span>
            <span className="font-bold tabular-nums text-slate-900">{roster.rest_day}</span>
          </li>
          <li className="flex items-baseline justify-between gap-2">
            <span className="text-slate-600">Not rostered at all</span>
            <span className="font-bold tabular-nums text-slate-900">{roster.not_rostered}</span>
          </li>
        </ul>
      </div>
    </div>
  );
}
