import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { Search, UserPlus, Calendar, Mail, Building2, Clock, ArrowLeft, Download } from 'lucide-react';
import Button from '@/components/ui/Button';
import { formatDate } from '@/lib/dateTime';
import { resolveUserRoleLabel } from '@/lib/permissions';

interface HireRecord {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  employee_code?: string;
  joining_date?: string;
  created_at: string;
  avatar?: string;
}

const resolveEmployeeDepartment = (employee: any) =>
  String(
    employee?.department
    || employee?.employee_work_info?.department?.name
    || employee?.employeeWorkInfo?.department?.name
    || employee?.employee_work_info?.department_name
    || employee?.groups?.[0]?.name
    || 'Unassigned'
  ).trim() || 'Unassigned';

export default function NewHiresPage() {
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<'7' | '30' | '90' | '365' | 'all'>('30');

  const { data: employees = [], isLoading, error } = useQuery({
    queryKey: ['new-hires-employees'],
    queryFn: async () => {
      const response = await userApi.getAll({ is_active: true });
      return (response.data || []) as any[];
    },
    enabled: isAuthenticated && !isAuthLoading,
  });

  if (isAuthLoading) {
    return <PageLoadingState label="Checking authentication..." />;
  }

  if (!isAuthenticated) {
    return <PageErrorState message="Please log in to view this page." />;
  }

  const dateRangeLabel = useMemo(() => {
    switch (dateRange) {
      case '7': return 'Last 7 days';
      case '30': return 'Last 30 days';
      case '90': return 'Last 3 months';
      case '365': return 'Last year';
      case 'all': return 'All time';
    }
  }, [dateRange]);

  const filteredHires = useMemo(() => {
    const cutoffDate = new Date();
    if (dateRange !== 'all') {
      cutoffDate.setDate(cutoffDate.getDate() - parseInt(dateRange));
    } else {
      cutoffDate.setFullYear(2000); // Effectively all time
    }

    return employees
      .filter((employee: any) => {
        const joinDate = new Date(employee.joining_date || employee.created_at);
        return joinDate >= cutoffDate;
      })
      .filter((employee: any) => {
        if (!searchQuery) return true;
        const query = searchQuery.toLowerCase();
        return (
          employee.name.toLowerCase().includes(query) ||
          employee.email.toLowerCase().includes(query) ||
          resolveEmployeeDepartment(employee).toLowerCase().includes(query) ||
          (employee.employee_code || '').toLowerCase().includes(query)
        );
      })
      .sort((a: any, b: any) => {
        const dateA = new Date(a.joining_date || a.created_at);
        const dateB = new Date(b.joining_date || b.created_at);
        return dateB.getTime() - dateA.getTime();
      });
  }, [employees, dateRange, searchQuery]);

  const stats = useMemo(() => {
    const now = new Date();
    const thisMonth = filteredHires.filter((e: any) => {
      const joinDate = new Date(e.joining_date || e.created_at);
      return joinDate.getMonth() === now.getMonth() && joinDate.getFullYear() === now.getFullYear();
    }).length;
    
    const lastMonth = employees.filter((e: any) => {
      const joinDate = new Date(e.joining_date || e.created_at);
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return joinDate.getMonth() === lastMonth.getMonth() && joinDate.getFullYear() === lastMonth.getFullYear();
    }).length;

    return { thisMonth, lastMonth, total: filteredHires.length };
  }, [filteredHires, employees]);

  if (isLoading) {
    return <PageLoadingState label="Loading employee data..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load employee data. Please try again." />;
  }

  return (
    <div className="min-h-screen bg-slate-50/50 pb-8">
      <PageHeader
        title="New Hires"
        description={`Track and manage recently joined employees - ${dateRangeLabel}`}
        actions={
          <div className="flex items-center gap-2">
            <Link to="/dashboard">
              <Button variant="secondary" size="sm" className="gap-1">
                <ArrowLeft className="h-4 w-4" />
                Back to Dashboard
              </Button>
            </Link>
          </div>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Stats Cards */}
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <SurfaceCard className="p-4 border-l-4 border-l-violet-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">New Hires ({dateRangeLabel})</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.total}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-violet-100">
                <UserPlus className="h-5 w-5 text-violet-600" />
              </div>
            </div>
          </SurfaceCard>
          
          <SurfaceCard className="p-4 border-l-4 border-l-emerald-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">This Month</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.thisMonth}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                <Calendar className="h-5 w-5 text-emerald-600" />
              </div>
            </div>
          </SurfaceCard>
          
          <SurfaceCard className="p-4 border-l-4 border-l-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Last Month</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{stats.lastMonth}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
            </div>
          </SurfaceCard>
        </div>

        {/* Filters */}
        <SurfaceCard className="mb-6 p-4">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, email, department..."
                className="w-full min-w-[250px] bg-transparent text-sm outline-none placeholder:text-slate-400"
              />
            </div>
            
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-500">Show hires from:</span>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as any)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
              >
                <option value="7">Last 7 days</option>
                <option value="30">Last 30 days</option>
                <option value="90">Last 3 months</option>
                <option value="365">Last year</option>
                <option value="all">All time</option>
              </select>
            </div>
          </div>
        </SurfaceCard>

        {/* Hires Table */}
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Recent Hires {filteredHires.length > 0 && `(${filteredHires.length})`}
            </h3>
          </div>
          
          {filteredHires.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Contact</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Joining Date</th>
                    <th className="px-4 py-3 font-medium">Role</th>
                    <th className="px-4 py-3 font-medium">Days Since Joined</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredHires.map((employee: any) => {
                    const joinDate = new Date(employee.joining_date || employee.created_at);
                    const daysSince = Math.floor((new Date().getTime() - joinDate.getTime()) / (1000 * 60 * 60 * 24));
                    
                    return (
                      <tr key={employee.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-violet-100 to-violet-200 text-sm font-semibold text-violet-700">
                              {employee.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium text-slate-900">{employee.name}</p>
                              <p className="text-xs text-slate-500">{employee.employee_code || 'No Code'}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-slate-600">
                            <Mail className="h-3.5 w-3.5" />
                            <span className="text-xs">{employee.email}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 text-slate-600">
                            <Building2 className="h-3.5 w-3.5" />
                            <span className="text-xs">{resolveEmployeeDepartment(employee)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDate(employee.joining_date || employee.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 capitalize">
                            {resolveUserRoleLabel(employee)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium ${
                            daysSince <= 7 ? 'text-emerald-600' : 
                            daysSince <= 30 ? 'text-violet-600' : 'text-slate-500'
                          }`}>
                            {daysSince === 0 ? 'Today' : 
                             daysSince === 1 ? '1 day ago' : 
                             `${daysSince} days ago`}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/employees/${employee.id}`}>
                            <Button variant="secondary" size="sm" className="h-7 text-xs">
                              View Profile
                            </Button>
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-8 text-center">
              <PageEmptyState 
                title="No new hires found"
                description={`No employees have joined in the ${dateRangeLabel.toLowerCase()}. Try selecting a different time period.`}
              />
            </div>
          )}
        </SurfaceCard>
      </div>
    </div>
  );
}
