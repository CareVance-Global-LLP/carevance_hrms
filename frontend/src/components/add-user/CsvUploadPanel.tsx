import { UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import type { CsvParseResult } from '@/services/addUser';

interface CsvUploadPanelProps {
  file: File | null;
  preview: CsvParseResult | null;
  isParsing?: boolean;
  isImporting?: boolean;
  summary?: { parsedCount: number; successCount: number; errorCount: number } | null;
  errorMessage?: string | null;
  departmentNameFor: (id: number) => string;
  onSelectFile: (file: File | null) => void;
  onDownloadTemplate: () => void;
  onConfirmImport: () => void;
  onDownloadErrors: () => void;
}

export default function CsvUploadPanel({
  file,
  preview,
  isParsing = false,
  isImporting = false,
  summary,
  errorMessage,
  departmentNameFor,
  onSelectFile,
  onDownloadTemplate,
  onConfirmImport,
  onDownloadErrors,
}: CsvUploadPanelProps) {
  const fileSizeLabel = file ? `${(file.size / 1024 / 1024).toFixed(file.size >= 1024 * 1024 ? 1 : 2)} MB` : null;
  const rowCount = preview?.rows.length ?? 0;
  const errorCount = preview?.errors.length ?? 0;

  return (
    <div className="space-y-4">
      {/*
        The drop target used to carry a hardcoded near-white gradient:
        bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(239,246,255,0.9))].
        theme.css can remap bg-white and the slate scale, but it cannot reach an
        rgba() baked into an arbitrary-value class — so in dark mode this stayed
        white and the panel flashed a bright slab around a dark card. Tokens
        only here.
      */}
      <label className="block cursor-pointer rounded-lg border border-dashed border-border-strong bg-surface-sunken p-5 transition hover:border-sky-400 hover:bg-surface-card">
        <div className="rounded-lg border border-border-strong bg-surface-card px-6 py-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sky-700">
            <UploadCloud className="h-7 w-7" />
          </div>
          <p className="mt-4 text-base font-semibold text-slate-950">
            {file ? 'Replace import file' : 'Choose a CSV or XLSX file'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Columns: email, name, access_role, employee_code, job_title, departments, projects, joining_date, timezone.
            Only email is required. Use access_role for employee, manager or admin.
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-sky-700">
            Nothing is sent until you review the rows below
          </p>
          {file ? (
            <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-left">
              <p className="text-sm font-semibold text-emerald-900">{file.name}</p>
              <p className="mt-1 text-xs text-emerald-700">{fileSizeLabel}</p>
            </div>
          ) : null}
        </div>
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(event) => onSelectFile(event.target.files?.[0] || null)}
        />
      </label>

      <div className="flex flex-wrap gap-3">
        <Button variant="secondary" onClick={onDownloadTemplate}>Download CSV Template</Button>
        {file ? <Button variant="ghost" onClick={() => onSelectFile(null)}>Clear File</Button> : null}
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{errorMessage}</div>
      ) : null}

      {isParsing ? (
        <div className="rounded-lg border border-border-strong bg-surface-sunken px-4 py-3 text-sm text-slate-600">
          Reading {file?.name}…
        </div>
      ) : null}

      {/*
        The preview is the whole point of this panel.
        Choosing a file used to parse and invite in one action, so a wrong
        column mapping in a 200-row sheet was discovered only once 200 people
        had been emailed. Nothing leaves the browser until Send is pressed.
      */}
      {preview && !summary ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-strong bg-surface-card px-4 py-3">
            <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-900">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {rowCount} row{rowCount === 1 ? '' : 's'} ready
            </span>
            {errorCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                <AlertTriangle className="h-4 w-4" />
                {errorCount} row{errorCount === 1 ? '' : 's'} skipped
              </span>
            ) : null}
            <div className="ml-auto flex flex-wrap gap-2">
              {errorCount > 0 ? (
                <Button variant="ghost" onClick={onDownloadErrors}>Download skipped rows</Button>
              ) : null}
              <Button onClick={onConfirmImport} disabled={rowCount === 0 || isImporting}>
                {isImporting
                  ? 'Sending…'
                  : `Send ${rowCount} invite${rowCount === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>

          {errorCount > 0 ? (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
              <ul className="space-y-1 text-sm text-amber-800">
                {preview.errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {rowCount > 0 ? (
            <div className="max-h-80 overflow-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[44rem] border-collapse text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Access</th>
                    <th className="px-3 py-2 font-medium">Emp. code</th>
                    <th className="px-3 py-2 font-medium">Job title</th>
                    <th className="px-3 py-2 font-medium">Departments</th>
                    <th className="px-3 py-2 font-medium">Joining</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.email} className="border-t border-slate-100 text-slate-700">
                      <td className="px-3 py-2">{row.email}</td>
                      <td className="px-3 py-2">{row.name}</td>
                      <td className="px-3 py-2 capitalize">{row.role}</td>
                      <td className="px-3 py-2">{row.employeeCode || <span className="text-slate-500">—</span>}</td>
                      <td className="px-3 py-2">{row.jobTitle || <span className="text-slate-500">—</span>}</td>
                      <td className="px-3 py-2">
                        {row.groupIds.length > 0
                          ? row.groupIds.map(departmentNameFor).join(', ')
                          : <span className="text-slate-500">Defaults</span>}
                      </td>
                      <td className="px-3 py-2">{row.joiningDate || <span className="text-slate-500">On accept</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      {summary ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Parsed {summary.parsedCount} row{summary.parsedCount === 1 ? '' : 's'}, invited {summary.successCount}, errors {summary.errorCount}.
        </div>
      ) : null}

      {!preview && !summary ? (
        <p className="text-xs text-slate-500">
          Large files are sent in batches. Separate multiple departments or projects with | or ;.
          Department names or ids both work.
        </p>
      ) : null}
    </div>
  );
}
