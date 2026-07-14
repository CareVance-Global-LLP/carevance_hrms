import { useState } from 'react';
import { NavLink, useLocation, Outlet } from 'react-router-dom';
import {
  LayoutDashboard,
  PlayCircle,
  Wallet,
  FileText,
  BarChart3,
  HelpCircle,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { cn } from '@/utils/cn';
import HelpDrawer from '@/components/payroll/HelpDrawer';

export type PayrollTabId =
  | 'overview'
  | 'run'
  | 'employee-pay'
  | 'tax-compliance'
  | 'reports';

export interface PayrollTabDef {
  id: PayrollTabId;
  label: string;
  path: string;
  icon: typeof LayoutDashboard;
  strictAdminOnly?: boolean;
}

export const PAYROLL_TABS: PayrollTabDef[] = [
  { id: 'overview', label: 'Overview', path: '/payroll', icon: LayoutDashboard },
  { id: 'run', label: 'Run Payroll', path: '/payroll/run', icon: PlayCircle, strictAdminOnly: true },
  { id: 'employee-pay', label: 'Employee Pay', path: '/payroll/employee-pay', icon: Wallet },
  { id: 'tax-compliance', label: 'Tax & Compliance', path: '/payroll/tax-compliance', icon: FileText },
  { id: 'reports', label: 'Reports', path: '/payroll/reports', icon: BarChart3, strictAdminOnly: true },
];

function resolveActiveTab(pathname: string): PayrollTabId {
  if (pathname === '/payroll' || pathname === '/payroll/') return 'overview';
  const match = PAYROLL_TABS.find(
    (tab) => tab.path !== '/payroll' && pathname.startsWith(tab.path),
  );
  return match?.id ?? 'overview';
}

export default function PayrollShell() {
  const location = useLocation();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const activeTab = resolveActiveTab(location.pathname);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="border-b border-slate-200 bg-white">
        <div className="flex flex-col gap-3 px-4 pt-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">Payroll</h1>
            <p className="text-sm text-slate-500">
              Run payroll, manage compensation, tax &amp; compliance from one place
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsHelpOpen(true)}
            className="inline-flex items-center gap-2 self-start rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-[#5D969D] sm:self-auto"
            aria-label="Open help"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Help</span>
          </button>
        </div>

        <nav className="mt-3 flex gap-1 overflow-x-auto px-4 sm:px-6" aria-label="Payroll sections">
          {PAYROLL_TABS.map((tab) => {
            const isActive = tab.id === activeTab;
            const Icon = tab.icon;
            const hidden = tab.strictAdminOnly && !isStrictAdmin;
            if (hidden) return null;
            return (
              <NavLink
                key={tab.id}
                to={tab.path}
                end={tab.path === '/payroll'}
                className={cn(
                  'inline-flex shrink-0 items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-[#5D969D] text-[#5D969D]'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800',
                )}
                aria-current={isActive ? 'page' : undefined}
              >
                <Icon className="h-4 w-4" />
                {tab.label}
              </NavLink>
            );
          })}
        </nav>
      </div>

      <div className="p-4 sm:p-6">
        <Outlet />
      </div>

      <HelpDrawer isOpen={isHelpOpen} onClose={() => setIsHelpOpen(false)} />
    </div>
  );
}
