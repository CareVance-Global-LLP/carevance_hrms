import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FileText,
  Calculator,
  ClipboardCheck,
  IndianRupee,
  UserMinus,
  Landmark,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { payrollApi } from '@/services/api';
import PanelChip from '@/components/payroll/PanelChip';

import TaxDeclarationsPage from '@/pages/TaxDeclarationsPage';
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

/*
 * Statutory Filings leads.
 *
 * It was the sixth chip on a tab that opened on Tax Declarations, so the
 * monthly statutory obligation - the thing an administrator is actually here
 * for, and the thing with a deadline attached - was three clicks and a scroll
 * away, behind five screens that matter once a year.
 */
const PANELS: PanelDef[] = [
  { id: 'filings', label: 'Statutory Filings', icon: Landmark, strictAdminOnly: true },
  { id: 'declarations', label: 'Tax Declarations', icon: FileText },
  { id: 'simulator', label: 'Tax Simulator', icon: Calculator },
  { id: 'proofs', label: 'Proofs Review', icon: ClipboardCheck, strictAdminOnly: true },
  { id: 'leave-encashment', label: 'Leave Encashment', icon: IndianRupee, strictAdminOnly: true },
  { id: 'fnf', label: 'F&F Settlements', icon: UserMinus, strictAdminOnly: true },
];


export default function TaxComplianceTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);

  const requested = searchParams.get('panel') as PanelId | null;
  /*
   * An admin lands on Filings; anyone else lands on their own declarations,
   * since Filings is strictAdminOnly and would render an access notice.
   */
  const active: PanelId =
    requested && PANELS.some((p) => p.id === requested)
      ? requested
      : isStrictAdmin
        ? 'filings'
        : 'declarations';

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
        {visiblePanels.map((p) => (
          <PanelChip
            key={p.id}
            label={p.label}
            icon={p.icon}
            isActive={p.id === active}
            isLocked={Boolean(p.strictAdminOnly && !isStrictAdmin)}
            badge={p.id === 'proofs' ? pendingProofs : 0}
            onClick={() => selectPanel(p.id)}
          />
        ))}
      </div>

      <div>
        {active === 'declarations' && (
          <TaxDeclarationsPage onOpenSimulator={() => selectPanel('simulator')} />
        )}
        {active === 'simulator' && <TaxSimulatorPage />}
        {active === 'proofs' && isStrictAdmin && <TaxProofsReviewPage />}
        {active === 'leave-encashment' && isStrictAdmin && <LeaveEncashmentPage />}
        {active === 'fnf' && isStrictAdmin && <FnFSettlementsPage />}
        {active === 'filings' && isStrictAdmin && <FilingsDashboard />}
      </div>
    </div>
  );
}
