import { useState } from 'react';
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

export default function PayrollPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('dashboard');
  const [selectedDepartmentId, setSelectedDepartmentId] = useState<number>(0);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number>(0);
  const [selectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  // Modal states
  const [isRunPayrollModalOpen, setIsRunPayrollModalOpen] = useState(false);
  const [isReportsModalOpen, setIsReportsModalOpen] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [runDetailId, setRunDetailId] = useState<number | null>(null);
  const [currentStats, setCurrentStats] = useState<PayrollStats | undefined>();
  const [departmentsList, setDepartmentsList] = useState<any[]>([]);

  // Help drawer
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  const handleOpenRunDetail = (runId: number) => {
    setRunDetailId(runId);
  };

  const handleSelectDepartment = (departmentId: number) => {
    setSelectedDepartmentId(departmentId);
    setViewMode('department');
  };

  const handleSelectEmployee = (employeeId: number) => {
    setSelectedEmployeeId(employeeId);
    setViewMode('employee');
  };

  const handleBackToDashboard = () => {
    setViewMode('dashboard');
    setSelectedDepartmentId(0);
    setSelectedEmployeeId(0);
  };

  const handleBackToDepartment = () => {
    setViewMode('department');
    setSelectedEmployeeId(0);
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
    setViewMode('dept-templates');
  };

  const handleOpenFilings = () => {
    setViewMode('filings');
  };

  const handleOpenWizard = () => {
    setViewMode('dashboard');
    // The NextStepsCard will show "Start Setup" linking to /payroll/setup
  };

  const handlePayrollSuccess = () => {
    setIsRunPayrollModalOpen(false);
    setViewMode('dashboard');
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
            onBack={handleBackToDepartment}
            onComplete={() => setViewMode('department')}
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
