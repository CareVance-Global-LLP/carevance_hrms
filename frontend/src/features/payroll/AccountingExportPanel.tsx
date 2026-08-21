import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download } from 'lucide-react';
import { accountingApi } from '@/services/api';
import Button from '@/components/ui/Button';

/**
 * A payroll run as a general-ledger journal, and the file for it.
 *
 * THE JOURNAL IS SHOWN BEFORE THE FILE EXISTS. Somebody about to post half a
 * million rupees into a ledger should be able to read it first — and finding
 * out about an unmapped component from a rejected Tally import is a worse
 * afternoon than finding out here.
 *
 * AN UNMAPPED COMPONENT IS NAMED AND THE DOWNLOAD IS BLOCKED. Never a suspense
 * account, never quietly omitted: "your salary journal is 40,000 light and
 * nobody knows why" is what dropping a line produces, and it is discovered at
 * month-end by an accountant who cannot see the payroll that caused it.
 */
export default function AccountingExportPanel({ runId }: { runId: number }) {
  const query = useQuery({
    queryKey: ['payroll-journal', runId],
    queryFn: async () => (await accountingApi.journal(runId)).data,
  });

  if (query.isLoading) {
    return <p className="py-4 text-center text-xs text-slate-400">Building the journal…</p>;
  }

  const journal = query.data?.data;
  const exportable = query.data?.exportable ?? false;

  if (!journal) {
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        Could not build the journal for this run.
      </p>
    );
  }

  const money = (value: string) =>
    new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2 }).format(Number(value));

  return (
    <div className="space-y-3">
      {journal.unmapped.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <p className="flex items-start gap-2 text-sm font-medium text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {journal.unmapped.length === 1 ? 'One component has' : `${journal.unmapped.length} components have`} no
            ledger mapped
          </p>
          <p className="mt-1 text-xs text-amber-800">
            {/* Named, so somebody can go and fix it rather than hunting. */}
            {journal.unmapped.join(', ')} — map {journal.unmapped.length === 1 ? 'it' : 'them'} before exporting, or the
            journal will not balance.
          </p>
        </div>
      ) : null}

      {!journal.totals.balanced && journal.unmapped.length === 0 ? (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {/* Should be unreachable, and stated anyway rather than exporting a
              file that quietly does not balance. */}
          This journal does not balance: debits {money(journal.totals.debit)}, credits{' '}
          {money(journal.totals.credit)}. That is a problem with the payroll run, not the export.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 font-semibold">Ledger</th>
              <th className="px-3 py-2 font-semibold">Code</th>
              <th className="px-3 py-2 text-right font-semibold">Debit</th>
              <th className="px-3 py-2 text-right font-semibold">Credit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {journal.lines.map((line) => (
              <tr key={line.entity}>
                <td className="px-3 py-2 text-slate-900">{line.ledger}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">{line.gl_code}</td>
                {/* The unused side is empty, not 0.00 — the same rule the CSV
                    follows, and for the same reason: a zero in both columns is
                    one a human misreads. */}
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                  {line.side === 'debit' ? money(line.amount) : ''}
                </td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-900">
                  {line.side === 'credit' ? money(line.amount) : ''}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50">
            <tr>
              <td className="px-3 py-2 font-semibold text-slate-900" colSpan={2}>
                {journal.totals.balanced ? 'Balanced' : 'Does not balance'}
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-950">
                {money(journal.totals.debit)}
              </td>
              <td className="px-3 py-2 text-right font-bold tabular-nums text-slate-950">
                {money(journal.totals.credit)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex flex-wrap gap-2">
        {([
          ['tally', 'Tally XML'],
          ['zoho', 'Zoho Books CSV'],
        ] as const).map(([format, label]) => (
          <Button
            key={format}
            variant="secondary"
            size="sm"
            iconLeft={<Download className="h-3.5 w-3.5" />}
            disabled={!exportable}
            onClick={() => window.open(accountingApi.exportUrl(runId, format), '_blank')}
          >
            {label}
          </Button>
        ))}

        {!exportable ? (
          <p className="self-center text-[11px] text-slate-500">
            Fix the above before exporting.
          </p>
        ) : null}
      </div>
    </div>
  );
}
