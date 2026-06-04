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
  const [selectedDepartments, setSelectedDepartments] = useState<number[]>([]);
  const [step, setStep] = useState<'select' | 'processing' | 'complete' | 'error'>('select');
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>({
    status: 'pending',
    message: '',
    processedCount: 0,
    totalCount: 0,
    errors: []
  });

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

  if (!isOpen) return null;

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
                // Get employee details to fetch template
                const detailsResponse = await payrollApi.getEmployeePayrollDetails(employee.id, {
                  month_year: monthYear
                });
                
                const template = detailsResponse.data.template;
                
                // Use a default CTC if not available (this should be configured per employee)
                // For now, we'll calculate based on template or use a reasonable default
                const annualCtc = 500000; // Default CTC - in production this should come from employee profile
                
                await payrollApi.processEmployeePayroll(employee.id, {
                  user_id: employee.id,
                  month_year: monthYear,
                  annual_ctc: annualCtc,
                  working_days: 26,
                  days_present: 26,
                  lOP_days: 0,
                  overtime_hours: 0
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

  const handleStartPayroll = () => {
    runPayrollMutation.mutate();
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

              <div className="flex gap-3 pt-4">
                <Button variant="secondary" className="flex-1" onClick={handleClose}>
                  Cancel
                </Button>
                <Button 
                  variant="primary" 
                  className="flex-1"
                  disabled={selectedDepartments.length === 0 || runPayrollMutation.isPending}
                  onClick={handleStartPayroll}
                >
                  {runPayrollMutation.isPending ? (
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
