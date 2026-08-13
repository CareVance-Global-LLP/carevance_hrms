import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, Search, Download, ExternalLink } from 'lucide-react';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput, SelectInput, FieldLabel } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import HowItWorksCard from '@/components/payroll/HowItWorksCard';
import ModuleHeader from '@/components/payroll/ModuleHeader';
import { currentFinancialYear, formatFinancialYear } from '@/lib/payroll/financialYear';
import { titleCase } from '@/utils/payrollStatus';

const STATUS_OPTIONS = ['pending', 'submitted', 'approved', 'rejected'];

/** The current FY and the two before it, in the exact 'YYYY-YY' form the API matches on. */
function recentFinancialYears(): string[] {
  const current = currentFinancialYear();
  const startYear = Number.parseInt(current.slice(0, 4), 10);
  return [0, 1, 2].map((back) => {
    const start = startYear - back;
    return `${start}-${String(start + 1).slice(-2)}`;
  });
}

const formatAmount = (n: number) => (n === 0 ? '—' : `₹${n.toLocaleString('en-IN')}`);

function getItemsBySection(row: any, section: string): number {
  return (row.items ?? [])
    .filter((i: any) => i.section === section)
    .reduce((sum: number, i: any) => sum + Number(i.declared_amount || 0), 0);
}

const isDraft = (d: any) => {
  const status = (d.status ?? '').toLowerCase();
  return status === 'pending' || status === 'draft';
};

