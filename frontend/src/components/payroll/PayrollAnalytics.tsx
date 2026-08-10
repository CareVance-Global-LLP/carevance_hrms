import { useMemo } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { AlertTriangle } from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { useChartTheme, type ChartTheme } from '@/hooks/useChartTheme';
import { formatPayrollAmount, formatPayrollAmountShort } from '@/lib/payrollFormat';

/**
 * The payroll dashboard's analytics layer.
 *
 * Four charts, each answering one question an admin asks every month:
 *   1. Is this month normal?              → gross vs net across a month spine
 *   2. Where did the money actually go?   → net / PF / ESI / PT / TDS split
 *   3. What did it really cost us?        → gross + employer contributions
 *   4. Did cost rise because we hired?    → headcount against cost per head
 *
 * Every figure comes from `payroll_monthly_runs`, which stores its own totals —
 * so none of this re-derives money in the browser.
 *
 * Colours arrive through `useChartTheme()`. Recharts takes colour as a prop and
 * renders into an SVG it owns, so it cannot reach the CSS token layer the rest
 * of the app themes through; `fill="var(--brand-600)"` resolves to nothing.
 */

/* ──────────── Shape of a run as the API returns it ──────────── */

export interface AnalyticsRun {
  month_year?: string | null;
  status?: string | null;
  total_employees?: number | string | null;
  total_gross?: number | string | null;
  total_deductions?: number | string | null;
  total_net_pay?: number | string | null;
  total_employer_contributions?: number | string | null;
  total_pf_employee?: number | string | null;
  total_pf_employer?: number | string | null;
  total_esi_employee?: number | string | null;
  total_esi_employer?: number | string | null;
  total_pt?: number | string | null;
  total_tds?: number | string | null;
}

interface PayrollAnalyticsProps {
  runs: AnalyticsRun[];
  /** `YYYY-MM`. Anchors the month spine and picks the composition month. */
  selectedMonth: string;
  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** How many months the trend covers, including the selected one. */
  monthsBack?: number;
}

const num = (v: number | string | null | undefined): number => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Statuses whose money is final. A draft's totals are provisional. */
const SETTLED = new Set(['locked', 'approved', 'released', 'disbursed', 'paid', 'completed']);

interface TrendPoint {
  key: string;
  label: string;
  gross: number | null;
  net: number | null;
  headcount: number | null;
  perHead: number | null;
  status: string | null;
  /** No run exists for this month at all. */
  missing: boolean;
  /** A run exists but its money is not final yet. */
  provisional: boolean;
  /** In the past with no run — a skipped month, not a future one. */
  skipped: boolean;
}

function shiftMonth(monthYear: string, delta: number): string {
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m) return monthYear;
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthYear;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short' });
}

