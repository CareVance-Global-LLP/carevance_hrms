import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { opsDashboardApi } from '@/services/api';

type Tile = {
  key: string;
  label: string;
  value: number;
  sub: string;
  tone?: 'bad' | 'warn' | 'ok';
  to: string;
  /** Omitted where nothing serves this tile's history — see below. */
  spark?: number[];
};

/**
 * The organisation today, as six figures.
 *
 * This band deliberately does NOT follow the page's date control. A range
 * picker that silently rewrites "who is in right now" forces the reader to
 * interpret every number twice, and it is the clearest tell that a dashboard
 * is really a report.
 *
 * THE BUCKETS DO NOT OVERLAP. Somebody late is not also counted on time, and
 * somebody on approved leave is never counted absent. The server guarantees
 * this; a test fails if it stops being true.
 *
 * A TILE WITHOUT HISTORY GETS NO SPARKLINE. Headcount and working-now have no
 * server-side series, and a flat line drawn from a single point is a lie about
 * the shape of the data rather than an absence of one.
 */
export default function TodayCensus() {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['ops', 'today-summary'],
    queryFn: async () => (await opsDashboardApi.todaySummary()).data.data,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-[118px] animate-pulse rounded-xl bg-surface-sunken" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-border-strong bg-surface-card p-4 text-sm text-slate-600">
        Today&rsquo;s figures could not be loaded. Nothing here is stale — it is simply absent.
      </div>
    );
  }

  const tiles: Tile[] = [
    {
      key: 'headcount',
      label: 'Headcount',
      value: data.headcount,
      sub: `${data.roster.rostered} rostered today`,
      to: '/employees',
    },
    {
      key: 'ontime',
      label: 'In, on time',
      value: data.present_on_time.count,
      sub: 'Punched before the bell',
      tone: 'ok',
      to: '/attendance',
    },
    {
      key: 'late',
      label: 'Late',
      value: data.late.count,
      sub: data.late.total_minutes > 0 ? `${data.late.total_minutes} minutes in total` : 'Nobody late',
      tone: data.late.count > 0 ? 'bad' : undefined,
      to: '/attendance',
    },
    {
      key: 'absent',
      /*
       * Without a published roster this is not zero, it is unknowable — and
       * saying so is the whole point. A green "0 absent" on a tenant that
       * never published a roster is a number nobody checked.
       */
      label: data.roster.published ? 'Not in yet' : 'Not in yet — no roster',
      value: data.rostered_absent.count,
      sub: data.roster.published
        ? 'Rostered, no punch, not on leave'
        : 'Publish a roster to check absence',
      tone: data.rostered_absent.count > 0 ? 'warn' : undefined,
      to: '/roster',
    },
    {
      key: 'leave',
      label: 'On leave',
      value: data.on_leave.count,
      sub: data.on_leave.half_day > 0 ? `${data.on_leave.half_day} half-day` : 'Approved leave',
      to: '/leave',
    },
    {
      key: 'working',
      label: 'Working now',
      value: data.working_now.count,
      sub: 'Desk staff with a running timer',
      to: '/reports',
    },
  ];

  const toneClass: Record<string, string> = {
    bad: 'text-red-700',
    warn: 'text-amber-700',
    ok: 'text-emerald-700',
  };

  return (
    <div className="grid grid-cols-2 gap-3.5 md:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <button
          key={tile.key}
          type="button"
          onClick={() => navigate(tile.to)}
          className="flex flex-col gap-1 rounded-xl border border-border-strong bg-surface-card p-3.5 text-left transition-colors hover:border-blue-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <span className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">{tile.label}</span>
          <span
            className={`font-display text-[30px] font-bold leading-none tabular-nums ${
              tile.tone ? toneClass[tile.tone] : 'text-slate-900'
            }`}
          >
            {tile.value}
          </span>
          <span className="text-[11.5px] leading-snug text-slate-500">{tile.sub}</span>
        </button>
      ))}
    </div>
  );
}
