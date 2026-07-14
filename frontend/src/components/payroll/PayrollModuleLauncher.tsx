import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
import {
  Search,
  ArrowRight,
  Users,
  Settings2,
  CreditCard,
  FileText,
  BookOpen,
  UserX,
  LayoutGrid,
  Calculator,
  IndianRupee,
  Receipt,
  ClipboardCheck,
  BarChart3,
  UserMinus,
} from 'lucide-react';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import StatusBadge from '@/components/ui/StatusBadge';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { usePlan } from '@/hooks/usePlan';
import { cn } from '@/utils/cn';

interface PayrollModuleLauncherProps {
  onOpenCreatePayGroup?: () => void;
  onOpenSalaryComponents?: () => void;
  onOpenEmployeeCards?: () => void;
  onOpenFilings?: () => void;
  onOpenDepartmentTemplates?: () => void;
  onOpenUnassignedEmployees?: () => void;
  /** Optional per-module attention counts, keyed by module id. */
  attention?: Record<string, number>;
}

type ModuleEntry = {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  section: string;
  to?: string;
  onClick?: () => void;
  strictAdminOnly?: boolean;
  planFeature?: string;
};

// Category order + labels. Mirrors the `section` values used in
// dashboardNavigation.ts so the launcher stays in sync with the sidebar.
const CATEGORY_ORDER = ['Overview', 'Tax', 'Compensation', 'Compliance', 'Reports & Advanced'] as const;

// Short descriptions for routed modules, keyed by their `to` path. The nav
// config itself carries no descriptions, so we enrich them here (values reused
// from the retired PayrollFeaturesPage).
const ROUTE_DESCRIPTIONS: Record<string, string> = {
  '/tax-declarations': 'Manage employee tax declarations (Form 12BB)',
  '/tax-proofs': 'Review submitted tax proofs and investment declarations',
  '/tax-simulator': 'Compare old vs new regime and project take-home',
  '/salary-revisions': 'Manage salary changes and generate revision letters',
  '/fbp': 'Configure Flexible Benefit Plan components and allocations',
  '/perquisites': 'Manage taxable perquisites for employees',
  '/reimbursements': 'Process employee reimbursement claims',
  '/loans': 'Manage employee loans and salary advances',
  '/pre-payroll-checklist': 'Validate readiness before processing a run',
  '/arrears': 'Manage arrears calculations and back-pay',
  '/leave-encashment': 'Process leave encashment requests',
  '/fnf-settlements': 'Handle full & final settlements for exits',
  '/payroll-reports': 'Generate detailed payroll and statutory reports',
  '/filings': 'Advanced statutory returns — PF, ESI, 24Q, PT, LWF, Form 16',
};

