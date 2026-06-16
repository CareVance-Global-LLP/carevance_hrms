import { useState, useEffect } from 'react';
import PageHeader from '@/components/dashboard/PageHeader';
import PayrollDashboard from '@/components/payroll/PayrollDashboard';
import PayrollCockpit from '@/components/payroll/PayrollCockpit';
import PayrollWizard from '@/components/payroll/PayrollWizard';
import DepartmentEmployees from '@/components/payroll/DepartmentEmployees';
import EmployeePayrollWizard from '@/components/payroll/EmployeePayrollWizard';
import RunPayrollModal from '@/components/payroll/RunPayrollModal';
import QuickPayrollProcess from '@/components/payroll/QuickPayrollProcess';
import PayrollReportsModal from '@/components/payroll/PayrollReportsModal';
import PayrollSettingsModal from '@/components/payroll/PayrollSettingsModal';
import type { PayrollOrganizationSettings } from '@/types';
import type { PayrollStats } from '@/types';
import Button from '@/components/ui/Button';

type ViewMode = 'cockpit' | 'dashboard' | 'department' | 'employee' | 'quick-process' | 'wizard';

export default function PayrollPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('cockpit');
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
  const [currentStats, setCurrentStats] = useState<PayrollStats | undefined>();
  const [departmentsList, setDepartmentsList] = useState<any[]>([]);

  const handleSelectDepartment = (departmentId: number) => {
    setSelectedDepartmentId(departmentId);
    setViewMode('department');
  };

  const handleSelectEmployee = (employeeId: number) => {
    setSelectedEmployeeId(employeeId);
    setViewMode('employee');
  };

  const handleBackToDashboard = () => {
    setViewMode('cockpit');
    setSelectedDepartmentId(0);
    setSelectedEmployeeId(0);
  };

  const handleBackToDepartment = () => {
    setViewMode('department');
    setSelectedEmployeeId(0);
  };

  useEffect(() => {
    const handlePopState = () => {
      if (viewMode === 'employee') {
        handleBackToDepartment();
      } else if (viewMode === 'department') {
        handleBackToDashboard();
      }
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [viewMode]);

  const handleOpenRunPayroll = (stats: PayrollStats, departments: any[]) => {
    setCurrentStats(stats);
    setDepartmentsList(departments);
    setIsRunPayrollModalOpen(true);
  };

  const handleOpenQuickProcess = () => {
    setViewMode('quick-process');
  };

  const handleQuickProcessComplete = () => {
    setViewMode('cockpit');
  };

  const handleCloseQuickProcess = () => {
    setViewMode('cockpit');
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
    setViewMode('cockpit');
  };

  const handleSaveSettings = (settings: PayrollOrganizationSettings) => {
    console.log('Settings saved:', settings);
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <PageHeader
        title="Payroll"
        description="Manage employee salaries and compliance"
      />

      <div className="p-6">
        {viewMode === 'cockpit' && (
          <PayrollCockpit
            monthYear={selectedMonth}
            onStartWizard={() => setViewMode('wizard')}
            onQuickProcess={handleOpenQuickProcess}
            onOpenSettings={handleOpenSettings}
            onOpenReports={() => handleOpenReports()}
            onOpenLegacyDashboard={() => setViewMode('dashboard')}
          />
        )}

        {viewMode === 'wizard' && (
          <PayrollWizard
            monthYear={selectedMonth}
            onComplete={() => setViewMode('cockpit')}
            onBack={() => setViewMode('cockpit')}
          />
        )}

        {viewMode === 'quick-process' && (
          <div className="max-w-3xl mx-auto">
            <div className="mb-4">
              <Button variant="ghost" onClick={handleCloseQuickProcess}>
                ← Back to Dashboard
              </Button>
            </div>
            <QuickPayrollProcess
              monthYear={selectedMonth}
              onComplete={handleQuickProcessComplete}
              onClose={handleCloseQuickProcess}
            />
          </div>
        )}

        {viewMode === 'dashboard' && (
          <PayrollDashboard
            onSelectDepartment={handleSelectDepartment}
            onSelectEmployee={handleSelectEmployee}
            onOpenRunPayroll={handleOpenRunPayroll}
            onOpenQuickProcess={handleOpenQuickProcess}
            onBack={handleBackToDashboard}
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
            onBack={handleBackToDepartment}
            onComplete={() => setViewMode('department')}
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
