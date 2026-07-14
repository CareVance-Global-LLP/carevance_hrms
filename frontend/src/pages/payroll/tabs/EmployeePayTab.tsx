import { useSearchParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { cn } from '@/utils/cn';

import SalaryRevisionPage from '@/pages/SalaryRevisionPage';
import FBPPage from '@/pages/FBPPage';
import PerquisitesPage from '@/pages/PerquisitesPage';
import ReimbursementsPage from '@/pages/ReimbursementsPage';
import Loans from '@/pages/Loans';
import ArrearsPage from '@/pages/ArrearsPage';
import EmployeePayrollCards from '@/pages/payroll/EmployeePayrollCards';
import SalaryComponents from '@/pages/payroll/SalaryComponents';
import DepartmentTemplates from '@/components/payroll/DepartmentTemplates';

type EmployeePayType =
  | 'revisions'
  | 'fbp'
  | 'perquisites'
  | 'reimbursements'
  | 'loans'
  | 'arrears'
  | 'employee-cards'
  | 'salary-components'
  | 'dept-templates';

interface PayTypeDef {
  id: EmployeePayType;
  label: string;
  strictAdminOnly?: boolean;
}

const PAY_TYPES: PayTypeDef[] = [
  { id: 'revisions', label: 'Revisions', strictAdminOnly: true },
  { id: 'fbp', label: 'FBP', strictAdminOnly: true },
  { id: 'perquisites', label: 'Perquisites', strictAdminOnly: true },
  { id: 'reimbursements', label: 'Reimbursements' },
  { id: 'loans', label: 'Loans' },
  { id: 'arrears', label: 'Arrears', strictAdminOnly: true },
  { id: 'employee-cards', label: 'Employee Cards', strictAdminOnly: true },
  { id: 'salary-components', label: 'Salary Components', strictAdminOnly: true },
  { id: 'dept-templates', label: 'Dept Templates', strictAdminOnly: true },
];

const noop = () => {};

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
      <div className="flex flex-wrap gap-2">
        {PAY_TYPES.filter((t) => !t.strictAdminOnly || isStrictAdmin).map((t) => {
          const isActive = t.id === active;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => selectType(t.id)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-[#5D969D] bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              {t.label}
            </button>
          );
        })}
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
          {active === 'employee-cards' && <EmployeePayrollCards onBack={noop} />}
          {active === 'salary-components' && <SalaryComponents />}
          {active === 'dept-templates' && <DepartmentTemplates onBack={noop} />}
        </div>
      )}
    </div>
  );
}
