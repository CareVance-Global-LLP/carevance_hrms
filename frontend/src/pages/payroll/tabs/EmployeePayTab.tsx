import { useSearchParams } from 'react-router-dom';
import {
  TrendingUp,
  Wallet,
  Gift,
  Receipt,
  IndianRupee,
  History,
  CreditCard,
  LayoutTemplate,
  PieChart,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import PanelChip from '@/components/payroll/PanelChip';

import SalaryRevisionPage from '@/pages/SalaryRevisionPage';
import FBPPage from '@/pages/FBPPage';
import PerquisitesPage from '@/pages/PerquisitesPage';
import ReimbursementsPage from '@/pages/ReimbursementsPage';
import Loans from '@/pages/Loans';
import ArrearsPage from '@/pages/ArrearsPage';
import EmployeePayrollCards from '@/pages/payroll/EmployeePayrollCards';
import SalaryComponentsEditor from '@/components/payroll/SalaryComponentsEditor';
import SalaryBreakdownCards from '@/pages/payroll/SalaryBreakdownCards';

type EmployeePayType =
  | 'revisions'
  | 'fbp'
  | 'perquisites'
  | 'reimbursements'
  | 'loans'
  | 'arrears'
  | 'employee-cards'
  | 'dept-templates'
  | 'salary-breakdown';

interface PayTypeDef {
  id: EmployeePayType;
  label: string;
  icon: typeof TrendingUp;
  strictAdminOnly?: boolean;
}

const PAY_TYPES: PayTypeDef[] = [
  { id: 'revisions', label: 'Salary Revisions', icon: TrendingUp, strictAdminOnly: true },
  { id: 'fbp', label: 'FBP', icon: Wallet, strictAdminOnly: true },
  { id: 'perquisites', label: 'Perquisites', icon: Gift, strictAdminOnly: true },
  { id: 'reimbursements', label: 'Reimbursements', icon: Receipt },
  { id: 'loans', label: 'Loans', icon: IndianRupee },
  { id: 'arrears', label: 'Arrears', icon: History, strictAdminOnly: true },
  { id: 'employee-cards', label: 'Employee Cards', icon: CreditCard, strictAdminOnly: true },
  { id: 'dept-templates', label: 'Salary Templates', icon: LayoutTemplate, strictAdminOnly: true },
  { id: 'salary-breakdown', label: 'Salary Breakdown', icon: PieChart, strictAdminOnly: true },
];

export default function EmployeePayTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);

  const requested = searchParams.get('type') as EmployeePayType | null;
  const active: EmployeePayType =
    requested && PAY_TYPES.some((t) => t.id === requested) ? requested : 'revisions';

  const activeDef = PAY_TYPES.find((t) => t.id === active)!;
  const canView = !activeDef.strictAdminOnly || isStrictAdmin;

  const selectType = (id: EmployeePayType) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('type', id);
        return next;
      },
      { replace: false },
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {PAY_TYPES.filter((t) => !t.strictAdminOnly || isStrictAdmin).map((t) => (
          <PanelChip
            key={t.id}
            label={t.label}
            icon={t.icon}
            isActive={t.id === active}
            onClick={() => selectType(t.id)}
          />
        ))}
      </div>

      {!canView ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
          You don&apos;t have access to this section.
        </div>
      ) : (
        <div>
          {active === 'revisions' && <SalaryRevisionPage />}
          {active === 'fbp' && <FBPPage />}
          {active === 'perquisites' && <PerquisitesPage />}
          {active === 'reimbursements' && <ReimbursementsPage />}
          {active === 'loans' && <Loans />}
          {active === 'arrears' && <ArrearsPage />}
          {active === 'employee-cards' && <EmployeePayrollCards />}
          {active === 'dept-templates' && <SalaryComponentsEditor />}
          {active === 'salary-breakdown' && <SalaryBreakdownCards />}
        </div>
      )}
    </div>
  );
}
