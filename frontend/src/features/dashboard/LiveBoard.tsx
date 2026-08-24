import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { attendanceApi } from '@/services/api';

type Row = {
  id: number;
  name: string;
  checkIn: string | null;
  lateMinutes: number;
  status: 'late' | 'in' | 'out' | 'absent';
  worked: number;
};

/**
 * Who is where, right now.
 *
 * SORTED LATE FIRST, then not-in, then working. The top of a table is the only
 * part anybody reads, so the order is the feature: an alphabetical list buries
 * the nine people who need attention among ninety who do not.
 *
 * IT SAYS "UPDATED N AGO", NEVER "LIVE". BROADCAST_CONNECTION is `log` — there
 * is no realtime transport in this product — so this polls on an interval. A
 * board that claims to be live while showing a two-minute-old picture is worse
 * than one that admits its age, because somebody will make a staffing call on
 * it.
 */
export default function LiveBoard() {
  const today = new Date().toISOString().slice(0, 10);
  const [q, setQ] = useState('');

  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['ops', 'live-board', today],
    queryFn: async () => (await attendanceApi.summary({ start_date: today, end_date: today })).data,
    refetchInterval: 60_000,
  });

  const rows = useMemo<Row[]>(() => {
    const order: Record<Row['status'], number> = { late: 0, absent: 1, in: 2, out: 3 };

    return (data?.data ?? [])
      .map((r) => {
        const late = r.late_days > 0;
        const status: Row['status'] = late
          ? 'late'
          : r.is_checked_in
            ? 'in'
            : r.check_in_at
              ? 'out'
              : 'absent';
        return {
          id: r.user.id,
          name: r.user.name,
          checkIn: r.check_in_at ?? null,
          lateMinutes: r.late_minutes ?? 0,
          status,
          worked: r.total_worked_seconds ?? 0,
        };
      })
      .filter((r) => (q ? r.name.toLowerCase().includes(q.toLowerCase()) : true))
      .sort((a, b) => order[a.status] - order[b.status] || b.lateMinutes - a.lateMinutes);
  }, [data, q]);

  const ago = Math.max(0, Math.round((Date.now() - dataUpdatedAt) / 1000));

  const pill: Record<Row['status'], string> = {
    late: 'bg-red-500/12 text-red-700',
    absent: 'bg-amber-500/12 text-amber-700',
    in: 'bg-emerald-500/12 text-emerald-700',
    out: 'bg-slate-500/12 text-slate-600',
  };

  const word: Record<Row['status'], string> = {
    late: 'Late',
    absent: 'Not in',
    in: 'Working',
    out: 'Checked out',
  };

  const hhmm = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—';

  if (isLoading) return <div className="h-[380px] animate-pulse rounded-xl bg-surface-sunken" />;

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
          Who is in &middot; late first
        </h3>
        {/* Never "Live" — see the header comment. */}
        <span className="text-[11px] tabular-nums text-slate-500">
          Updated {ago < 60 ? `${ago}s` : `${Math.round(ago / 60)}m`} ago
        </span>
      </div>

      <div className="relative mt-2.5">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a person"
          aria-label="Find a person on the board"
          className="h-8 w-full rounded-lg border border-border-strong bg-surface-base pl-8 pr-2 text-xs text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        />
      </div>

      <div className="mt-2 max-h-[300px] overflow-y-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-surface-card">
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
              <th className="border-b border-border-strong pb-1.5 pr-2 font-bold">Person</th>
              <th className="border-b border-border-strong pb-1.5 pr-2 font-bold">In</th>
              <th className="border-b border-border-strong pb-1.5 pr-2 font-bold">Status</th>
              <th className="border-b border-border-strong pb-1.5 text-right font-bold">Worked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="border-b border-border-strong/40 py-2 pr-2 font-medium text-slate-900">
                  {r.name}
                </td>
                <td className="border-b border-border-strong/40 py-2 pr-2 tabular-nums text-slate-600">
                  {hhmm(r.checkIn)}
                </td>
                <td className="border-b border-border-strong/40 py-2 pr-2">
                  <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${pill[r.status]}`}>
                    {word[r.status]}
                    {r.status === 'late' && r.lateMinutes > 0 ? ` ${r.lateMinutes}m` : ''}
                  </span>
                </td>
                <td className="border-b border-border-strong/40 py-2 text-right tabular-nums text-slate-600">
                  {r.worked > 0 ? `${Math.floor(r.worked / 3600)}h ${Math.floor((r.worked % 3600) / 60)}m` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            {q ? `Nobody matches “${q}”.` : 'No attendance recorded today.'}
          </p>
        ) : null}
      </div>
    </div>
  );
}
