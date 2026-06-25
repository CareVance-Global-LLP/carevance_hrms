import { useState, useMemo } from 'react';
import {
  ArrowLeft,
  Search,
  Clock,
  CheckCircle2,
  AlertCircle,
  Users,
  ChevronDown,
  Filter,
  Play,
  CheckSquare,
  Square,
  Loader2,
  Download,
  Eye,
  Settings,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import InfoTooltip from '@/components/ui/InfoTooltip';
import type { PayrollDepartmentEmployee } from '@/types';

interface PayGroupEmployeesProps {
  payGroupId: number;
  payGroupName?: string;
  monthYear: string;
  onBack: () => void;
  onSelectEmployee: (employeeId: number) => void;
  onOpenBulkPayroll?: () => void;
  onOpenPayGroupSettings?: (payGroupId: number) => void;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function formatMonthLabel(monthYear: string): string {
  const [y, m] = monthYear.split('-').map(Number);
  if (!y || !m) return monthYear;
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

type FilterStatus = 'all' | 'pending' | 'paid';
type SortBy = 'name' | 'ctc' | 'status';

// Employee Card Component (same shape as DepartmentEmployees so the
// two views stay consistent).
function EmployeeCard({
  employee,
  isSelected,
  onSelect,
  onClick,
  onProcess,
  onViewPayslip,
  onDownloadPayslip,
}: {
  employee: PayrollDepartmentEmployee;
  isSelected: boolean;
  onSelect: () => void;
  onClick: () => void;
  onProcess: (e: React.MouseEvent) => void;
  onViewPayslip: (e: React.MouseEvent) => void;
  onDownloadPayslip: (e: React.MouseEvent) => void;
}) {
  const isPaid = employee.payroll_status.payment_status === 'paid';
  const status: 'paid' | 'pending' = isPaid ? 'paid' : 'pending';

  const statusConfig = {
    paid: {
      icon: CheckCircle2,
      label: 'Paid',
      bgColor: 'bg-emerald-50',
      textColor: 'text-emerald-600',
      borderColor: 'border-emerald-200',
      tooltip: 'Funds have been credited to this employee\'s bank account.',
    },
    pending: {
      icon: Clock,
      label: 'Pending',
      bgColor: 'bg-amber-50',
      textColor: 'text-amber-600',
      borderColor: 'border-amber-200',
      tooltip: 'Payroll not yet processed for this employee. Click "Process Payroll" to calculate.',
    },
  } as const;

  const config = statusConfig[status];
  const StatusIcon = config.icon;

  const hasCTC = employee.annual_ctc && employee.annual_ctc > 0;
  const monthlyCTC = hasCTC ? (employee.annual_ctc! / 12) : 0;

  return (
    <SurfaceCard
      className={`p-5 transition-all ${
        isSelected ? 'ring-2 ring-emerald-500 border-emerald-300' : 'hover:shadow-md'
      }`}
    >
      <div className="flex items-start gap-4">
        {/* Checkbox */}
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="mt-1 flex-shrink-0"
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-emerald-600" />
          ) : (
            <Square className="h-5 w-5 text-slate-300 hover:text-slate-400" />
          )}
        </button>

        {/* Avatar */}
        <div
          className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center flex-shrink-0 cursor-pointer"
          onClick={onClick}
        >
          {employee.avatar ? (
            <img src={employee.avatar} alt={employee.name} className="h-12 w-12 rounded-full" />
          ) : (
            <span className="text-lg font-semibold text-emerald-600">
              {employee.name.charAt(0)}
            </span>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between">
            <div>
              <h3
                className="font-semibold text-slate-900 cursor-pointer hover:text-emerald-600 transition-colors"
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
              <InfoTooltip content={config.tooltip} title={config.label} size="sm" />
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
                  {hasCTC ? 'Process Payroll' : 'Set CTC & Process'}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onClick}
                >
                  View
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="flex-1"
                  iconLeft={<Eye className="h-4 w-4" />}
                  onClick={(e) => {
                    e.stopPropagation();
                    onViewPayslip(e);
                  }}
                >
                  View Payslip
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  className="px-2"
                  aria-label="Download payslip"
                  title="Download payslip"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownloadPayslip(e);
                  }}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </SurfaceCard>
  );
}

