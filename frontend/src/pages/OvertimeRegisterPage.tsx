import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, Scale } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import Button from '@/components/ui/Button';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';
import { statutoryApi } from '@/services/api';
import { LIST_MAX_BODY_HEIGHT } from '@/lib/pagination';
import type { OvertimeRegisterRow } from '@/types';

/**
 * The overtime register, and where the working week broke the law.
 *
 * A statutory record rather than a dashboard — section 59(4) requires a
 * register of overtime, and an inspector asks for it by name — so the columns
 * are the ones the Act names and the download is the point of the screen.
 *
 * Two things here are deliberately loud rather than tidy:
 *
 * Rows that could not be priced are counted at the top. A register that
 * silently shows blank amounts for half its people is not one anybody should
 * hand over, and the person about to hand it over is the one who needs telling.
 *
 * Employees whose establishment type is unset are reported as NOT ASSESSED, not
 * as compliant. An empty breach list over an unconfigured entity means nobody
 * looked, and a green tick over that is the worst thing this screen could say.
 */
export default function OvertimeRegisterPage() {
  const [from, setFrom] = useState(() => firstOfThisMonth());
  const [to, setTo] = useState(() => today());
  // One stable prefix per form, so every caption is tied to its control.
  // FieldLabel without htmlFor is decoration: a screen reader reaches the
  // field and announces "edit text, blank".
  const fieldId = useId();

  const params = { from, to };

  const registerQuery = useQuery({
    queryKey: ['overtime-register', from, to],
    queryFn: async () => (await statutoryApi.register(params)).data,
  });

  const breachQuery = useQuery({
    queryKey: ['statutory-breaches', from, to],
    queryFn: async () => (await statutoryApi.breaches(params)).data,
  });

  const rows = registerQuery.data?.rows ?? [];
  const totals = registerQuery.data?.totals;
  const breachTotals = breachQuery.data?.totals;

  /*
   * Rows actually being PAID below the floor — not rows whose policy is low but
   * whose pay has been lifted to the statutory rate. Counting the latter keeps
   * a red tile on screen forever after somebody has already fixed the problem
   * the only way the product offers.
   */
  const belowFloor = useMemo(
    () => rows.filter((row) => row.is_below_statutory_floor && !isFloorApplied(row)).length,
    [rows],
  );

  /** Policy is below the floor, but the floor is being paid anyway. */
  const floorCovering = useMemo(
    () => rows.filter((row) => row.is_below_statutory_floor && isFloorApplied(row)).length,
    [rows],
  );

  const error =
    (registerQuery.error as any)?.response?.data?.message ??
    (breachQuery.error as any)?.response?.data?.message ??
    '';

  return (
    <div className="space-y-4 p-4">
      <PageHeader
        title="Overtime register"
        description="What was worked beyond ordinary hours, what it is worth, and where the working week went past a statutory limit."
      />

      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <div>
          <FieldLabel htmlFor={`${fieldId}-from`}>From</FieldLabel>
          <TextInput id={`${fieldId}-from`} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <FieldLabel htmlFor={`${fieldId}-to`}>To</FieldLabel>
          <TextInput id={`${fieldId}-to`} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <Button
          variant="secondary"
          iconLeft={<Download className="h-4 w-4" />}
          disabled={rows.length === 0}
          onClick={() => downloadCsv(rows, from, to)}
        >
          Download CSV
        </Button>
      </div>

      {totals ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Overtime" value={formatHours(totals.overtime_minutes)} />
          <Tile
            label="Awaiting approval"
            value={formatHours(totals.pending_minutes)}
            tone={totals.pending_minutes > 0 ? 'amber' : undefined}
          />
          <Tile
            label="Rows with no rate"
            value={String(totals.rows_without_a_rate)}
            tone={totals.rows_without_a_rate > 0 ? 'amber' : undefined}
            hint={totals.rows_without_a_rate > 0 ? 'No annual CTC, so the amount could not be computed' : undefined}
          />
          <Tile
            label={belowFloor === 0 && floorCovering > 0 ? 'Lifted to the statutory rate' : 'Below the statutory rate'}
            value={String(belowFloor > 0 ? belowFloor : floorCovering)}
            tone={belowFloor > 0 ? 'red' : undefined}
            hint={
              belowFloor > 0
                ? 'Overtime is owed at twice the ordinary rate'
                : floorCovering > 0
                  ? 'Paid at the statutory rate despite a lower policy'
                  : undefined
            }
          />
        </div>
      ) : null}

      {breachTotals && breachTotals.employees_not_assessed > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {/* The false negative this whole screen is built to avoid. */}
          {breachTotals.employees_not_assessed} {breachTotals.employees_not_assessed === 1 ? 'employee was' : 'employees were'}{' '}
          not checked at all, because their company has no establishment type set. They are not compliant — they are
          unassessed. Set it under Settings → Legal entities.
        </p>
      ) : null}

      {registerQuery.isLoading ? (
        <PageLoadingState label="Building the register..." />
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
          No overtime recorded in this period.
        </p>
      ) : (
        <div className={`overflow-auto rounded-lg border border-slate-200 ${LIST_MAX_BODY_HEIGHT}`}>
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Worker</th>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 text-right font-semibold">Normal</th>
                <th className="px-3 py-2 text-right font-semibold">Overtime</th>
                <th className="px-3 py-2 text-right font-semibold">Rate</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map((row) => (
                <tr key={`${row.user_id}-${row.date}`}>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{row.name}</span>
                    {row.employee_code ? (
                      <span className="block text-[10px] text-slate-500">{row.employee_code}</span>
                    ) : null}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">{row.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {row.normal_minutes === null ? '—' : formatHours(row.normal_minutes)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {formatHours(row.overtime_minutes)}
                    {row.pending_minutes > 0 ? (
                      <span className="block text-[10px] font-normal text-amber-700">
                        {formatHours(row.pending_minutes)} not approved
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {/*
                      * Three states, not two. `is_below_statutory_floor` is
                      * about the POLICY, so it stays true even once the floor
                      * is being paid — and rendering that as a red "law
                      * requires 2.00x" beside a rate of 2.00x reads as a
                      * violation when it is the protection working.
                      */}
                    <span className={rateTone(row)}>{row.multiplier}×</span>
                    {row.is_below_statutory_floor ? (
                      isFloorApplied(row) ? (
                        <span className="block text-[10px] text-slate-500">
                          statutory floor applied · policy says {row.configured_multiplier}×
                        </span>
                      ) : (
                        <span className="block text-[10px] text-red-700">
                          law requires {row.statutory_multiplier_floor}×
                        </span>
                      )
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                    {/* Never rendered as 0.00 — an unpriced row is a different
                        fact from a row worth nothing. */}
                    {row.amount === null ? <span className="text-slate-400">no rate</span> : row.amount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <BreachList
        isLoading={breachQuery.isLoading}
        employees={breachQuery.data?.employees ?? []}
        total={breachTotals?.breaches ?? 0}
      />
    </div>
  );
}

function BreachList({
  isLoading,
  employees,
  total,
}: {
  isLoading: boolean;
  employees: Array<{ user_id: number; name: string; breaches: Array<{ type: string; period: string; summary: string; citation: string | null; excess_minutes: number }> }>;
  total: number;
}) {
  if (isLoading) {
    return <PageLoadingState label="Checking working-hour limits..." />;
  }

  if (employees.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <Scale className="h-4 w-4 text-slate-500" />
        Working-hour limits · {total} {total === 1 ? 'breach' : 'breaches'}
      </h2>

      {employees.map((employee) => (
        <div key={employee.user_id} className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-sm font-medium text-slate-950">{employee.name}</p>

          <ul className="mt-1.5 space-y-1.5">
            {employee.breaches.map((breach, index) => (
              <li key={`${breach.type}-${breach.period}-${index}`} className="flex gap-2 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span>
                  <span className="text-slate-900">{breach.summary}</span>
                  <span className="block text-[11px] text-slate-500">
                    {breach.period} · over by {formatHours(breach.excess_minutes)}
                    {/* "Says who" is the first question anybody asks. */}
                    {breach.citation ? ` · ${breach.citation}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: string;
  tone?: 'amber' | 'red';
  hint?: string;
}) {
  const toneClass =
    tone === 'red'
      ? 'border-red-200 bg-red-50 text-red-800'
      : tone === 'amber'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-white text-slate-900';

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{value}</p>
      {hint ? <p className="mt-0.5 text-[10px] opacity-80">{hint}</p> : null}
    </div>
  );
}

/** Hours and minutes, because a register is read by people, not by a chart. */
function formatHours(minutes: number): string {
  const whole = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const sign = minutes < 0 ? '-' : '';

  return rest === 0 ? `${sign}${whole}h` : `${sign}${whole}h ${rest}m`;
}

function downloadCsv(rows: OvertimeRegisterRow[], from: string, to: string): void {
  const headers = [
    'Employee code', 'Name', 'Date', 'Normal minutes', 'Worked minutes',
    'Overtime minutes', 'Pending minutes', 'Rate', 'Configured rate',
    'Statutory floor', 'Hourly rate', 'Amount',
  ];

  const body = rows.map((row) => [
    row.employee_code ?? '', row.name, row.date, row.normal_minutes ?? '',
    row.worked_minutes, row.overtime_minutes, row.pending_minutes,
    row.multiplier, row.configured_multiplier, row.statutory_multiplier_floor ?? '',
    row.hourly_rate ?? '',
    // Empty, not 0 — the whole point of carrying null this far.
    row.amount ?? '',
  ]);

  const csv = [headers, ...body]
    .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\r\n');

  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `overtime-register-${from}-to-${to}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfThisMonth(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

/**
 * Is this row being paid at the statutory floor rather than at its policy rate?
 *
 * Compared as numbers because both arrive as decimal strings from the server and
 * "2.00" !== "2.0" would silently classify an enforced row as an underpaying one.
 */
function isFloorApplied(row: OvertimeRegisterRow): boolean {
  if (!row.statutory_multiplier_floor) return false;

  return Number(row.multiplier) >= Number(row.statutory_multiplier_floor)
    && Number(row.configured_multiplier) < Number(row.statutory_multiplier_floor);
}

function rateTone(row: OvertimeRegisterRow): string {
  if (!row.is_below_statutory_floor) return 'text-slate-700';

  return isFloorApplied(row) ? 'text-slate-700' : 'text-red-700';
}
