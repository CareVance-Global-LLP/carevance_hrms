import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { payrollApi } from '@/services/api';

import ProgressSteps from '@/components/payroll/ProgressSteps';
import PrePayrollChecklistPage from '@/pages/PrePayrollChecklistPage';
import UnassignedEmployees from '@/components/payroll/UnassignedEmployees';
import PayGroupEmployees from '@/components/payroll/PayGroupEmployees';
import BulkPayrollMatrix from '@/components/payroll/BulkPayrollMatrix';
import { ProcessAndPayPanel } from '@/components/payroll/ProcessAndPayModal';
import PayrollRunLifecycleStepper, {
  type RunLifecycleState,
} from '@/components/payroll/PayrollRunLifecycleStepper';
import BankPayoutDashboard from '@/components/payroll/BankPayoutDashboard';

import { SelectInput, FieldLabel } from '@/components/ui/FormField';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

type StepId = 'checklist' | 'assign' | 'process' | 'payout';

const STEPS: { id: StepId; label: string; description: string }[] = [
  { id: 'checklist', label: 'Checklist', description: 'Validate the run' },
  { id: 'assign', label: 'Assign & Review', description: 'Employees & pay groups' },
  { id: 'process', label: 'Process & Pay', description: 'Lock and release' },
  { id: 'payout', label: 'Payout', description: 'Bank transfer' },
];

function currentMonthYear(): string {
  const saved =
    typeof window !== 'undefined' ? window.localStorage.getItem('payroll-selected-month') : null;
  if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function mapRunStatus(status?: string): RunLifecycleState {
  const map: Record<string, RunLifecycleState> = {
    draft: 'draft',
    locked: 'locked',
    approved: 'approved',
    released: 'released',
    disbursed: 'disbursed',
    paid: 'disbursed',
    processed: 'released',
    processing: 'locked',
    not_started: 'draft',
  };
  return map[status ?? ''] ?? 'draft';
}

const noop = () => {};

export default function RunPayrollTab() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const isStrictAdmin = hasStrictAdminAccess(user);
  const queryClient = useQueryClient();

  const requestedStep = searchParams.get('step') as StepId | null;
  const activeStep: StepId =
    requestedStep && STEPS.some((s) => s.id === requestedStep) ? requestedStep : 'checklist';
  const activeIndex = STEPS.findIndex((s) => s.id === activeStep);

  const monthYear = useMemo(() => currentMonthYear(), []);

  const [selectedPayGroupId, setSelectedPayGroupId] = useState<number | null>(() =>
    Number(searchParams.get('payGroup')) || null,
  );
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkIds, setBulkIds] = useState<number[]>([]);

  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  const { data: payGroupsRes } = useQuery({
    queryKey: ['payroll', 'pay-groups-list'],
    queryFn: () => payrollApi.getPayGroups(),
    enabled: isStrictAdmin,
  });
  const payGroups = (payGroupsRes as any)?.data?.pay_groups ?? [];

  const { data: runsRes } = useQuery({
    queryKey: ['payroll-runs'],
    queryFn: () => payrollApi.getPayrollRuns().then((r) => r.data?.runs ?? r.data ?? []),
    enabled: isStrictAdmin,
  });
  const runs = Array.isArray(runsRes) ? runsRes : [];
  const selectedRun = runs.find((r: any) => r.id === selectedRunId) ?? null;

  const goToStep = (index: number) => {
    const step = STEPS[index];
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('step', step.id);
        if (step.id === 'assign' && selectedPayGroupId) next.set('payGroup', String(selectedPayGroupId));
        return next;
      },
      { replace: false },
    );
  };

  if (!isStrictAdmin) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
        Running payroll requires strict admin access.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ProgressSteps steps={STEPS} currentStep={activeIndex} />

      <div className="flex items-center justify-between">
        <Button
          variant="secondary"
          iconLeft={<ArrowLeft className="h-4 w-4" />}
          onClick={() => goToStep(Math.max(0, activeIndex - 1))}
          disabled={activeIndex === 0}
        >
          Back
        </Button>
        <Button
          variant="primary"
          iconRight={<ArrowRight className="h-4 w-4" />}
          onClick={() => goToStep(Math.min(STEPS.length - 1, activeIndex + 1))}
          disabled={activeIndex === STEPS.length - 1}
        >
          Next
        </Button>
      </div>

      <div>
        {activeStep === 'checklist' && (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <PrePayrollChecklistPage />
          </div>
        )}

        {activeStep === 'assign' && (
          <div className="space-y-4">
            <UnassignedEmployees onBack={noop} />

            <SurfaceCard className="p-5">
              <FieldLabel>Select Pay Group</FieldLabel>
              <SelectInput
                value={selectedPayGroupId ?? ''}
                onChange={(e) => {
                  setSelectedPayGroupId(Number(e.target.value) || null);
                  setBulkOpen(false);
                }}
              >
                <option value="">Choose a pay group…</option>
                {payGroups.map((g: any) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </SelectInput>
            </SurfaceCard>

            {selectedPayGroupId ? (
              bulkOpen ? (
                <div className="overflow-hidden">
                  <BulkPayrollMatrix
                    payGroupId={selectedPayGroupId}
                    monthYear={monthYear}
                    onBack={() => setBulkOpen(false)}
                    selectedEmployeeIds={bulkIds}
                  />
                </div>
              ) : (
                <PayGroupEmployees
                  payGroupId={selectedPayGroupId}
                  monthYear={monthYear}
                  onBack={noop}
                  onSelectEmployee={noop}
                  onOpenBulkPayroll={(ids) => {
                    setBulkIds(ids);
                    setBulkOpen(true);
                  }}
                  onOpenPayGroupSettings={noop}
                />
              )
            ) : (
              <SurfaceCard className="p-8 text-center text-sm text-slate-500">
                Select a pay group to review and bulk-edit salaries.
              </SurfaceCard>
            )}
          </div>
        )}

        {activeStep === 'process' && (
          <div className="space-y-4">
            <SurfaceCard className="p-5">
              <FieldLabel>Select Payroll Run</FieldLabel>
              <SelectInput
                value={selectedRunId ?? ''}
                onChange={(e) => setSelectedRunId(Number(e.target.value) || null)}
              >
                <option value="">Choose a run…</option>
                {runs.map((r: any) => (
                  <option key={r.id} value={r.id}>
                    {r.month_year} — {r.status}
                  </option>
                ))}
              </SelectInput>
            </SurfaceCard>

            {selectedRun ? (
              <div className="space-y-4">
                <ProcessAndPayPanel
                  mode="inline"
                  monthYear={selectedRun.month_year ?? monthYear}
                  pendingCount={selectedRun.pending_count ?? selectedRun.pendingCount ?? 0}
                  expectedNetPay={selectedRun.expected_net_pay ?? selectedRun.expectedNetPay ?? 0}
                  onComplete={() => queryClient.invalidateQueries({ queryKey: ['payroll-runs'] })}
                />
                <SurfaceCard className="space-y-3 p-5">
                  <FieldLabel>Run Lifecycle</FieldLabel>
                  <PayrollRunLifecycleStepper currentState={mapRunStatus(selectedRun.status)} />
                </SurfaceCard>
              </div>
            ) : (
              <SurfaceCard className="p-8 text-center text-sm text-slate-500">
                Select a payroll run to process and release.
              </SurfaceCard>
            )}
          </div>
        )}

        {activeStep === 'payout' && <BankPayoutDashboard />}
      </div>
    </div>
  );
}
