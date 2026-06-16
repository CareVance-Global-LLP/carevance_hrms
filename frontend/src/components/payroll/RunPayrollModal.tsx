import { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle, AlertCircle, Building2, Users, DollarSign } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayrollDepartment } from '@/types';

interface RunPayrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  departments: PayrollDepartment[];
  monthYear: string;
  onSuccess: () => void;
}

interface ProcessingStatus {
  status: 'pending' | 'processing' | 'success' | 'error';
  message: string;
  processedCount: number;
  totalCount: number;
  errors: string[];
}

export default function RunPayrollModal({
  isOpen,
  onClose,
  departments,
  monthYear,
  onSuccess
}: RunPayrollModalProps) {
  // ALL useState hooks at the top
  const [selectedDepartments, setSelectedDepartments] = useState<number[]>([]);
  const [useUnifiedEngine, setUseUnifiedEngine] = useState(true);
  const [step, setStep] = useState<'select' | 'processing' | 'complete' | 'error'>('select');
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    status: 'pending',
    message: '',
    processedCount: 0,
    totalCount: 0,
    errors: []
  });

  // ALL useEffect hooks next
  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('select');
      setSelectedDepartments([]);
      setProcessingStatus({
        status: 'pending',
        message: '',
        processedCount: 0,
        totalCount: 0,
        errors: []
      });
    }
  }, [isOpen]);

  // ALL useMutation hooks next
  // Unified engine path: a single /payroll/auto/process-scoped call.
  // Bulk and individual use the same engine, so net pay is identical.
  const unifiedRunMutation = useMutation({
    mutationFn: () => payrollApi.processScoped({
      month_year: monthYear,
      scope: selectedDepartments.length === 0 ? 'all' : 'department',
      department_ids: selectedDepartments.length > 0 ? selectedDepartments : undefined,
    }).then(r => r.data),
    onSuccess: (data) => {
      if (data.success) {
        setProcessingStatus({
          status: 'success',
          message: `Unified engine processed ${data.user_count ?? 'all'} employees.`,
          processedCount: data.user_count ?? 0,
          totalCount: data.user_count ?? 0,
          errors: [],
        });
        setStep('complete');
      } else {
        setProcessingStatus({
          status: 'error',
          message: data.message || 'Payroll run failed',
          processedCount: 0,
          totalCount: 0,
          errors: [data.message || 'Unknown error'],
        });
        setStep('error');
      }
    },
    onError: (err: any) => {
      setStep('error');
      setProcessingStatus({
        status: 'error',
        message: err instanceof Error ? err.message : 'Failed to process payroll',
        processedCount: 0,
        totalCount: 0,
        errors: [err instanceof Error ? err.message : 'Unknown error'],
      });
    },
  });

  // Get employees for each selected department and process payroll
  const runPayrollMutation = useMutation({
    mutationFn: async () => {
      const results = [];
      const errors = [];
      let processedCount = 0;

      // Get total employee count across selected departments
      let totalEmployees = 0;
      for (const deptId of selectedDepartments) {
        const dept = departments.find(d => d.id === deptId);
        if (dept) {
          totalEmployees += dept.employee_count;
        }
      }

      setProcessingStatus(prev => ({
        ...prev,
        totalCount: totalEmployees,
        status: 'processing',
        message: 'Fetching employee data...'
      }));

      // Process each department
      for (const deptId of selectedDepartments) {
        try {
          setProcessingStatus(prev => ({
            ...prev,
            message: `Processing department ${deptId}...`
          }));

          // Get employees in this department
          const response = await payrollApi.getDepartmentEmployees(deptId, {
            month_year: monthYear
          });

          const employees = response.data.employees || [];

          // Process each employee in the department
          for (const employee of employees) {
            try {
              if (!employee.payroll_status.is_processed) {
                // Use annual_ctc from employee template data (returned by getDepartmentEmployees)
                // If not available, fetch it from the details endpoint
                let annualCtc = (employee as any).annual_ctc;

                if (!annualCtc) {
                  // Fallback: fetch employee details to get template with annual_ctc
                  const detailsResponse = await payrollApi.getEmployeePayrollDetails(employee.id, {
                    month_year: monthYear
                  });
                  annualCtc = detailsResponse.data.template.annual_ctc;
                }

                // If still no CTC, skip or use a placeholder (user must set it first)
                if (!annualCtc || annualCtc <= 0) {
                  errors.push(`Skipped ${employee.name}: No annual CTC configured. Set it in the employee's payroll template first.`);
                  continue;
                }

                // Use the new monthly attendance summary (single source of
                // truth). Falls back to the legacy time-tracking fields if
                // the summary endpoint is unavailable for any reason.
                let workingDays: number;
                let daysPresent: number;
                let lopDays: number;
                let overtimeHours: number;
                try {
                  const summaryRes = await payrollApi.getMonthlyAttendanceSummary({
                    user_id: employee.id,
                    month_year: monthYear,
                  });
                  const s = summaryRes.data.summary;
                  workingDays = Math.round(s.working_days);
                  daysPresent = Math.round(s.present_days);
                  lopDays = Math.round(s.lop_days);
                  overtimeHours = Number(s.hours?.overtime_hours ?? 0);
                } catch {
                  const timeTracking = (employee as any).time_tracking || {};
                  workingDays = timeTracking.payroll_attendance_days || 26;
                  daysPresent = timeTracking.payroll_attendance_days || 26;
                  lopDays = 0;
                  overtimeHours = 0;
                }

                await payrollApi.processEmployeePayroll(employee.id, {
                  user_id: employee.id,
                  month_year: monthYear,
                  annual_ctc: annualCtc,
                  working_days: workingDays,
                  days_present: daysPresent,
                  lOP_days: lopDays,
                  overtime_hours: overtimeHours,
                });
              }

              processedCount++;
              setProcessingStatus(prev => ({
                ...prev,
                processedCount,
                message: `Processed ${processedCount} of ${totalEmployees} employees...`
              }));
            } catch (err) {
              errors.push(`Failed to process employee ${employee.name}: ${err instanceof Error ? err.message : 'Unknown error'}`);
            }
          }

          results.push({ departmentId: deptId, success: true });
        } catch (err) {
          errors.push(`Failed to process department ${deptId}: ${err instanceof Error ? err.message : 'Unknown error'}`);
          results.push({ departmentId: deptId, success: false, error: err });
        }
      }

      return { results, errors, processedCount, totalEmployees };
    },
    onSuccess: (data) => {
      if (data.errors.length === 0) {
        setStep('complete');
        setProcessingStatus(prev => ({
          ...prev,
          status: 'success',
          message: `Successfully processed ${data.processedCount} employees`,
          processedCount: data.processedCount,
          errors: data.errors
        }));
        onSuccess();
      } else {
        setStep('error');
        setProcessingStatus(prev => ({
          ...prev,
          status: 'error',
          message: `Completed with ${data.errors.length} errors`,
          processedCount: data.processedCount,
          errors: data.errors
        }));
      }
    },
    onError: (error) => {
      setStep('error');
      setProcessingStatus(prev => ({
        ...prev,
        status: 'error',
        message: error instanceof Error ? error.message : 'Failed to process payroll',
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }));
    }
  });

  // Conditional return AFTER all hooks
  if (!isOpen) {
    return null;
  }

  // Helper functions after hooks
  const toggleDepartment = (deptId: number) => {
    setSelectedDepartments(prev =>
      prev.includes(deptId)
        ? prev.filter(id => id !== deptId)
        : [...prev, deptId]
    );
  };

  const selectAll = () => {
    if (selectedDepartments.length === departments.length) {
      setSelectedDepartments([]);
    } else {
      setSelectedDepartments(departments.map(d => d.id));
    }
  };

  const handleStartPayroll = () => {
    if (useUnifiedEngine) {
      unifiedRunMutation.mutate();
    } else {
      runPayrollMutation.mutate();
    }
  };

  const handleClose = () => {
    if (step === 'complete' || step === 'error') {
      setStep('select');
      setSelectedDepartments([]);
    }
    onClose();
  };

  const totalSelectedNetPay = selectedDepartments.reduce((sum, deptId) => {
    const dept = departments.find(d => d.id === deptId);
    return sum + (dept?.total_net_pay || 0);
  }, 0);

  const totalSelectedEmployees = selectedDepartments.reduce((sum, deptId) => {
    const dept = departments.find(d => d.id === deptId);
    return sum + (dept?.employee_count || 0);
  }, 0);

  // JSX render
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
      <SurfaceCard className="w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Run Payroll</h2>
            <p className="text-sm text-slate-500">Process payroll for {monthYear}</p>
          </div>
          <button onClick={handleClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="h-5 w-5 text-slate-500" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {step === 'select' && (
            <div className="space-y-4">
              {/* Summary Stats */}
              {selectedDepartments.length > 0 && (
                <div className="bg-blue-50 rounded-lg p-4 mb-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs text-blue-600">Selected Employees</p>
                      <p className="text-xl font-bold text-blue-900">{totalSelectedEmployees}</p>
                    </div>
                    <div>
                      <p className="text-xs text-blue-600">Total Net Pay</p>
                      <p className="text-xl font-bold text-blue-900">
                        ₹{totalSelectedNetPay.toLocaleString('en-IN')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  {selectedDepartments.length} of {departments.length} departments selected
                </span>
                <button
                  onClick={selectAll}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  {selectedDepartments.length === departments.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="space-y-2 max-h-80 overflow-y-auto">
                {departments.map((dept) => (
                  <label
                    key={dept.id}
                    className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                      selectedDepartments.includes(dept.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedDepartments.includes(dept.id)}
                      onChange={() => toggleDepartment(dept.id)}
                      className="h-4 w-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-slate-400" />
                        <span className="font-medium text-slate-900">{dept.name}</span>
                      </div>
                      <div className="text-xs text-slate-500 ml-6">
                        <Users className="h-3 w-3 inline mr-1" />
                        {dept.employee_count} employees • {dept.processed_count} processed
                        {dept.paid_count > 0 && ` • ${dept.paid_count} paid`}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-slate-900">
                        ₹{dept.total_net_pay.toLocaleString('en-IN')}
                      </div>
                      <div className="text-xs text-slate-500">Net Pay</div>
                    </div>
                  </label>
                ))}
              </div>

              {/* Engine selector — defaults to unified so bulk and individual produce identical results. */}
              <div className="border-t border-slate-200 pt-4 mt-2">
                <p className="text-xs text-slate-500 mb-2">Processing engine</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${useUnifiedEngine ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input
                      type="radio"
                      name="run-engine"
                      value="unified"
                      checked={useUnifiedEngine}
                      onChange={() => setUseUnifiedEngine(true)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-900">Unified engine <span className="ml-1 text-[10px] uppercase tracking-wide text-emerald-600">Recommended</span></div>
                      <div className="text-xs text-slate-500">Single call to /payroll/auto/process-scoped. Same net pay as processing an individual employee. Reads attendance, leaves, FBP, variable pay in one pass.</div>
                    </div>
                  </label>
                  <label className={`flex items-start gap-2 p-3 rounded-lg border cursor-pointer transition-colors ${!useUnifiedEngine ? 'border-blue-300 bg-blue-50' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input
                      type="radio"
                      name="run-engine"
                      value="loop"
                      checked={!useUnifiedEngine}
                      onChange={() => setUseUnifiedEngine(false)}
                      className="mt-0.5"
                    />
                    <div>
                      <div className="text-sm font-medium text-slate-900">Per-employee loop (legacy)</div>
                      <div className="text-xs text-slate-500">Iterates the existing processEmployeePayroll endpoint. Kept for transitional use; will be deprecated.</div>
                    </div>
                  </label>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <Button variant="secondary" className="flex-1" onClick={handleClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  disabled={selectedDepartments.length === 0 || runPayrollMutation.isPending || unifiedRunMutation.isPending}
                  onClick={handleStartPayroll}
                >
                  {(runPayrollMutation.isPending || unifiedRunMutation.isPending) ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Starting...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <DollarSign className="h-4 w-4" />
                      Start Payroll
                    </span>
                  )}
                </Button>
              </div>
            </div>
          )}

          {step === 'processing' && (
            <div className="text-center py-12">
              <Loader2 className="h-12 w-12 text-blue-600 animate-spin mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Processing Payroll...</h3>
              <p className="text-slate-500 mb-4">
                {processingStatus.message}
              </p>
              <div className="w-64 mx-auto">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 rounded-full transition-all duration-300"
                    style={{
                      width: `${processingStatus.totalCount > 0
                        ? (processingStatus.processedCount / processingStatus.totalCount) * 100
                        : 0}%`
                    }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2 text-center">
                  {processingStatus.processedCount} / {processingStatus.totalCount} employees
                </p>
              </div>
            </div>
          )}

          {step === 'complete' && (
            <div className="text-center py-12">
              <CheckCircle className="h-12 w-12 text-emerald-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Payroll Complete!</h3>
              <p className="text-slate-500 mb-2">
                Successfully processed payroll for {processingStatus.processedCount} employees
              </p>
              <p className="text-sm text-slate-400 mb-6">
                across {selectedDepartments.length} department{selectedDepartments.length !== 1 ? 's' : ''}
              </p>
              <div className="flex justify-center gap-3">
                <Button variant="primary" onClick={handleClose}>
                  Done
                </Button>
              </div>
            </div>
          )}

          {step === 'error' && (
            <div className="text-center py-8">
              <AlertCircle className="h-12 w-12 text-rose-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-slate-900 mb-2">Payroll Completed with Errors</h3>
              <p className="text-slate-500 mb-4">
                Processed {processingStatus.processedCount} of {processingStatus.totalCount} employees
              </p>

              {processingStatus.errors.length > 0 && (
                <div className="text-left bg-rose-50 rounded-lg p-4 mb-4 max-h-40 overflow-y-auto">
                  <p className="text-sm font-medium text-rose-900 mb-2">Errors:</p>
                  <ul className="text-sm text-rose-700 space-y-1">
                    {processingStatus.errors.map((error, idx) => (
                      <li key={idx}>• {error}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="flex justify-center gap-3">
                <Button variant="secondary" onClick={handleClose}>
                  Close
                </Button>
                <Button
                  variant="primary"
                  onClick={() => setStep('select')}
                >
                  Try Again
                </Button>
              </div>
            </div>
          )}
        </div>
      </SurfaceCard>
    </div>
  );
}
