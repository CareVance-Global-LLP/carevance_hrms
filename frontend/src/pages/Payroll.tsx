import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageHeader from '@/components/dashboard/PageHeader';
import PayrollDashboard from '@/components/payroll/PayrollDashboard';
import DepartmentEmployees from '@/components/payroll/DepartmentEmployees';
import DepartmentTemplates from '@/components/payroll/DepartmentTemplates';
import EmployeePayrollWizard from '@/components/payroll/EmployeePayrollWizard';
import RunPayrollModal from '@/components/payroll/RunPayrollModal';
import PayrollReportsModal from '@/components/payroll/PayrollReportsModal';
import PayrollSettingsModal from '@/components/payroll/PayrollSettingsModal';
import type { PayrollOrganizationSettings } from '@/types';
import type { PayrollStats } from '@/types';

type ViewMode = 'dashboard' | 'department' | 'employee' | 'dept-templates';

const VIEW_VALUES: ReadonlySet<ViewMode> = new Set([
  'dashboard',
  'department',
  'employee',
  'dept-templates',
]);

const DEFAULT_VIEW: ViewMode = 'dashboard';

function currentMonthString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function isValidMonth(value: string): boolean {
  return /^\d{4}-\d{2}$/.test(value);
}

function parseInt0(value: string | null): number {
  if (!value) return 0;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : 0;
}

function parseView(value: string | null): ViewMode {
  if (value && (VIEW_VALUES as Set<string>).has(value)) {
    return value as ViewMode;
  }
  return DEFAULT_VIEW;
}

export default function PayrollPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // ---- URL params as the single source of truth (refresh-safe, shareable) ----
  const urlMonth = searchParams.get('month');
  const urlView = parseView(searchParams.get('view'));
  const urlDept = parseInt0(searchParams.get('dept'));
  const urlEmp = parseInt0(searchParams.get('emp'));

  const selectedMonth = useMemo(
    () => (urlMonth && isValidMonth(urlMonth) ? urlMonth : currentMonthString()),
    [urlMonth],
  );
  const viewMode: ViewMode = urlView;
  const selectedDepartmentId = urlDept;
  const selectedEmployeeId = urlEmp;

  // ---- Mutators that update the URL ----
  const updateParams = useCallback(
    (patch: Record<string, string | null>, opts: { replace?: boolean } = {}) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(patch)) {
            if (v === null || v === '') {
              next.delete(k);
            } else {
              next.set(k, v);
            }
          }
          return next;
        },
        { replace: opts.replace ?? false },
      );
    },
    [setSearchParams],
  );

  // setMonth uses replace:true so the browser back button doesn't fill up
  // with one history entry per keystroke of the month input.
  const setMonth = useCallback(
    (month: string) => {
      updateParams({ month: isValidMonth(month) ? month : null }, { replace: true });
    },
    [updateParams],
  );

  const navigate = useCallback(
    (next: {
      view: ViewMode;
      dept?: number | null;
      emp?: number | null;
    }) => {
      const patch: Record<string, string | null> = { view: next.view };
      if (next.dept === null || next.dept === undefined || next.dept === 0) {
        patch.dept = null;
      } else {
        patch.dept = String(next.dept);
      }
      if (next.emp === null || next.emp === undefined || next.emp === 0) {
        patch.emp = null;
      } else {
        patch.emp = String(next.emp);
      }
      updateParams(patch);
    },
    [updateParams],
  );

  const handleSelectDepartment = (departmentId: number) => {
    navigate({ view: 'department', dept: departmentId, emp: null });
  };

  const handleSelectEmployee = (employeeId: number) => {
    navigate({ view: 'employee', dept: selectedDepartmentId, emp: employeeId });
  };

  const handleBackToDashboard = () => {
    navigate({ view: 'dashboard', dept: null, emp: null });
  };

  const handleBackToDepartment = () => {
    navigate({ view: 'department', dept: selectedDepartmentId, emp: null });
  };

  const handleOpenDepartmentTemplates = () => {
    navigate({ view: 'dept-templates', dept: null, emp: null });
  };

  // ---- Modal state (transient, doesn't go in the URL) ----
  const [isRunPayrollModalOpen, setIsRunPayrollModalOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [currentStats, setCurrentStats] = useState<PayrollStats | undefined>();
  const [departmentsList, setDepartmentsList] = useState<any[]>([]);

  const handleOpenRunPayroll = (stats: PayrollStats, departments: any[]) => {
    setCurrentStats(stats);
    setDepartmentsList(departments);
    setIsRunPayrollModalOpen(true);
  };

  const handleOpenReports = (stats?: PayrollStats) => {
    if (stats) setCurrentStats(stats);
    setIsReportsModalOpen(true);
  };

  const handleOpenSettings = () => {
    setIsSettingsModalOpen(true);
  };

  const handlePayrollSuccess = () => {
    setIsRunPayrollModalOpen(false);
    handleBackToDashboard();
  };

  const handleSaveSettings = (settings: PayrollOrganizationSettings) => {
    console.log('Settings saved:', settings);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Payroll"
        description={`Manage employee salaries and compliance · ${selectedMonth}`}
      />

      <div className="p-6">
        {viewMode === 'dashboard' && (
          <PayrollDashboard
            onSelectDepartment={handleSelectDepartment}
            onSelectEmployee={handleSelectEmployee}
            onOpenRunPayroll={handleOpenRunPayroll}
            onOpenDepartmentTemplates={handleOpenDepartmentTemplates}
            selectedMonth={selectedMonth}
            onMonthChange={setMonth}
          />
        )}

        {viewMode === 'dept-templates' && (
          <DepartmentTemplates onBack={handleBackToDashboard} />
        )}

        {viewMode === 'department' && (
          <DepartmentEmployees
            departmentId={selectedDepartmentId}
            monthYear={selectedMonth}
            onBack={handleBackToDashboard}
            onSelectEmployee={handleSelectEmployee}
          />
        )}

        {viewMode === 'employee' && (
          <EmployeePayrollWizard
            employeeId={selectedEmployeeId}
            monthYear={selectedMonth}
            onBack={handleBackToDepartment}
            onComplete={() => navigate({ view: 'department', dept: selectedDepartmentId, emp: null })}
          />
        )}
      </div>

      <RunPayrollModal
        isOpen={isRunPayrollModalOpen}
        onClose={() => setIsRunPayrollModalOpen(false)}
        departments={departmentsList}
        monthYear={selectedMonth}
        onSuccess={handlePayrollSuccess}
      />

      <PayrollReportsModal
        isOpen={isReportsModalOpen}
        onClose={() => setIsReportsModalOpen(false)}
        stats={currentStats}
        monthYear={selectedMonth}
      />

      <PayrollSettingsModal
        isOpen={isSettingsModalOpen}
        onClose={() => setIsSettingsModalOpen(false)}
        onSave={handleSaveSettings}
      />
    </div>
  );
}