// Routes we never surface in the admin launcher: the ESS "My Payroll" view and
// the dashboard itself (which is the page hosting this launcher).
// Routed modules now live inside the tabbed /payroll shell. Map each to its
// new deep-linkable tab URL (the real, categorised source of truth moved from
// dashboardNavigation into the shell).
const ROUTED_MODULES: ModuleEntry[] = [
  { id: 'tax-declarations', label: 'Tax Declarations', description: 'Manage employee tax declarations (Form 12BB)', icon: FileText, section: 'Tax', to: '/payroll/tax-compliance?panel=declarations' },
  { id: 'tax-proofs', label: 'Tax Proofs Review', description: 'Review submitted tax proofs and investment declarations', icon: FileText, section: 'Tax', to: '/payroll/tax-compliance?panel=proofs', strictAdminOnly: true },
  { id: 'tax-simulator', label: 'Tax Simulator', description: 'Compare old vs new regime and project take-home', icon: Calculator, section: 'Tax', to: '/payroll/tax-compliance?panel=simulator' },
  { id: 'salary-revisions', label: 'Salary Revisions', description: 'Manage salary changes and generate revision letters', icon: FileText, section: 'Compensation', to: '/payroll/employee-pay?type=revisions', strictAdminOnly: true },
  { id: 'fbp', label: 'FBP', description: 'Configure Flexible Benefit Plan components and allocations', icon: IndianRupee, section: 'Compensation', to: '/payroll/employee-pay?type=fbp', strictAdminOnly: true },
  { id: 'perquisites', label: 'Perquisites', description: 'Manage taxable perquisites for employees', icon: IndianRupee, section: 'Compensation', to: '/payroll/employee-pay?type=perquisites', strictAdminOnly: true },
  { id: 'reimbursements', label: 'Reimbursements', description: 'Process employee reimbursement claims', icon: Receipt, section: 'Compensation', to: '/payroll/employee-pay?type=reimbursements' },
  { id: 'loans', label: 'Loans & Advances', description: 'Manage employee loans and salary advances', icon: IndianRupee, section: 'Compensation', to: '/payroll/employee-pay?type=loans' },
  { id: 'pre-payroll-checklist', label: 'Pre-Payroll Checklist', description: 'Validate readiness before processing a run', icon: ClipboardCheck, section: 'Compliance', to: '/payroll/run?step=checklist', strictAdminOnly: true },
  { id: 'arrears', label: 'Arrears', description: 'Manage arrears calculations and back-pay', icon: IndianRupee, section: 'Compliance', to: '/payroll/employee-pay?type=arrears', strictAdminOnly: true },
  { id: 'leave-encashment', label: 'Leave Encashment', description: 'Process leave encashment requests', icon: FileText, section: 'Compliance', to: '/payroll/tax-compliance?panel=leave-encashment', strictAdminOnly: true },
  { id: 'fnf-settlements', label: 'F&F Settlements', description: 'Handle full & final settlements for exits', icon: UserMinus, section: 'Compliance', to: '/payroll/tax-compliance?panel=fnf', strictAdminOnly: true },
  { id: 'payroll-reports', label: 'Payroll Reports', description: 'Generate detailed payroll and statutory reports', icon: BarChart3, section: 'Reports & Advanced', to: '/payroll/reports?panel=register', strictAdminOnly: true },
  { id: 'filings', label: 'Advanced Payroll', description: 'Advanced statutory returns — PF, ESI, 24Q, PT, LWF, Form 16', icon: FileText, section: 'Reports & Advanced', to: '/payroll/reports?panel=filings', strictAdminOnly: true },
];

