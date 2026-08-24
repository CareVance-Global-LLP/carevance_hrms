import { useEffect, useMemo, useState } from 'react';
import { leaveTypeApi } from '@/services/api';
import type { LeaveLedgerEntry, LeaveLedgerKind } from '@/types';
import { SlideOver } from '@/components/ui/dialog';

/**
 * Why a leave balance is the number it is.
 *
 * The reason the ledger exists at all. Nobody argues about "what is my
 * balance" — they argue about "why is it 8.5 when I have taken four days", and
 * a figure that cannot be expanded into the rows that produced it is one you
 * end up settling with a customer's HR team over a spreadsheet.
 *
 * Nothing here is computed twice. The running column is a plain cumulative sum
 * of the rows on screen, so what it ends at IS the arithmetic being shown —
 * there is no second calculation that could disagree with the first.
 */

const KIND_LABEL: Record<LeaveLedgerKind, string> = {
  opening_balance: 'Opening balance',
  accrual: 'Earned',
  consumption: 'Taken',
  carry_forward: 'Carried forward',
  expiry: 'Expired',
  encashment: 'Encashed',
  adjustment: 'Adjustment',
};

export interface LeaveLedgerDrawerProps {
  open: boolean;
  userId: number;
  /** Which leave type to open on. Others stay reachable from the filter. */
  focusCode?: string | null;
  /** Whose ledger this is, for the drawer subtitle when it is not your own. */
  subjectName?: string | null;
  onClose: () => void;
}

export default function LeaveLedgerDrawer({
  open,
  userId,
  focusCode,
  subjectName,
  onClose,
}: LeaveLedgerDrawerProps) {
  const [entries, setEntries] = useState<LeaveLedgerEntry[]>([]);
  const [cycle, setCycle] = useState<{ start_date: string; end_date: string } | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(focusCode ?? null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setSelectedCode(focusCode ?? null);
  }, [focusCode, open]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;
    setIsLoading(true);
    setError('');

    leaveTypeApi
      .ledger(userId)
      .then((response) => {
        if (cancelled) return;
        setEntries(response.data.entries ?? []);
        setCycle(response.data.cycle ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        // Said plainly rather than shown as an empty ledger: "no rows" and
        // "could not load the rows" mean opposite things to somebody checking
        // whether their leave was credited.
        setError('Could not load the breakdown. Try again in a moment.');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, userId]);

  const codes = useMemo(() => {
    const seen = new Map<string, string>();
    entries.forEach((entry) => {
      const code = entry.leave_type?.code;
      if (code && !seen.has(code)) seen.set(code, entry.leave_type?.name || code);
    });
    return Array.from(seen, ([code, name]) => ({ code, name }));
  }, [entries]);

  const rows = useMemo(() => {
    const filtered = selectedCode
      ? entries.filter((entry) => entry.leave_type?.code === selectedCode)
      : entries;

    let running = 0;
    return filtered.map((entry) => {
      const units = Number(entry.units || 0);
      running = Math.round((running + units) * 100) / 100;
      return { entry, units, running };
    });
  }, [entries, selectedCode]);

  const closing = rows.length > 0 ? rows[rows.length - 1].running : 0;

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title="How this balance was earned"
      subtitle={
        cycle
          ? `${subjectName ? `${subjectName} · ` : ''}${formatDate(cycle.start_date)} to ${formatDate(cycle.end_date)}`
          : subjectName || undefined
      }
    >
      {error ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      ) : null}

      {codes.length > 1 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip active={selectedCode === null} onClick={() => setSelectedCode(null)}>
            All
          </FilterChip>
          {codes.map(({ code, name }) => (
            <FilterChip key={code} active={selectedCode === code} onClick={() => setSelectedCode(code)}>
              {name}
            </FilterChip>
          ))}
        </div>
      ) : null}

      {isLoading ? (
        <p className="py-6 text-center text-xs text-slate-400">Loading breakdown…</p>
      ) : error ? (
        /*
         * Nothing else. A failed load also has no rows, so falling through to
         * the empty state would say "nothing has been credited" underneath the
         * error — which is the exact confusion this drawer exists to remove.
         */
        null
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-6 text-center text-xs text-slate-500">
          {/* Two genuinely different situations, and an employee checking
              whether their leave was credited needs to know which. */}
          {entries.length === 0
            ? 'Nothing has been credited or drawn down in this leave year yet.'
            : 'No entries for this leave type in this leave year.'}
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">What happened</th>
                <th className="px-3 py-2 text-right font-semibold">Days</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {rows.map(({ entry, units, running }) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-slate-600">
                    {formatDate(entry.effective_on)}
                  </td>
                  <td className="px-3 py-2">
                    <span className="font-medium text-slate-900">{KIND_LABEL[entry.kind] ?? entry.kind}</span>
                    {!selectedCode && entry.leave_type ? (
                      <span className="text-slate-500"> · {entry.leave_type.name}</span>
                    ) : null}
                    {entry.note ? <span className="block text-[11px] text-slate-500">{entry.note}</span> : null}
                  </td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums ${
                      units < 0 ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {units > 0 ? '+' : ''}
                    {formatDays(units)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-slate-700">
                    {formatDays(running)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="bg-slate-50">
              <tr>
                <td className="px-3 py-2 font-semibold text-slate-900" colSpan={3}>
                  {selectedCode ? 'Left in this type' : 'Left across all types'}
                </td>
                <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-950">{formatDays(closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {closing < 0 ? (
        <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {/* The balance cards floor at zero. Rather than quietly show a
              different number here, the difference is named. */}
          More has been drawn down than was earned, so the balance card shows 0 while the ledger stands at{' '}
          {formatDays(closing)}. Ask HR to check for an adjustment.
        </p>
      ) : null}
    </SlideOver>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
        active
          ? 'border-slate-900 bg-slate-900 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
      }`}
    >
      {children}
    </button>
  );
}

/** Half days are real, whole days are the common case — so 1 not 1.0. */
function formatDays(value: number): string {
  return Number(value).toFixed(value % 1 === 0 ? 0 : 1);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
