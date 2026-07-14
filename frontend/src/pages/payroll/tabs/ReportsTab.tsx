import { useSearchParams } from 'react-router-dom';
import { BarChart3, Landmark, Building2, FileText } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { cn } from '@/utils/cn';

import PayrollReportsPage from '@/pages/PayrollReportsPage';
import FilingsDashboard from '@/components/payroll/FilingsDashboard';
import BankPayoutDashboard from '@/components/payroll/BankPayoutDashboard';
import ProofDocumentsCenter from '@/components/payroll/ProofDocumentsCenter';

type PanelId = 'register' | 'filings' | 'bank-payout' | 'proof-documents';

interface PanelDef {
  id: PanelId;
  label: string;
  icon: typeof BarChart3;
}

const PANELS: PanelDef[] = [
  { id: 'register', label: 'Payroll Register', icon: BarChart3 },
  { id: 'filings', label: 'Filings', icon: Landmark },
  { id: 'bank-payout', label: 'Bank Payout', icon: Building2 },
  { id: 'proof-documents', label: 'Proof Documents', icon: FileText },
];

const noop = () => {};

export default function ReportsTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);

  const requested = searchParams.get('panel') as PanelId | null;
  const active: PanelId =
    requested && PANELS.some((p) => p.id === requested) ? requested : 'register';

  const selectPanel = (id: PanelId) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('panel', id);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {PANELS.map((p) => {
          const isActive = p.id === active;
          const Icon = p.icon;
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
            </button>
          );
        })}
      </div>

      <div>
        {active === 'register' && <PayrollReportsPage />}
        {active === 'filings' && isStrictAdmin && <FilingsDashboard onBack={noop} />}
        {active === 'bank-payout' && isStrictAdmin && <BankPayoutDashboard />}
        {active === 'proof-documents' && isStrictAdmin && <ProofDocumentsCenter />}
      </div>
    </div>
  );
}