export default function PayrollModuleLauncher({
  onOpenCreatePayGroup,
  onOpenSalaryComponents,
  onOpenEmployeeCards,
  onOpenFilings,
  onOpenDepartmentTemplates,
  onOpenUnassignedEmployees,
  attention,
}: PayrollModuleLauncherProps) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { hasFeature } = usePlan();
  const isStrictAdmin = hasStrictAdminAccess(user);

  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');

  const modules = useMemo<ModuleEntry[]>(() => {
    // 1. In-page views handled by Payroll.tsx's URL view-mode router. These
    //    have no route in dashboardNavigation, so they are wired via callbacks.
    const inPageModules: ModuleEntry[] = [
      {
        id: 'create-pay-group',
        label: 'Create Pay Group',
        description: 'Group employees for a shared pay schedule',
        icon: Users,
        section: 'Overview',
        onClick: onOpenCreatePayGroup,
      },
      {
        id: 'unassigned-employees',
        label: 'Unassigned Employees',
        description: 'Employees without a department assignment',
        icon: UserX,
        section: 'Overview',
        onClick: onOpenUnassignedEmployees,
      },
      {
        id: 'employee-cards',
        label: 'Employee Payroll Cards',
        description: 'View & manage individual CTC, components and config',
        icon: CreditCard,
        section: 'Compensation',
        onClick: onOpenEmployeeCards,
      },
      {
        id: 'salary-components',
        label: 'Salary Components',
        description: 'Enable earnings, deductions and formula-based components',
        icon: Settings2,
        section: 'Compensation',
        onClick: onOpenSalaryComponents,
      },
      {
        id: 'dept-templates',
        label: 'Salary Templates',
        description: 'Manage salary component templates per department',
        icon: BookOpen,
        section: 'Compensation',
        onClick: onOpenDepartmentTemplates,
      },
      {
        id: 'statutory-filings',
        label: 'Statutory Filings',
        description: 'Generate PF, ESI, Form 16, 24Q, PT and LWF returns',
        icon: FileText,
        section: 'Compliance',
        onClick: onOpenFilings,
      },
    ];

    // 2. Routed modules sourced from the tabbed /payroll shell (the real,
    //    categorised source of truth).
    const routedModules: ModuleEntry[] = ROUTED_MODULES.map((m) => ({
      ...m,
      description: ROUTE_DESCRIPTIONS[m.to] ?? m.description,
    }));

    return [...inPageModules, ...routedModules]
      // Respect plan gating and strict-admin gating from the nav config.
      .filter((m) => (m.planFeature ? hasFeature(m.planFeature) : true))
      .filter((m) => (m.strictAdminOnly ? isStrictAdmin : true))
      .map((m) => ({ ...m, section: m.section }));
  }, [
    onOpenCreatePayGroup,
    onOpenSalaryComponents,
    onOpenEmployeeCards,
    onOpenFilings,
    onOpenDepartmentTemplates,
    onOpenUnassignedEmployees,
    hasFeature,
    isStrictAdmin,
  ]);

  const availableCategories = useMemo(() => {
    const present = new Set(modules.map((m) => m.section));
    return CATEGORY_ORDER.filter((c) => present.has(c));
  }, [modules]);

  const filteredModules = useMemo(() => {
    const q = search.trim().toLowerCase();
    return modules.filter((m) => {
      if (activeCategory !== 'All' && m.section !== activeCategory) return false;
      if (!q) return true;
      return (
        m.label.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q)
      );
    });
  }, [modules, search, activeCategory]);

  // Group filtered modules by category for section-headed rendering.
  const grouped = useMemo(() => {
    const map = new Map<string, ModuleEntry[]>();
    for (const category of CATEGORY_ORDER) {
      const items = filteredModules.filter((m) => m.section === category);
      if (items.length > 0) map.set(category, items);
    }
    return map;
  }, [filteredModules]);

  const handleActivate = (m: ModuleEntry) => {
    if (m.onClick) m.onClick();
    else if (m.to) navigate(m.to);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[rgba(93,150,157,0.1)] text-[#5D969D]">
            <LayoutGrid className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900">All Payroll Modules</h2>
            <p className="text-sm text-slate-500">Search or filter to jump to any module</p>
          </div>
        </div>
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search modules..."
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm text-slate-700 focus:border-[#5D969D] focus:outline-none focus:ring-1 focus:ring-[#5D969D]"
          />
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-2">
        {(['All', ...availableCategories] as string[]).map((category) => {
          const isActive = activeCategory === category;
          return (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={cn(
                'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                isActive
                  ? 'border-[#5D969D] bg-[rgba(93,150,157,0.1)] text-[#5D969D]'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              {category}
            </button>
          );
        })}
      </div>

      {filteredModules.length === 0 ? (
        <SurfaceCard className="p-8 text-center">
          <p className="text-sm text-slate-500">
            No modules match {search ? `"${search}"` : 'the selected filter'}.
          </p>
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="mt-3 text-sm font-medium text-[#5D969D] hover:underline"
            >
              Clear search
            </button>
          )}
        </SurfaceCard>
      ) : (
        <div className="space-y-6">
          {Array.from(grouped.entries()).map(([category, items]) => (
            <div key={category} className="space-y-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {category}
              </h3>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((m) => {
                  const Icon = m.icon;
                  const count = attention?.[m.id];
                  return (
                    <SurfaceCard
                      key={m.id}
                      onClick={() => handleActivate(m)}
                      className="group flex cursor-pointer items-start gap-3 p-4 transition-all hover:border-[#5D969D] hover:shadow-md"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[rgba(93,150,157,0.1)] text-[#5D969D]">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h4 className="truncate font-medium text-slate-900 group-hover:text-[#5D969D]">
                            {m.label}
                          </h4>
                          {count !== undefined && count > 0 && (
                            <StatusBadge tone="warning" className="tracking-normal">
                              {count}
                            </StatusBadge>
                          )}
                        </div>
                        {m.description && (
                          <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">
                            {m.description}
                          </p>
                        )}
                      </div>
                      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-[#5D969D]" />
                    </SurfaceCard>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
