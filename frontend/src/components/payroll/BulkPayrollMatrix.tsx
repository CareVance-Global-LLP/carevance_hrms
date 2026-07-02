import { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Loader2,
  Users,
  CheckSquare,
  Calculator,
  Wallet,
  Receipt,
  FileText,
  DollarSign,
  Play,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import EmployeePayrollWizard from '@/components/payroll/EmployeePayrollWizard';
import { Virtuoso } from 'react-virtuoso';
import { cn } from '@/utils/cn';
import { useToast } from '@/components/ui/Toast';
import { getApiErrorMessage } from '@/services/api';

interface BulkPayrollMatrixProps {
  payGroupId: number;
  monthYear: string;
  onBack: () => void;
  selectedEmployeeIds?: number[]; // empty/undefined = show all (backwards compat)
}

// The 6 wizard steps, in order. The number is the 1-indexed
// user-facing step; the internal currentStep in the wizard is
// step - 1.
const WIZARD_STEPS = [
  { num: 1, label: 'Attendance', short: 'Atten', icon: Calculator },
  { num: 2, label: 'Salary Structure', short: 'Salary', icon: Wallet },
  { num: 3, label: 'Statutory', short: 'Stat', icon: Receipt },
  { num: 4, label: 'Reimbursements', short: 'Reim', icon: DollarSign },
  { num: 5, label: 'Loans & Advances', short: 'Loans', icon: FileText },
  { num: 6, label: 'Preview & Process', short: 'Previ', icon: Play },
] as const;

function formatMonthLabel(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m) return monthYear;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export default function BulkPayrollMatrix({
  payGroupId,
  monthYear,
  onBack,
  selectedEmployeeIds,
}: BulkPayrollMatrixProps) {
  // 1-indexed wizard step (1..6). The wizard's internal currentStep is
  // this minus 1.
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(null);
  const [payGroupName, setPayGroupName] = useState<string>('Pay Group');

  const queryClient = useQueryClient();
  const { show } = useToast();

  // Fetch employees with per-step completion status
  const { data: employeesData, isLoading: isEmployeesLoading } = useQuery({
    queryKey: ['payroll', 'pay-group', payGroupId, 'employees', monthYear],
    queryFn: () =>
      payrollApi
        .getPayGroupEmployees(payGroupId, { month_year: monthYear })
        .then((r) => r.data),
    enabled: payGroupId > 0,
  });

  // Sync the pay group name + initialize currentStep from the server's
  // last-known position (first time we see this user, default to 1).
  useEffect(() => {
    if (employeesData?.pay_group?.name && payGroupName === 'Pay Group') {
      setPayGroupName(employeesData.pay_group.name);
    }
  }, [employeesData, payGroupName]);

  // Derive the full employee list BEFORE the auto-select effect
  // so we can filter when selectedEmployeeIds is provided.
  const allEmployees = employeesData?.employees ?? [];

  // Auto-select the first employee with current_step matching the
  // active step (or the first employee if no step is set).
  // When selectedEmployeeIds is set, prefer employees from that list.
  useEffect(() => {
    if (selectedEmployeeId !== null) return;
    if (allEmployees.length === 0) return;

    // Filter to only selected employees when prop is provided
    const filteredEmployees = selectedEmployeeIds && selectedEmployeeIds.length > 0
      ? allEmployees.filter(e => selectedEmployeeIds.includes(e.id))
      : allEmployees;

    if (filteredEmployees.length === 0) return;

    // Prefer an employee still on current step, then first pending, then first
    const candidate =
      filteredEmployees.find((e) => e.current_step === currentStep && e.payroll_status?.payment_status !== 'paid')
      ?? filteredEmployees.find((e) => e.payroll_status?.payment_status !== 'paid')
      ?? filteredEmployees.find((e) => e.current_step === currentStep)
      ?? filteredEmployees[0];
    setSelectedEmployeeId(candidate.id);
  }, [employeesData, currentStep, selectedEmployeeId, selectedEmployeeIds]);

  // Filter to only selected employees when selectedEmployeeIds is provided
  const employees = useMemo(() => {
    if (!selectedEmployeeIds || selectedEmployeeIds.length === 0) return allEmployees;
    const idSet = new Set(selectedEmployeeIds);
    return allEmployees.filter(e => idSet.has(e.id));
  }, [allEmployees, selectedEmployeeIds]);

  // Mark a single employee's current step as complete. Called when
  // the wizard's onComplete fires (i.e. the user clicked "Continue"
  // past a step).
const completeStepMutation = useMutation({
    mutationFn: ({ userId, step }: { userId: number; step: number }) => {
      return payrollApi.completeStep(payGroupId, { step, user_ids: [userId] });
    },
    onError: (error) => {
      console.log('completeStep mutation error:', error);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({
        queryKey: ['payroll', 'pay-group', payGroupId, 'employees', monthYear],
      });
      queryClient.invalidateQueries({
        queryKey: ['payroll', 'pay-group', payGroupId, 'step-status'],
      });

      // Auto-advance to the next employee who hasn't completed the current step
      const stepKey = `step${vars.step}` as const;
      
      // Create updated employee list with the current step marked as complete for the current user
      const updatedEmployees = employees?.map(e => {
          if (e.id === vars.userId) {
            return {
              ...e,
              steps_completed: {
                ...e.steps_completed,
                [stepKey]: true
              }
            };
          }
          return e;
        }) ?? [];
      
      // Find next employee who hasn't completed this step (using updated data)
      // First, find the index of current employee
      const currentIndex = updatedEmployees.findIndex(e => e.id === vars.userId);
      
      // Look for next employee AFTER the current one in the array
      let nextEmployee = null;
      for (let i = 1; i <= updatedEmployees.length; i++) {
        const checkIndex = (currentIndex + i) % updatedEmployees.length;
        const e = updatedEmployees[checkIndex];
        // Skip current user and find the next one
        if (e.id !== vars.userId) {
          nextEmployee = e;
          break;
        }
      }
      
      if (nextEmployee) {
        setSelectedEmployeeId(nextEmployee.id);
      }
    },
  });

  // Mark the current step complete for every active member in one
  // shot. Used by the "Done All for Step N" button in the footer.
  const completeAllStepsMutation = useMutation({
    mutationFn: (step: number) =>
      payrollApi.completeAllSteps(payGroupId, { step }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ['payroll', 'pay-group', payGroupId, 'employees', monthYear],
      });
      queryClient.invalidateQueries({
        queryKey: ['payroll', 'pay-group', payGroupId, 'step-status'],
      });
    },
  });

  // Step completion calculations for footer
  const stepKey = `step${currentStep}` as const;
  
  // Count steps as completed - count employees who have marked this step complete
  const completedCount = employees?.filter(e => e.steps_completed[stepKey] === true).length ?? 0;
  const totalCount = employees?.length ?? 0;
  const isStepComplete = completedCount === totalCount && totalCount > 0;

  // Process All mutation — actually processes payroll for all employees
  // in the pay group (not just marking step 6 complete).
  const processAllMutation = useMutation({
    mutationFn: () => {
      const userIds = employees?.map((e) => e.id) ?? [];
      return payrollApi.processPayGroupSelectedEmployees(payGroupId, {
        month_year: monthYear,
        user_ids: userIds,
        working_days: 26,
      });
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-group', payGroupId, 'employees', monthYear] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-group', payGroupId, 'step-status'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'runs'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
      const succeeded = (data as any)?.succeeded?.length ?? 0;
      const failed = (data as any)?.failed?.length ?? 0;
      show({
        kind: failed > 0 ? 'warning' : 'success',
        message: `Payroll processed: ${succeeded} succeeded${failed > 0 ? `, ${failed} failed` : ''}`,
      });
    },
    onError: (err: unknown) => {
      show({
        kind: 'error',
        message: getApiErrorMessage(err, 'Failed to process payroll for pay group.'),
      });
    },
  });

  return (
    <div className="flex flex-col h-full -m-6">
      {/* Header */}
      <div className="flex items-center gap-3 p-6 border-b border-slate-200 bg-white">
        <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
          Back to Pay Group
        </Button>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Bulk Payroll: {payGroupName}
          </h1>
          <p className="text-sm text-slate-500">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 mr-2">
              {formatMonthLabel(monthYear)}
            </span>
            {selectedEmployeeIds && selectedEmployeeIds.length > 0
              ? `${employees.length} of ${allEmployees.length} selected`
              : `${employees.length} ${employees.length === 1 ? 'employee' : 'employees'} in group`}
          </p>
        </div>
      </div>

      {/* Step Tabs — gated: can only click steps whose previous step is 100% done */}
      <div className="flex border-b border-slate-200 bg-white px-6">
        {WIZARD_STEPS.map((step) => {
          const isActive = currentStep === step.num;
          const Icon = step.icon;
          const prevStepKey = `step${step.num - 1}` as const;
          // Check if all employees have completed the previous step
          const prevStepDone = step.num === 1 ||
            employees?.every(e => e.steps_completed[prevStepKey] === true);
          const canClick = step.num <= currentStep || prevStepDone;
          return (
            <button
              key={step.num}
              onClick={() => canClick && setCurrentStep(step.num)}
              disabled={!canClick}
              className={cn(
                'flex-1 flex flex-col items-center gap-1 py-3 px-2 text-sm font-medium border-b-2 transition-colors relative',
                isActive
                  ? 'border-emerald-500 text-emerald-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300',
                !canClick && 'opacity-40 cursor-not-allowed',
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'h-6 w-6 rounded-full flex items-center justify-center text-xs font-semibold transition-all',
                    isActive
                      ? 'bg-emerald-500 text-white scale-110 shadow-sm'
                      : 'bg-slate-200 text-slate-600',
                  )}
                >
                  {step.num}
                </span>
                <Icon className="h-4 w-4" />
                <span className="hidden sm:inline font-medium">{step.short}</span>
              </div>
              <span className="text-[10px] sm:text-xs">{step.label}</span>
              
              {/* Progress indicator for non-active steps */}
              {!isActive && prevStepDone && step.num > currentStep && (
                <div className="absolute top-1 right-1">
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Main layout: Left sidebar + Right panel */}
      <div className="flex flex-1 min-h-0">
        {/* Left Sidebar — Employee List */}
        <div className="w-64 border-r border-slate-200 bg-white flex flex-col flex-shrink-0">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
              <Users className="h-4 w-4" />
              Employees
            </h3>
            <p className="text-sm text-slate-700 mt-1">
              {selectedEmployeeIds && selectedEmployeeIds.length > 0
                ? `${employees.length} selected`
                : `${employees.length} in group`}
            </p>
          </div>

          <div className="flex-1">
            {isEmployeesLoading && (
              <div className="flex items-center justify-center p-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading employees…
              </div>
            )}

            {!isEmployeesLoading && employees.length === 0 && (
              <div className="p-6 text-sm text-slate-500 text-center">
                <Users className="h-8 w-8 mx-auto text-slate-300 mb-2" />
                <p>No employees in this pay group</p>
                <p className="text-xs mt-1">Add employees to the pay group to process payroll</p>
              </div>
            )}

            {!isEmployeesLoading && employees.length > 0 && (
              <div className="p-2 h-full">
                <Virtuoso
                  totalCount={employees.length}
itemContent={(index) => {
                      const emp = employees[index];
                     const isSelected = selectedEmployeeId === emp.id;
                     // Show step as done only if:
                     // 1. This is NOT a fresh payroll month (hasAnyProcessedPayroll)
// 2. Employee has marked this step complete
                      // Show checkmark if employee has completed this step (for both fresh payroll and re-runs)
                      const stepDone = emp.steps_completed[stepKey] === true;
                    
                    // Get employee initials
                    const initials = emp.name
                      .split(' ')
                      .map(n => n.charAt(0).toUpperCase())
                      .join('')
                      .substring(0, 2);
                    
                    return (
                      <button
                        key={emp.id}
                        onClick={() => setSelectedEmployeeId(emp.id)}
                        className={cn(
                          'w-full p-3 flex items-center gap-3 text-left rounded-lg transition-all mb-1',
                          isSelected
                            ? 'bg-emerald-50 border border-emerald-200 shadow-sm'
                            : 'hover:bg-slate-50 border border-transparent',
                        )}
                      >
                        <div
                          className={cn(
                            'h-9 w-9 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-semibold transition-all',
                            isSelected
                              ? 'bg-emerald-500 text-white shadow-sm'
                              : 'bg-slate-200 text-slate-600',
                          )}
                        >
                          {initials || emp.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-slate-900 truncate">
                            {emp.name}
                          </p>
                          <p className="text-xs text-slate-500 truncate">
                            {emp.designation || emp.email || 'No designation'}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          {stepDone ? (
                            <div className="h-6 w-6 rounded-full bg-emerald-100 flex items-center justify-center">
                              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            </div>
                          ) : (
                            <div className="h-6 w-6 rounded-full bg-slate-100 flex items-center justify-center">
                              <Circle className="h-3 w-3 text-slate-400" />
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  }}
                  style={{ height: 'calc(100% - 1rem)' }}
                />
              </div>
            )}
          </div>

        </div>

        {/* Right Panel — Wizard Content */}
        <div className="flex-1 overflow-y-auto bg-slate-50 min-w-0">
          {selectedEmployeeId ? (
            <div className="p-6">
              <EmployeePayrollWizard
                   isStepCompleteForAll={isStepComplete}
                // Key on employee only — NOT on currentStep. With
                // controlledStep wired, the wizard's internal step is
                // fully driven by the matrix; remounting on step
                // change would reset all form state and cause a
                // visible flicker between the draft restore.
                key={selectedEmployeeId}
                employeeId={selectedEmployeeId}
                monthYear={monthYear}
                hideStepIndicator={true}
                initialStep={currentStep - 1}
                // Controlled step: 0-indexed, derived from the
                // matrix's 1-indexed currentStep. When the user clicks
                // Continue inside the wizard, onStepChange fires
                // (1-indexed from the wizard's perspective) and we
                // sync the matrix's currentStep. The wizard remounts
                // ONLY when the user clicks a different employee in
                // the sidebar.
                controlledStep={currentStep - 1}
                onStepChange={(step) => setCurrentStep(step + 1)}
                onBack={() => setSelectedEmployeeId(null)}
                backLabel="← Back to List"
                onComplete={() => {
                  // Mark this employee + step as complete. The mutation
                  // onSuccess handler advances the sidebar selection.
                  completeStepMutation.mutate({
                    userId: selectedEmployeeId,
                    step: currentStep,
                  });
                }}
                onViewRun={() => {
                  /* The matrix view is read-only on the run; the
                     full lifecycle is available in the dashboard's
                     RecentRuns section. */
                }}
              />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-slate-400 p-6">
              <div className="text-center">
                <Users className="h-12 w-12 mx-auto mb-3 text-slate-300" />
                <p className="text-sm">Select an employee to start</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer — Progress + Continue */}
      <div className="border-t border-slate-200 p-4 bg-white">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <span>
                Step <strong>{currentStep}</strong> of 6
              </span>
              <span className="text-slate-300">•</span>
              <span>
                {completedCount}/{totalCount} completed
              </span>
              {completeStepMutation.isPending && (
                <span className="text-xs text-slate-400 flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  saving…
                </span>
              )}
              {completeAllStepsMutation.isSuccess && (
                <span className="text-xs text-emerald-600 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" />
                  all done
                </span>
              )}
            </div>
            <div className="w-48 h-2 bg-slate-100 rounded-full mt-1.5">
              <div
                className="h-full bg-emerald-500 rounded-full transition-all"
                style={{ width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%` }}
              />
            </div>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Done All for Step N */}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => completeAllStepsMutation.mutate(currentStep)}
              disabled={completeAllStepsMutation.isPending || isStepComplete}
            >
              {completeAllStepsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <CheckSquare className="h-4 w-4 mr-1" />
              )}
              Done All for Step {currentStep}
            </Button>

            {/* Continue to next step — only when 100% done */}
            {isStepComplete && currentStep < 6 && (
              <Button
                size="sm"
                onClick={() => {
                  const nextStep = currentStep + 1;
                  setCurrentStep(nextStep);
                  const nextStepKey = `step${nextStep}` as const;
                  // Find next employee who hasn't completed the next step
                  const nextEmp = employees?.find(e => !e.steps_completed[nextStepKey]);
                  if (nextEmp) setSelectedEmployeeId(nextEmp.id);
                }}
              >
                Continue to Step {currentStep + 1} →
              </Button>
            )}

            {/* Process All — only on Step 6 when all done */}
            {isStepComplete && currentStep === 6 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => processAllMutation.mutate()}
                disabled={processAllMutation.isPending}
              >
                {processAllMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <Play className="h-4 w-4 mr-1" />
                )}
                Process All Employees
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
