import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { attendanceApi } from '@/services/api';

/**
 * What time people actually punched in today.
 *
 * This is the card that turns a number into a conversation. "Nine people were
 * late" is a disciplinary fact; a histogram showing the arrival peak sitting
 * just BEFORE the bell with a second cluster five minutes after it is a
 * transport fact — a bus, a shift bus, a level crossing. The two call for
 * completely different responses, and only the distribution can tell them
 * apart.
 *
 * Bars are bucketed by half hour and coloured against the earliest shift
 * start, not against a policy grace period: the question here is what
 * happened, not who is in breach.
 */
export default function ArrivalCurve() {
  const today = new Date().toISOString().slice(0, 10);

  const { data, isLoading } = useQuery({
    queryKey: ['ops', 'arrivals', today],
    queryFn: async () => (await attendanceApi.summary({ start_date: today, end_date: today })).data,
    staleTime: 5 * 60_000,
  });

  const chart = useMemo(() => {
    const rows = (data?.data ?? []).filter((r) => r.check_in_at);
    if (rows.length === 0) return null;

    const buckets = new Map<number, { onTime: number; late: number }>();
    let lateTotal = 0;

    rows.forEach((r) => {
      const at = new Date(r.check_in_at as string);
      const half = at.getHours() * 2 + (at.getMinutes() >= 30 ? 1 : 0);
      const slot = buckets.get(half) ?? { onTime: 0, late: 0 };
      const isLate = (r.late_days ?? 0) > 0;
      if (isLate) {
        slot.late += 1;
        lateTotal += 1;
      } else {
        slot.onTime += 1;
      }
      buckets.set(half, slot);
    });

    const keys = [...buckets.keys()].sort((a, b) => a - b);
    const from = keys[0];
    const to = keys[keys.length - 1];
    const series = [];
    for (let h = from; h <= to; h++) {
      const slot = buckets.get(h) ?? { onTime: 0, late: 0 };
      series.push({ half: h, ...slot, total: slot.onTime + slot.late });
    }

    const peak = series.reduce((best, s) => (s.total > best.total ? s : best), series[0]);

    return {
      series,
      max: Math.max(...series.map((s) => s.total), 1),
      peak,
      lateTotal,
      arrived: rows.length,
    };
  }, [data]);

  const label = (half: number) =>
    `${String(Math.floor(half / 2)).padStart(2, '0')}:${half % 2 ? '30' : '00'}`;

  if (isLoading) return <div className="h-[230px] animate-pulse rounded-xl bg-surface-sunken" />;

  if (!chart) {
    return (
      <div className="rounded-xl border border-border-strong bg-surface-card p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Arrivals</h3>
        <p className="mt-2 text-sm text-slate-600">Nobody has punched in yet today.</p>
      </div>
    );
  }

  const W = 320;
  const H = 118;
  const bw = Math.max(W / chart.series.length - 4, 4);

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          When people arrived
        </h3>
        <span className="text-[11px] tabular-nums text-slate-500">{chart.arrived} in</span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H + 22}`}
        className="mt-2 h-[150px] w-full"
        role="img"
        aria-label={`Arrival times today. Busiest half hour ${label(chart.peak.half)} with ${chart.peak.total} people.`}
      >
        {chart.series.map((s, i) => {
          const x = i * (W / chart.series.length);
          const onH = (s.onTime / chart.max) * H;
          const lateH = (s.late / chart.max) * H;
          return (
            <g key={s.half}>
              {s.late > 0 ? (
                <rect x={x} y={H - lateH} width={bw} height={lateH} rx="2" className="fill-red-600" />
              ) : null}
              {s.onTime > 0 ? (
                <rect
                  x={x}
                  y={H - lateH - onH}
                  width={bw}
                  height={onH}
                  rx="2"
                  className="fill-blue-600"
                />
              ) : null}
            </g>
          );
        })}
        <line x1="0" y1={H} x2={W} y2={H} className="stroke-slate-300" strokeWidth="1" />
        <text x="0" y={H + 16} className="fill-slate-500" style={{ fontSize: '9.5px' }}>
          {label(chart.series[0].half)}
        </text>
        <text
          x={W}
          y={H + 16}
          textAnchor="end"
          className="fill-slate-500"
          style={{ fontSize: '9.5px' }}
        >
          {label(chart.series[chart.series.length - 1].half)}
        </text>
      </svg>

      <p className="mt-1 text-[11.5px] leading-relaxed text-slate-500">
        Busiest half hour is <b className="text-slate-700">{label(chart.peak.half)}</b> with{' '}
        {chart.peak.total} arrivals.
        {chart.lateTotal > 0
          ? ' A late cluster tight against the bell is usually transport, not conduct — worth checking before it is treated as either.'
          : ' Nobody arrived late.'}
      </p>
    </div>
  );
}
