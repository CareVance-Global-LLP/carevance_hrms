import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowRight, IndianRupee, Landmark, Users, Wallet } from 'lucide-react';
import { payrollApi } from '@/services/api';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

/**
 * Money and compliance, on the page an administrator lands on.
 *
 * AdminDashboard is 3,263 lines in which the word "payroll" did not appear
 * once — headcount, attendance and screenshot-tracker widgets on the front page
 * of a payroll product. This is the first thing somebody opens the dashboard to
 * find out, and it needed no new backend: `/payroll/dashboard` and
 * `/payroll/dashboard-attention` were both already routed and already returned
 * exactly these fields.
 *
 * Three rules hold here:
 *
 * - Nothing is invented. Every figure is read from a response, and a month with
 *   no run says so rather than rendering zeroes that look like a finished
 *   payroll of nobody.
 * - The readiness numbers are DEFECTS, and each one links to the screen that
 *   fixes it. "14 people have no bank account" is the most credible thing on a
 *   dashboard because the buyer recognises it from their own company.
 * - Compliance shows what is due and what is late, off the same calendar the
 *   Filings screen uses, so the two can never disagree.
 */

const money = (value: number | null | undefined) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0,
      }).format(Number(value));

const RUN_STATUS_TONE: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  locked: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  released: 'bg-blue-50 text-blue-700 border-blue-200',
  disbursed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

