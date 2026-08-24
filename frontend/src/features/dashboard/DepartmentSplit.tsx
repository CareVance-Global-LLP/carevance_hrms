import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { userApi } from '@/services/api';

/** Loose slug used only to spot two department names that mean the same thing. */
const slug = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');

/**
 * Where the headcount actually sits.
 *
 * Departments here are the `groups` table, and this tenant carries both "HR"
 * and "Human Resources" as separate rows — which splits every
 * department-scoped report in two without either half looking wrong. The card
 * flags names that normalise to the same thing rather than silently merging
 * them: merging would hide a data problem somebody has to fix at the source,
 * and the unique index means the fix is not a rename.
 */
export default function DepartmentSplit() {
  const { data, isLoading } = useQuery({
    queryKey: ['ops', 'people-movement'],
    queryFn: async () => (await userApi.getAll()).data,
    staleTime: 15 * 60_000,
  });

  const { rows, duplicates, unassigned, total } = useMemo(() => {
    const people: any[] = Array.isArray(data) ? data : ((data as any)?.data ?? []);
    const counts = new Map<string, number>();
    let none = 0;

    people.forEach((u) => {
      const w = u.employee_work_info ?? u.employeeWorkInfo ?? {};
      const name =
        w.department?.name ?? w.department ?? w.report_group?.name ?? u.department?.name ?? null;

      if (!name || typeof name !== 'string' || !name.trim()) {
        none += 1;
        return;
      }
      counts.set(name.trim(), (counts.get(name.trim()) ?? 0) + 1);
    });

    const byName = [...counts.entries()].sort((a, b) => b[1] - a[1]);

    // Two labels that normalise to one thing — "HR" and "Human Resources".
    const bySlug = new Map<string, string[]>();
    byName.forEach(([name]) => {
      const k = slug(name).slice(0, 6);
      bySlug.set(k, [...(bySlug.get(k) ?? []), name]);
    });
    const dupes = [...bySlug.values()].filter((names) => names.length > 1);

    return {
      rows: byName.slice(0, 7),
      duplicates: dupes,
      unassigned: none,
      total: people.length,
    };
  }, [data]);

  if (isLoading) return <div className="h-[220px] animate-pulse rounded-xl bg-surface-sunken" />;

  const max = Math.max(...rows.map((r) => r[1]), 1);

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Headcount by department
      </h3>

      {rows.length === 0 ? (
        <p className="mt-2.5 text-[12.5px] text-slate-600">
          Nobody has a department set yet, so headcount cannot be split.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map(([name, n]) => (
            <li key={name} className="grid grid-cols-[7rem_1fr_2.5rem] items-center gap-2 text-[12px]">
              <span className="truncate text-slate-600" title={name}>
                {name}
              </span>
              <span className="h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                <span
                  className="block h-full rounded-full bg-blue-600"
                  style={{ width: `${Math.round((n / max) * 100)}%` }}
                />
              </span>
              <span className="text-right font-bold tabular-nums text-slate-900">{n}</span>
            </li>
          ))}
        </ul>
      )}

      {unassigned > 0 ? (
        <p className="mt-2.5 text-[11.5px] text-slate-500">
          {unassigned} of {total} have no department, so they appear in no departmental report.
        </p>
      ) : null}

      {duplicates.length > 0 ? (
        <p className="mt-2.5 flex items-start gap-1.5 rounded-lg bg-amber-500/[0.09] px-2.5 py-2 text-[11.5px] leading-relaxed text-amber-700">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {/*
              Not merged on the fly: that would hide a problem which has to be
              fixed at the source, and a unique index means the fix is a merge
              rather than a rename.
            */}
            <b>{duplicates.map((d) => d.join('” and “')).join('; ')}</b> look like the same
            department under two names. Every department-scoped report is currently splitting them.
          </span>
        </p>
      ) : null}
    </div>
  );
}
