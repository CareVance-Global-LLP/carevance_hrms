import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { userApi } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import { PageLoadingState, PageErrorState, PageEmptyState } from '@/components/ui/PageState';
import { Search, UserMinus, Calendar, AlertCircle, Clock, ArrowLeft, Building2, Mail, CheckCircle2 } from 'lucide-react';
import Button from '@/components/ui/Button';
import { formatDate } from '@/lib/dateTime';

interface ExitRecord {
  id: number;
  name: string;
  email: string;
  role: string;
  department: string;
  employee_code?: string;
  employment_status?: 'active' | 'inactive' | 'notice' | 'exited';
  exit_date?: string;
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

export default function ResignationsPage() {
  const { user, isLoading: isAuthLoading, isAuthenticated } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'notice' | 'exited'>('all');

  const { data: employees = [], isLoading, error } = useQuery({
    queryKey: ['resignations-employees'],
    queryFn: async () => {
      const response = await userApi.getAll();
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

  const exitData = useMemo(() => {
    const inNotice = employees.filter((e: any) => 
      e.employment_status === 'notice' && !e.exit_date
    );
    
    const exited = employees.filter((e: any) => 
      e.exit_date || e.employment_status === 'exited'
    );
    
    const allExits = [...inNotice, ...exited];
    
    return {
      inNotice,
      exited,
      allExits,
      noticeCount: inNotice.length,
      exitedCount: exited.length,
      totalCount: allExits.length,
    };
  }, [employees]);

  const filteredExits = useMemo(() => {
    let data = exitData.allExits;
    
    // Apply status filter
    if (statusFilter !== 'all') {
      if (statusFilter === 'notice') {
        data = exitData.inNotice;
      } else if (statusFilter === 'exited') {
        data = exitData.exited;
      }
    }
    
    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      data = data.filter((employee: any) =>
        employee.name.toLowerCase().includes(query) ||
        employee.email.toLowerCase().includes(query) ||
        resolveEmployeeDepartment(employee).toLowerCase().includes(query) ||
        (employee.employee_code || '').toLowerCase().includes(query)
      );
    }
    
    return data.sort((a: any, b: any) => {
      // Sort by exit date (nulls first - active notice periods)
      if (!a.exit_date && b.exit_date) return -1;
      if (a.exit_date && !b.exit_date) return 1;
      if (a.exit_date && b.exit_date) {
        return new Date(b.exit_date).getTime() - new Date(a.exit_date).getTime();
      }
      return 0;
    });
  }, [exitData, statusFilter, searchQuery]);

  const calculateNoticePeriodDays = (joinDate?: string, exitDate?: string): number => {
    if (!joinDate || !exitDate) return 30; // Default 30 days
    const join = new Date(joinDate);
    const exit = new Date(exitDate);
    const diffTime = exit.getTime() - join.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  };

  if (isLoading) {
    return <PageLoadingState label="Loading employee data..." />;
  }

  if (error) {
    return <PageErrorState message="Failed to load employee data. Please try again." />;
  }

  return (
    <div className="min-h-screen bg-slate-50/50 pb-8">
      <PageHeader
        title="Resignations & Exit Tracking"
        description="Monitor employees in notice period and track exits"
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
        <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-4">
          <SurfaceCard className="p-4 border-l-4 border-l-amber-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">In Notice Period</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{exitData.noticeCount}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100">
                <AlertCircle className="h-5 w-5 text-amber-600" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Currently serving notice</p>
          </SurfaceCard>
          
          <SurfaceCard className="p-4 border-l-4 border-l-slate-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Exited This Month</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">
                  {exitData.exited.filter((e: any) => {
                    if (!e.exit_date) return false;
                    const exit = new Date(e.exit_date);
                    const now = new Date();
                    return exit.getMonth() === now.getMonth() && exit.getFullYear() === now.getFullYear();
                  }).length}
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100">
                <UserMinus className="h-5 w-5 text-slate-600" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Left this month</p>
          </SurfaceCard>
          
          <SurfaceCard className="p-4 border-l-4 border-l-rose-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Total Exits (All Time)</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">{exitData.exitedCount}</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-100">
                <CheckCircle2 className="h-5 w-5 text-rose-600" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Cumulative exits</p>
          </SurfaceCard>

          <SurfaceCard className="p-4 border-l-4 border-l-blue-500">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-slate-500">Attrition Rate</p>
                <p className="mt-1 text-2xl font-semibold text-slate-950">
                  {employees.length > 0 ? ((exitData.exitedCount / employees.length) * 100).toFixed(1) : '0.0'}%
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
            </div>
            <p className="mt-2 text-[11px] text-slate-500">Exits / Total employees</p>
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
              <span className="text-sm text-slate-500">Filter by status:</span>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 outline-none"
              >
                <option value="all">All Status</option>
                <option value="notice">In Notice Period</option>
                <option value="exited">Exited</option>
              </select>
            </div>
          </div>
        </SurfaceCard>

        {/* Exit Tracking Table */}
        <SurfaceCard className="p-0 overflow-hidden">
          <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900">
              Exit Tracking {filteredExits.length > 0 && `(${filteredExits.length})`}
            </h3>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-amber-500"></span>
                Notice Period
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-slate-400"></span>
                Exited
              </span>
            </div>
          </div>
          
          {filteredExits.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Employee</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Exit Date</th>
                    <th className="px-4 py-3 font-medium">Notice Period</th>
                    <th className="px-4 py-3 font-medium">Remaining / Since Exit</th>
                    <th className="px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredExits.map((employee: any) => {
                    const isInNotice = employee.employment_status === 'notice' && !employee.exit_date;
                    const exitDate = employee.exit_date ? new Date(employee.exit_date) : null;
                    const daysUntilExit = exitDate 
                      ? Math.floor((exitDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
                      : null;
                    const daysSinceExit = exitDate
                      ? Math.floor((new Date().getTime() - exitDate.getTime()) / (1000 * 60 * 60 * 24))
                      : null;
                    
                    const noticeDays = calculateNoticePeriodDays(
                      employee.joining_date || employee.created_at,
                      employee.exit_date
                    );
                    
                    return (
                      <tr key={employee.id} className="hover:bg-slate-50/50">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold ${
                              isInNotice 
                                ? 'bg-gradient-to-br from-amber-100 to-amber-200 text-amber-700' 
                                : 'bg-gradient-to-br from-slate-100 to-slate-200 text-slate-600'
                            }`}>
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
                            <Building2 className="h-3.5 w-3.5" />
                            <span className="text-xs">{resolveEmployeeDepartment(employee)}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {isInNotice ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium text-amber-700">
                              <AlertCircle className="h-3 w-3" />
                              Notice Period
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                              <CheckCircle2 className="h-3 w-3" />
                              Exited
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          {exitDate ? (
                            <div className="flex items-center gap-1">
                              <Calendar className="h-3.5 w-3.5" />
                              {formatDate(employee.exit_date)}
                            </div>
                          ) : (
                            <span className="text-slate-400">Not set</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600">
                          <span className="text-xs">{noticeDays} days</span>
                        </td>
                        <td className="px-4 py-3">
                          {isInNotice ? (
                            <div>
                              {daysUntilExit !== null && daysUntilExit > 0 ? (
                                <div className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5 text-amber-500" />
                                  <span className="text-xs font-medium text-amber-600">
                                    {daysUntilExit} days left
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs font-medium text-rose-600">
                                  Last day today
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-400">
                              Exited {daysSinceExit === 0 ? 'today' : daysSinceExit === 1 ? 'yesterday' : `${daysSinceExit} days ago`}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Link to={`/employees/${employee.id}`}>
                            <Button variant="secondary" size="sm" className="h-7 text-xs">
                              {isInNotice ? 'Manage Exit' : 'View History'}
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
                title="No exits found"
                description={statusFilter === 'all' 
                  ? "No employees are currently in notice period or have exited."
                  : `No employees found with status: ${statusFilter}.`
                }
              />
            </div>
          )}
        </SurfaceCard>

        {/* Info Card */}
        <SurfaceCard className="mt-6 p-4 bg-blue-50/50 border-blue-200">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 mt-0.5">
              <Clock className="h-4 w-4 text-blue-600" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-slate-900">Notice Period Policy</h4>
              <p className="mt-1 text-xs text-slate-600">
                The standard notice period is 30 days from the date of resignation. 
                HR should ensure proper handover and exit procedures are completed before the exit date.
                Update employee status in their profile when they submit resignation or complete their exit.
              </p>
            </div>
          </div>
        </SurfaceCard>
      </div>
    </div>
  );
}
