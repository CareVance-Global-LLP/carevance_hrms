import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import {
  FileText,
  Calculator,
  IndianRupee,
  Receipt,
  UserMinus,
  ClipboardCheck,
  BarChart3,
  Wallet,
  Sparkles,
} from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';

const PayrollFeaturesPage: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');

  // Define all payroll features organized by category
  const payrollFeatures = [
    {
      category: 'Overview',
      features: [
        { name: 'My Payroll', path: '/my-payroll', icon: Wallet, description: 'View your personal payroll information' },
        { name: 'Payroll Dashboard', path: '/payroll', icon: Wallet, description: 'Manage overall payroll operations' },
        // TEMPORARILY DISABLED: Setup Wizard hidden
        // { name: 'Setup Wizard', path: '/payroll/setup', icon: Sparkles, description: 'Configure payroll settings and preferences' },
      ],
    },
    {
      category: 'Tax Management',
      features: [
        { name: 'Tax Declarations', path: '/tax-declarations', icon: FileText, description: 'Manage employee tax declarations' },
        { name: 'Tax Proofs Review', path: '/tax-proofs', icon: FileText, description: 'Review submitted tax proofs' },
        { name: 'Tax Simulator', path: '/tax-simulator', icon: Calculator, description: 'Calculate tax implications and projections' },
      ],
    },
    {
      category: 'Compensation',
      features: [
        { name: 'Salary Revisions', path: '/salary-revisions', icon: FileText, description: 'Manage salary changes and revisions' },
        { name: 'FBP (Fixed Benefit Plan)', path: '/fbp', icon: IndianRupee, description: 'Manage fixed benefit plans' },
        { name: 'Perquisites', path: '/perquisites', icon: IndianRupee, description: 'Manage employee perquisites' },
        { name: 'Reimbursements', path: '/reimbursements', icon: Receipt, description: 'Process employee reimbursements' },
        { name: 'Loans & Advances', path: '/loans', icon: IndianRupee, description: 'Manage employee loans and advances' },
      ],
    },
    {
      category: 'Compliance',
      features: [
        { name: 'Pre-Payroll Checklist', path: '/pre-payroll-checklist', icon: ClipboardCheck, description: 'Ensure compliance before payroll processing' },
        { name: 'Arrears', path: '/arrears', icon: IndianRupee, description: 'Manage arrears calculations and payments' },
        { name: 'Leave Encashment', path: '/leave-encashment', icon: FileText, description: 'Process leave encashment requests' },
        { name: 'F&F Settlements', path: '/fnf-settlements', icon: UserMinus, description: 'Handle full and final settlements' },
      ],
    },
    {
      category: 'Reports & Advanced',
      features: [
        { name: 'Payroll Reports', path: '/payroll-reports', icon: BarChart3, description: 'Generate detailed payroll reports' },
        { name: 'Advanced Payroll', path: '/filings', icon: FileText, description: 'Advanced payroll processing and filings' },
      ],
    },
  ];

  // Filter features based on search term
  const filteredFeatures = payrollFeatures
    .map(category => ({
      ...category,
      features: category.features.filter(feature =>
        feature.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        feature.description.toLowerCase().includes(searchTerm.toLowerCase())
      )
    }))
    .filter(category => category.features.length > 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="All Payroll Features"
        description="Access all payroll-related functionalities in one place"
      />

      <div className="flex flex-col sm:flex-row gap-4 mb-6">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search payroll features..."
            className="w-full rounded-lg border border-slate-200 bg-white px-4 py-2 pl-10 text-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <svg
            className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
      </div>

      <div className="space-y-8">
        {filteredFeatures.map((category) => (
          <div key={category.category}>
            <h2 className="text-xl font-semibold text-slate-900 mb-4">{category.category}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {category.features.map((feature) => (
                <SurfaceCard key={feature.name} className="hover:shadow-md transition-shadow p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <feature.icon className="h-5 w-5 text-slate-600" />
                    <h3 className="font-medium text-slate-900">{feature.name}</h3>
                  </div>
                  <p className="text-sm text-slate-600 mb-4">{feature.description}</p>
                  <Link to={feature.path}>
                    <Button variant="secondary" size="sm">
                      Access Feature
                    </Button>
                  </Link>
                </SurfaceCard>
              ))}
            </div>
          </div>
        ))}

        {filteredFeatures.length === 0 && searchTerm && (
          <div className="text-center py-12">
            <p className="text-slate-600">No payroll features found matching "{searchTerm}"</p>
            <Button variant="secondary" className="mt-4" onClick={() => setSearchTerm('')}>
              Clear search
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default PayrollFeaturesPage;