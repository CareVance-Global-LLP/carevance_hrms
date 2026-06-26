import { useEffect, useState, useCallback, useMemo } from 'react';
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
import ProcessAndPayModal from '@/components/payroll/ProcessAndPayModal';
import PayGroupModal from '@/components/payroll/PayGroupModal';
import PayGroupEmployees from '@/components/payroll/PayGroupEmployees';
import BulkPayrollMatrix from '@/components/payroll/BulkPayrollMatrix';

import EmployeePayrollCards from '@/pages/payroll/EmployeePayrollCards';
import PayGroupSettings from '@/pages/payroll/PayGroupSettings';
import type { PayrollOrganizationSettings } from '@/types';
import type { PayrollStats } from '@/types';

type ViewMode = 'dashboard' | 'department' | 'employee' | 'dept-templates' | 'filings' | 'pay-group' | 'bulk-payroll' | 'employee-cards' | 'pay-group-settings';

const VALID_VIEWS: ReadonlySet<ViewMode> = new Set([
  'dashboard', 'department', 'employee', 'dept-templates', 'filings', 'pay-group', 'bulk-payroll',
  'employee-cards', 'pay-group-settings',
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
  *   /payroll?view=pay-group&payGroup=5                → Pay Group employees
  *   /payroll?view=bulk-payroll&payGroup=5            → Bulk Payroll Matrix (6-step wizard per employee)
  *
  * The wizard reads `step` directly via its own useSearchParams; the parent
  * only needs to round-trip it (it's not read here). View + dept + emp +
  * payGroup are the parent's responsibility.
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
  const selectedPayGroupId = useMemo(
    () => parseId(searchParams.get('payGroup')),
    [searchParams],
  );

  const [selectedMonth, setSelectedMonthRaw] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('payroll-selected-month');
      if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const [bulkSelectedEmployeeIds, setBulkSelectedEmployeeIds] = useState<number[]>([]);

  // Wrapper that mirrors the value into localStorage so navigating
  // away (e.g. clicking Reports) and returning keeps the same month
  // selected.
  const setSelectedMonth = useCallback((month: string) => {
    setSelectedMonthRaw(month);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('payroll-selected-month', month);
      }
    } catch { /* non-fatal — private mode or quota */ }
  }, []);

  // ---------------------------------------------------------------------------
  // Resume wizard position across cross-route navigations
  // ---------------------------------------------------------------------------
  // When the user is in the middle of the wizard (e.g. step 3 of 6 for
  // employee 4 in department 2) and clicks a sidebar link like "Setup
  // Wizard" (which navigates to /payroll/setup, a *different* route),
  // this component unmounts. The URL params are lost. When the user
  // clicks "Payroll Dashboard" again, this component re-mounts on a
  // bare /payroll URL — `viewMode` resolves to 'dashboard' and the
  // dashboard main page is shown instead of the wizard.
  //
  // We solve this by saving the wizard position to localStorage on
  // every change, and restoring it on mount when the user lands on a
  // bare /payroll with no query params.
  //
  // The `handleBackToDashboard` action explicitly clears the saved
  // position so the user is in control of "going to the dashboard
  // means I want a fresh start."
  const WIZARD_POS_KEY = 'payroll-wizard-pos';
  const WIZARD_POS_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
  // 6 steps in the current wizard (0..5). The wizard itself also
  // clamps to 5 in parseStep, but we re-clamp here defensively.
  const WIZARD_STEP_MAX = 5;

  // Save the position on every change. We only save wizard-related views
  // (employee, department, pay-group, bulk-payroll). Standalone views like
  // dept-templates / employee-cards must NOT be persisted — they are
  // selected explicitly from the dashboard and restoring them on mount would
  // incorrectly override a deliberate "go to dashboard" navigation.
  const WIZARD_VIEWS = new Set(['employee', 'department', 'pay-group', 'bulk-payroll']);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!WIZARD_VIEWS.has(viewMode)) {
        // Non-wizard view — clear any stale saved position so it doesn't
        // interfere later.
        window.localStorage.removeItem(WIZARD_POS_KEY);
        return;
      }
      window.localStorage.setItem(
        WIZARD_POS_KEY,
        JSON.stringify({
          view: viewMode,
          dept: selectedDepartmentId,
          emp: selectedEmployeeId,
          payGroup: selectedPayGroupId,
          step: currentStep,
          savedAt: Date.now(),
        }),
      );
    } catch { /* non-fatal */ }
  }, [viewMode, selectedDepartmentId, selectedEmployeeId, currentStep]);

  // Restore the position on mount *only* when the user lands on a
  // bare /payroll URL with no query params AND the saved position is a
  // wizard-related view. If the saved view is a standalone view (e.g.
  // dept-templates, employee-cards), we clear localStorage and let the
  // dashboard show — the user selected that view explicitly from the
  // dashboard and shouldn't be yanked back into it on next visit.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hasParam = searchParams.has('view') || searchParams.has('emp');
    if (hasParam) return;
    let saved: any = null;
    try {
      const raw = window.localStorage.getItem(WIZARD_POS_KEY);
      if (raw) saved = JSON.parse(raw);
    } catch { /* ignore corrupt JSON */ }
    if (!saved) return;
    // 24-hour expiry on the saved position.
    if (typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > WIZARD_POS_MAX_AGE_MS) {
      try { window.localStorage.removeItem(WIZARD_POS_KEY); } catch { /* ignore */ }
      return;
    }
    // Only restore wizard-related views.
    const view = saved.view;
    const RESTORABLE_VIEWS = new Set(['employee', 'department', 'pay-group', 'bulk-payroll']);
    if (!view || !RESTORABLE_VIEWS.has(view)) {
      try { window.localStorage.removeItem(WIZARD_POS_KEY); } catch { /* ignore */ }
      return;
    }
    // Validate the shape before restoring.
    const emp = Number(saved.emp);
    const hasValidEmp = Number.isFinite(emp) && emp > 0;
    // Pay-group view needs a valid payGroup id but no employee.
    const payGroup = Number(saved.payGroup);
    const hasValidPayGroup = Number.isFinite(payGroup) && payGroup > 0;
    const needsPayGroup = view === 'pay-group' || view === 'bulk-payroll';
    const needsEmp = view === 'employee' || view === 'department';
    if ((needsEmp && !hasValidEmp) || (needsPayGroup && !hasValidPayGroup)) {
      try { window.localStorage.removeItem(WIZARD_POS_KEY); } catch { /* ignore */ }
      return;
    }
    const dept = Number(saved.dept);
    const step = Math.max(0, Math.min(WIZARD_STEP_MAX, Math.trunc(Number(saved.step ?? 0))));
    updateParams({
      view,
      dept: Number.isFinite(dept) && dept > 0 ? dept : null,
      emp: needsEmp ? emp : null,
      payGroup: needsPayGroup ? payGroup : null,
      step: step === 0 ? null : step,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Modal states (transient, not part of the deep-linkable flow)
  const [isRunPayrollModalOpen, setIsRunPayrollModalOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCreatePayGroupOpen, setIsCreatePayGroupOpen] = useState(false);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);
  const [currentStats, setCurrentStats] = useState<PayrollStats | undefined>();
  const [departmentsList, setDepartmentsList] = useState<any[]>([]);

  // Process & Pay modal state (the new perfect flow)
  const [processAndPayState, setProcessAndPayState] = useState<{
    isOpen: boolean;
    monthYear: string;
    pendingCount: number;
    expectedNetPay: number;
  }>({ isOpen: false, monthYear: '', pendingCount: 0, expectedNetPay: 0 });

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

  const handleSelectPayGroup = (payGroupId: number) => {
    updateParams({ view: 'pay-group', payGroup: payGroupId, emp: null, step: null });
  };

  const handleOpenBulkPayroll = (payGroupId: number, selectedIds: number[]) => {
    setBulkSelectedEmployeeIds(selectedIds);
    updateParams({ view: 'bulk-payroll', payGroup: payGroupId, emp: null, step: null });
  };

  const handleBackToDashboard = () => {
    // Clear the saved wizard position — clicking the dashboard "back"
    // button is an explicit signal that the user wants a fresh start
    // next time they land on /payroll. Without this, the next
    // cross-route navigation (e.g. into /payroll/setup) followed by
    // a return would re-resume into the wizard they just left.
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(WIZARD_POS_KEY);
      }
    } catch { /* non-fatal */ }
    updateParams({ view: null, dept: null, emp: null, payGroup: null, step: null });
  };

  const handleBackToDepartment = () => {
    updateParams({ view: 'department', emp: null, step: null });
  };

  const handleBackToPayGroup = () => {
    // Keep `payGroup` so the URL stays ?view=pay-group&payGroup=N. The
    // wizard's onBack is wired to this handler when the user came from
    // a pay group; stripping the payGroup id would drop the user back to
    // the dashboard and lose the pay-group context.
    updateParams({ view: 'pay-group', emp: null, step: null });
  };

  const handleOpenRunPayroll = (stats: PayrollStats, departments: any[]) => {
    setCurrentStats(stats);
    setDepartmentsList(departments);
    setIsRunPayrollModalOpen(true);
  };

  const handleOpenProcessAndPay = (monthYear: string, pendingCount: number, expectedNetPay: number) => {
    setProcessAndPayState({ isOpen: true, monthYear, pendingCount, expectedNetPay });
  };

  const handleProcessAndPayComplete = () => {
    setProcessAndPayState((s) => ({ ...s, isOpen: false }));
    // Run detail modal will pick up the new run via existing invalidation
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

  const handleOpenEmployeeCards = () => {
    updateParams({ view: 'employee-cards' });
  };

  const handleOpenPayGroupSettings = (payGroupId: number) => {
    updateParams({ view: 'pay-group-settings', payGroup: payGroupId });
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
            onOpenProcessAndPay={handleOpenProcessAndPay}
            onOpenDepartmentTemplates={handleOpenDepartmentTemplates}
            onOpenEmployeeCards={handleOpenEmployeeCards}
            onOpenFilings={handleOpenFilings}
            onOpenWizard={handleOpenWizard}
            onOpenRunDetail={handleOpenRunDetail}
            onOpenCreatePayGroup={() => setIsCreatePayGroupOpen(true)}
            onSelectPayGroup={handleSelectPayGroup}
          />
        )}

        {viewMode === 'dept-templates' && (
          <DepartmentTemplates onBack={handleBackToDashboard} />
        )}

        {viewMode === 'pay-group' && (
          <PayGroupEmployees
            payGroupId={selectedPayGroupId}
            monthYear={selectedMonth}
            onBack={handleBackToDashboard}
            onSelectEmployee={handleSelectEmployee}
            onOpenBulkPayroll={(selectedIds) => handleOpenBulkPayroll(selectedPayGroupId, selectedIds)}
            onOpenPayGroupSettings={handleOpenPayGroupSettings}
          />
        )}

        {viewMode === 'bulk-payroll' && (
          <BulkPayrollMatrix
            payGroupId={selectedPayGroupId}
            monthYear={selectedMonth}
            onBack={handleBackToPayGroup}
            selectedEmployeeIds={bulkSelectedEmployeeIds}
          />
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
            // If the user came from a pay group, send them back to
            // the pay-group employees view. Otherwise, send them back
            // to the department employees view.
            onBack={selectedPayGroupId ? handleBackToPayGroup : handleBackToDepartment}
            backLabel={selectedPayGroupId ? 'Back to Pay Group' : undefined}
            // The wizard fires onComplete on every step transition
            // (1-6). We only navigate away when the user actually
            // processes payroll (step 6).
            onComplete={(step) => {
              if (step === 6) {
                updateParams({ view: 'department', emp: null, step: null });
              }
            }}
            onViewRun={handleOpenRunDetail}
          />
        )}

        {viewMode === 'filings' && (
          <FilingsDashboard onBack={handleBackToDashboard} />
        )}

        {viewMode === 'employee-cards' && (
          <EmployeePayrollCards onBack={handleBackToDashboard} />
        )}

        {viewMode === 'pay-group-settings' && (
          <PayGroupSettings
            onBack={(target) => target === 'dashboard' ? handleBackToDashboard() : handleBackToPayGroup()}
            payGroupId={selectedPayGroupId || undefined}
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

      <PayrollRunDetailModal
        isOpen={runDetailId !== null}
        onClose={() => setRunDetailId(null)}
        runId={runDetailId}
        monthYear={selectedMonth}
      />

      {/* Process & Pay modal — the new perfect flow */}
      <ProcessAndPayModal
        isOpen={processAndPayState.isOpen}
        onClose={() => setProcessAndPayState((s) => ({ ...s, isOpen: false }))}
        monthYear={processAndPayState.monthYear}
        pendingCount={processAndPayState.pendingCount}
        expectedNetPay={processAndPayState.expectedNetPay}
        onComplete={handleProcessAndPayComplete}
      />

      {/* Create Pay Group modal */}
      <PayGroupModal
        isOpen={isCreatePayGroupOpen}
        onClose={() => setIsCreatePayGroupOpen(false)}
        monthYear={selectedMonth}
        onCreated={() => {
          setIsCreatePayGroupOpen(false);
        }}
      />

      {/* Help drawer with glossary, how-to guides, and FAQs */}
      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}
