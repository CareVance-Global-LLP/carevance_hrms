import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Cake, PartyPopper } from 'lucide-react';
import { userApi } from '@/services/api';

/** Days until the next occurrence of a month-day, ignoring the year. */
function daysUntilAnniversary(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const src = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(src.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const next = new Date(today.getFullYear(), src.getMonth(), src.getDate());
  if (next < today) next.setFullYear(next.getFullYear() + 1);

  return Math.round((next.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Who is arriving, who is leaving, and who to say something to.
 *
 * Lifecycle counts are people mid-transition rather than a headcount total:
 * probation, notice period, first six months. Each is a state somebody has to
 * do something about before a date, which is what separates this from a
 * demographic breakdown nobody actions.
 *
 * The celebrations card is the only thing on this page that is not a task. It
 * stays because its absence is noticed — and because a fourteen-day horizon is
 * long enough to order a cake and short enough not to become a list.
 */
export default function PeopleMovement() {
  const navigate = useNavigate();

  const { data, isLoading } = useQuery({
    queryKey: ['ops', 'people-movement'],
    queryFn: async () => (await userApi.getAll()).data,
    staleTime: 15 * 60_000,
  });

  const people = useMemo(() => {
    const rows: any[] = Array.isArray(data) ? data : ((data as any)?.data ?? []);

    const lifecycle = { probation: 0, notice: 0, fresh: 0 };
    const celebrations: Array<{ id: number; name: string; kind: 'birthday' | 'anniversary'; days: number; years?: number }> = [];

    rows.forEach((u: any) => {
      const work = u.employee_work_info ?? u.employeeWorkInfo ?? {};
      const profile = u.employee_profile ?? u.employeeProfile ?? {};

      const status = String(work.employment_status ?? '').toLowerCase();
      if (status.includes('probation')) lifecycle.probation += 1;
      if (work.exit_date) lifecycle.notice += 1;

      const joined = work.joining_date ? new Date(`${String(work.joining_date).slice(0, 10)}T00:00:00`) : null;
      if (joined) {
        const months = (Date.now() - joined.getTime()) / (30.44 * 86_400_000);
        if (months >= 0 && months < 6) lifecycle.fresh += 1;

        const d = daysUntilAnniversary(work.joining_date);
        const years = new Date().getFullYear() - joined.getFullYear();
        // A joining date this year is not an anniversary yet.
        if (d !== null && d <= 14 && years >= 1) {
          celebrations.push({ id: u.id, name: u.name, kind: 'anniversary', days: d, years });
        }
      }

      const dob = daysUntilAnniversary(profile.date_of_birth);
      if (dob !== null && dob <= 14) {
        celebrations.push({ id: u.id, name: u.name, kind: 'birthday', days: dob });
      }
    });

    celebrations.sort((a, b) => a.days - b.days);

    return { lifecycle, celebrations: celebrations.slice(0, 6), total: rows.length };
  }, [data]);

  if (isLoading) {
    return (
      <div className="grid gap-3.5 sm:grid-cols-2">
        <div className="h-[190px] animate-pulse rounded-xl bg-surface-sunken" />
        <div className="h-[190px] animate-pulse rounded-xl bg-surface-sunken" />
      </div>
    );
  }

  const when = (d: number) => (d === 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`);

  return (
    <div className="grid gap-3.5 sm:grid-cols-2">
      <div className="rounded-xl border border-border-strong bg-surface-card p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Lifecycle in motion</h3>
        <ul className="mt-2.5 space-y-0.5">
          {[
            { k: 'On probation', v: people.lifecycle.probation, to: '/employees' },
            { k: 'Serving notice', v: people.lifecycle.notice, to: '/employees' },
            { k: 'Joined in the last 6 months', v: people.lifecycle.fresh, to: '/employees' },
          ].map((row) => (
            <li key={row.k}>
              <button
                type="button"
                onClick={() => navigate(row.to)}
                className="flex w-full items-baseline justify-between gap-2 rounded border-b border-border-strong/40 py-2 text-left text-[12.5px] last:border-0 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
              >
                <span className="text-slate-600">{row.k}</span>
                <span className="font-bold tabular-nums text-slate-900">{row.v}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-xl border border-border-strong bg-surface-card p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Next 14 days</h3>

        {people.celebrations.length === 0 ? (
          <p className="mt-2.5 text-[12.5px] text-slate-500">
            No birthdays or work anniversaries in the next two weeks.
          </p>
        ) : (
          <ul className="mt-2.5 space-y-0.5">
            {people.celebrations.map((c) => (
              <li
                key={`${c.kind}-${c.id}`}
                className="flex items-baseline justify-between gap-2 border-b border-border-strong/40 py-2 text-[12.5px] last:border-0"
              >
                <span className="flex min-w-0 items-center gap-1.5 text-slate-600">
                  {c.kind === 'birthday' ? (
                    <Cake className="h-3.5 w-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                  ) : (
                    <PartyPopper className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
                  )}
                  <span className="truncate">
                    {c.name}
                    {c.kind === 'anniversary' ? ` — ${c.years} yr${c.years === 1 ? '' : 's'}` : ''}
                  </span>
                </span>
                <span className="shrink-0 text-slate-500">{when(c.days)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
