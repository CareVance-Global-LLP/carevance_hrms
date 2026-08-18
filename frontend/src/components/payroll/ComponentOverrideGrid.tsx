import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Lightbulb, Lock, Search } from 'lucide-react';
import {
  payrollApi,
  getApiErrorMessage,
  type OverrideGridRow,
  type OverrideGridParams,
} from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import { useToast } from '@/components/ui/Toast';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { cn } from '@/utils/cn';
import ImportOverridesModal from '@/components/payroll/ImportOverridesModal';

/**
 * One row per employee: what the structure produces, and what will be paid.
 *
 * Two rules govern everything below.
 *
 * VALUES ARE STRINGS until submit. A half-typed "4" must not snap to 0 and
 * then re-render as "0" under the cursor — SalaryBreakdownCards learned this
 * the hard way and its comment says so.
 *
 * THE LOCAL MATHS MUST AGREE WITH THE SERVER TO THE RUPEE. The residual, the
 * HRA move and the ceiling are recomputed here on every keystroke so the row
 * responds immediately, but they are the same arithmetic the balancer runs and
 * the server remains the authority at save. Nothing here is debounced — only a
 * server call would be, and this screen makes none while typing.
 *
 * Edits are stored ANNUAL regardless of the remuneration-type display, so
 * flipping Annual/Monthly never mutates what the officer entered — only how it
 * is shown.
 */

/** 0.12 of basic up to the PF wage ceiling. Mirrors PayrollCalculatorService. */
const PF_WAGE_CAP_ANNUAL = 15000 * 12;
const EMPLOYER_PF_RATE = 0.12;
const GRATUITY_RATE = 0.0481;

interface RowEdit {
  basic?: string;
  hra?: string;
}

/** The residual once this row's edits are applied. All figures annual. */
function projectRow(row: OverrideGridRow, edit: RowEdit) {
  const ctc = row.annual_ctc ?? 0;
  const structureBasic = row.components.basic?.computed_annual ?? row.components.basic?.annual ?? 0;
  const structureHra = row.components.hra?.computed_annual ?? row.components.hra?.annual ?? 0;
  const conveyance = row.components.conveyance?.annual ?? 0;

  const hraRate = structureBasic > 0 ? structureHra / structureBasic : 0;

  const basicEdited = edit.basic !== undefined && edit.basic !== '';
  const hraEdited = edit.hra !== undefined && edit.hra !== '';

  const basic = basicEdited ? Number(edit.basic) : (row.components.basic?.annual ?? 0);

  // HRA follows basic unless HRA itself is being pinned — §3.1, and the reason
  // the cost of a rupee of basic differs between the two cases.
  const hra = hraEdited ? Number(edit.hra) : basic * hraRate;

  const employerPf = EMPLOYER_PF_RATE * Math.min(basic, PF_WAGE_CAP_ANNUAL);
  const gratuity = GRATUITY_RATE * basic;
  const gross = ctc - employerPf - gratuity;
  const residual = gross - basic - hra - conveyance;

  const baselineSa = row.components.special_allowance?.annual ?? 0;

  // What a rupee of basic costs the residual at this row's rates. HRA drops
  // out of the factor the moment it is pinned.
  const amplification =
    1 + (hraEdited ? 0 : hraRate) + (basic < PF_WAGE_CAP_ANNUAL ? EMPLOYER_PF_RATE : 0) + GRATUITY_RATE;

  return {
    basic,
    hra,
    residual,
    delta: residual - baselineSa,
    amplification,
    hraFollowsBasic: !hraEdited && basicEdited,
    dirty: basicEdited || hraEdited,
  };
}

const inr = (value: number | null | undefined) =>
  value === null || value === undefined ? '—' : `₹${Math.round(value).toLocaleString('en-IN')}`;

/** '2026-09' + n months, still as 'YYYY-MM'. */
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const date = new Date(y, (m - 1) + n, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(ym: string, style: 'long' | 'short' = 'long'): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  return new Date(y, m - 1, 1).toLocaleString('en-US', {
    month: style,
    ...(style === 'long' ? { year: 'numeric' } : {}),
  });
}