export default function TaxDeclarationsPage({ onOpenSimulator }: { onOpenSimulator?: () => void }) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [financialYear, setFinancialYear] = useState(currentFinancialYear());

  const { data: response, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['tax-declarations', financialYear, statusFilter],
    queryFn: () =>
      payrollApi
        .listTaxDeclarations({ financial_year: financialYear, status: statusFilter || undefined })
        .then((r) => r.data),
  });

  const declarations: any[] = Array.isArray(response)
    ? response
    : (response as any)?.declarations ?? [];

  const filtered = declarations.filter((d: any) =>
    (d.user?.name ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  /*
   * These two used to overlap. `totalSubmitted` was declarations.length — the
   * number of rows, so a draft counted as submitted — and `notYetDeclared`
   * was the drafts *within that same array*. One employee sitting on a draft
   * therefore appeared in both tiles at once, reading "1 Declarations
   * Submitted" and "1 Not Yet Declared" simultaneously.
   *
   * They are now disjoint, and named for what they actually measure.
   *
   * Still missing, deliberately: employees who have never opened the form have
   * no row here at all, so they appear in neither tile. Counting them needs
   * the payroll population — employees with an active payroll template — which
   * this endpoint does not return. /payroll/all-employees is not it: that
   * filters by role, not by whether someone is on payroll, and using it would
   * put a fourth wrong headcount on screen. The header caption says so rather
   * than implying full coverage.
   */
  const stillInDraft = declarations.filter(isDraft).length;
  const totalSubmitted = declarations.length - stillInDraft;

  const exportCsv = () => {
    if (!filtered.length) return;
    const headers = ['Employee', 'Pan', 'Regime', 'Total Declared', 'Status'];
    const rows = filtered.map((d: any) => [
      d.user?.name ?? '',
      d.pan_number ?? '',
      d.tax_regime ?? 'old',
      d.total_declared_amount ?? 0,
      d.status ?? '',
    ]);
    const csv = [headers.join(','), ...rows.map((r: any[]) => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-declarations-${financialYear}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Tax Declarations"
        description={`What each employee has declared for ${formatFinancialYear(financialYear)} — investments, HRA and deductions used to compute monthly TDS.`}
      />

      <HowItWorksCard
        whatIsThis="An employee's planned tax-saving investments for the year (80C, 80D, HRA, home loan interest). Payroll uses the declared figures to spread TDS across twelve months instead of deducting it all at year-end."
        whenToUse={[
          'At the start of the financial year — collect declarations before the April run',
          'When an employee switches tax regime (old vs new)',
          'Before proof submission season, to see who has declared but not yet proved',
        ]}
        howItFlows={[
          { step: 1, label: 'Employee declares', desc: 'Enters planned investments and rent from their own portal' },
          { step: 2, label: 'TDS projected', desc: 'Payroll spreads the estimated annual tax across remaining months' },
          { step: 3, label: 'Proofs submitted', desc: 'Employee uploads bills and receipts against each declared item' },
          { step: 4, label: 'Verified', desc: 'Admin approves in Proofs Review; unproved declarations are reversed' },
        ]}
        commonMistakes={[
          'Treating a declaration as proof — an unproved declaration must be reversed before the final quarter',
          'Letting employees declare under the new regime, where most of these deductions do not apply',
          'Forgetting that employees who never opened the form have no row here at all',
        ]}
      />

      <FilterPanel>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <FieldLabel>Financial Year</FieldLabel>
            <SelectInput value={financialYear} onChange={(e) => setFinancialYear(e.target.value)}>
              {recentFinancialYears().map((fy) => (
                <option key={fy} value={fy}>
                  {formatFinancialYear(fy)}
                </option>
              ))}
            </SelectInput>
          </div>
          <div>
            <FieldLabel>Status</FieldLabel>
            <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">All Status</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </SelectInput>
          </div>
          <div className="min-w-[200px] flex-1">
            <FieldLabel>Search</FieldLabel>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <TextInput
                placeholder="Search employee..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Download className="h-4 w-4" />}
            onClick={exportCsv}
            disabled={!filtered.length}
          >
            Export CSV
          </Button>
        </div>
      </FilterPanel>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard label="Declarations Submitted" value={totalSubmitted} accent="emerald" icon={FileText} />
        <MetricCard label="Still in Draft" value={stillInDraft} accent="rose" />
      </div>

      <SurfaceCard className="overflow-hidden">
        {isLoading ? (
          <PageLoadingState label="Loading declarations…" />
        ) : isError ? (
          <PageErrorState
            message={getApiErrorMessage(error, "Couldn't load tax declarations.")}
            onRetry={() => refetch()}
          />
        ) : filtered.length === 0 ? (
          <PageEmptyState
            title={declarations.length === 0 ? 'No declarations found' : 'No matching employees'}
            description={
              declarations.length === 0
                ? `No employee has started a declaration for ${formatFinancialYear(financialYear)} yet.`
                : 'No employee matches your search. Clear the search to see all declarations.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Employee</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">80C</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">80D</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">HRA Claimed</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Total Declared</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-slate-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((row: any) => (
                  <tr key={row.id ?? row.user?.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{row.user?.name || 'Unknown'}</td>
                    <td className="px-4 py-3 text-slate-600">{formatAmount(getItemsBySection(row, '80C'))}</td>
                    <td className="px-4 py-3 text-slate-600">{formatAmount(getItemsBySection(row, '80D'))}</td>
                    <td className="px-4 py-3 text-slate-600">{formatAmount(getItemsBySection(row, 'HRA'))}</td>
                    <td className="px-4 py-3 text-slate-600">{formatAmount(Number(row.total_declared_amount ?? 0))}</td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        tone={
                          (row.status as string)?.toLowerCase() === 'approved'
                            ? 'success'
                            : (row.status as string)?.toLowerCase() === 'rejected'
                              ? 'danger'
                              : 'warning'
                        }
                      >
                        {titleCase(row.status || 'pending')}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SurfaceCard>

      {onOpenSimulator && (
        <SurfaceCard className="p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Tax Simulator — Old vs New Regime Compare</h3>
              <p className="mt-0.5 text-xs text-slate-500">
                Model an employee's liability under both regimes before they commit to one.
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              iconLeft={<ExternalLink className="h-4 w-4" />}
              onClick={onOpenSimulator}
            >
              Open Full Simulator
            </Button>
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}
