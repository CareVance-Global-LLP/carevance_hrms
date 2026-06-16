import { useState } from 'react';
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
      />

      <div className="p-6">
        {viewMode === 'dashboard' && (
          <PayrollDashboard
            onSelectDepartment={handleSelectDepartment}
            onSelectEmployee={handleSelectEmployee}
            onOpenRunPayroll={handleOpenRunPayroll}
            onOpenDepartmentTemplates={handleOpenDepartmentTemplates}
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
