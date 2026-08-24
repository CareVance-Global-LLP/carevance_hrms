import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { opsDashboardApi } from '@/services/api';

/**
 * Headcount, joiners and leavers over twelve months.
 *
 * Drawn as inline SVG rather than through the charting library on purpose:
 * Recharts is configured here with three hardcoded slate hex values that do
 * not invert, so a chart rendered through it is light-mode-only. These paths
 * take their colours from `currentColor` and the theme tokens.
 *
 * THE CURVE IS ANCHORED, NOT ACCUMULATED. The server walks the running total
 * backwards from today's real headcount instead of summing forwards from zero,
 * because joining dates do not reach back to the organisation's founding —
 * counting up produces a line that is wrong at every point and correct only at
 * its right-hand end. See HeadcountSeriesService.
 */
export default function HeadcountChart() {
  const { data, isLoading } = useQuery({
    queryKey: ['ops', 'headcount-series'],
    queryFn: async () => (await opsDashboardApi.headcountSeries()).data.data,
    staleTime: 15 * 60_000,
  });

  const geometry = useMemo(() => {
    const months = data?.months ?? [];
    if (months.length === 0) return null;

    const W = 760;
    const H = 150;
    const counts = months.map((m) => m.headcount);
    const max = Math.max(...counts, 1);
    const min = Math.min(...counts, 0);
    const span = Math.max(max - min, 1);
    const step = W / Math.max(months.length - 1, 1);

    const points = months.map((m, i) => {
      const x = i * step;
      const y = H - ((m.headcount - min) / span) * (H - 20) - 10;
      return { x, y, ...m };
    });

    return {
      W,
      H,
      points,
      line: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '),
      area: `${points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')} ${W},${H} 0,${H}`,
      maxMove: Math.max(...months.map((m) => Math.max(m.joined, m.left)), 1),
    };
  }, [data]);

  if (isLoading) {
    return <div className="h-[230px] animate-pulse rounded-xl bg-surface-sunken" />;
  }

  if (!geometry || !data) {
    return (
      <div className="rounded-xl border border-border-strong bg-surface-card p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Headcount</h3>
        <p className="mt-2 text-sm text-slate-600">
          No joining or exit dates are recorded yet, so there is no movement to plot.
        </p>
      </div>
    );
  }

  const { W, H, points, line, area, maxMove } = geometry;
  const last = points[points.length - 1];

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Headcount &middot; 12 months
        </h3>
        <span className="font-display text-lg font-bold tabular-nums text-slate-900">
          {data.current_headcount}
        </span>
      </div>

      <div className="mt-2 overflow-x-auto">
        <svg
          viewBox={`0 0 ${W} ${H + 46}`}
          className="h-[190px] w-full min-w-[420px]"
          role="img"
          aria-label={`Headcount from ${data.from} to ${data.to}, currently ${data.current_headcount}`}
        >
          {[0.25, 0.5, 0.75].map((f) => (
            <line
              key={f}
              x1="0"
              y1={H * f}
              x2={W}
              y2={H * f}
              className="stroke-slate-200"
              strokeWidth="1"
            />
          ))}

          <polygon points={area} className="fill-blue-500" opacity="0.14" />
          <polyline points={line} fill="none" className="stroke-blue-600" strokeWidth="2.4" />
          <circle cx={last.x} cy={last.y} r="4" className="fill-blue-600" />

          {/* Joiners above the axis, leavers below it — the shape reads as
              movement rather than as two unrelated series. */}
          {points.map((p, i) => {
            const joinH = (p.joined / maxMove) * 16;
            const leftH = (p.left / maxMove) * 16;
            return (
              <g key={p.month}>
                {p.joined > 0 ? (
                  <rect
                    x={p.x - 4}
                    y={H + 6}
                    width="3.5"
                    height={joinH}
                    rx="1"
                    className="fill-emerald-600"
                    opacity="0.85"
                  />
                ) : null}
                {p.left > 0 ? (
                  <rect
                    x={p.x + 0.5}
                    y={H + 6}
                    width="3.5"
                    height={leftH}
                    rx="1"
                    className="fill-red-600"
                    opacity="0.8"
                  />
                ) : null}
                {i % 3 === 0 ? (
                  <text
                    x={p.x}
                    y={H + 42}
                    textAnchor="middle"
                    className="fill-slate-500"
                    style={{ fontSize: '9.5px' }}
                  >
                    {p.month.slice(5)}/{p.month.slice(2, 4)}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="mt-1 flex flex-wrap gap-4 text-[11.5px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm bg-blue-600" aria-hidden="true" /> Headcount
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm bg-emerald-600" aria-hidden="true" /> Joined
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-2 rounded-sm bg-red-600" aria-hidden="true" /> Left
        </span>
      </div>
    </div>
  );
}
