import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileText, Calculator, ClipboardCheck, IndianRupee, UserMinus, Landmark } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { payrollApi } from '@/services/api';
import { cn } from '@/utils/cn';

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
  { id: 'proofs', label: 'Tax Proofs Review', icon: ClipboardCheck, strictAdminOnly: true },
  { id: 'leave-encashment', label: 'Leave Encashment', icon: IndianRupee, strictAdminOnly: true },
  { id: 'fnf', label: 'F&F Settlements', icon: UserMinus, strictAdminOnly: true },
  { id: 'filings', label: 'Statutory Filings', icon: Landmark, strictAdminOnly: true },
];

const noop = () => {};

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
      <div className="flex flex-wrap gap-2">
        {visiblePanels.map((p) => {
          const isActive = p.id === active;
          const Icon = p.icon;
          const badge = p.id === 'proofs' ? pendingProofs : 0;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => selectPanel(p.id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-[#5D969D] bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {p.label}
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
        {active === 'declarations' && <TaxDeclarationPage />}
        {active === 'simulator' && <TaxSimulatorPage />}
        {active === 'proofs' && isStrictAdmin && <TaxProofsReviewPage />}
        {active === 'leave-encashment' && isStrictAdmin && <LeaveEncashmentPage />}
        {active === 'fnf' && isStrictAdmin && <FnFSettlementsPage />}
        {active === 'filings' && isStrictAdmin && <FilingsDashboard onBack={noop} />}
      </div>
    </div>
  );
}
