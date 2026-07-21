import { useState, useMemo, useEffect } from 'react';
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
  Download,
  Eye,
  Settings,
  UserPlus,
  X,
  IndianRupee,
  Loader2,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { payrollApi, getApiErrorMessage } from '@/services/api';
import { useToast } from '@/components/ui/Toast';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import InfoTooltip from '@/components/ui/InfoTooltip';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import AddEmployeeToPayGroupModal from './AddEmployeeToPayGroupModal';

interface PayGroupEmployeesProps {
  payGroupId: number;
  payGroupName?: string;
  monthYear: string;
  onBack: () => void;
  onSelectEmployee: (employeeId: number) => void;
  onOpenBulkPayroll?: (selectedEmployeeIds: number[]) => void;
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
  employee: any;
  isSelected: boolean;
  onSelect: () => void;
  onClick: () => void;
  onProcess: (e: React.MouseEvent) => void;
  onViewPayslip: (e: React.MouseEvent) => void;
  onDownloadPayslip: (e: React.MouseEvent) => void;
}) {
  const paymentStatus = employee.payroll_status?.payment_status ?? 'pending';
  const isPaid = paymentStatus === 'paid';
  // "Processed" = a payroll item exists for this month (calculated, even
  // if not yet disbursed). This drives the payslip actions and stops
  // prompting the user to process the employee again.
  const isProcessed = employee.payroll_status?.is_processed ?? paymentStatus !== 'pending';
  const status: 'paid' | 'processed' | 'pending' = isPaid ? 'paid' : isProcessed ? 'processed' : 'pending';

  const statusConfig = {
    paid: {
      icon: CheckCircle2,
      label: 'Paid',
      bgColor: 'bg-emerald-50',
      textColor: 'text-emerald-600',
      borderColor: 'border-emerald-200',
      tooltip: 'Funds have been credited to this employee\'s bank account.',
    },
    processed: {
      icon: CheckCircle2,
      label: 'Processed',
      bgColor: 'bg-sky-50',
      textColor: 'text-sky-600',
      borderColor: 'border-sky-200',
      tooltip: 'Payroll calculated — payslip is ready. Disburse to mark as paid.',
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
        {/* Checkbox — disabled if already paid */}
        <button
          onClick={(e) => { e.stopPropagation(); if (status === 'pending') onSelect(); }}
          className={`mt-1 flex-shrink-0 ${status !== 'pending' ? 'cursor-not-allowed opacity-40' : ''}`}
          disabled={status !== 'pending'}
          title={status !== 'pending' ? 'Already processed for this month — cannot be selected' : undefined}
        >
          {isSelected ? (
            <CheckSquare className="h-5 w-5 text-emerald-600" />
          ) : isPaid ? (
            <CheckCircle2 className="h-5 w-5 text-emerald-300" />
          ) : (
            <Square className="h-5 w-5 text-slate-300 hover:text-slate-400" />
          )}
        </button>

        {/* Avatar */}
        <div className="h-12 w-12 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center flex-shrink-0">
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
                  className={`font-semibold ${
                    status !== 'pending' ? 'text-slate-500' : 'text-slate-900'
                  }`}
                >
                  {employee.name}
                </h3>
                <p className={`text-sm truncate ${status !== 'pending' ? 'text-slate-400' : 'text-slate-500'}`}>
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
            {isProcessed ? (
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
  payGroupName: _payGroupNameProp,
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
  const [showAddEmployeeModal, setShowAddEmployeeModal] = useState(false);
  const [ctcModalEmployee, setCtcModalEmployee] = useState<any | null>(null);
  const [ctcInput, setCtcInput] = useState('');
  const [reprocessConfirmIds, setReprocessConfirmIds] = useState<number[] | null>(null);
  const queryClient = useQueryClient();
  const { show } = useToast();

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

  // Auto-deselect any employees that are already paid (prevents stale selection)
  useEffect(() => {
    if (employees.length === 0 || selectedEmployees.size === 0) return;
    const paidIds = new Set(
      employees
        .filter(e => e.payroll_status?.payment_status === 'paid')
        .map(e => e.id)
    );
    if (paidIds.size === 0) return;
    const cleaned = new Set([...selectedEmployees].filter(id => !paidIds.has(id)));
    if (cleaned.size !== selectedEmployees.size) {
      setSelectedEmployees(cleaned);
    }
  }, [employees]);

  // Client-side search filter (matches DepartmentEmployees pattern)
  const searchFilteredEmployees = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((emp) => {
      return (
        emp.name.toLowerCase().includes(q) ||
        emp.email.toLowerCase().includes(q) ||
        (emp.designation ?? '').toLowerCase().includes(q)
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

  // Selection handlers — only paid employees are NOT selectable (processed can be re-processed)
  const toggleSelectAll = () => {
    const selectableIds = filteredEmployees
      .filter(e => e.payroll_status?.payment_status !== 'paid')
      .map(e => e.id);

    if (selectedEmployees.size === selectableIds.length && selectableIds.every(id => selectedEmployees.has(id))) {
      setSelectedEmployees(new Set());
    } else {
      setSelectedEmployees(new Set(selectableIds));
    }
  };

  const toggleSelect = (id: number) => {
    const newSet = new Set(selectedEmployees);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setSelectedEmployees(newSet);
  };

  const handleBulkPayroll = (ids: number[]) => {
    const processedIds = ids.filter((id) => {
      const emp = employees.find((e) => e.id === id);
      if (!emp) return false;
      const ps = emp.payroll_status?.payment_status ?? 'pending';
      const ip = emp.payroll_status?.is_processed ?? ps !== 'pending';
      return ps !== 'paid' && ip;
    });
    if (processedIds.length > 0) {
      setReprocessConfirmIds(ids);
    } else {
      onOpenBulkPayroll?.(ids);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {payGroupName} — Members
          </h1>
          <p className="text-sm text-slate-500">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 mr-2">
              {formatMonthLabel(monthYear)}
            </span>
            {employees.length} employee{employees.length === 1 ? '' : 's'} · {counts.pending} pending
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedEmployees.size > 0 && (
                <Button
                  variant="primary"
                  size="sm"
                  iconLeft={<Play className="h-4 w-4" />}
                  onClick={() => handleBulkPayroll(Array.from(selectedEmployees))}
                >
                  Run Payroll
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<UserPlus className="h-4 w-4" />}
            onClick={() => setShowAddEmployeeModal(true)}
          >
            + Add Member
          </Button>
          <Button
            variant="ghost"
            size="sm"
            iconLeft={<Settings className="h-4 w-4" />}
            onClick={() => onOpenPayGroupSettings?.(payGroupId)}
          >
            Settings
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <TextInput
            placeholder="Search by name, email, or designation..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 w-full"
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onBack?.()}
        >
          ← Back to Pay Group
        </Button>
      </div>

      {/* Employees Table — wireframe layout */}
      <SurfaceCard className="p-0 overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="w-10 px-4 py-2.5">
                  <button onClick={toggleSelectAll}>
                    {selectedEmployees.size === filteredEmployees.filter(e => e.payroll_status?.payment_status !== 'paid').length && filteredEmployees.length > 0 ? (
                      <CheckSquare className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <Square className="h-4 w-4 text-slate-400" />
                    )}
                  </button>
                </th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Employee</th>
                <th className="text-left px-4 py-2.5 font-medium text-slate-600">Designation</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">CTC</th>
                <th className="text-center px-4 py-2.5 font-medium text-slate-600">Status</th>
                <th className="text-right px-4 py-2.5 font-medium text-slate-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredEmployees.map((employee) => {
                const paymentStatus = employee.payroll_status?.payment_status ?? 'pending';
                const isPaid = paymentStatus === 'paid';
                const isProcessed = employee.payroll_status?.is_processed ?? paymentStatus !== 'pending';
                const status: 'paid' | 'processed' | 'pending' = isPaid ? 'paid' : isProcessed ? 'processed' : 'pending';
                const statusTone = {
                  paid: 'bg-emerald-100 text-emerald-700',
                  processed: 'bg-sky-100 text-sky-700',
                  pending: 'bg-amber-100 text-amber-700',
                };
                const statusLabel = { paid: 'Paid', processed: 'Processed', pending: 'Draft' };
                const initials = employee.name.split(' ').map((n: string) => n.charAt(0)).join('').substring(0, 2).toUpperCase();
                const employeeHasCtc = !!(employee.annual_ctc && employee.annual_ctc > 0);

                return (
                  <tr key={employee.id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <button
                        onClick={() => status !== 'paid' && toggleSelect(employee.id)}
                        disabled={status === 'paid'}
                        className={status === 'paid' ? 'opacity-40 cursor-not-allowed' : ''}
                      >
                        {selectedEmployees.has(employee.id) ? (
                          <CheckSquare className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Square className="h-4 w-4 text-slate-300" />
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-emerald-100 to-teal-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-sm font-semibold text-emerald-600">{initials}</span>
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{employee.name}</p>
                          <p className="text-xs text-slate-500">{employee.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{employee.designation || '—'}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      {employee.annual_ctc ? `₹${Number(employee.annual_ctc).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${statusTone[status]}`}>
                        {statusLabel[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {status === 'paid' ? (
                          <>
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-100 px-2.5 py-1 rounded-full">
                              <CheckCircle2 className="h-3 w-3" /> Paid
                            </span>
                            <Button variant="ghost" size="sm" onClick={() => void viewPayslipPdf(employee.id, monthYear, employee.name)}>
                              Payslip
                            </Button>
                          </>
                        ) : status === 'processed' ? (
                          <span className="text-xs text-slate-400 italic">Processed — select & Run Payroll to re-process</span>
                        ) : (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={() => {
                              if (!employeeHasCtc) {
                                setCtcInput(employee.annual_ctc ? String(employee.annual_ctc) : '');
                                setCtcModalEmployee(employee);
                              } else {
                                onSelectEmployee(employee.id);
                              }
                            }}
                          >
                            Start →
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SurfaceCard>

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
                  onClick={() => handleBulkPayroll(Array.from(selectedEmployees))}
                >
                  Run Payroll
               </Button>
             </div>
           )}
         </div>
       )}

        <AddEmployeeToPayGroupModal
          isOpen={showAddEmployeeModal}
          onClose={() => setShowAddEmployeeModal(false)}
          payGroupId={payGroupId}
          payGroupName={payGroupName}
          onSuccess={() => setShowAddEmployeeModal(false)}
        />

        {ctcModalEmployee && (
          <SetCtcModal
            employee={ctcModalEmployee}
            monthYear={monthYear}
            ctcInput={ctcInput}
            onCtcChange={setCtcInput}
            onClose={() => {
              setCtcModalEmployee(null);
              setCtcInput('');
            }}
            onSaved={() => {
              queryClient.invalidateQueries({
                queryKey: ['payroll', 'pay-group', payGroupId, 'employees'],
              });
              const empId = ctcModalEmployee?.id;
              setCtcModalEmployee(null);
              setCtcInput('');
              // Open the wizard for this employee so the admin can
              // review the 6 steps — instead of processing headlessly.
              // The wizard reads the now-saved CTC on mount.
              if (empId) onSelectEmployee(empId);
            }}
          />
        )}

        <ConfirmDialog
          isOpen={reprocessConfirmIds !== null}
          title="Re-process Payroll?"
          message={`Some selected employees already have processed payroll. Re-processing will overwrite their current payroll data. Continue?`}
          confirmLabel="Yes, Re-process"
          cancelLabel="Cancel"
          tone="danger"
          onConfirm={() => {
            if (reprocessConfirmIds) {
              onOpenBulkPayroll?.(reprocessConfirmIds);
            }
            setReprocessConfirmIds(null);
          }}
          onClose={() => setReprocessConfirmIds(null)}
        />
      </div>
    );
}

// Inline "Set CTC & Process" modal. Opens from an employee card when the
// employee has no CTC. Saves the CTC via quickSaveCtc, then processes that
// single employee's payroll so the card immediately updates.
function SetCtcModal({
  employee,
  monthYear,
  ctcInput,
  onCtcChange,
  onClose,
  onSaved,
}: {
  employee: any;
  monthYear: string;
  ctcInput: string;
  onCtcChange: (v: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctcValue = parseFloat(ctcInput);
  const isValid = !Number.isNaN(ctcValue) && ctcValue > 0;

  const handleSaveAndProcess = async () => {
    if (!isValid) {
      setError('Enter an annual CTC greater than 0.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      // Save the CTC only — do NOT headless-process. The wizard will
      // open (via onSaved) so the admin can review the full 6-step
      // flow before payroll is actually run.
      await payrollApi.quickSaveCtc(employee.id, {
        annual_ctc: ctcValue,
        month_year: monthYear,
      });
      queryClient.invalidateQueries({ queryKey: ['payroll', 'stats'] });
      onSaved();
    } catch (err: any) {
      const msg = getApiErrorMessage(err, 'Could not set CTC. Please try again.');
      setError(msg || 'Could not set CTC. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <SurfaceCard className="w-full max-w-md p-6">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold text-slate-900">Set CTC &amp; Process</h3>
            <p className="text-sm text-slate-500 mt-0.5">{employee.name}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Annual CTC (₹)
          </label>
          <div className="relative">
            <IndianRupee className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              type="number"
              min="0"
              autoFocus
              value={ctcInput}
              onChange={(e) => {
                onCtcChange(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && isValid && !isSaving) void handleSaveAndProcess();
              }}
              placeholder="e.g. 1200000"
              className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          {error && (
            <p className="mt-1.5 text-sm text-rose-600">{error}</p>
          )}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={isSaving}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="sm"
            iconLeft={isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
            onClick={() => void handleSaveAndProcess()}
            disabled={isSaving || !isValid}
          >
            {isSaving ? 'Saving…' : 'Set & Process'}
          </Button>
        </div>
      </SurfaceCard>
    </div>
  );
}