export default function PayrollDashboardStrip({ monthYear }: { monthYear?: string }) {
  const period = monthYear ?? new Date().toISOString().slice(0, 7);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['payroll-dashboard-strip', period],
    queryFn: async () => (await payrollApi.getPayrollDashboard({ month_year: period })).data,
    staleTime: 60_000,
  });

  const { data: attention } = useQuery({
    queryKey: ['payroll-dashboard-attention'],
    queryFn: async () => (await payrollApi.getDashboardAttention()).data,
    staleTime: 60_000,
  });

  const { data: calendar } = useQuery({
    queryKey: ['filing-calendar', period],
    queryFn: () => payrollApi.getFilingCalendar(period),
    staleTime: 5 * 60_000,
  });

  const figures = (stats as any)?.data ?? stats ?? {};
  const hasRun = Boolean(figures?.status);
  const runStatus = String(figures?.status ?? '');

  /*
   * Does gross minus deductions actually equal net?
   *
   * Found on a real run: gross 1,20,795, deductions 1,47,964, net 0. That row
   * predates the current calculator and lumps the LOP deduction into the
   * total, so the same wages come off twice and the arithmetic on screen
   * cannot be made to work.
   *
   * Three impossible numbers side by side is the worst thing to put in front
   * of a finance person, because the only available reading is that the
   * product cannot add up. So when they do not reconcile the figures are NOT
   * presented as fact - the discrepancy is named and pointed at the run, which
   * is where it can be fixed. Tolerance is a rupee, for rounding.
   */
  const gross = Number(figures?.total_gross ?? 0);
  const deductions = Number(figures?.total_deductions ?? 0);
  const net = Number(figures?.total_net_pay ?? 0);
  const reconciles = hasRun ? Math.abs(gross - deductions - net) <= 1 : true;

  const readiness = [
    { label: 'No bank account', value: attention?.attention?.missing_bank_details ?? 0, to: '/employees' },
    { label: 'Missing PAN or UAN', value: attention?.attention?.missing_pan_uan ?? 0, to: '/employees' },
    { label: 'Not in a pay group', value: attention?.attention?.unassigned_employees ?? 0, to: '/payroll/unassigned-employees' },
    { label: 'Declarations to review', value: attention?.attention?.pending_fbp_declarations ?? 0, to: '/payroll/tax-compliance?panel=proofs' },
  ].filter((row) => row.value > 0);

  // Only what needs doing. A calendar of things comfortably in the future is
  // noise on a landing page; the Filings screen carries the full schedule.
  const upcoming = (calendar?.data ?? [])
    .filter((row) => ['overdue', 'critical', 'due_soon'].includes(row.urgency))
    .slice(0, 4);

  return (
    <section id="payroll-strip" className="scroll-mt-24 space-y-3">
      <SurfaceCard className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-slate-950">
            <Wallet className="h-4 w-4 text-slate-600" />
            Payroll this month
          </h2>
          <div className="flex items-center gap-2">
            {hasRun && (
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium capitalize ${
                  RUN_STATUS_TONE[runStatus] ?? 'bg-slate-100 text-slate-700 border-slate-200'
                }`}
              >
                {runStatus}
              </span>
            )}
            <Link to="/payroll" className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
              Open payroll <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </div>

        {statsLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-[52px] animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : !hasRun ? (
          /*
           * No run is a real state, and it is not zero. Rendering ₹0 across
           * four cards would read as a completed payroll that paid nobody.
           */
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
            <p className="text-sm text-slate-600">
              No payroll run for {period} yet.
            </p>
            <Link to="/payroll" className="text-xs font-medium text-blue-600 hover:text-blue-700">
              Create this month&rsquo;s run
            </Link>
          </div>
        ) : !reconciles ? (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <p className="text-sm font-medium text-amber-900">
              This run&rsquo;s totals don&rsquo;t reconcile.
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Gross {money(gross)} less deductions {money(deductions)} does not equal the recorded net
              pay of {money(net)}. The figures are withheld rather than shown, because a total nobody
              can reconcile is worse than no total.
            </p>
            <Link
              to="/payroll"
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-900 underline underline-offset-2"
            >
              Open the run to see which employees are affected <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[
              { label: 'Gross', value: money(figures.total_gross), icon: IndianRupee },
              { label: 'Deductions', value: money(figures.total_deductions), icon: IndianRupee },
              { label: 'Net pay', value: money(figures.total_net_pay), icon: Wallet },
              {
                label: 'Employees paid',
                value: `${figures.processed_employees ?? 0} of ${figures.total_employees ?? 0}`,
                icon: Users,
              },
            ].map((cell) => (
              <div key={cell.label} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{cell.label}</p>
                <p className="mt-0.5 text-lg font-semibold tabular-nums tracking-[-0.02em] text-slate-950">
                  {cell.value}
                </p>
              </div>
            ))}
          </div>
        )}
      </SurfaceCard>

      {(upcoming.length > 0 || readiness.length > 0) && (
        <div className="grid gap-3 lg:grid-cols-2">
          {upcoming.length > 0 && (
            <SurfaceCard className="p-4">
              <h2 className="mb-2.5 flex items-center gap-2 text-[15px] font-semibold text-slate-950">
                <Landmark className="h-4 w-4 text-slate-600" />
                Statutory deadlines
              </h2>
              <ul className="space-y-1.5">
                {upcoming.map((row) => (
                  <li key={row.type} className="flex items-center justify-between gap-3 text-sm">
                    <Link
                      to="/payroll/tax-compliance?panel=filings"
                      className="truncate text-slate-700 hover:text-slate-950"
                      title={row.authority ?? undefined}
                    >
                      {row.label}
                    </Link>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        row.urgency === 'overdue'
                          ? 'bg-rose-50 text-rose-700'
                          : row.urgency === 'critical'
                            ? 'bg-amber-50 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {row.urgency === 'overdue' && row.days_remaining != null
                        ? `${Math.abs(row.days_remaining)} days late`
                        : row.days_remaining != null
                          ? `in ${row.days_remaining} days`
                          : 'due'}
                    </span>
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          )}

          {readiness.length > 0 && (
            <SurfaceCard className="p-4">
              <h2 className="mb-1 flex items-center gap-2 text-[15px] font-semibold text-slate-950">
                <AlertCircle className="h-4 w-4 text-slate-600" />
                Blocking this month&rsquo;s payroll
              </h2>
              <p className="mb-2.5 text-xs text-slate-500">
                Each of these stops somebody being paid. They are shown only when the count is above zero.
              </p>
              <ul className="space-y-1.5">
                {readiness.map((row) => (
                  <li key={row.label} className="flex items-center justify-between gap-3 text-sm">
                    <Link to={row.to} className="truncate text-slate-700 hover:text-slate-950">
                      {row.label}
                    </Link>
                    <span className="shrink-0 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold tabular-nums text-amber-800">
                      {row.value}
                    </span>
                  </li>
                ))}
              </ul>
            </SurfaceCard>
          )}
        </div>
      )}
    </section>
  );
}