function monthLabelLong(monthYear: string | null | undefined): string {
  if (!monthYear) return '';
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return monthYear;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Build a continuous run of months ending at `selectedMonth`.
 *
 * Without this spine a month with no run simply vanishes from the axis, so a
 * payroll that was never run looks identical to one that was — the series just
 * closes over the gap. Months are emitted whether or not a run exists.
 */
function buildSpine(runs: AnalyticsRun[], selectedMonth: string, monthsBack: number): TrendPoint[] {
  const byMonth = new Map<string, AnalyticsRun>();
  for (const run of runs) {
    if (run?.month_year) byMonth.set(run.month_year, run);
  }

  const today = currentMonthKey();

  // A month only counts as "skipped" if payroll was already running by then.
  // Without this floor every month before the org's first run gets flagged,
  // which turns a genuine missed-payroll warning into background noise.
  const firstRunMonth = Array.from(byMonth.keys()).sort()[0] ?? null;

  const points: TrendPoint[] = [];

  for (let i = monthsBack - 1; i >= 0; i -= 1) {
    const key = shiftMonth(selectedMonth, -i);
    const run = byMonth.get(key);
    const status = run?.status ?? null;
    const settled = status !== null && SETTLED.has(status);

    if (!run) {
      points.push({
        key,
        label: monthLabel(key),
        gross: null,
        net: null,
        headcount: null,
        perHead: null,
        status: null,
        missing: true,
        provisional: false,
        skipped: key < today && firstRunMonth !== null && key > firstRunMonth,
      });
      continue;
    }

    const gross = num(run.total_gross);
    const headcount = num(run.total_employees);

    points.push({
      key,
      label: monthLabel(key),
      gross,
      // A draft has not been costed, so its net is not a real number yet.
      // Plotting the stored 0 would draw a cliff that does not exist.
      net: settled ? num(run.total_net_pay) : null,
      headcount,
      // Guard the divide — a run with no items must render a gap, not Infinity.
      // A run with headcount but zero gross has not been costed either; a
      // ₹0 per-head dot would read as a real collapse in pay rather than
      // as an absence of data.
      perHead: headcount > 0 && gross > 0 ? Math.round(gross / headcount) : null,
      status,
      missing: false,
      provisional: !settled,
      skipped: false,
    });
  }

  return points;
}

/* ──────────── Tooltip ──────────── */

function ChartTooltip({
  active,
  payload,
  label,
  theme,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | null; color?: string; dataKey?: string }>;
  label?: string;
  theme: ChartTheme;
}) {
  if (!active || !payload?.length) return null;

  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (!rows.length) return null;

  return (
    <div
      className="rounded-lg border px-3 py-2 text-xs"
      style={{
        background: theme.tooltip.background,
        borderColor: theme.tooltip.border,
        color: theme.tooltip.text,
        boxShadow: theme.tooltip.shadow,
      }}
    >
      <p className="mb-1.5 font-semibold">{label}</p>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.dataKey ?? row.name} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
              {row.name}
            </span>
            <span className="font-semibold tabular-nums">
              {row.dataKey === 'headcount'
                ? row.value
                : formatPayrollAmount(Number(row.value))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────── Shared chrome ──────────── */

function Panel({
  title,
  question,
  badge,
  children,
}: {
  title: string;
  question: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SurfaceCard className="p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          <p className="mt-0.5 text-xs text-slate-600">{question}</p>
        </div>
        {badge}
      </div>
      {children}
    </SurfaceCard>
  );
}

function ChartSkeleton({ height }: { height: number }) {
  return (
    <div className="flex items-end gap-3 px-2" style={{ height }} aria-hidden="true">
      {[55, 80, 45, 95, 70, 100].map((h, i) => (
        <div
          key={i}
          className="flex-1 animate-pulse rounded-t bg-slate-200"
          style={{ height: `${h}%` }}
        />
      ))}
    </div>
  );
}

function EmptyState({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 px-4 py-10 text-center">
      <p className="text-sm font-medium text-slate-700">{message}</p>
      {hint ? <p className="mt-1 max-w-xs text-xs text-slate-600">{hint}</p> : null}
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-rose-300 px-4 py-10 text-center">
      <AlertTriangle className="mb-2 h-5 w-5 text-rose-500" aria-hidden="true" />
      <p className="text-sm font-medium text-slate-900">Couldn&apos;t load payroll analytics.</p>
      <p className="mt-1 text-xs text-slate-600">
        Amounts elsewhere on this page are unaffected.
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-100"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}

/* ──────────── Component ──────────── */

export default function PayrollAnalytics({
  runs,
  selectedMonth,
  isLoading = false,
  isError = false,
  onRetry,
  monthsBack = 6,
}: PayrollAnalyticsProps) {
  const theme = useChartTheme();

  const spine = useMemo(
    () => buildSpine(runs ?? [], selectedMonth, monthsBack),
    [runs, selectedMonth, monthsBack],
  );

  const hasAnyRun = spine.some((p) => !p.missing);
  const skippedMonths = spine.filter((p) => p.skipped).map((p) => p.label);

  /**
   * The month the composition and cost-to-company panels describe.
   *
   * A draft has not been costed, so its split is meaningless — fall back to the
   * most recent settled month rather than rendering a row of zeroes and letting
   * the reader assume the deductions were genuinely nil.
   */
  const compositionRun = useMemo(() => {
    const runsByMonth = new Map<string, AnalyticsRun>();
    for (const run of runs ?? []) {
      if (run?.month_year) runsByMonth.set(run.month_year, run);
    }

    const selected = runsByMonth.get(selectedMonth);
    if (selected && SETTLED.has(selected.status ?? '')) return selected;

    const settled = (runs ?? [])
      .filter((r) => r?.month_year && SETTLED.has(r.status ?? '') && num(r.total_gross) > 0)
      .sort((a, b) => String(b.month_year).localeCompare(String(a.month_year)));

    return settled[0] ?? null;
  }, [runs, selectedMonth]);

  const composition = useMemo(() => {
    if (!compositionRun) return null;

    const gross = num(compositionRun.total_gross);
    if (gross <= 0) return null;

    const net = num(compositionRun.total_net_pay);
    const pf = num(compositionRun.total_pf_employee);
    const esi = num(compositionRun.total_esi_employee);
    const pt = num(compositionRun.total_pt);
    const tds = num(compositionRun.total_tds);

    // Whatever the named heads do not account for. Recovery deductions, loan
    // instalments and voluntary contributions all land here, so it is labelled
    // as a remainder rather than claimed to be any one thing.
    const other = Math.max(0, gross - net - pf - esi - pt - tds);

    const segments = [
      { key: 'net', label: 'Net to employees', value: net, color: theme.positive },
      { key: 'tds', label: 'TDS', value: tds, color: theme.series[2] },
      { key: 'pf', label: 'PF (employee)', value: pf, color: theme.series[0] },
      { key: 'esi', label: 'ESI (employee)', value: esi, color: theme.series[3] },
      { key: 'pt', label: 'Professional tax', value: pt, color: theme.series[1] },
      { key: 'other', label: 'Other deductions', value: other, color: theme.neutral },
    ].filter((s) => s.value > 0);

    const employerPf = num(compositionRun.total_pf_employer);
    const employerEsi = num(compositionRun.total_esi_employer);
    const employerTotal = num(compositionRun.total_employer_contributions);

    return {
      monthKey: compositionRun.month_year ?? '',
      monthLabelFull: monthLabelLong(compositionRun.month_year),
      gross,
      segments,
      employerPf,
      employerEsi,
      employerTotal,
      // total_employer_contributions carries more than PF and ESI (LWF,
      // superannuation, employer NPS). Naming only PF next to the larger
      // total reads as a contradiction, so account for the remainder.
      employerOther: Math.max(0, employerTotal - employerPf - employerEsi),
      trueCost: gross + employerTotal,
      employerPct: gross > 0 ? (employerTotal / gross) * 100 : 0,
    };
  }, [compositionRun, theme]);

  const perHeadDelta = useMemo(() => {
    const withHeads = spine.filter((p) => p.perHead !== null);
    if (withHeads.length < 2) return null;
    const latest = withHeads[withHeads.length - 1].perHead as number;
    const prior = withHeads[withHeads.length - 2].perHead as number;
    if (!prior) return null;
    return ((latest - prior) / Math.abs(prior)) * 100;
  }, [spine]);

  /* ── error / loading / empty ── */

  if (isError) {
    return (
      <Panel title="Payroll analytics" question="Trends, composition and true cost">
        <ErrorState onRetry={onRetry} />
      </Panel>
    );
  }

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="lg:col-span-2">
          <Panel title="Payroll cost trend" question="Is this month normal?">
            <ChartSkeleton height={210} />
          </Panel>
        </div>
        <Panel title="Where the money went" question="Loading…">
          <ChartSkeleton height={120} />
        </Panel>
        <Panel title="Headcount against cost per head" question="Loading…">
          <ChartSkeleton height={120} />
        </Panel>
      </div>
    );
  }

  if (!hasAnyRun) {
    return (
      <Panel title="Payroll cost trend" question="Is this month normal?">
        <EmptyState
          message="No payroll runs yet"
          hint="Once you approve your first month, the trend, composition and cost-to-company charts will appear here."
        />
      </Panel>
    );
  }

  const axisTick = { fill: theme.axisLabel, fontSize: 11 };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* ── 1 · Cost trend ─────────────────────────────────────────── */}
      <div className="lg:col-span-2">
        <Panel
          title="Payroll cost trend"
          question="Is this month normal, against the months before it?"
          badge={
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-600">
              Last {monthsBack} months
            </span>
          }
        >
          <ResponsiveContainer width="100%" height={230}>
            <ComposedChart data={spine} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={axisTick}
                axisLine={{ stroke: theme.axis }}
                tickLine={false}
              />
              <YAxis
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                width={54}
                tickFormatter={(v) => formatPayrollAmountShort(Number(v))}
              />
              <Tooltip
                cursor={{ fill: theme.grid, fillOpacity: 0.35 }}
                content={({ active, payload, label }) => (
                  <ChartTooltip active={active} payload={payload as never} label={label as string} theme={theme} />
                )}
              />
              <Bar dataKey="gross" name="Gross" fill={theme.series[0]} radius={[3, 3, 0, 0]}>
                {spine.map((p) => (
                  // A draft's gross is real but not final — dim it so it does not
                  // read as a committed figure sitting next to committed ones.
                  <Cell key={p.key} fillOpacity={p.provisional ? 0.45 : 1} />
                ))}
              </Bar>
              <Bar dataKey="net" name="Net paid" fill={theme.positive} radius={[3, 3, 0, 0]} />
            </ComposedChart>
          </ResponsiveContainer>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: theme.series[0] }} />
              Gross
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: theme.positive }} />
              Net paid
            </span>
            <span className="inline-flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-sm opacity-45"
                style={{ background: theme.series[0] }}
              />
              Draft — not yet costed
            </span>
          </div>

          {skippedMonths.length > 0 ? (
            // Never run, and in the past. Called out in words as well as colour,
            // because "no bar" is exactly what a future month looks like too.
            <p className="mt-2 flex items-start gap-1.5 text-xs font-medium text-rose-600">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                {skippedMonths.join(', ')} {skippedMonths.length === 1 ? 'is' : 'are'} in the past
                with no payroll run.
              </span>
            </p>
          ) : null}
        </Panel>
      </div>

      {/* ── 2 · Where the money went ───────────────────────────────── */}
      <Panel
        title="Where the money went"
        question={
          composition
            ? `${composition.monthLabelFull} · ${formatPayrollAmount(composition.gross)} gross`
            : 'Of every rupee of gross, how much reached the employee?'
        }
      >
        {!composition ? (
          <EmptyState
            message="No costed run to break down"
            hint="A draft has not been costed yet, so its split would read as all zeroes."
          />
        ) : (
          <>
            <div
              className="flex h-7 w-full overflow-hidden rounded"
              role="img"
              aria-label={composition.segments
                .map((s) => `${s.label} ${formatPayrollAmount(s.value)}`)
                .join(', ')}
            >
              {composition.segments.map((s) => (
                <div
                  key={s.key}
                  style={{
                    width: `${(s.value / composition.gross) * 100}%`,
                    background: s.color,
                  }}
                  title={`${s.label} — ${formatPayrollAmount(s.value)}`}
                />
              ))}
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
              {composition.segments.map((s) => (
                <div key={s.key}>
                  <dt className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <span className="h-2 w-2 rounded-sm" style={{ background: s.color }} />
                    {s.label}
                  </dt>
                  <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-900">
                    {formatPayrollAmount(s.value)}
                  </dd>
                  <dd className="text-[11px] tabular-nums text-slate-600">
                    {((s.value / composition.gross) * 100).toFixed(1)}%
                  </dd>
                </div>
              ))}
            </dl>

            {composition.segments.every((s) => s.key !== 'esi') ? (
              <p className="mt-3 border-t border-slate-200 pt-2.5 text-[11px] text-slate-600">
                ESI ₹0 — nobody in this run is under the ₹21,000 wage threshold.
              </p>
            ) : null}
          </>
        )}
      </Panel>

      {/* ── 3 · True cost to company ───────────────────────────────── */}
      <Panel
        title="Gross is not what it costs you"
        question="Employer contributions sit on top of gross"
      >
        {!composition ? (
          <EmptyState message="No costed run to total" />
        ) : (
          <>
            <div className="flex items-end gap-2 sm:gap-3">
              <div className="flex-1">
                <div
                  className="rounded-t"
                  style={{
                    height: 74,
                    background: theme.series[0],
                  }}
                />
                <p className="mt-2 text-[11px] text-slate-600">Gross</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatPayrollAmountShort(composition.gross)}
                </p>
              </div>

              <span aria-hidden="true" className="pb-8 text-sm text-slate-600">
                +
              </span>

              <div className="flex-1">
                <div
                  className="rounded-t"
                  style={{
                    height: Math.max(
                      6,
                      Math.round((composition.employerTotal / composition.trueCost) * 74),
                    ),
                    background: theme.series[2],
                  }}
                />
                <p className="mt-2 text-[11px] text-slate-600">Employer</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatPayrollAmountShort(composition.employerTotal)}
                </p>
              </div>

              <span aria-hidden="true" className="pb-8 text-sm text-slate-600">
                =
              </span>

              <div className="flex-1">
                <div
                  className="rounded-t"
                  style={{
                    height: Math.round((composition.trueCost / composition.gross) * 74),
                    background: theme.positive,
                  }}
                />
                <p className="mt-2 text-[11px] text-slate-600">True cost</p>
                <p className="text-sm font-semibold tabular-nums text-slate-900">
                  {formatPayrollAmountShort(composition.trueCost)}
                </p>
              </div>
            </div>

            <p className="mt-3 border-t border-slate-200 pt-2.5 text-[11px] text-slate-600">
              {formatPayrollAmount(composition.employerTotal)} of employer contributions —{' '}
              {composition.employerPct.toFixed(1)}% on top of gross. Of that,{' '}
              {formatPayrollAmount(composition.employerPf)} is PF
              {composition.employerEsi > 0
                ? ` and ${formatPayrollAmount(composition.employerEsi)} is ESI`
                : ''}
              {composition.employerOther > 0
                ? `; the remaining ${formatPayrollAmount(composition.employerOther)} is other employer heads`
                : ''}
              . Excludes gratuity, which is not accrued per month.
            </p>
          </>
        )}
      </Panel>

      {/* ── 5 · Headcount against cost per head ────────────────────── */}
      <div className="lg:col-span-2">
        <Panel
          title="Headcount against cost per head"
          question="Total cost rising is meaningless on its own — it rises when you hire"
          badge={
            perHeadDelta !== null ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider ${
                  perHeadDelta < 0
                    ? 'bg-emerald-50 text-emerald-700'
                    : perHeadDelta > 0
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-slate-100 text-slate-600'
                }`}
              >
                {perHeadDelta > 0 ? '+' : ''}
                {perHeadDelta.toFixed(1)}% per head
              </span>
            ) : undefined
          }
        >
          <ResponsiveContainer width="100%" height={200}>
            <ComposedChart data={spine} margin={{ top: 12, right: 8, left: 0, bottom: 4 }}>
              <CartesianGrid stroke={theme.grid} vertical={false} />
              <XAxis
                dataKey="label"
                tick={axisTick}
                axisLine={{ stroke: theme.axis }}
                tickLine={false}
              />
              <YAxis
                yAxisId="heads"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                width={34}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="cost"
                orientation="right"
                tick={axisTick}
                axisLine={false}
                tickLine={false}
                width={54}
                tickFormatter={(v) => formatPayrollAmountShort(Number(v))}
              />
              <Tooltip
                cursor={{ fill: theme.grid, fillOpacity: 0.35 }}
                content={({ active, payload, label }) => (
                  <ChartTooltip active={active} payload={payload as never} label={label as string} theme={theme} />
                )}
              />
              <Bar
                yAxisId="heads"
                dataKey="headcount"
                name="Headcount"
                fill={theme.series[0]}
                fillOpacity={0.5}
                radius={[3, 3, 0, 0]}
              />
              <Line
                yAxisId="cost"
                type="monotone"
                dataKey="perHead"
                name="Cost per head"
                stroke={theme.warning}
                strokeWidth={2}
                dot={{ r: 3, fill: theme.warning, strokeWidth: 0 }}
                activeDot={{ r: 5, stroke: theme.surface, strokeWidth: 2 }}
                connectNulls={false}
              />
            </ComposedChart>
          </ResponsiveContainer>

          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-slate-600">
            <span className="inline-flex items-center gap-2">
              <span
                className="h-2.5 w-2.5 rounded-sm opacity-50"
                style={{ background: theme.series[0] }}
              />
              Headcount
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: theme.warning }} />
              Cost per head
            </span>
          </div>
        </Panel>
      </div>
    </div>
  );
}
