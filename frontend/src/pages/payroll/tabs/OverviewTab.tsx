import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import PayrollDashboard from '@/components/payroll/PayrollDashboard';
import PayrollRunDetailModal from '@/components/payroll/PayrollRunDetailModal';
import PayGroupModal from '@/components/payroll/PayGroupModal';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { payrollApi } from '@/services/api';
import { cn } from '@/utils/cn';

function useSelectedMonth() {
  const [selectedMonth, setSelectedMonthRaw] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      const saved = window.localStorage.getItem('payroll-selected-month');
      if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
    }
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });

  const setSelectedMonth = useCallback((month: string) => {
    setSelectedMonthRaw(month);
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('payroll-selected-month', month);
      }
    } catch {
      /* non-fatal */
    }
  }, []);

  return [selectedMonth, setSelectedMonth] as const;
}

export default function OverviewTab() {
  const navigate = useNavigate();
  const [selectedMonth, setSelectedMonth] = useSelectedMonth();

  const [runDetailId, setRunDetailId] = useState<number | null>(null);
  const [isCreatePayGroupOpen, setIsCreatePayGroupOpen] = useState(false);

  const { data: unassigned } = useQuery({
    queryKey: ['payroll', 'unassigned-employees'],
    queryFn: payrollApi.getUnassignedEmployees,
  });

  const unassignedCount = unassigned?.data?.employees?.length ?? 0;

  const handleOpenRunDetail = (runId: number) => setRunDetailId(runId);

  const openRunTab = (step?: string) => {
    const params = step ? `?step=${step}` : '';
    navigate(`/payroll/run${params}`);
  };

  const actionStrip = useMemo(() => {
    if (unassignedCount === 0) return null;
    return (
      <SurfaceCard className="mb-4 flex flex-col gap-3 border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
          <div>
            <p className="text-sm font-medium text-amber-900">
              {unassignedCount} employee{unassignedCount === 1 ? '' : 's'} not assigned to a pay group
            </p>
            <p className="text-xs text-amber-700">
              Assign them before running payroll to avoid missing payments.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => openRunTab('assign')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600"
        >
          Assign employees
          <ArrowRight className="h-4 w-4" />
        </button>
      </SurfaceCard>
    );
  }, [unassignedCount]);

  return (
    <div className={cn('space-y-4')}>
      {actionStrip}

      <PayrollDashboard
        selectedMonth={selectedMonth}
        onMonthChange={setSelectedMonth}
        onSelectEmployee={(employeeId) => navigate(`/payroll/run?step=assign&emp=${employeeId}`)}
        onOpenProcessAndPay={() => openRunTab('process')}
        onOpenEmployeeCards={() => navigate('/payroll/employee-pay?type=employee-cards')}
        onOpenFilings={() => navigate('/payroll/reports?panel=filings')}
        onOpenWizard={() => openRunTab('assign')}
        onOpenRunDetail={handleOpenRunDetail}
        onOpenCreatePayGroup={() => setIsCreatePayGroupOpen(true)}
        onSelectPayGroup={(payGroupId) => navigate(`/payroll/run?step=assign&payGroup=${payGroupId}`)}
        onOpenReports={() => navigate('/payroll/reports?panel=register')}
        onOpenDepartmentTemplates={() => navigate('/payroll/employee-pay?type=dept-templates')}
        onOpenUnassignedEmployees={() => openRunTab('assign')}
        onOpenSalaryComponents={() => navigate('/payroll/employee-pay?type=salary-components')}
      />

      <PayrollRunDetailModal
        isOpen={runDetailId !== null}
        onClose={() => setRunDetailId(null)}
        runId={runDetailId}
        monthYear={selectedMonth}
      />

      <PayGroupModal
        isOpen={isCreatePayGroupOpen}
        onClose={() => setIsCreatePayGroupOpen(false)}
        monthYear={selectedMonth}
        onCreated={() => setIsCreatePayGroupOpen(false)}
      />
    </div>
  );
}
