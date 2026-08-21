import { useId, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import { FieldLabel, SelectInput } from '@/components/ui/FormField';
import { PageLoadingState } from '@/components/ui/PageState';
import AccountingExportPanel from './AccountingExportPanel';

/**
 * Pick a payroll run, then read its journal.
 *
 * ONLY RUNS THAT HAVE BEEN APPROVED ARE OFFERED. A draft run's totals are still
 * moving, and posting one into a general ledger produces a journal that has to
 * be reversed by hand once somebody notices — which is a considerably worse
 * afternoon than not finding the run in this list.
 */
export default function AccountingExportPicker() {
  const fieldId = useId();
  const [selected, setSelected] = useState<number | null>(null);

  const runsQuery = useQuery({
    queryKey: ['payroll-runs-for-export'],
    queryFn: async () => (await payrollApi.getPayrollRuns()).data,
  });

  const runs = useMemo(
    () =>
      (runsQuery.data?.runs ?? []).filter((run: any) =>
        ['approved', 'released', 'disbursed'].includes(String(run.status)),
      ),
    [runsQuery.data],
  );

  const activeId = selected ?? runs[0]?.id ?? null;

  if (runsQuery.isLoading) {
    return <PageLoadingState label="Loading runs..." />;
  }

  if (runs.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
        {/* Distinct from "no runs at all": a draft run exists but must not be
            posted, and saying which stops somebody hunting for a bug. */}
        No approved payroll run to export yet. A run has to clear approval before its journal can be posted.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <FieldLabel htmlFor={`${fieldId}-run`}>Payroll run</FieldLabel>
        <SelectInput
          id={`${fieldId}-run`}
          value={String(activeId ?? '')}
          onChange={(event) => setSelected(Number(event.target.value))}
        >
          {runs.map((run: any) => (
            <option key={run.id} value={run.id}>
              {run.month_year} · {run.status}
            </option>
          ))}
        </SelectInput>
      </div>

      {activeId !== null ? <AccountingExportPanel runId={activeId} /> : null}
    </div>
  );
}
