import { useState } from 'react';
import { 
  Users, 
  Search, 
  Building2, 
  ChevronRight, 
  Clock, 
  Activity,
  TrendingUp,
  TrendingDown,
  Calculator,
  Settings,
  DollarSign,
  CheckCircle2,
  AlertCircle,
  Play,
  FileText
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import type { PayrollDepartment, PayrollStats } from '@/types';

interface PayrollDashboardProps {
  onSelectDepartment: (departmentId: number) => void;
  onSelectEmployee: (employeeId: number) => void;
  onOpenRunPayroll: (stats: PayrollStats, departments: PayrollDepartment[]) => void;
  onOpenReports: (stats: PayrollStats) => void;
  onOpenSettings: () => void;
}

function formatCurrency(amount: number): string {
  return '₹' + amount.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

export default function PayrollDashboard({ 
  onSelectDepartment, 
  onSelectEmployee,
  onOpenRunPayroll,
  onOpenReports,
  onOpenSettings
}: PayrollDashboardProps) {
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
  });
  const [searchQuery, setSearchQuery] = useState('');

  const { data: stats, refetch: refetchStats } = useQuery({
    queryKey: ['payroll', 'stats', selectedMonth],
    queryFn: () => payrollApi.getStats({ month_year: selectedMonth }).then(res => res.data),
  });

  const { data: departmentsData, refetch: refetchDepartments } = useQuery({
    queryKey: ['payroll', 'departments', selectedMonth],
    queryFn: () => payrollApi.getDepartments({ month_year: selectedMonth }).then(res => res.data),
  });

  const departments = departmentsData?.departments || [];
  const unassignedCount = departmentsData?.unassigned_count || 0;

  // Calculate overall stats
  const totalEmployees = stats?.total_employees || 0;
  const processedEmployees = stats?.processed_employees || 0;
  const totalNetPay = stats?.total_net_pay || 0;
  const totalGross = stats?.total_gross || 0;
  const totalDeductions = stats?.total_deductions || 0;
  const progressPercentage = totalEmployees > 0 ? (processedEmployees / totalEmployees) * 100 : 0;

  // Filter departments by search
  const filteredDepartments = departments.filter(dept =>
    dept.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRunPayroll = () => {
    console.log('Run Payroll clicked, stats:', stats, 'departments:', departments);
    if (stats && departments.length > 0) {
      onOpenRunPayroll(stats, departments);
    } else if (departments.length === 0) {
      alert('No departments found. Please make sure you have departments set up.');
    }
  };

  const handleViewReports = () => {
    console.log('View Reports clicked, stats:', stats);
    if (stats) {
      onOpenReports(stats);
    } else {
      alert('Loading stats... Please try again in a moment.');
    }
  };

  const handlePayrollSuccess = () => {
    // Refresh data after payroll run
    refetchStats();
    refetchDepartments();
  };

  return (
    <div className="space-y-6">
      {/* Header with Month Selector */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Payroll Management</h1>
          <p className="text-sm text-slate-500 mt-1">Manage employee payroll by department</p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="month"
            value={selectedMonth}
            onChange={(e) => setSelectedMonth(e.target.value)}
            className="px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <Button variant="primary" iconLeft={<Play className="h-4 w-4" />} onClick={handleRunPayroll}>
            Run Payroll
          </Button>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <SurfaceCard className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Employees</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{totalEmployees}</p>
              <p className="text-xs text-slate-400 mt-1">{processedEmployees} processed</p>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg">
              <Users className="h-5 w-5 text-blue-600" />
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-slate-500">Progress</span>
              <span className="font-medium">{progressPercentage.toFixed(0)}%</span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Net Pay</p>
              <p className="text-2xl font-bold text-emerald-700 mt-1">{formatCurrency(totalNetPay)}</p>
              <p className="text-xs text-emerald-600 mt-1">All departments</p>
            </div>
            <div className="p-2 bg-emerald-50 rounded-lg">
              <DollarSign className="h-5 w-5 text-emerald-600" />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Gross Salary</p>
              <p className="text-2xl font-bold text-slate-900 mt-1">{formatCurrency(totalGross)}</p>
              <p className="text-xs text-slate-400 mt-1">Before deductions</p>
            </div>
            <div className="p-2 bg-violet-50 rounded-lg">
              <TrendingUp className="h-5 w-5 text-violet-600" />
            </div>
          </div>
        </SurfaceCard>

        <SurfaceCard className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-sm font-medium text-slate-500">Total Deductions</p>
              <p className="text-2xl font-bold text-rose-700 mt-1">{formatCurrency(totalDeductions)}</p>
              <p className="text-xs text-rose-600 mt-1">PF, ESI, PT, TDS</p>
            </div>
            <div className="p-2 bg-rose-50 rounded-lg">
              <TrendingDown className="h-5 w-5 text-rose-600" />
            </div>
          </div>
        </SurfaceCard>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <TextInput
            placeholder="Search departments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Building2 className="h-4 w-4" />
          <span>{departments.length} Departments</span>
          {unassignedCount > 0 && (
            <span className="text-amber-600">({unassignedCount} unassigned)</span>
          )}
        </div>
      </div>

      {/* Departments Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDepartments.map((dept) => (
          <SurfaceCard 
            key={dept.id} 
            className="p-5 cursor-pointer hover:shadow-md transition-shadow"
            onClick={() => onSelectDepartment(dept.id)}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-violet-500 flex items-center justify-center text-white font-bold">
                  {dept.name.charAt(0)}
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">{dept.name}</h3>
                  <p className="text-xs text-slate-500">{dept.employee_count} employees</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </div>

            <div className="mt-4 grid grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-slate-500">Net Pay</p>
                <p className="text-sm font-semibold text-slate-900">{formatCurrency(dept.total_net_pay)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Processed</p>
                <p className="text-sm font-semibold text-slate-900">{dept.processed_count}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500">Paid</p>
                <p className="text-sm font-semibold text-emerald-600">{dept.paid_count}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-2">
              {dept.processed_count === dept.employee_count ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                  <CheckCircle2 className="h-3 w-3" />
                  Complete
                </span>
              ) : dept.processed_count > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-full">
                  <Clock className="h-3 w-3" />
                  In Progress
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                  <AlertCircle className="h-3 w-3" />
                  Pending
                </span>
              )}
            </div>
          </SurfaceCard>
        ))}

        {/* Unassigned Card */}
        {unassignedCount > 0 && (
          <SurfaceCard 
            className="p-5 cursor-pointer hover:shadow-md transition-shadow border-amber-200"
            onClick={() => onSelectDepartment(0)}
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
                  <Users className="h-5 w-5 text-amber-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-900">Unassigned</h3>
                  <p className="text-xs text-slate-500">{unassignedCount} employees</p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-slate-400" />
            </div>
            <p className="mt-4 text-xs text-amber-600">
              Employees without department assignment
            </p>
          </SurfaceCard>
        )}
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button 
          variant="secondary" 
          iconLeft={<Settings className="h-4 w-4" />} 
          onClick={() => {
            console.log('Settings button clicked');
            onOpenSettings();
          }}
        >
          Payroll Settings
        </Button>
        <Button 
          variant="secondary" 
          iconLeft={<FileText className="h-4 w-4" />} 
          onClick={handleViewReports}
        >
          View Reports
        </Button>
      </div>
    </div>
  );
}
