import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Calculator,
  ClipboardCheck,
  IndianRupee,
  UserMinus,
  Landmark,
  Search,
  Download,
  Lock,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { payrollApi } from '@/services/api';
import { currentFinancialYear, formatFinancialYear } from '@/lib/payroll/financialYear';
import { cn } from '@/utils/cn';
import { titleCase } from '@/utils/payrollStatus';
import StatusBadge from '@/components/ui/StatusBadge';

import TaxSimulatorPage from '@/pages/TaxSimulatorPage';
import TaxProofsReviewPage from '@/pages/TaxProofsReview';
import LeaveEncashmentPage from '@/pages/LeaveEncashmentPage';
import FnFSettlementsPage from '@/pages/FnFSettlementsPage';
import FilingsDashboard from '@/components/payroll/FilingsDashboard';

type PanelId =
  | 'declarations'
  | 'simulator'
  | 'proofs'
  | 'leave-encashment'
  | 'fnf'
  | 'filings';

interface PanelDef {
  id: PanelId;
  label: string;
  icon: typeof FileText;
  strictAdminOnly?: boolean;
}

const PANELS: PanelDef[] = [
  { id: 'declarations', label: 'Tax Declarations', icon: FileText },
  { id: 'simulator', label: 'Tax Simulator', icon: Calculator },
  { id: 'proofs', label: 'Proofs Review', icon: ClipboardCheck, strictAdminOnly: true },
  { id: 'leave-encashment', label: 'Leave Encashment', icon: IndianRupee, strictAdminOnly: true },
  { id: 'fnf', label: 'F&F Settlements', icon: UserMinus, strictAdminOnly: true },
  { id: 'filings', label: 'Statutory Filings', icon: Landmark, strictAdminOnly: true },
];

const formatAmount = (n: number) =>
  n === 0 ? '—' : `₹${n.toLocaleString('en-IN')}`;

function TaxDeclarationsInline({ onOpenFull }: { onOpenFull: () => void }) {
  const [search, setSearch] = useState('');

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['tax-declarations'],
    queryFn: () => payrollApi.listTaxDeclarations().then(r => r.data),
  });

  const declarations: any[] = Array.isArray(response)
    ? response
    : (response as any)?.declarations ?? [];

  const filtered = declarations.filter((d: any) =>
    (d.user?.name ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
        <span className="ml-2 text-sm text-slate-500">Loading declarations…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
        <p className="text-sm font-medium text-rose-700">Failed to load tax declarations.</p>
        <p className="mt-1 text-xs text-rose-500">Please try again later.</p>
      </div>
    );
  }

  if (declarations.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-10 text-center">
        <FileText className="mx-auto h-8 w-8 text-slate-300" />
        <p className="mt-3 text-sm font-medium text-slate-700">No declarations found</p>
        <p className="mt-1 text-xs text-slate-500">There are no tax declarations for this financial year yet.</p>
      </div>
    );
  }

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
   * put a fourth wrong headcount on screen. The caption below says so rather
   * than implying full coverage.
   */
  const isDraft = (d: any) => {
    const status = (d.status ?? '').toLowerCase();
    return status === 'pending' || status === 'draft';
  };

  const stillInDraft = declarations.filter(isDraft).length;
  const totalSubmitted = declarations.length - stillInDraft;

  function getItemsBySection(row: any, section: string): number {
    return (row.items ?? []).filter((i: any) => i.section === section).reduce((sum: number, i: any) => sum + Number(i.declared_amount || 0), 0);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">
            Tax Declarations
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            {formatFinancialYear(currentFinancialYear())} · {declarations.length} employee
            {declarations.length === 1 ? '' : 's'} have started a declaration
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search employee…"
              className="h-8 w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-[#5D969D]"
            />
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
            onClick={() => {
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
              a.download = 'tax-declarations.csv';
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-lg font-semibold text-slate-900">{totalSubmitted}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Declarations Submitted
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-lg font-semibold text-rose-500">{stillInDraft}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Still in draft</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-3 py-2 font-medium text-slate-500">Employee</th>
              <th className="px-3 py-2 font-medium text-slate-500">80C</th>
              <th className="px-3 py-2 font-medium text-slate-500">80D</th>
              <th className="px-3 py-2 font-medium text-slate-500">HRA Claimed</th>
              <th className="px-3 py-2 font-medium text-slate-500">Total Declared</th>
              <th className="px-3 py-2 font-medium text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row: any) => (
              <tr
                key={row.id ?? row.user?.id}
                className="border-b border-slate-50 last:border-0"
              >
                <td className="px-3 py-2 font-medium text-slate-900">
                  {row.user?.name || 'Unknown'}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatAmount(getItemsBySection(row, '80C'))}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatAmount(getItemsBySection(row, '80D'))}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatAmount(getItemsBySection(row, 'HRA'))}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatAmount(row.total_declared_amount ?? 0)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge
                    tone={
                      (row.status as string) === 'Approved' || (row.status as string) === 'approved'
                        ? 'success'
                        : (row.status as string) === 'Rejected' || (row.status as string) === 'rejected'
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

      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 className="text-sm font-semibold text-slate-900">
            Tax Simulator — Old vs New Regime Compare
          </h3>
          <button
            type="button"
            onClick={onOpenFull}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Open Full Simulator
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <div className="text-[11px] font-medium text-slate-500">
              Old Regime
            </div>
            <div className="mt-1.5 text-sm text-slate-600">
              Compute via Tax Simulator →
            </div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3.5">
            <div className="text-[11px] font-medium text-slate-500">
              New Regime
            </div>
            <div className="mt-1.5 text-sm text-slate-600">
              Compute via Tax Simulator →
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TaxComplianceTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);

  const handleBackToPayroll = () => navigate('/payroll');

  const requested = searchParams.get('panel') as PanelId | null;
  const active: PanelId =
    requested && PANELS.some((p) => p.id === requested) ? requested : 'declarations';

  const { data: proofsSummary } = useQuery({
    queryKey: ['tax-proofs-summary'],
    queryFn: () => payrollApi.taxProofsSummary(),
    enabled: isStrictAdmin,
  });

  const pendingProofs = proofsSummary?.data?.by_status?.pending ?? 0;

  const selectPanel = (id: PanelId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('panel', id);
      return next;
    });
  };

  const visiblePanels = PANELS.filter((p) => !p.strictAdminOnly || isStrictAdmin);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {visiblePanels.map((p) => {
          const isActive = p.id === active;
          const Icon = p.icon;
          const badge = p.id === 'proofs' ? pendingProofs : 0;
          const isLocked = p.strictAdminOnly && !isStrictAdmin;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPanel(p.id)}
              disabled={isLocked}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-blue-600 bg-blue-500/10 text-blue-600'
                  : isLocked
                    ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
              {isLocked && <Lock className="h-3 w-3 text-slate-300" />}
              {badge > 0 && (
                <span className="ml-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div>
        {active === 'declarations' && (
          <TaxDeclarationsInline onOpenFull={() => selectPanel('simulator')} />
        )}
        {active === 'simulator' && <TaxSimulatorPage />}
        {active === 'proofs' && isStrictAdmin && <TaxProofsReviewPage />}
        {active === 'leave-encashment' && isStrictAdmin && <LeaveEncashmentPage />}
        {active === 'fnf' && isStrictAdmin && <FnFSettlementsPage />}
        {active === 'filings' && isStrictAdmin && (
          <FilingsDashboard onBack={handleBackToPayroll} />
        )}
      </div>
    </div>
  );
}
