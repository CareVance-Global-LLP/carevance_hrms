import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
import { cn } from '@/utils/cn';
import StatusBadge from '@/components/ui/StatusBadge';

import TaxDeclarationPage from '@/pages/TaxDeclaration';
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

const noop = () => {};

const formatAmount = (n: number) =>
  n === 0 ? '—' : `₹${n.toLocaleString('en-IN')}`;

function TaxDeclarationsInline({ onOpenFull }: { onOpenFull: () => void }) {
  const [search, setSearch] = useState('');

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['tax-declarations'],
    queryFn: () => payrollApi.listTaxDeclarations(),
  });

  const declarations: any[] = Array.isArray(response)
    ? response
    : (response as any)?.declarations ?? [];

  const filtered = declarations.filter((d: any) =>
    (d.employee_name ?? '').toLowerCase().includes(search.toLowerCase()),
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

  const totalSubmitted = declarations.length;
  const pendingProofs = declarations.filter((d: any) => (d.proofs_status ?? '').toLowerCase() === 'pending').length;
  const rejected = declarations.filter((d: any) => (d.status ?? '').toLowerCase() === 'rejected').length;
  const verified = declarations.filter((d: any) => (d.status ?? '').toLowerCase() === 'approved').length;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900">
            Tax Declarations
          </h3>
          <p className="mt-0.5 text-xs text-slate-500">
            FY 2025–26 · Submission window: Apr–Jan
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
              className="h-8 w-48 rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#5D969D] focus:outline-none focus:ring-1 focus:ring-[#5D969D]"
            />
          </div>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-lg font-semibold text-slate-900">{totalSubmitted}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Declarations Submitted
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-lg font-semibold text-amber-500">{pendingProofs}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">
            Pending Proof Upload
          </div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-lg font-semibold text-rose-500">{rejected}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Rejected</div>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-3 text-center">
          <div className="text-lg font-semibold text-emerald-500">{verified}</div>
          <div className="mt-0.5 text-[11px] text-slate-500">Verified</div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-3 py-2 font-medium text-slate-500">Employee</th>
              <th className="px-3 py-2 font-medium text-slate-500">Regime</th>
              <th className="px-3 py-2 font-medium text-slate-500">
                80C Declared
              </th>
              <th className="px-3 py-2 font-medium text-slate-500">
                HRA Claimed
              </th>
              <th className="px-3 py-2 font-medium text-slate-500">
                Total Exemption
              </th>
              <th className="px-3 py-2 font-medium text-slate-500">Proofs</th>
              <th className="px-3 py-2 font-medium text-slate-500">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row: any) => (
              <tr
                key={row.id ?? row.employee_name}
                className="border-b border-slate-50 last:border-0"
              >
                <td className="px-3 py-2 font-medium text-slate-900">
                  {row.employee_name}
                </td>
                <td className="px-3 py-2 text-slate-600">{row.regime}</td>
                <td className="px-3 py-2 text-slate-600">
                  {formatAmount(row.declared_80c ?? 0)}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatAmount(row.hra_claimed ?? 0)}
                </td>
                <td className="px-3 py-2 text-slate-600">
                  {formatAmount(row.total_exemption ?? 0)}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge
                    tone={
                      (row.proofs_status as string) === 'Verified'
                        ? 'success'
                        : 'warning'
                    }
                  >
                    {row.proofs_status}
                  </StatusBadge>
                </td>
                <td className="px-3 py-2">
                  <StatusBadge
                    tone={
                      (row.status as string) === 'Approved'
                        ? 'success'
                        : (row.status as string) === 'Rejected'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {row.status}
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
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3.5">
            <div className="text-[11px] font-medium text-amber-700">
              Old Regime
            </div>
            <div className="mt-1.5 text-xl font-bold text-slate-800">
              ₹1,82,400 tax
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Take-home: ₹7.37L/yr
            </div>
          </div>
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3.5">
            <div className="text-[11px] font-medium text-emerald-700">
              New Regime
            </div>
            <div className="mt-1.5 text-xl font-bold text-emerald-600">
              ₹1,56,000 tax
            </div>
            <div className="mt-1 text-[11px] text-slate-500">
              Take-home: ₹7.63L/yr ·{' '}
              <span className="font-semibold text-emerald-600">
                Save ₹26,400
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TaxComplianceTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);

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
                  ? 'border-[#5D969D] bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
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
          <FilingsDashboard onBack={noop} />
        )}
      </div>
    </div>
  );
}
