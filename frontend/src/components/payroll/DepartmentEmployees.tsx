import { useState, useMemo } from 'react';
import { 
  ArrowLeft, 
  Search, 
  Clock,
  Calculator,
  CheckCircle2,
  AlertCircle,
  DollarSign,
  Users,
  ChevronDown,
  Filter,
  MoreHorizontal,
  User,
  Play,
  Briefcase,
  CheckSquare,
  Square
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayrollDepartmentEmployee } from '@/types';

interface DepartmentEmployeesProps {
  departmentId: number;
  monthYear: string;
  onBack: () => void;
  onSelectEmployee: (employeeId: number) => void;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

type FilterStatus = 'all' | 'pending' | 'processed' | 'paid';
type SortBy = 'name' | 'ctc' | 'status';

// Employee Card Component
function EmployeeCard({
  employee,
  isSelected,
  onSelect,
  onClick,
  onProcess
}: {
  employee: PayrollDepartmentEmployee;
  isSelected: boolean;
  onSelect: () => void;
  onClick: () => void;
  onProcess: (e: React.MouseEvent) => void;
}) {
  const status = employee.payroll_status.is_processed 
    ? (employee.payroll_status.payment_status === 'paid' ? 'paid' : 'processed')
    : 'pending';

  const statusConfig = {
    paid: {
      icon: CheckCircle2,
      label: 'Paid',
      bgColor: 'bg-emerald-50',
      textColor: 'text-emerald-600',
      borderColor: 'border-emerald-200'
    },
    processed: {
      icon: CheckCircle2,
      label: 'Processed',
      bgColor: 'bg-blue-50',
      textColor: 'text-blue-600',
      borderColor: 'border-blue-200'
    },
    pending: {
      icon: Clock,
      label: 'Pending',
      bgColor: 'bg-amber-50',
      textColor: 'text-amber-600',
      borderColor: 'border-amber-200'
    }
  };

  const config = statusConfig[status];
  const StatusIcon = config.icon;

  // CTC info
  const hasCTC = employee.annual_ctc && employee.annual_ctc > 0;
  const monthlyCTC = hasCTC ? (employee.annual_ctc! / 12) : 0;

  return (
    <SurfaceCard 
      className={`p-5 transition-all ${
        isSelected ? 'ring-2 ring-blue-500 border-blue-300' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Checkbox */}
        <button 
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="mt-1 flex-shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-blue-600" />
          ) : (
            <Square className="h-5 w-5 text-slate-300 hover:text-slate-400" />
          )}
        </button>

        {/* Avatar */}
        <div 
          className="h-12 w-12 rounded-full bg-gradient-to-br from-blue-100 to-violet-100 flex items-center justify-center flex-shrink-0 cursor-pointer"
          onClick={onClick}
        >
          {employee.avatar ? (
            <img src={employee.avatar} alt={employee.name} className="h-12 w-12 rounded-full" />
          ) : (
            <span className="text-lg font-semibold text-blue-600">
              {employee.name.charAt(0)}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div>
              <h3 
                className="font-semibold text-slate-900 cursor-pointer hover:text-blue-600 transition-colors"
                onClick={onClick}
              >
                {employee.name}
              </h3>
              <p className="text-sm text-slate-500 truncate">
                {employee.designation || employee.email}
              </p>
              {employee.employee_code && (
                <p className="text-xs text-slate-400 mt-0.5">{employee.employee_code}</p>
              )}
            </div>
            <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium ${config.bgColor} ${config.textColor}`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {config.label}
            </span>
          </div>

          {/* Salary Info */}
          <div className="mt-4 flex items-center justify-between">
            <div>
              {hasCTC ? (
                <div>
                  <p className="text-xs text-slate-400">CTC</p>
                  <p className="font-semibold text-slate-900">{formatCurrency(employee.annual_ctc!)}<span className="text-slate-400 font-normal">/yr</span></p>
                </div>
              ) : (
                <div className="flex items-center gap-2 text-amber-600">
                  <AlertCircle className="h-4 w-4" />
                  <span className="text-sm font-medium">CTC not set</span>
                </div>
              )}
            </div>

            {/* Net Pay Display */}
            {employee.payroll_status.is_processed ? (
              <div className="text-right">
                <p className="text-xs text-slate-400">Net Pay</p>
                <p className="font-semibold text-emerald-600">
                  {formatCurrency(employee.payroll_status.net_pay)}
                </p>
              </div>
            ) : hasCTC ? (
              <div className="text-right">
                <p className="text-xs text-slate-400">Est. Monthly</p>
                <p className="font-semibold text-slate-700">
                  ~{formatCurrency(monthlyCTC * 0.75)}<span className="text-slate-400 font-normal">/mo</span>
                </p>
              </div>
            ) : null}
          </div>

          {/* Actions */}
          <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-2">
            {status === 'pending' ? (
              <>
                <Button 
                  variant="primary" 
                  size="sm" 
                  className="flex-1"
                  iconLeft={<Play className="h-4 w-4" />}
                  onClick={onProcess}
                >
                  Process Payroll
                </Button>
                <Button 
                  variant="secondary" 
                  size="sm"
                  onClick={onClick}
                >
                  View
                </Button>
              </>
            ) : status === 'processed' ? (
              <>
                <Button 
                  variant="primary" 
                  size="sm" 
                  className="flex-1"
                  iconLeft={<DollarSign className="h-4 w-4" />}
                >
                  Pay Now
                </Button>
                <Button 
                  variant="secondary" 
                  size="sm"
                  onClick={onClick}
                >
                  Edit
                </Button>
              </>
            ) : (
              <Button 
                variant="secondary" 
                size="sm" 
                className="flex-1"
                onClick={onClick}
              >
                View Payslip
              </Button>
            )}
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

export default function DepartmentEmployees({ 
  departmentId, 
  monthYear, 
  onBack, 
  onSelectEmployee 
}: DepartmentEmployeesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<Set<number>>(new Set());
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [showFilters, setShowFilters] = useState(false);
  const queryClient = useQueryClient();

  // Fetch employees
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'department', departmentId, 'employees', monthYear, searchQuery],
    queryFn: () => payrollApi.getDepartmentEmployees(departmentId, { 
      month_year: monthYear,
      search: searchQuery || undefined 
    }).then(res => res.data),
  });

  const employees = data?.employees || [];
  const departmentName = departmentId === 0 ? 'Unassigned Employees' : 
    employees[0]?.department || 'Department';

  // Filter and sort employees
  const filteredEmployees = useMemo(() => {
    let filtered = [...employees];
    
    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(emp => {
        const status = emp.payroll_status.is_processed 
          ? (emp.payroll_status.payment_status === 'paid' ? 'paid' : 'processed')
          : 'pending';
        return status === filterStatus;
      });
    }

    // Apply sorting
    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'ctc':
          return (b.annual_ctc || 0) - (a.annual_ctc || 0);
        case 'status':
          const statusOrder = { pending: 0, processed: 1, paid: 2 };
          const aStatus = a.payroll_status.is_processed 
            ? (a.payroll_status.payment_status === 'paid' ? 'paid' : 'processed')
            : 'pending';
          const bStatus = b.payroll_status.is_processed 
            ? (b.payroll_status.payment_status === 'paid' ? 'paid' : 'processed')
            : 'pending';
          return statusOrder[aStatus as keyof typeof statusOrder] - statusOrder[bStatus as keyof typeof statusOrder];
        default:
          return 0;
      }
    });

    return filtered;
  }, [employees, filterStatus, sortBy]);

  // Count by status
  const counts = useMemo(() => {
    return employees.reduce((acc, emp) => {
      if (emp.payroll_status.payment_status === 'paid') {
        acc.paid++;
      } else if (emp.payroll_status.is_processed) {
        acc.processed++;
      } else {
        acc.pending++;
      }
      return acc;
    }, { pending: 0, processed: 0, paid: 0 });
  }, [employees]);

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedEmployees.size === filteredEmployees.length) {
      setSelectedEmployees(new Set());
    } else {
      setSelectedEmployees(new Set(filteredEmployees.map(e => e.id)));
    }
  };

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedEmployees);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedEmployees(newSet);
  };

  // Get selected employee objects
  const selectedEmployeeObjects = useMemo(() => {
    return employees.filter(e => selectedEmployees.has(e.id));
  }, [employees, selectedEmployees]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
            Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{departmentName}</h1>
            <p className="text-sm text-slate-500">
              {employees.length} employees • {counts.pending} pending
            </p>
          </div>
        </div>
        
        {/* Bulk Actions */}
        {selectedEmployees.size > 0 && (
          <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-lg">
            <span className="text-sm font-medium text-blue-900">
              {selectedEmployees.size} selected
            </span>
            <div className="h-4 w-px bg-blue-200" />
            <Button variant="primary" size="sm" iconLeft={<Play className="h-4 w-4" />}>
              Process Selected
            </Button>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => setSelectedEmployees(new Set())}
            >
              Clear
            </Button>
          </div>
        )}
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'processed', 'paid'] as FilterStatus[]).map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterStatus === status 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
              filterStatus === status ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-600'
            }`}>
              {status === 'all' ? employees.length : counts[status]}
            </span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSelectAll}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            {selectedEmployees.size === filteredEmployees.length && filteredEmployees.length > 0 ? (
              <CheckSquare className="h-4 w-4 text-blue-600" />
            ) : (
              <Square className="h-4 w-4 text-slate-400" />
            )}
            Select All
          </button>
          <span className="text-slate-300">|</span>
          <button 
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm font-medium text-slate-700 hover:text-slate-900"
          >
            <Filter className="h-4 w-4" />
            Filters
            <ChevronDown className={`h-3 w-3 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <div className="flex-1" />

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <TextInput
            placeholder="Search by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 w-full sm:w-72"
          />
        </div>
      </div>

      {/* Expanded Filters */}
      {showFilters && (
        <SurfaceCard className="p-4">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Sort by:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="name">Name</option>
                <option value="ctc">CTC (High to Low)</option>
                <option value="status">Status</option>
              </select>
            </div>
          </div>
        </SurfaceCard>
      )}

      {/* Employees Grid */}
      <div className="space-y-4">
        {isLoading ? (
          // Loading state
          Array.from({ length: 3 }).map((_, i) => (
            <SurfaceCard key={i} className="p-5 animate-pulse">
              <div className="flex items-center gap-4">
                <div className="h-12 w-12 bg-slate-200 rounded-full" />
                <div className="flex-1">
                  <div className="h-5 bg-slate-200 rounded w-1/3 mb-2" />
                  <div className="h-4 bg-slate-200 rounded w-1/4" />
                </div>
              </div>
            </SurfaceCard>
          ))
        ) : filteredEmployees.length === 0 ? (
          <div className="text-center py-12">
            <Users className="h-12 w-12 mx-auto mb-3 text-slate-300" />
            <p className="text-slate-500 font-medium">No employees found</p>
            <p className="text-sm text-slate-400">
              {searchQuery ? 'Try adjusting your search' : 'This department has no employees'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredEmployees.map((employee) => (
              <EmployeeCard
                key={employee.id}
                employee={employee}
                isSelected={selectedEmployees.has(employee.id)}
                onSelect={() => toggleSelect(employee.id)}
                onClick={() => onSelectEmployee(employee.id)}
                onProcess={(e) => {
                  e.stopPropagation();
                  onSelectEmployee(employee.id);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Summary Footer */}
      {employees.length > 0 && (
        <div className="bg-slate-50 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-amber-500" />
              <span className="text-sm text-slate-600">{counts.pending} Pending</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-blue-500" />
              <span className="text-sm text-slate-600">{counts.processed} Processed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="h-3 w-3 rounded-full bg-emerald-500" />
              <span className="text-sm text-slate-600">{counts.paid} Paid</span>
            </div>
          </div>
          
          {selectedEmployees.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">
                {selectedEmployees.size} employees selected
              </span>
              <Button variant="primary" size="sm" iconLeft={<Play className="h-4 w-4" />}>
                Process Selected
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
