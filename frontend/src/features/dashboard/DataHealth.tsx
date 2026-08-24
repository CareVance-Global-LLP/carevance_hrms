import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { opsDashboardApi, payrollApi, userApi } from '@/services/api';

type Gap = { key: string; label: string; count: number; of: number; why: string; to: string };

/**
 * What is not set up yet, as a share of the workforce.
 *
 * Every other card on this page reports what people DID. This one reports what
 * the system cannot see, and on a young tenant it is the most useful thing on
 * the screen: an organisation where three of ninety-one people have punch data
 * does not have an attendance problem, it has eighty-eight people whose device
 * or roster was never wired up. Reading that off a turnout chart is impossible,
 * because the chart is busy describing them as absent.
 *
 * A ROW ONLY APPEARS WHEN THE GAP IS REAL. Nothing here renders at zero, so a
 * fully configured organisation sees one line rather than six green ticks —
 * and nobody re-reads a screen of green ticks.
 *
 * EVERY ROW NAMES ITS CONSEQUENCE. "10 missing PAN or UAN" is a data-entry
 * chore; "10 people whose filings will report not-ready" is a deadline.
 */
export default function DataHealth() {
  const navigate = useNavigate();

  const users = useQuery({
    queryKey: ['ops', 'people-movement'],
    queryFn: async () => (await userApi.getAll()).data,
    staleTime: 15 * 60_000,
  });

  const today = useQuery({
    queryKey: ['ops', 'today-summary'],
    queryFn: async () => (await opsDashboardApi.todaySummary()).data.data,
    refetchInterval: 60_000,
  });

  const attention = useQuery({
    queryKey: ['ops', 'payroll-attention'],
    queryFn: async () => (await payrollApi.getDashboardAttention()).data,
    retry: false,
    staleTime: 15 * 60_000,
  });

  const gaps = useMemo<Gap[]>(() => {
    const rows: any[] = Array.isArray(users.data) ? users.data : ((users.data as any)?.data ?? []);
    const head = today.data?.headcount ?? rows.length;
    const a = attention.data?.attention;

    const noWorkInfo = rows.filter((u) => {
      const w = u.employee_work_info ?? u.employeeWorkInfo;
      return !w || !w.joining_date;
    }).length;

    const out: Gap[] = [
      {
        key: 'roster',
        label: 'Not on a published roster',
        count: today.data?.roster.not_rostered ?? 0,
        of: head,
        why: 'Their absence cannot be detected — nothing says they were due in',
        to: '/roster',
      },
      {
        key: 'paygroup',
        label: 'Not in a pay group',
        count: Number(a?.unassigned_employees ?? 0),
        of: head,
        why: 'They are silently left out of every payroll run',
        to: '/payroll',
      },
      {
        key: 'bank',
        label: 'No bank account',
        count: Number(a?.missing_bank_details ?? 0),
        of: head,
        why: 'A transfer line that will bounce on pay day',
        to: '/employees',
      },
      {
        key: 'statutory',
        label: 'Missing PAN or UAN',
        count: Number(a?.missing_pan_uan ?? 0),
        of: head,
        why: 'Their filings report not-ready rather than emitting a bad identifier',
        to: '/employees',
      },
      {
        key: 'workinfo',
        label: 'No joining date on record',
        count: noWorkInfo,
        of: head,
        why: 'They are missing from tenure, probation and anniversary counts',
        to: '/employees',
      },
    ];

    return out.filter((g) => g.count > 0).sort((x, y) => y.count - x.count);
  }, [users.data, today.data, attention.data]);

  if (users.isLoading || today.isLoading) {
    return <div className="h-[220px] animate-pulse rounded-xl bg-surface-sunken" />;
  }

  const head = today.data?.headcount ?? 0;

  return (
    <div className="rounded-xl border border-border-strong bg-surface-card p-4">
      <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
        Set-up gaps
      </h3>

      {gaps.length === 0 ? (
        <p className="mt-2.5 text-[12.5px] text-slate-600">
          Every employee has a roster, a pay group, a bank account and their statutory
          identifiers. Nothing here is blocking payroll or attendance.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[11.5px] text-slate-500">
            Each row is a reason a figure elsewhere on this page is smaller than it should be.
          </p>

          <ul className="mt-2.5 space-y-2.5">
            {gaps.map((g) => {
              const pct = g.of > 0 ? Math.round((g.count / g.of) * 100) : 0;
              return (
                <li key={g.key}>
                  <button
                    type="button"
                    onClick={() => navigate(g.to)}
                    className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-[12.5px] font-medium text-slate-900">{g.label}</span>
                      <span className="shrink-0 text-[12.5px] font-bold tabular-nums text-slate-900">
                        {g.count}
                        <span className="font-normal text-slate-500"> of {g.of}</span>
                      </span>
                    </span>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                      <span
                        className={`block h-full rounded-full ${
                          pct > 50 ? 'bg-red-600' : pct > 20 ? 'bg-amber-500' : 'bg-blue-600'
                        }`}
                        style={{ width: `${Math.max(pct, 2)}%` }}
                      />
                    </span>
                    <span className="mt-0.5 block text-[11px] leading-snug text-slate-500">{g.why}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {head > 0 ? (
        <p className="mt-3 text-[11px] text-slate-500">Measured against {head} active employees.</p>
      ) : null}
    </div>
  );
}
