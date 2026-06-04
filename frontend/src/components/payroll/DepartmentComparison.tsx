import { Building2, Users, TrendingUp, TrendingDown, CheckCircle, AlertCircle } from 'lucide-react';
import Button from '@/components/ui/Button';

interface DepartmentData {
  id: number;
  name: string;
  employee_count: number;
  processed_count: number;
  total_gross: number;
  total_net_pay: number;
  avg_salary: number;
  status: 'complete' | 'pending';
}

interface DepartmentComparisonProps {
  departments: DepartmentData[] | null;
  loading?: boolean;
  onViewDepartment?: (deptId: number) => void;
  onViewAll?: () => void;
}

export default function DepartmentComparison({
  departments,
  loading = false,
  onViewDepartment,
  onViewAll
}: DepartmentComparisonProps) {
  // Helper function to show alert safely
  const showAlert = (message: string) => {
    if (typeof window !== 'undefined' && window.alert) {
      window.alert(message);
    }
  };

  const handleViewAll = () => {
    if (onViewAll) {
      onViewAll();
    } else {
      showAlert('All departments view coming soon');
    }
  };

  const formatCurrency = (value: number) => {
    if (value >= 100000) {
      return '₹' + (value / 100000).toFixed(1) + 'L';
    }
    return '₹' + value.toLocaleString('en-IN');
  };

  if (loading) {
    return (
      <div className="bg-white rounded-xl p-6 border border-slate-200 animate-pulse">
        <div className="h-64 bg-slate-200 rounded-lg"></div>
      </div>
    );
  }

  if (!departments || departments.length === 0) {
    return (
      <div className="bg-white rounded-xl p-6 border border-slate-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-slate-100 rounded-lg">
            <Building2 className="h-5 w-5 text-slate-600" />
          </div>
          <h3 className="text-lg font-semibold text-slate-900">Department Comparison</h3>
        </div>
        <p className="text-slate-500 text-sm text-center py-8">No departments found</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl p-6 border border-slate-200">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-violet-100 rounded-lg">
            <Building2 className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Department Comparison</h3>
            <p className="text-sm text-slate-500">Payroll by department</p>
          </div>
        </div>
        <Button 
          variant="secondary" 
          size="sm"
          onClick={handleViewAll}
        >
          View All
        </Button>
      </div>

      {/* Department List */}
      <div className="space-y-3">
        {departments.map((dept) => (
          <div 
            key={dept.id}
            className="p-4 rounded-lg border border-slate-200 hover:border-slate-300 transition-colors cursor-pointer"
            onClick={() => onViewDepartment?.(dept.id)}
          >
            <div className="flex items-center justify-between">
              {/* Department Info */}
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold">
                  {dept.name.charAt(0)}
                </div>
                <div>
                  <h4 className="font-medium text-slate-900">{dept.name}</h4>
                  <div className="flex items-center gap-2 text-sm text-slate-500">
                    <Users className="h-3 w-3" />
                    <span>{dept.employee_count} employees</span>
                    <span className="text-slate-300">|</span>
                    <span>{dept.processed_count} processed</span>
                  </div>
                </div>
              </div>

              {/* Status & Stats */}
              <div className="text-right">
                <p className="text-lg font-semibold text-slate-900">
                  {formatCurrency(dept.total_net_pay)}
                </p>
                <div className="flex items-center justify-end gap-2 mt-1">
                  <span className="text-sm text-slate-500">
                    Avg: {formatCurrency(dept.avg_salary)}
                  </span>
                  {dept.status === 'complete' ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full">
                      <CheckCircle className="h-3 w-3" />
                      Complete
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full">
                      <AlertCircle className="h-3 w-3" />
                      Pending
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Progress Bar */}
            <div className="mt-3">
              <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                <span>Processing Progress</span>
                <span>{Math.round((dept.processed_count / dept.employee_count) * 100)}%</span>
              </div>
              <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                <div 
                  className={`h-full rounded-full transition-all duration-300 ${
                    dept.status === 'complete' ? 'bg-emerald-500' : 'bg-amber-500'
                  }`}
                  style={{ width: `${(dept.processed_count / dept.employee_count) * 100}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className="mt-6 pt-4 border-t border-slate-200">
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-slate-900">
              {departments.reduce((sum, d) => sum + d.employee_count, 0)}
            </p>
            <p className="text-xs text-slate-500">Total Employees</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-emerald-600">
              {formatCurrency(departments.reduce((sum, d) => sum + d.total_net_pay, 0))}
            </p>
            <p className="text-xs text-slate-500">Total Net Pay</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-violet-600">
              {formatCurrency(
                departments.reduce((sum, d) => sum + d.total_net_pay, 0) / 
                departments.reduce((sum, d) => sum + d.employee_count, 0)
              )}
            </p>
            <p className="text-xs text-slate-500">Avg Salary</p>
          </div>
        </div>
      </div>
    </div>
  );
}