export default function ComponentOverrideGrid() {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState('');
  const [structureId, setStructureId] = useState('');
  const [remuneration, setRemuneration] = useState<'annual' | 'monthly'>('annual');
  const [sortAsc, setSortAsc] = useState(true);
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [reason, setReason] = useState('');
  const [isImportOpen, setIsImportOpen] = useState(false);

  const debouncedSearch = useDebouncedValue(search, 400);

  const params: OverrideGridParams = useMemo(
    () => ({
      page,
      per_page: 10,
      ...(debouncedSearch ? { q: debouncedSearch } : {}),
      ...(month ? { month } : {}),
      ...(structureId ? { salary_template_id: Number(structureId) } : {}),
    }),
    [page, debouncedSearch, month, structureId],
  );

  const gridQuery = useQuery({
    queryKey: ['payroll', 'override-grid', params],
    queryFn: () => payrollApi.overrides.grid(params).then((r) => r.data),
  });

  const structuresQuery = useQuery({
    queryKey: ['payroll', 'salary-structures'],
    queryFn: () => payrollApi.getSalaryStructures().then((r) => r.data.templates),
  });

  const meta = gridQuery.data?.meta;

  const rows = useMemo(() => {
    const list = [...(gridQuery.data?.data ?? [])];
    list.sort((a, b) => {
      const cmp = String(a.employee_number ?? '').localeCompare(String(b.employee_number ?? ''));
      return sortAsc ? cmp : -cmp;
    });
    return list;
  }, [gridQuery.data, sortAsc]);

  /** Display scale: figures are annual; Monthly view divides at the edge only. */
  const show = (value: number | null | undefined) =>
    value === null || value === undefined ? '—' : inr(remuneration === 'annual' ? value : value / 12);
  const unit = remuneration === 'annual' ? 'Annual' : 'Monthly';

  const dirtyRows = useMemo(
    () => rows.filter((row) => projectRow(row, edits[row.user_id] ?? {}).dirty),
    [rows, edits],
  );

  /** A row whose residual would go negative must never reach the server. */
  const blockedRows = useMemo(
    () => dirtyRows.filter((row) => projectRow(row, edits[row.user_id] ?? {}).residual < -0.01),
    [dirtyRows, edits],
  );

  const save = useMutation({
    /*
     * ONE request for the batch, whether it came from a row's Update button or
     * the strip's. The server judges every item before writing any, so either
     * all the changes land or none do — a partial write is how a grid silently
     * drifts from the file it was exported to.
     */
    mutationFn: async (targetRows: OverrideGridRow[]) => {
      const items = targetRows.flatMap((row) => {
        const edit = edits[row.user_id] ?? {};

        return (['basic', 'hra'] as const)
          .filter((target) => edit[target] !== undefined && edit[target] !== '')
          .map((target) => ({
            user_id: row.user_id,
            target,
            value_annual: Number(edit[target]),
          }));
      });

      return payrollApi.overrides.createBatch({
        month: meta?.month,
        reason: reason.trim(),
        balance_mode: 'preserve_ctc',
        effective_from: `${meta?.month ?? month}-01`,
        effective_to: null,
        items,
      });
    },
    onSuccess: async (response, targetRows) => {
      toast.show({ kind: 'success', message: response.data.message });
      setEdits((current) => {
        const next = { ...current };
        targetRows.forEach((row) => delete next[row.user_id]);
        return next;
      });
      if (targetRows.length === dirtyRows.length) setReason('');
      await queryClient.invalidateQueries({ queryKey: ['payroll', 'override-grid'] });
      await queryClient.invalidateQueries({ queryKey: ['payroll', 'overrides'] });
    },
    onError: (error) => {
      /*
       * The server's per-item errors name the employee and the ceiling. Shown
       * as they came rather than collapsed into "something went wrong", which
       * is the difference between a fixable refusal and a dead end.
       */
      const items = (error as any)?.response?.data?.errors as Array<{ message: string }> | undefined;

      toast.show({
        kind: 'error',
        message: items?.length
          ? `${items[0].message}${items.length > 1 ? ` (+${items.length - 1} more)` : ''}`
          : getApiErrorMessage(error),
      });
    },
  });

  const saveRows = (targetRows: OverrideGridRow[]) => {
    if (reason.trim().length < 3) {
      toast.show({ kind: 'error', message: 'Add a reason first — it appears on the register and the differences report.' });
      return;
    }
    save.mutate(targetRows);
  };

  const downloadBlob = async (fetcher: () => Promise<{ data: Blob }>, filename: string) => {
    try {
      const response = await fetcher();
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 100);
    } catch (error) {
      toast.show({ kind: 'error', message: getApiErrorMessage(error) });
    }
  };

  const setCell = (userId: number, target: 'basic' | 'hra', raw: string) => {
    const digits = raw.replace(/[^\d]/g, '');
    // Stored annual whatever the display: Monthly input is scaled on the way
    // in, so the officer's figure survives a view toggle untouched.
    const annual = digits === '' ? '' : remuneration === 'annual' ? digits : String(Number(digits) * 12);
    setEdits((current) => ({ ...current, [userId]: { ...current[userId], [target]: annual } }));
  };

  const cellValue = (edit: RowEdit, target: 'basic' | 'hra', fallback: number | null | undefined) => {
    const raw = edit[target];
    if (raw === '') return '';
    const annual = raw !== undefined ? Number(raw) : fallback ?? 0;
    return String(Math.round(remuneration === 'annual' ? annual : annual / 12));
  };

  const openMonth = meta?.earliest_open_month;
  const effectiveMonth = month || openMonth || '';
  const closedMonth = effectiveMonth ? monthLabel(addMonths(effectiveMonth, -1), 'short') : null;

  if (gridQuery.isLoading) return <PageLoadingState label="Loading employees…" />;
  if (gridQuery.isError) {
    return <PageErrorState message={getApiErrorMessage(gridQuery.error)} onRetry={() => void gridQuery.refetch()} />;
  }

  return (
    <div className="space-y-4 pb-24">
      <ModuleHeader
        title="Salary Component Override"
        description="Set an employee's Basic or HRA to an exact amount, overriding what their salary structure would calculate. Everything else rebalances against CTC."
        actions={
          <>
            <Button
              variant="secondary"
              iconLeft={<Download className="h-4 w-4" />}
              onClick={() => void downloadBlob(
                () => payrollApi.overrides.exportCsv(params) as any,
                `component-overrides-${meta?.month ?? 'current'}.csv`,
              )}
            >
              Export CSV
            </Button>
            <Button iconLeft={<FileUp className="h-4 w-4" />} onClick={() => setIsImportOpen(true)}>
              Import overrides
            </Button>
          </>
        }
      />

      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50/60 p-4">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600">
          <Lightbulb className="h-4 w-4" />
        </div>
        <p className="text-sm leading-relaxed text-slate-700">
          <span className="font-semibold text-slate-900">Only Basic and HRA are overridable.</span>{' '}
          Both are entered as an exact amount and hold until cleared. The Special Allowance column
          recalculates as you type, because it is the residual that balances the structure back to
          CTC. CTC never changes.
        </p>
      </div>

      <SurfaceCard className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <FieldLabel>Remuneration type</FieldLabel>
            <SelectInput
              aria-label="Remuneration type"
              value={remuneration}
              onChange={(event) => setRemuneration(event.target.value as 'annual' | 'monthly')}
            >
              <option value="annual">Annual</option>
              <option value="monthly">Monthly</option>
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Salary structure</FieldLabel>
            <SelectInput
              aria-label="Salary structure"
              value={structureId}
              onChange={(event) => {
                setStructureId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">All structures</option>
              {(structuresQuery.data ?? []).map((template: { id: number; name: string }) => (
                <option key={template.id} value={String(template.id)}>{template.name}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel hint={closedMonth ? `${closedMonth} is closed` : undefined}>Effective from</FieldLabel>
            <SelectInput
              aria-label="Effective from"
              value={effectiveMonth}
              onChange={(event) => {
                setMonth(event.target.value);
                setPage(1);
              }}
            >
              {(openMonth
                ? [0, 1, 2].map((n) => addMonths(openMonth, n))
                : [effectiveMonth]
              ).map((ym) => (
                <option key={ym} value={ym}>{monthLabel(ym)}</option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <TextInput
                type="search"
                className="pl-9"
                value={search}
                placeholder="Name or employee number"
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
        </div>

        {meta?.ambiguous_residual && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
            More than one component is marked as the residual, so the balancer cannot know which absorbs a
            change. Mark exactly one in Pay Group Settings before raising overrides.
          </p>
        )}
      </SurfaceCard>

      <SurfaceCard className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">Employee components</span>
          <span className="text-xs font-semibold text-slate-700">
            {meta?.total ?? rows.length} employee{(meta?.total ?? rows.length) === 1 ? '' : 's'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1140px] text-sm">
            <thead className="border-b border-slate-100 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th scope="col" className="px-4 py-2.5 font-medium">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-blue-600"
                    onClick={() => setSortAsc((current) => !current)}
                  >
                    Employee {sortAsc ? '▲' : '▼'}
                  </button>
                </th>
                <th scope="col" className="px-4 py-2.5 font-medium">Name</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">CTC ({unit})</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Basic ({unit})</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">HRA ({unit})</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Special allowance ({unit})</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Conveyance ({unit})</th>
                <th scope="col" className="sticky right-0 border-l border-slate-200 bg-white px-4 py-2.5"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((row) => {
                const edit = edits[row.user_id] ?? {};
                const projected = projectRow(row, edit);
                const overCeiling = projected.residual < -0.01;
                const rowTint = overCeiling ? 'bg-rose-50/60' : projected.dirty ? 'bg-amber-50/40' : undefined;
                const stickyTint = overCeiling ? 'bg-rose-50' : projected.dirty ? 'bg-amber-50' : 'bg-white';

                return (
                  <tr
                    key={row.user_id}
                    data-testid="override-grid-row"
                    className={cn(rowTint, projected.dirty && !overCeiling && 'shadow-[inset_3px_0_0_theme(colors.amber.400)]', overCeiling && 'shadow-[inset_3px_0_0_theme(colors.rose.500)]')}
                  >
                    <td className="px-4 py-2.5 align-top">
                      <span className="text-[13px] font-semibold text-blue-600">{row.employee_number ?? '—'}</span>
                    </td>
                    <td className="px-4 py-2.5 align-top">
                      <p className="max-w-52 truncate font-medium text-slate-800" title={row.employee_name ?? undefined}>
                        {row.employee_name}
                      </p>
                      <p className="text-[11px] text-slate-400">
                        {row.department ?? 'No department'}{row.salary_structure ? ` · ${row.salary_structure}` : ''}
                      </p>
                      {row.locked && (
                        <span className="mt-1 inline-block">
                          <StatusBadge tone="neutral">
                            <Lock className="mr-1 inline h-3 w-3" />
                            {row.lock_reason ?? 'Locked'}
                          </StatusBadge>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right align-top tabular-nums text-slate-500">{show(row.annual_ctc)}</td>

                    {(['basic', 'hra'] as const).map((target) => {
                      const cell = row.components[target];
                      const notApplicable = cell?.annual === null || cell?.annual === undefined;
                      const edited = edit[target] !== undefined && edit[target] !== '';
                      const isErrorCell = overCeiling && (target === 'basic' ? edited || !projected.hraFollowsBasic : edited);

                      return (
                        <td key={target} className="px-4 py-2.5 text-right align-top">
                          {notApplicable ? (
                            <span className="text-xs text-slate-400">Not Applicable</span>
                          ) : !cell?.overridable || row.locked ? (
                            <span className="tabular-nums text-slate-700">{show(cell?.annual)}</span>
                          ) : (
                            <>
                              <div
                                className={cn(
                                  'ml-auto flex w-40 items-stretch overflow-hidden rounded-lg border shadow-sm transition focus-within:border-sky-400 focus-within:ring-2 focus-within:ring-sky-300/30',
                                  isErrorCell
                                    ? 'border-rose-400 bg-rose-50'
                                    : edited
                                      ? 'border-amber-400 bg-amber-50'
                                      : 'border-border-strong bg-surface-card',
                                )}
                              >
                                <span
                                  className={cn(
                                    'flex items-center border-r px-2 text-[11px] font-semibold',
                                    isErrorCell
                                      ? 'border-rose-400 bg-rose-100 text-rose-700'
                                      : edited
                                        ? 'border-amber-400 bg-amber-100 text-amber-800'
                                        : 'border-border-strong bg-surface-sunken text-slate-500',
                                  )}
                                >
                                  INR
                                </span>
                                <input
                                  aria-label={`${target} for ${row.employee_name}`}
                                  inputMode="numeric"
                                  className={cn(
                                    'w-full bg-transparent px-2.5 py-2 text-right text-sm tabular-nums outline-none',
                                    isErrorCell ? 'font-semibold text-rose-700' : edited ? 'font-semibold text-amber-800' : 'text-slate-900',
                                  )}
                                  // Strings, not numbers: parsing on every
                                  // keystroke turns a half-typed "4" into 0.
                                  value={cellValue(edit, target, cell?.annual)}
                                  onChange={(event) => setCell(row.user_id, target, event.target.value)}
                                />
                              </div>
                              {target === 'basic' && edited && !overCeiling && (
                                <p className="mt-1 text-[11px] text-slate-400">
                                  ₹1 of Basic costs ₹{projected.amplification.toFixed(4)} of allowance
                                </p>
                              )}
                              {target === 'basic' && overCeiling && (
                                <p className="mt-1 max-w-44 text-[11px] leading-snug text-rose-600">
                                  Max is {show(row.max_basic_annual)}{' '}
                                  {row.max_basic_annual !== null && (
                                    <button
                                      type="button"
                                      className="font-semibold text-blue-600 underline underline-offset-2"
                                      onClick={() => setEdits((current) => ({
                                        ...current,
                                        [row.user_id]: { ...current[row.user_id], basic: String(row.max_basic_annual) },
                                      }))}
                                    >
                                      use max
                                    </button>
                                  )}
                                </p>
                              )}
                              {target === 'hra' && projected.hraFollowsBasic && (
                                <p className="mt-1 text-[11px] text-slate-400">follows basic → {show(projected.hra)}</p>
                              )}
                              {/*
                                A saved request, shown next to the figure it has
                                not yet replaced.

                                The input keeps showing what is actually paid,
                                because that is still the truth until somebody
                                approves this. But saving used to leave the cell
                                looking exactly as it did before, so a saved
                                override and a failed save were indistinguishable
                                and the officer's instinct was to type it again.
                              */}
                              {!edited && cell?.pending_annual != null && (
                                <p className="mt-1 text-[11px] font-medium leading-snug text-amber-600">
                                  Pending {show(cell.pending_annual)} — awaiting approval
                                </p>
                              )}
                            </>
                          )}
                        </td>
                      );
                    })}

                    <td className={cn('px-4 py-2.5 text-right align-top tabular-nums', overCeiling ? 'text-rose-600' : 'font-semibold text-slate-900')}>
                      {show(projected.dirty ? projected.residual : row.components.special_allowance?.annual)}
                      {projected.dirty && !overCeiling && Math.abs(projected.delta) > 0.5 && (
                        <span
                          className={cn(
                            'mt-0.5 block text-[11px] font-bold tabular-nums',
                            projected.delta < 0 ? 'text-rose-600' : 'text-emerald-600',
                          )}
                        >
                          {projected.delta < 0 ? '−' : '+'}
                          {show(Math.abs(projected.delta))}
                        </span>
                      )}
                      {overCeiling && (
                        <p className="mt-0.5 max-w-44 text-[11px] leading-snug text-rose-600">
                          Below zero — the breakdown would not balance to CTC.
                        </p>
                      )}
                    </td>

                    <td className="px-4 py-2.5 text-right align-top tabular-nums text-slate-500">
                      {show(row.components.conveyance?.annual)}
                    </td>

                    <td className={cn('sticky right-0 border-l border-slate-200 px-4 py-2.5 text-right align-top', stickyTint)}>
                      <Button
                        size="sm"
                        disabled={!projected.dirty || overCeiling || row.locked || save.isPending}
                        onClick={() => saveRows([row])}
                      >
                        Update
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {meta && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3 text-sm text-slate-500">
            <span>
              {meta.total === 0
                ? 'No employees'
                : `${(meta.page - 1) * meta.per_page + 1} to ${Math.min(meta.page * meta.per_page, meta.total)} of ${meta.total}`}
            </span>
            <div className="flex items-center gap-2">
              <span>Page {meta.page} of {meta.last_page}</span>
              <Button variant="secondary" size="sm" disabled={meta.page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={meta.page >= meta.last_page} onClick={() => setPage((p) => p + 1)}>
                Next
              </Button>
            </div>
          </div>
        )}
      </SurfaceCard>

      {dirtyRows.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
          <div className="mx-auto flex max-w-6xl flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <FieldLabel>Reason for this batch</FieldLabel>
              <TextInput
                value={reason}
                placeholder="e.g. Annual revision FY 2026-27"
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <Button variant="ghost" onClick={() => { setEdits({}); setReason(''); }}>
              Discard changes
            </Button>
            <Button
              loading={save.isPending}
              disabled={reason.trim().length < 3 || blockedRows.length > 0}
              onClick={() => save.mutate(dirtyRows)}
            >
              Update {dirtyRows.length} employee{dirtyRows.length === 1 ? '' : 's'}
            </Button>
          </div>
          {blockedRows.length > 0 && (
            <p className="mx-auto mt-2 max-w-6xl text-xs text-rose-600">
              {blockedRows.length} row{blockedRows.length === 1 ? '' : 's'} would leave the residual below zero. Fix
              {blockedRows.length === 1 ? ' it' : ' them'} before updating.
            </p>
          )}
        </div>
      )}

      <ImportOverridesModal
        isOpen={isImportOpen}
        month={meta?.month}
        onClose={() => setIsImportOpen(false)}
        onCommitted={() => {
          void queryClient.invalidateQueries({ queryKey: ['payroll', 'override-grid'] });
          void queryClient.invalidateQueries({ queryKey: ['payroll', 'overrides'] });
        }}
      />
    </div>
  );
}
