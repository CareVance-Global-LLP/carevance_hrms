import { AlertTriangle, CheckCircle2 } from 'lucide-react';

export default function PayrollWarningPanel({
  title = 'Validation checks',
  warnings,
  successMessage = 'Everything required for this workflow is currently configured.',
}: {
  title?: string;
  warnings: string[];
  successMessage?: string;
}) {
  const hasWarnings = warnings.length > 0;

  return (
    <div
      className={`rounded-[24px] border p-4 ${
        hasWarnings
          ? 'border-amber-200 bg-amber-50/85 text-amber-950'
          : 'border-emerald-200 bg-emerald-50/85 text-emerald-950'
      }`}
    >
      <div className="flex items-start gap-3">
        {hasWarnings ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold">{title}</p>
          {hasWarnings ? (
            <div className="mt-2 space-y-1 text-sm">
              {warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </div>
          ) : (
            <p className="mt-2 text-sm">{successMessage}</p>
          )}
        </div>
      </div>
    </div>
  );
}
