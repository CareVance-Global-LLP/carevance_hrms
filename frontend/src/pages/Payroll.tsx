import { useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import PayrollDashboard from '@/components/payroll/PayrollDashboard';
import DepartmentEmployees from '@/components/payroll/DepartmentEmployees';
import DepartmentTemplates from '@/components/payroll/DepartmentTemplates';
import EmployeePayrollWizard from '@/components/payroll/EmployeePayrollWizard';
import FilingsDashboard from '@/components/payroll/FilingsDashboard';
import HelpDrawer from '@/components/payroll/HelpDrawer';
import RunPayrollModal from '@/components/payroll/RunPayrollModal';
import PayrollReportsModal from '@/components/payroll/PayrollReportsModal';
import PayrollSettingsModal from '@/components/payroll/PayrollSettingsModal';
import PayrollRunDetailModal from '@/components/payroll/PayrollRunDetailModal';
import type { PayrollOrganizationSettings } from '@/types';
import type { PayrollStats } from '@/types';

type ViewMode = 'dashboard' | 'department' | 'employee' | 'dept-templates' | 'filings';

const VALID_VIEWS: ReadonlySet<ViewMode> = new Set([
  'dashboard', 'department', 'employee', 'dept-templates', 'filings',
]);

/**
 * Helpers for reading/writing the payroll flow's URL state.
 *
 * URL contract:
 *   /payroll                                          → Dashboard
 *   /payroll?view=department&dept=5                   → Department employees
 *   /payroll?view=dept-templates                      → Salary templates
 *   /payroll?view=filings                             → Filings
 *   /payroll?view=employee&dept=5&emp=12&step=1       → Wizard step 1 (Salary)
 *
 * The wizard reads `step` directly via its own useSearchParams; the parent
 * only needs to round-trip it (it's not read here). View + dept + emp are
 * the parent's responsibility.
 */
function parseView(raw: string | null): ViewMode {
  if (raw && VALID_VIEWS.has(raw as ViewMode)) return raw as ViewMode;
  return 'dashboard';
}

function parseId(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function parseStep(raw: string | null): number {
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(2, Math.trunc(n)));
}

export default function PayrollPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read the four URL-driven values. Defaults keep the dashboard view stable
  // when the user lands on /payroll with no params.
  const viewMode = useMemo(() => parseView(searchParams.get('view')), [searchParams]);
  const selectedDepartmentId = useMemo(
    () => parseId(searchParams.get('dept')),
    [searchParams],
  );
  const selectedEmployeeId = useMemo(
    () => parseId(searchParams.get('emp')),
    [searchParams],
  );
  const currentStep = useMemo(() => parseStep(searchParams.get('step')), [searchParams]);

  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Modal states (transient, not part of the deep-linkable flow)
  const [isRunPayrollModalOpen, setIsRunPayrollModalOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);
  const [currentStats, setCurrentStats] = useState<PayrollStats | undefined>();
  const [departmentsList, setDepartmentsList] = useState<any[]>([]);

  // Help drawer
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  /**
   * Mutate a single URL param without trampling siblings (so back/forward
   * through the flow continues to work and the user's current step is
   * preserved when they navigate between branches).
   */
  const updateParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [key, value] of Object.entries(updates)) {
            if (value === null || value === '' || value === 0) {
              next.delete(key);
            } else {
              next.set(key, String(value));
            }
          }
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const handleOpenRunDetail = (runId: number) => {
    setRunDetailId(runId);
  };

  const handleSelectDepartment = (departmentId: number) => {
    updateParams({ view: 'department', dept: departmentId, emp: null, step: null });
  };

  const handleSelectEmployee = (employeeId: number) => {
    updateParams({ view: 'employee', emp: employeeId, step: 0 });
  };

  const handleBackToDashboard = () => {
    updateParams({ view: null, dept: null, emp: null, step: null });
  };

  const handleBackToDepartment = () => {
    updateParams({ view: 'department', emp: null, step: null });
  };

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

  const handleOpenDepartmentTemplates = () => {
    updateParams({ view: 'dept-templates' });
  };

  const handleOpenFilings = () => {
    updateParams({ view: 'filings' });
  };

  const handleOpenWizard = () => {
    // The NextStepsCard will show "Start Setup" linking to /payroll/setup
    updateParams({ view: null });
  };

  const handlePayrollSuccess = () => {
    setIsRunPayrollModalOpen(false);
    updateParams({ view: null });
  };

  const handleSaveSettings = (settings: PayrollOrganizationSettings) => {
    console.log('Settings saved:', settings);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Payroll"
        description="Manage employee salaries and compliance"
        actions={
          <button
            onClick={() => setIsHelpOpen(true)}
            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
            aria-label="Open help"
          >
            <HelpCircle className="h-4 w-4" />
            <span className="hidden sm:inline">Help</span>
          </button>
        }
      />

      <div className="p-6">
        {viewMode === 'dashboard' && (
          <PayrollDashboard
            selectedMonth={selectedMonth}
            onMonthChange={setSelectedMonth}
            onSelectDepartment={handleSelectDepartment}
            onSelectEmployee={handleSelectEmployee}
            onOpenRunPayroll={handleOpenRunPayroll}
            onOpenDepartmentTemplates={handleOpenDepartmentTemplates}
            onOpenFilings={handleOpenFilings}
            onOpenWizard={handleOpenWizard}
            onOpenRunDetail={handleOpenRunDetail}
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
            initialStep={currentStep}
            onBack={handleBackToDepartment}
            onComplete={() => updateParams({ view: 'department', emp: null, step: null })}
            onViewRun={handleOpenRunDetail}
          />
        )}

        {viewMode === 'filings' && (
          <FilingsDashboard />
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

      <PayrollRunDetailModal
        isOpen={runDetailId !== null}
        onClose={() => setRunDetailId(null)}
        runId={runDetailId}
        monthYear={selectedMonth}
      />

      {/* Help drawer with glossary, how-to guides, and FAQs */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}
