import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileUp } from 'lucide-react';
import {
  payrollApi,
  getApiErrorMessage,
  type ImportValidateResponse,
} from '@/services/api';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/dialog/Modal';
import StatusBadge from '@/components/ui/StatusBadge';
import { FieldLabel, TextInput } from '@/components/ui/FormField';
import { useToast } from '@/components/ui/Toast';

/**
 * Upload → judge → commit, in one dialog.
 *
 * The middle step is the point. A payroll officer who uploads 174 rows and is
 * told "3 errors" has learned nothing; the only useful answer names the row, in
 * the numbering Excel shows them, says what is wrong in their words, and says
 * what to type instead. Every error below therefore renders as Error Name /
 * Details / Ways to Fix, and carries the suggested value where the server
 * could compute one.
 *
 * Nothing here recomputes anything. The amplification, the residual and the
 * suggested maximum are all the server's figures, rendered as returned.
 */

interface ImportOverridesModalProps {
  isOpen: boolean;
  month?: string;
  onClose: () => void;
  onCommitted: () => void;
}

export default function ImportOverridesModal({ isOpen, month, onClose, onCommitted }: ImportOverridesModalProps) {
  const toast = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [defaultReason, setDefaultReason] = useState('');
  const [defaultEffectiveFrom, setDefaultEffectiveFrom] = useState('');
  const [result, setResult] = useState<ImportValidateResponse | null>(null);
  const [skipErrors, setSkipErrors] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setFile(null);
    setDefaultReason('');
    setDefaultEffectiveFrom('');
    setResult(null);
    setSkipErrors(false);
    setError(null);
    onClose();
  };

  const download = async (fetcher: () => Promise<{ data: Blob }>, filename: string) => {
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
    } catch (err) {
      toast.show({ kind: 'error', message: getApiErrorMessage(err) });
    }
  };

  const validate = async () => {
    if (!file) return;
    setIsBusy(true);
    setError(null);

    const form = new FormData();
    form.append('file', file);
    if (defaultReason.trim()) form.append('default_reason', defaultReason.trim());
    if (defaultEffectiveFrom) form.append('default_effective_from', defaultEffectiveFrom);
    if (month) form.append('month', month);

    try {
      const response = await payrollApi.overrides.validateImport(form);
      setResult(response.data);
    } catch (err) {
      // A file-level failure (F001–F005) is a 422 and stops everything — it is
      // the whole file that is wrong, not a row of it.
      setError(getApiErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  const commit = async () => {
    if (!result) return;
    setIsBusy(true);
    setError(null);

    try {
      const response = await payrollApi.overrides.commitImport({
        batch_id: result.batch_id,
        skip_errors: skipErrors,
      });

      toast.show({
        kind: 'success',
        message: `${response.data.created} override(s) raised from the file. They apply once approved.`,
      });
      onCommitted();
      reset();
    } catch (err) {
      setError(getApiErrorMessage(err));
    } finally {
      setIsBusy(false);
    }
  };

  const canCommit = result !== null && result.summary.will_change > 0 && (result.summary.errors === 0 || skipErrors);

  return (
    <Modal open={isOpen} onClose={reset} title="Import salary component overrides" size="3xl">
      <div className="space-y-4">
        {result === null ? (
          <>
            <p className="text-sm text-slate-500">
              Export the current view, type the new figures into the{' '}
              <strong>basic_annual</strong> and <strong>hra_annual</strong> columns in Excel, and
              upload it back. Blank means leave that component alone; a literal 0 means zero and is
              a real change.
            </p>
            {/*
              Called out because the format invites the opposite. The figure an
              officer wants to change sits in the read-only _current column and
              the writable one beside it is empty, so editing the number they
              can see is the natural move — and it used to be discarded in
              silence.
            */}
            <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              Type into the <strong>blank</strong> columns, not the ones ending{' '}
              <strong>_current</strong>. The <code>_current</code> columns show what is in force
              today and are ignored on import — an edit made there will be reported back to you, not
              applied.
            </p>

            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Download className="h-4 w-4" />}
                onClick={() => void download(
                  () => payrollApi.overrides.downloadTemplate() as any,
                  'component-overrides-template.csv',
                )}
              >
                Download template
              </Button>
              <Button
                variant="secondary"
                size="sm"
                iconLeft={<Download className="h-4 w-4" />}
                onClick={() => void download(
                  () => payrollApi.overrides.exportCsv({ month }) as any,
                  `component-overrides-${month ?? 'current'}.csv`,
                )}
              >
                Export current view
              </Button>
            </div>

            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-blue-400 hover:bg-blue-50/40">
              <FileUp className="h-6 w-6 text-slate-500" />
              <span className="text-sm font-medium text-slate-700">
                {file ? file.name : 'Choose a .csv file'}
              </span>
              <span className="text-xs text-slate-500">Up to 5 MB and 5,000 rows</span>
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel hint="Used for any row that leaves effective_from blank">
                  Default effective from
                </FieldLabel>
                <TextInput
                  type="date"
                  value={defaultEffectiveFrom}
                  onChange={(event) => setDefaultEffectiveFrom(event.target.value)}
                />
              </div>
              <div>
                <FieldLabel hint="Used for any row that leaves reason blank">Default reason</FieldLabel>
                <TextInput
                  value={defaultReason}
                  placeholder="e.g. Annual revision FY 2026-27"
                  onChange={(event) => setDefaultReason(event.target.value)}
                />
              </div>
            </div>

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
            )}

            <div className="flex justify-end gap-2 border-t border-slate-200 pt-4">
              <Button variant="secondary" onClick={reset}>Cancel</Button>
              <Button disabled={!file} loading={isBusy} onClick={() => void validate()}>
                Check file
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <StatusBadge tone="neutral">{result.summary.rows_read} rows read</StatusBadge>
              <StatusBadge tone="success">{result.summary.will_change} will change</StatusBadge>
              <StatusBadge tone="info">{result.summary.no_change} unchanged</StatusBadge>
              <StatusBadge tone={result.summary.errors > 0 ? 'danger' : 'neutral'}>
                {result.summary.errors} errors
              </StatusBadge>
            </div>

            {result.errors.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-slate-900">Rows that cannot be applied</p>
                {result.errors.map((row) => (
                  <div
                    key={`${row.row}-${row.code}`}
                    className="rounded-lg border border-rose-200 bg-rose-50 p-3"
                    data-testid="import-error"
                  >
                    <div className="flex items-start gap-2">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-rose-900">
                          Row {row.spreadsheet_row} · {row.employee_number} — {row.name}
                          <span className="ml-1.5 font-normal text-rose-600">({row.code})</span>
                        </p>
                        <p className="mt-1 text-sm text-rose-800">{row.details}</p>
                        <p className="mt-1 text-sm text-rose-700">
                          <span className="font-medium">Ways to fix: </span>{row.fix}
                        </p>
                        {row.suggested_value !== undefined && (
                          <p className="mt-1 text-xs text-rose-700">
                            Suggested value: ₹{row.suggested_value.toLocaleString('en-IN')}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {result.valid.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Row</th>
                      <th scope="col" className="px-3 py-2 font-medium">Employee</th>
                      <th scope="col" className="px-3 py-2 font-medium">Change</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Residual after</th>
                      <th scope="col" className="px-3 py-2 text-right font-medium">Each ₹1 of basic costs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {result.valid.map((row) => (
                      <tr key={row.row}>
                        <td className="px-3 py-2 text-slate-500">{row.spreadsheet_row}</td>
                        <td className="px-3 py-2 text-slate-800">
                          {row.employee_name}
                          <span className="block text-xs text-slate-500">{row.employee_number}</span>
                        </td>
                        <td className="px-3 py-2 text-slate-700">
                          {row.changes.map((change) => (
                            <span key={change.target} className="block">
                              {change.target}: ₹{change.from.toLocaleString('en-IN')} → ₹{change.to.toLocaleString('en-IN')}
                            </span>
                          ))}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                          ₹{row.residual_after.toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-700">₹{row.amplification}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result.summary.errors > 0 && (
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300 text-blue-600"
                  checked={skipErrors}
                  onChange={(event) => setSkipErrors(event.target.checked)}
                />
                Skip the {result.summary.errors} error row{result.summary.errors === 1 ? '' : 's'} and apply the rest
              </label>
            )}

            {error && (
              <p className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{error}</p>
            )}

            <div className="flex justify-between gap-2 border-t border-slate-200 pt-4">
              <Button variant="ghost" onClick={() => setResult(null)}>Choose a different file</Button>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={reset}>Cancel</Button>
                <Button
                  disabled={!canCommit}
                  loading={isBusy}
                  iconLeft={<CheckCircle2 className="h-4 w-4" />}
                  onClick={() => void commit()}
                >
                  Apply {result.summary.will_change} change{result.summary.will_change === 1 ? '' : 's'}
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
