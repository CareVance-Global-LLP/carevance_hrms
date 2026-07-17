import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { payrollApi } from '@/services/api';

import PayGroupEmployees from '@/components/payroll/PayGroupEmployees';
import BulkPayrollMatrix from '@/components/payroll/BulkPayrollMatrix';
import EmployeePayrollWizard from '@/components/payroll/EmployeePayrollWizard';
import PayGroupCard from '@/components/payroll/PayGroupCard';
import PayGroupModal from '@/components/payroll/PayGroupModal';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

function currentMonthYear(): string {
  const saved =
    typeof window !== 'undefined' ? window.localStorage.getItem('payroll-selected-month') : null;
  if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const noop = () => {};

export default function RunPayrollTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);
  const queryClient = useQueryClient();

  const monthYear = useMemo(() => currentMonthYear(), []);

  const [selectedPayGroupId, setSelectedPayGroupId] = useState<number | null>(() =>
    Number(searchParams.get('payGroup')) || null,
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIds, setBulkIds] = useState<number[]>([]);
  const [processingEmployeeId, setProcessingEmployeeId] = useState<number | null>(null);
  const [isCreatePayGroupOpen, setIsCreatePayGroupOpen] = useState(false);

  useEffect(() => {
    setSelectedPayGroupId(Number(searchParams.get('payGroup')) || null);
  }, [searchParams]);

  const goToPicker = () => {
    setSelectedPayGroupId(null);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete('payGroup');
        next.delete('step');
        return next;
      },
      { replace: false },
    );
  };

  const { data: payGroupsRes } = useQuery({
    queryKey: ['payroll', 'pay-groups-list'],
    queryFn: () => payrollApi.getPayGroups(),
    enabled: isStrictAdmin,
  });
  const payGroups = (payGroupsRes as any)?.data?.pay_groups ?? [];

  if (!isStrictAdmin) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Running payroll requires strict admin access.
      </div>
    );
  }

  // --- Pay group detail (employee management for the chosen pay group) ---
  if (selectedPayGroupId) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={goToPicker}>
            Back to pay groups
          </Button>
        </div>

        {bulkOpen ? (
          <div className="overflow-hidden">
            <BulkPayrollMatrix
              payGroupId={selectedPayGroupId}
              monthYear={monthYear}
              onBack={() => setBulkOpen(false)}
              selectedEmployeeIds={bulkIds}
            />
          </div>
        ) : processingEmployeeId ? (
          <EmployeePayrollWizard
            key={processingEmployeeId}
            employeeId={processingEmployeeId}
            monthYear={monthYear}
            initialStep={0}
            backLabel="Back to Pay Group"
            onBack={() => setProcessingEmployeeId(null)}
            onViewRun={() => {}}
            onComplete={(step) => {
              // handleContinue fires onComplete for EVERY step (1..6). Only
              // the final step means payroll was processed — refresh the
              // pay-group card list so the status flips to Paid/Processed.
              // We deliberately do NOT close the wizard here; the success
              // view stays visible and the Back button (onBack) closes it.
              if (step === 6) {
                queryClient.invalidateQueries({
                  queryKey: ['payroll', 'pay-group', selectedPayGroupId, 'employees', monthYear],
                });
              }
            }}
          />
        ) : (
          <PayGroupEmployees
            payGroupId={selectedPayGroupId}
            monthYear={monthYear}
            onBack={noop}
            onSelectEmployee={(id) => setProcessingEmployeeId(id)}
            onOpenBulkPayroll={(ids) => {
              setBulkIds(ids);
              setBulkOpen(true);
            }}
            onOpenPayGroupSettings={(pgId) => navigate(`/payroll/pay-group-settings/${pgId}`)}
          />
        )}
      </div>
    );
  }

  // --- Pay group picker (landing screen) ---
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Run Payroll</h1>
        <p className="mt-1 text-sm text-slate-500">
          Select a pay group to manage its employees, salaries and run payroll.
        </p>
      </div>

      {payGroups.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {payGroups.map((pg: any) => (
<PayGroupCard
               key={pg.id}
               payGroup={pg}
               onClick={() => navigate(`/payroll/run?payGroup=${pg.id}`)}
               onSettingsClick={() => navigate(`/payroll/pay-group-settings/${pg.id}`)}
             />
          ))}
        </div>
      ) : (
        <SurfaceCard className="p-12 text-center">
          <p className="text-slate-500 font-medium">No pay groups yet</p>
          <p className="text-sm text-slate-400 mt-1">
            Create a pay group and assign employees before running payroll.
          </p>
        </SurfaceCard>
      )}

      <div>
        <Button
          variant="primary"
          iconLeft={<Plus className="h-4 w-4" />}
          onClick={() => setIsCreatePayGroupOpen(true)}
        >
          Create Pay Group
        </Button>
      </div>

      <PayGroupModal
        isOpen={isCreatePayGroupOpen}
        onClose={() => setIsCreatePayGroupOpen(false)}
        monthYear={monthYear}
        onCreated={(payGroupId?: number) => {
          setIsCreatePayGroupOpen(false);
          queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups-list'] });
          if (payGroupId) navigate(`/payroll/run?payGroup=${payGroupId}`);
        }}
      />
    </div>
  );
}