export default function PayGroupEmployees({
  payGroupId,
  payGroupName: payGroupNameProp,
  monthYear,
  onBack,
  onSelectEmployee,
  onOpenBulkPayroll,
  onOpenPayGroupSettings,
}: PayGroupEmployeesProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedEmployees, setSelectedEmployees] = useState<Set<number>>(new Set());
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [showFilters, setShowFilters] = useState(false);
  // Default working days = days in the selected month
  const [workingDays] = useState<number>(() => {
    const [y, m] = monthYear.split('-').map(Number);
    return new Date(y, m, 0).getDate();
  });
  const queryClient = useQueryClient();

  // Bulk process mutation (pay-group-scoped)
  const processSelectedMutation = useMutation({
    mutationFn: (userIds: number[]) =>
      payrollApi.processPayGroupSelectedEmployees(payGroupId, {
        month_year: monthYear,
        user_ids: userIds,
        working_days: workingDays,
      }).then((r) => r.data),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-group', payGroupId, 'employees'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'pay-groups'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'department'] });
      if (data?.failed?.length > 0) {
        const reasons = data.failed.map((f: { user_id: number; reason: string }) => `#${f.user_id}: ${f.reason}`).join('\n');
        alert(`Processed ${data.succeeded.length} • Failed ${data.failed.length}\n\n${reasons}`);
      }
    },
    onError: (err: any) => {
      alert(getApiErrorMessage(err, 'Bulk process failed. The run may already be paid or released.'));
    },
  });

  const handleProcessSelected = () => {
    if (selectedEmployees.size === 0) return;
    processSelectedMutation.mutate(Array.from(selectedEmployees));
  };

  // Payslip PDF (same blob + open-in-new-tab pattern as DepartmentEmployees)
  const viewPayslipPdf = async (userId: number, monthYearArg: string, employeeName: string) => {
    try {
      const res = await payrollApi.viewPayslipPdf(userId, monthYearArg, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      if (blob.size <= 200 || blob.type !== 'application/pdf') {
        throw new Error('Server did not return a PDF');
      }
      const url = URL.createObjectURL(blob);
      const win = window.open(url, '_blank', 'noopener,noreferrer');
      if (!win) {
        const a = document.createElement('a');
        a.href = url;
        a.download = `payslip_${monthYearArg}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      console.error('Failed to view payslip:', err);
      alert(`Failed to open payslip for ${employeeName}. ${getApiErrorMessage(err, '')}`.trim());
    }
  };

  const downloadPayslipPdf = async (userId: number, monthYearArg: string, employeeName: string) => {
    try {
      const res = await payrollApi.downloadPayslipPdf(userId, monthYearArg, { responseType: 'blob' });
      const blob = new Blob([res.data], { type: 'application/pdf' });
      if (blob.size <= 200 || blob.type !== 'application/pdf') {
        throw new Error('Server did not return a PDF');
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `payslip_${employeeName.replace(/\s+/g, '_')}_${monthYearArg}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download payslip:', err);
      alert(`Failed to download payslip for ${employeeName}. ${getApiErrorMessage(err, '')}`.trim());
    }
  };

  // Fetch pay group + members
  const { data, isLoading } = useQuery({
    queryKey: ['payroll', 'pay-group', payGroupId, 'employees', monthYear, searchQuery],
    queryFn: () => payrollApi.getPayGroupEmployees(payGroupId, {
      month_year: monthYear,
    }).then((res) => res.data),
  });

  const employees = data?.employees || [];
  const payGroupName = data?.pay_group?.name ?? 'Pay Group';

  // Client-side search filter (matches DepartmentEmployees pattern)
  const searchFilteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((emp) => {
      return (
        emp.name.toLowerCase().includes(q) ||
        emp.email.toLowerCase().includes(q) ||
        (emp.designation ?? '').toLowerCase().includes(q) ||
        (emp.department ?? '').toLowerCase().includes(q)
      );
    });
  }, [employees, searchQuery]);

  // Filter and sort
  const filteredEmployees = useMemo(() => {
    let filtered = [...searchFilteredEmployees];

    if (filterStatus !== 'all') {
      filtered = filtered.filter((emp) => {
        const status: 'paid' | 'pending' = emp.payroll_status.payment_status === 'paid' ? 'paid' : 'pending';
        return status === filterStatus;
      });
    }

    filtered.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'ctc':
          return (b.annual_ctc || 0) - (a.annual_ctc || 0);
        case 'status': {
          const statusOrder = { pending: 0, paid: 1 } as const;
          const aStatus: 'pending' | 'paid' = a.payroll_status.payment_status === 'paid' ? 'paid' : 'pending';
          const bStatus: 'pending' | 'paid' = b.payroll_status.payment_status === 'paid' ? 'paid' : 'pending';
          return statusOrder[aStatus] - statusOrder[bStatus];
        }
        default:
          return 0;
      }
    });

    return filtered;
  }, [searchFilteredEmployees, filterStatus, sortBy]);

  // Count by status (over the full employee set, not the filtered one)
  const counts = useMemo(() => {
    return employees.reduce(
      (acc, emp) => {
        if (emp.payroll_status.payment_status === 'paid') acc.paid++;
        else acc.pending++;
        return acc;
      },
      { pending: 0, paid: 0 },
    );
  }, [employees]);

  // Selection handlers
  const toggleSelectAll = () => {
    if (selectedEmployees.size === filteredEmployees.length) {
      setSelectedEmployees(new Set());
    } else {
      setSelectedEmployees(new Set(filteredEmployees.map((e) => e.id)));
    }
  };

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedEmployees);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedEmployees(newSet);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={onBack} iconLeft={<ArrowLeft className="h-4 w-4" />}>
            Back to Payroll
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900">{payGroupName}</h1>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                {formatMonthLabel(monthYear)}
              </span>
            </div>
            <p className="text-sm text-slate-500">
              {employees.length} {employees.length === 1 ? 'employee' : 'employees'} • {counts.pending} pending
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Settings className="h-4 w-4" />}
            onClick={() => onOpenPayGroupSettings?.(payGroupId)}
          >
            Settings
          </Button>

          {selectedEmployees.size > 0 && (
            <div className="flex items-center gap-2 bg-emerald-50 px-4 py-2 rounded-lg">
              <span className="text-sm font-medium text-emerald-900">
                {selectedEmployees.size} selected
              </span>
              <div className="h-4 w-px bg-emerald-200" />
              <Button
                variant="primary"
                size="sm"
                iconLeft={<Play className="h-4 w-4" />}
                onClick={() => onOpenBulkPayroll?.()}
              >
                Open Bulk Payroll
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
      </div>

      {/* Status Tabs */}
      <div className="flex flex-wrap gap-2">
        {(['all', 'pending', 'paid'] as FilterStatus[]).map((status) => (
          <button
            key={status}
            onClick={() => setFilterStatus(status)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              filterStatus === status
                ? 'bg-emerald-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {status.charAt(0).toUpperCase() + status.slice(1)}
            <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
              filterStatus === status ? 'bg-emerald-500 text-white' : 'bg-slate-200 text-slate-600'
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
              <CheckSquare className="h-4 w-4 text-emerald-600" />
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
            placeholder="Search by name, email, department, or designation..."
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
                className="px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
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
              {searchQuery
                ? 'Try adjusting your search'
                : 'This pay group has no active members'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredEmployees.map((employee) => (
              <EmployeeCard
                key={employee.id}
                employee={employee as unknown as PayrollDepartmentEmployee}
                isSelected={selectedEmployees.has(employee.id)}
                onSelect={() => toggleSelect(employee.id)}
                onClick={() => onSelectEmployee(employee.id)}
                onProcess={(e) => {
                  e.stopPropagation();
                  onSelectEmployee(employee.id);
                }}
                onViewPayslip={(e) => {
                  e.stopPropagation();
                  void viewPayslipPdf(employee.id, monthYear, employee.name);
                }}
                onDownloadPayslip={(e) => {
                  e.stopPropagation();
                  void downloadPayslipPdf(employee.id, monthYear, employee.name);
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
              <div className="h-3 w-3 rounded-full bg-emerald-500" />
              <span className="text-sm text-slate-600">{counts.paid} Paid</span>
            </div>
          </div>

          {selectedEmployees.size > 0 && (
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600">
                {selectedEmployees.size} employees selected
              </span>
              <Button
                variant="primary"
                size="sm"
                iconLeft={<Play className="h-4 w-4" />}
                onClick={() => onOpenBulkPayroll?.()}
              >
                Open Bulk Payroll
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
