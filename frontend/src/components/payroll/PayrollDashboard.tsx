import { useState } from 'react';
import { 
  Users, 
  Search, 
  Building2, 
  ChevronRight,
  Play,
  FileText,
  Settings,
  TrendingUp,
  TrendingDown,
  DollarSign,
  AlertCircle,
  CheckCircle2
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { payrollApi } from '@/services/api';
import Button from '@/components/ui/Button';
import { TextInput } from '@/components/ui/FormField';
import SurfaceCard from '@/components/dashboard/SurfaceCard';

// Import new components
import EnhancedStatCard from '@/components/payroll/EnhancedStatCard';
import PayrollStatusWorkflow from '@/components/payroll/PayrollStatusWorkflow';
import ComplianceCalendar from '@/components/payroll/ComplianceCalendar';
import ActionableAlertsPanel from '@/components/payroll/ActionableAlertsPanel';
import SalaryTrendCharts from '@/components/payroll/SalaryTrendCharts';
import DepartmentComparison from '@/components/payroll/DepartmentComparison';
import EmployeeHealthScore from '@/components/payroll/EmployeeHealthScore';
import RecentActivityFeed from '@/components/payroll/RecentActivityFeed';
import PayrollRunHistory from '@/components/payroll/PayrollRunHistory';

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

  // Fetch comprehensive dashboard data
  const { data: dashboardData, isLoading: isDashboardLoading } = useQuery({
    queryKey: ['payroll', 'dashboard', selectedMonth],
    queryFn: () => payrollApi.getDashboardData({ month_year: selectedMonth }).then(res => res.data),
  });

  // Fetch departments
  const { data: departmentsData, isLoading: isDepartmentsLoading } = useQuery({
    queryKey: ['payroll', 'departments', selectedMonth],
    queryFn: () => payrollApi.getDepartments({ month_year: selectedMonth }).then(res => res.data),
  });

  // Fetch stats for modals
  const { data: statsData } = useQuery({
    queryKey: ['payroll', 'stats', selectedMonth],
    queryFn: () => payrollApi.getStats({ month_year: selectedMonth }).then(res => res.data),
  });

  const departments = departmentsData?.departments || [];
  const unassignedCount = departmentsData?.unassigned_count || 0;

  // Filter departments by search
  const filteredDepartments = departments.filter(dept =>
    dept.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleRunPayroll = () => {
    if (statsData && departments.length > 0) {
      onOpenRunPayroll(statsData, departments);
    } else if (departments.length === 0) {
      alert('No departments found. Please make sure you have departments set up.');
    }
  };

  const handleViewReports = () => {
    if (statsData) {
      onOpenReports(statsData);
    }
  };

  const handleAlertAction = (alert: any) => {
    console.log('Alert action triggered:', alert);
    // Handle navigation based on alert type
    if (alert.action_url) {
      if (alert.action_url.includes('run')) {
        handleRunPayroll();
      } else {
        // For other URLs, show alert for now
        alert(`${alert.action}: ${alert.message}`);
      }
    }
  };

  const handleWorkflowAction = (action: string) => {
    console.log('Workflow action:', action);
    switch (action) {
      case 'process':
        handleRunPayroll();
        break;
      case 'approve':
        alert('Approve payroll functionality coming soon');
        break;
      case 'release':
        alert('Release payroll functionality coming soon');
        break;
      case 'pay':
        alert('Process payment functionality coming soon');
        break;
      default:
        console.log('Unknown workflow action:', action);
    }
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

      {/* Actionable Alerts Panel */}
      {(dashboardData?.data?.alerts?.length > 0) && (
        <ActionableAlertsPanel 
          alerts={dashboardData?.data?.alerts || []}
          loading={isDashboardLoading}
          onAction={handleAlertAction}
        />
      )}

      {/* Payroll Status Workflow */}
      <PayrollStatusWorkflow 
        workflowStatus={dashboardData?.data?.workflow_status || null}
        loading={isDashboardLoading}
        onProcess={() => handleWorkflowAction('process')}
        onApprove={() => handleWorkflowAction('approve')}
        onRelease={() => handleWorkflowAction('release')}
        onPay={() => handleWorkflowAction('pay')}
      />

      {/* Enhanced Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <EnhancedStatCard
          title="Total Net Pay"
          value={formatCurrency(dashboardData?.data?.stats?.total_net_pay?.value || 0)}
          subtitle={`${dashboardData?.data?.stats?.total_employees?.processed || 0} employees processed`}
          trend={dashboardData?.data?.stats?.total_net_pay?.trend}
          icon={<DollarSign className="h-5 w-5" />}
          iconBgColor="bg-emerald-50"
          iconColor="text-emerald-600"
          loading={isDashboardLoading}
        />

        <EnhancedStatCard
          title="Total Gross Pay"
          value={formatCurrency(dashboardData?.data?.stats?.total_gross?.value || 0)}
          subtitle="Before deductions"
          trend={dashboardData?.data?.stats?.total_gross?.trend}
          icon={<TrendingUp className="h-5 w-5" />}
          iconBgColor="bg-blue-50"
          iconColor="text-blue-600"
          loading={isDashboardLoading}
        />

        <EnhancedStatCard
          title="Total Deductions"
          value={formatCurrency(dashboardData?.data?.stats?.total_deductions?.value || 0)}
          subtitle="PF, ESI, PT, TDS"
          icon={<TrendingDown className="h-5 w-5" />}
          iconBgColor="bg-rose-50"
          iconColor="text-rose-600"
          loading={isDashboardLoading}
        />

        <EnhancedStatCard
          title="Total Employees"
          value={String(dashboardData?.data?.stats?.total_employees?.value || 0)}
          subtitle={`${dashboardData?.data?.stats?.total_employees?.processed || 0} processed`}
          trend={dashboardData?.data?.stats?.total_employees?.trend}
          icon={<Users className="h-5 w-5" />}
          iconBgColor="bg-violet-50"
          iconColor="text-violet-600"
          loading={isDashboardLoading}
        />
      </div>

      {/* Two Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Salary Trend Charts */}
          <SalaryTrendCharts 
            data={dashboardData?.data?.trends || null}
            loading={isDashboardLoading}
          />

          {/* Departments Section */}
          <div className="bg-white rounded-xl p-6 border border-slate-200">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">Departments</h3>
                <p className="text-sm text-slate-500">Select a department to view employees</p>
              </div>
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <Building2 className="h-4 w-4" />
                <span>{departments.length} Departments</span>
                {unassignedCount > 0 && (
                  <span className="text-amber-600">({unassignedCount} unassigned)</span>
                )}
              </div>
            </div>

            {/* Search */}
            <div className="mb-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <TextInput
                  placeholder="Search departments..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
            </div>

            {/* Departments Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                        <AlertCircle className="h-3 w-3" />
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
          </div>

          {/* Department Comparison */}
          <DepartmentComparison 
            departments={dashboardData?.data?.department_comparison || null}
            loading={isDashboardLoading}
            onViewDepartment={onSelectDepartment}
            onViewAll={() => alert('All departments view coming soon')}
          />

          {/* Payroll Run History */}
          <PayrollRunHistory />
        </div>

        {/* Right Column (1/3 width) */}
        <div className="space-y-6">
          {/* Compliance Calendar */}
          <ComplianceCalendar 
            deadlines={dashboardData?.data?.compliance_calendar || null}
            loading={isDashboardLoading}
            onViewAll={() => alert('Full compliance calendar view coming soon')}
            onViewDeadline={(deadline) => console.log('View deadline:', deadline)}
          />

          {/* Employee Health Score */}
          <EmployeeHealthScore 
            data={dashboardData?.data?.health_score || null}
            loading={isDashboardLoading}
            onViewDetails={() => alert('Employee health details coming soon')}
            onFixRecords={() => alert('Fix incomplete records feature coming soon')}
          />

          {/* Recent Activity */}
          <RecentActivityFeed 
            activities={dashboardData?.data?.recent_activity || null}
            loading={isDashboardLoading}
            onViewAll={() => alert('Full activity history coming soon')}
            onActivityClick={(activity) => console.log('Activity clicked:', activity)}
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="flex flex-wrap gap-3">
        <Button 
          variant="secondary" 
          iconLeft={<Play className="h-4 w-4" />} 
          onClick={handleRunPayroll}
        >
          Run Payroll
        </Button>
        <Button 
          variant="secondary" 
          iconLeft={<Settings className="h-4 w-4" />} 
          onClick={onOpenSettings}
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
