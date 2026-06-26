import { useEffect, useState, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { HelpCircle } from 'lucide-react';
import PageHeader from '@/components/dashboard/PageHeader';
import PayrollDashboard from '@/components/payroll/PayrollDashboard';
import EmployeePayrollWizard from '@/components/payroll/EmployeePayrollWizard';
import FilingsDashboard from '@/components/payroll/FilingsDashboard';
import HelpDrawer from '@/components/payroll/HelpDrawer';
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

type ViewMode = 'dashboard' | 'employee' | 'filings' | 'pay-group' | 'bulk-payroll' | 'employee-cards' | 'pay-group-settings';

const VALID_VIEWS: ReadonlySet<ViewMode> = new Set([
  'dashboard', 'employee', 'filings', 'pay-group', 'bulk-payroll',
  'employee-cards', 'pay-group-settings',
]);

/**
 * Helpers for reading/writing the payroll flow's URL state.
 *
 * URL contract:
 *   /payroll                                          → Dashboard
 *   /payroll?view=filings                             → Filings
 *   /payroll?view=employee&emp=12&step=1       → Wizard step 1 (Salary)
 *   /payroll?view=pay-group&payGroup=5                → Pay Group employees
 *   /payroll?view=bulk-payroll&payGroup=5            → Bulk Payroll Matrix (6-step wizard per employee)
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

  const viewMode = useMemo(() => parseView(searchParams.get('view')), [searchParams]);
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
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  });

  const setSelectedMonth = useCallback((m: string) => {
    setSelectedMonthRaw(m);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('payroll-selected-month', m);
    }
  }, []);

  const WIZARD_POS_KEY = 'payroll-wizard-pos';
  const WIZARD_POS_MAX_AGE_MS = 24 * 60 * 60 * 1000;
  const WIZARD_STEP_MAX = 5;

  const WIZARD_VIEWS = new Set(['employee', 'pay-group', 'bulk-payroll']);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (!WIZARD_VIEWS.has(viewMode)) {
        window.localStorage.removeItem(WIZARD_POS_KEY);
        return;
      }
      window.localStorage.setItem(
        WIZARD_POS_KEY,
        JSON.stringify({
          view: viewMode,
          emp: selectedEmployeeId,
          payGroup: selectedPayGroupId,
          step: currentStep,
          savedAt: Date.now(),
        }),
      );
    } catch { /* non-fatal */ }
  }, [viewMode, selectedEmployeeId, currentStep]);

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
    if (typeof saved.savedAt !== 'number' || Date.now() - saved.savedAt > WIZARD_POS_MAX_AGE_MS) {
      try { window.localStorage.removeItem(WIZARD_POS_KEY); } catch { /* ignore */ }
      return;
    }
    const view = saved.view;
    const RESTORABLE_VIEWS = new Set(['employee', 'pay-group', 'bulk-payroll']);
    if (!view || !RESTORABLE_VIEWS.has(view)) {
      try { window.localStorage.removeItem(WIZARD_POS_KEY); } catch { /* ignore */ }
      return;
    }
    const emp = Number(saved.emp);
    const hasValidEmp = Number.isFinite(emp) && emp > 0;
    const payGroup = Number(saved.payGroup);
    const hasValidPayGroup = Number.isFinite(payGroup) && payGroup > 0;
    const needsPayGroup = view === 'pay-group' || view === 'bulk-payroll';
    const needsEmp = view === 'employee';
    if ((needsEmp && !hasValidEmp) || (needsPayGroup && !hasValidPayGroup)) {
      try { window.localStorage.removeItem(WIZARD_POS_KEY); } catch { /* ignore */ }
      return;
    }
    const step = Math.max(0, Math.min(WIZARD_STEP_MAX, Math.trunc(Number(saved.step ?? 0))));
    updateParams({
      view,
      emp: needsEmp ? emp : null,
      payGroup: needsPayGroup ? payGroup : null,
      step: step === 0 ? null : step,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [isCreatePayGroupOpen, setIsCreatePayGroupOpen] = useState(false);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);
  const [currentStats, setCurrentStats] = useState<PayrollStats | undefined>();

  const [processAndPayState, setProcessAndPayState] = useState<{
    isOpen: boolean;
    monthYear: string;
    pendingCount: number;
    expectedNetPay: number;
  }>({ isOpen: false, monthYear: '', pendingCount: 0, expectedNetPay: 0 });

  const [isHelpOpen, setIsHelpOpen] = useState(false);

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

  const handleSelectEmployee = (employeeId: number) => {
    updateParams({ view: 'employee', emp: employeeId, step: 0 });
  };

  const handleSelectPayGroup = (payGroupId: number) => {
    updateParams({ view: 'pay-group', payGroup: payGroupId, emp: null, step: null });
  };

  const handleOpenBulkPayroll = (payGroupId: number) => {
    updateParams({ view: 'bulk-payroll', payGroup: payGroupId, emp: null, step: null });
  };

  const handleBackToDashboard = () => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(WIZARD_POS_KEY);
      }
    } catch { /* non-fatal */ }
    updateParams({ view: null, emp: null, payGroup: null, step: null });
  };

  const handleBackToPayGroup = () => {
    updateParams({ view: 'pay-group', emp: null, step: null });
  };

  const handleOpenProcessAndPay = (monthYear: string, pendingCount: number, expectedNetPay: number) => {
    setProcessAndPayState({ isOpen: true, monthYear, pendingCount, expectedNetPay });
  };

  const handleProcessAndPayComplete = () => {
    setProcessAndPayState((s) => ({ ...s, isOpen: false }));
  };

  const handleOpenReports = (stats?: PayrollStats) => {
    if (stats) setCurrentStats(stats);
    setIsReportsModalOpen(true);
  };

  const handleOpenSettings = () => {
    setIsSettingsModalOpen(true);
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
            onSelectEmployee={handleSelectEmployee}
            onOpenProcessAndPay={handleOpenProcessAndPay}
            onOpenEmployeeCards={handleOpenEmployeeCards}
            onOpenFilings={handleOpenFilings}
            onOpenWizard={handleOpenWizard}
            onOpenRunDetail={handleOpenRunDetail}
            onOpenCreatePayGroup={() => setIsCreatePayGroupOpen(true)}
            onSelectPayGroup={handleSelectPayGroup}
          />
        )}

        {viewMode === 'pay-group' && (
          <PayGroupEmployees
            payGroupId={selectedPayGroupId}
            monthYear={selectedMonth}
            onBack={handleBackToDashboard}
            onSelectEmployee={handleSelectEmployee}
            onOpenBulkPayroll={() => handleOpenBulkPayroll(selectedPayGroupId)}
            onOpenPayGroupSettings={handleOpenPayGroupSettings}
          />
        )}

        {viewMode === 'bulk-payroll' && (
          <BulkPayrollMatrix
            payGroupId={selectedPayGroupId}
            monthYear={selectedMonth}
            onBack={handleBackToPayGroup}
          />
        )}

        {viewMode === 'employee' && (
          <EmployeePayrollWizard
            employeeId={selectedEmployeeId}
            monthYear={selectedMonth}
            initialStep={currentStep}
            onBack={selectedPayGroupId ? handleBackToPayGroup : handleBackToDashboard}
            backLabel={selectedPayGroupId ? 'Back to Pay Group' : 'Back to Dashboard'}
            onComplete={(step) => {
              if (step === 6) {
                updateParams({ view: 'dashboard', emp: null, step: null });
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
          <PayGroupSettings onBack={handleBackToPayGroup} payGroupId={selectedPayGroupId || undefined} />
        )}
      </div>

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

      <ProcessAndPayModal
        isOpen={processAndPayState.isOpen}
        onClose={() => setProcessAndPayState((s) => ({ ...s, isOpen: false }))}
        monthYear={processAndPayState.monthYear}
        pendingCount={processAndPayState.pendingCount}
        expectedNetPay={processAndPayState.expectedNetPay}
        onComplete={handleProcessAndPayComplete}
      />

      <PayGroupModal
        isOpen={isCreatePayGroupOpen}
        onClose={() => setIsCreatePayGroupOpen(false)}
        monthYear={selectedMonth}
        onCreated={() => {
          setIsCreatePayGroupOpen(false);
        }}
      />

      <HelpDrawer
        isOpen={isHelpOpen}
        onClose={() => setIsHelpOpen(false)}
      />
    </div>
  );
}
