import { useState } from 'react';
import { FileText, Landmark, Upload } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import FilingsDashboard from '@/components/payroll/FilingsDashboard';
import BankPayoutDashboard from '@/components/payroll/BankPayoutDashboard';
import ProofDocumentsCenter from '@/components/payroll/ProofDocumentsCenter';

type Tab = 'filings' | 'bank-payout' | 'proofs';

const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
  { key: 'filings', label: 'Statutory Filings', icon: FileText },
  { key: 'bank-payout', label: 'Bank Payout', icon: Landmark },
  { key: 'proofs', label: 'Proof Documents', icon: Upload },
];

export default function Filings() {
  const [activeTab, setActiveTab] = useState<Tab>('filings');

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Advanced Payroll"
        description="Compliance filings, benefits administration, tax planning, reports, and bank integration"
      />
      <div className="p-6">
        <div className="flex gap-1 mb-6 border-b border-slate-200">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'filings' && <FilingsDashboard />}
        {activeTab === 'bank-payout' && <BankPayoutDashboard />}
        {activeTab === 'proofs' && <ProofDocumentsCenter />}
      </div>
    </div>
  );
}
