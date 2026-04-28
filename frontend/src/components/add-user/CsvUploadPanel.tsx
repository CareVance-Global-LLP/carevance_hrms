import { UploadCloud } from 'lucide-react';
import Button from '@/components/ui/Button';

interface CsvUploadPanelProps {
  file: File | null;
  summary?: { parsedCount: number; successCount: number; errorCount: number } | null;
  errorMessage?: string | null;
  onSelectFile: (file: File | null) => void;
  onDownloadTemplate: () => void;
}

export default function CsvUploadPanel({
  file,
  summary,
  errorMessage,
  onSelectFile,
  onDownloadTemplate,
}: CsvUploadPanelProps) {
  const fileSizeLabel = file ? `${(file.size / 1024 / 1024).toFixed(file.size >= 1024 * 1024 ? 1 : 2)} MB` : null;

  return (
    <div className="space-y-4">
      <label className="block cursor-pointer rounded-lg border border-dashed border-sky-200 bg-[linear-gradient(180deg,rgba(248,250,252,0.92),rgba(239,246,255,0.9))] p-5 transition hover:border-sky-400 hover:bg-sky-50">
        <div className="rounded-lg border border-slate-200 bg-white px-6 py-8 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sky-100 text-sky-700">
            <UploadCloud className="h-7 w-7" />
          </div>
          <p className="mt-4 text-base font-semibold text-slate-950">
            {file ? 'Replace import file' : 'Upload CSV or XLSX'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Expected columns: email, name, role, groups, projects. Role is read directly from the file.
          </p>
          <p className="mt-2 text-xs font-medium uppercase tracking-[0.18em] text-sky-700">
            Supported formats: .csv, .xlsx
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

      {summary ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
          Parsed {summary.parsedCount} row{summary.parsedCount === 1 ? '' : 's'}, added {summary.successCount}, errors {summary.errorCount}.
        </div>
      ) : (
        <p className="text-xs text-slate-500">Large CSV and XLSX uploads are sent in batches. Group names or IDs in the `groups` column apply per row, and groups selected above are added as defaults.</p>
      )}
    </div>
  );
}
