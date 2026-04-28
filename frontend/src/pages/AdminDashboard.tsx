import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bell,
  Briefcase,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileBarChart,
  FileClock,
  Gift,
  Megaphone,
  Plus,
  Search,
  Settings,
  TimerReset,
  Umbrella,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import {
  attendanceApi,
  auditApi,
  dashboardApi,
  leaveApi,
  notificationApi,
  payrollApi,
  reportApi,
  reportGroupApi,
  taskApi,
  userApi,
} from '@/services/api';

type DashboardEmployee = {
  id: number;
  name: string;
  email: string;
  department: string;
  position: string;
  status: 'Active' | 'Inactive' | 'On Leave';
  avatar?: string | null;
  created_at?: string | null;
  date_of_birth?: string | null;
  joining_date?: string | null;
  exit_date?: string | null;
};

type DashboardActivity = {
  id: number;
  title: string;
  meta: string;
  tone: 'green' | 'blue' | 'amber';
};

type TimesheetRow = {
  key: string;
  project: string;
  task: string;
  days: string[];
  daySeconds: number[];
  totalSeconds: number;
};

const departmentPalette = ['#2563eb', '#22c55e', '#f97316', '#8b5cf6', '#14b8a6', '#f59e0b', '#64748b'];
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthIso = () => new Date().toISOString().slice(0, 7);

const startOfWeek = (date = new Date()) => {
  const copy = new Date(date);
  const day = copy.getDay() || 7;
  copy.setDate(copy.getDate() - day + 1);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const endOfWeek = (date = new Date()) => {
  const start = startOfWeek(date);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return end;
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const formatCompactDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount || 0));

const formatDate = (value?: string | null) => {
  if (!value) return 'Today';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Today';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

const humanizeAction = (action?: string | null) =>
  String(action || 'activity')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const safeArray = <T,>(value: unknown): T[] => Array.isArray(value) ? value as T[] : [];

const normalizeEmployee = (item: any): DashboardEmployee => {
  const workInfo = item?.employee_work_info || item?.employeeWorkInfo || item?.work_info || {};
  const profile = item?.employee_profile || item?.employeeProfile || item?.profile || {};
  const department = workInfo?.department?.name || item?.department || item?.groups?.[0]?.name || 'Unassigned';
  const employmentStatus = String(workInfo?.employment_status || '').toLowerCase();

  return {
    id: Number(item?.id || 0),
    name: profile?.display_name || item?.name || 'Unnamed employee',
    email: item?.email || '',
    department,
    position: workInfo?.designation || item?.position || item?.designation || item?.job_title || item?.role || 'Not set',
    status: item?.is_active === false || ['inactive', 'exited', 'terminated'].includes(employmentStatus) ? 'Inactive' : 'Active',
    avatar: item?.avatar || null,
    created_at: item?.created_at || null,
    date_of_birth: profile?.date_of_birth || null,
    joining_date: workInfo?.joining_date || null,
    exit_date: workInfo?.exit_date || null,
  };
};

const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <section className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
);

const SectionTitle = ({ title, action }: { title: string; action?: ReactNode }) => (
  <div className="mb-4 flex items-center justify-between gap-3">
    <h2 className="text-[15px] font-semibold text-slate-950">{title}</h2>
    {action ?? <span />}
  </div>
);

const EmptyInline = ({ children }: { children: ReactNode }) => (
  <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-xs text-slate-500">
    {children}
  </div>
);

const KpiCard = ({ label, value, hint, icon: Icon, tint }: { label: string; value: string | number; hint: string; icon: any; tint: string }) => (
  <Card className="p-4">
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className="mt-3 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        <p className="mt-2 text-[11px] text-slate-500">{hint}</p>
      </div>
      <div className={`flex h-10 w-10 items-center justify-center rounded-full ${tint}`}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </Card>
);

const MiniLineChart = ({ values }: { values: number[] }) => {
  const chartValues = values.length ? values : [0, 0, 0, 0, 0, 0, 0];
  const max = Math.max(1, ...chartValues);
  const points = chartValues.map((value, index) => {
    const x = 16 + index * (268 / Math.max(1, chartValues.length - 1));
    const y = 142 - (value / max) * 112;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg viewBox="0 0 310 160" className="h-44 w-full">
      {[0, 1, 2, 3].map((line) => (
        <line key={line} x1="16" x2="294" y1={32 + line * 34} y2={32 + line * 34} stroke="#eef2f7" />
      ))}
      <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2.5" />
      {points.split(' ').map((point, index) => {
        const [cx, cy] = point.split(',');
        return <circle key={index} cx={cx} cy={cy} r="3" fill="#fff" stroke="#2563eb" strokeWidth="2" />;
      })}
      {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, index) => (
        <text key={day} x={16 + index * 44} y="156" fill="#94a3b8" fontSize="10">{day}</text>
      ))}
    </svg>
  );
};

const DonutChart = ({ items }: { items: Array<{ label: string; value: number; color: string; bgClass: string }> }) => {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return <EmptyInline>No leave data yet</EmptyInline>;
  }

  let cursor = 0;
  const gradient = items.map((item) => {
    const start = cursor;
    const end = cursor + (item.value / total) * 100;
    cursor = end;
    return `${item.color} ${start}% ${end}%`;
  }).join(', ');

  return (
    <div className="flex items-center gap-6">
      <div className="relative h-36 w-36 rounded-full" style={{ background: `conic-gradient(${gradient})` }}>
        <div className="absolute inset-7 flex flex-col items-center justify-center rounded-full bg-white">
          <span className="text-2xl font-semibold text-slate-950">{total}</span>
          <span className="text-xs text-slate-500">Days</span>
        </div>
      </div>
      <div className="flex-1 space-y-3 text-xs">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-slate-600"><span className={`h-2.5 w-2.5 rounded-sm ${item.bgClass}`} />{item.label}</span>
            <span className="text-slate-500">{item.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default function AdminDashboard() {
  const { user } = useAuth();
  const [employeeSearch, setEmployeeSearch] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const now = new Date();
  const weekStart = startOfWeek(now);
  const weekEnd = endOfWeek(now);
  const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const weekRangeLabel = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

  const dashboardQuery = useQuery({
    queryKey: ['real-admin-dashboard', todayIso(), toIsoDate(weekStart), toIsoDate(weekEnd)],
    queryFn: async () => {
      const [
        usersResponse,
        attendanceResponse,
        leaveResponse,
        overallResponse,
        dashboardResponse,
        tasksResponse,
        payrollResponse,
        notificationsResponse,
        groupsResponse,
        auditResponse,
        weeklyResponse,
        monthlyResponse,
      ] = await Promise.allSettled([
        userApi.getAll(),
        attendanceApi.summary({ start_date: todayIso(), end_date: todayIso() }),
        leaveApi.list({ status: 'approved' }),
        reportApi.overall({ start_date: todayIso(), end_date: todayIso() }),
        dashboardApi.summary(),
        taskApi.getAll(),
        payrollApi.getRecords({ payroll_month: monthIso() }),
        notificationApi.list({ limit: 8 }),
        reportGroupApi.list(),
        auditApi.list({ per_page: 8 }),
        reportApi.weekly({ start_date: toIsoDate(weekStart), end_date: toIsoDate(weekEnd), scope: 'organization' }),
        reportApi.monthly({ scope: 'organization' }),
      ]);

      return {
        employees: usersResponse.status === 'fulfilled' ? safeArray<any>(usersResponse.value.data).map(normalizeEmployee).filter((employee) => employee.id > 0) : [],
        attendanceRows: attendanceResponse.status === 'fulfilled' ? safeArray<any>(attendanceResponse.value.data?.data) : [],
        leaves: leaveResponse.status === 'fulfilled' ? safeArray<any>(leaveResponse.value.data?.data) : [],
        overall: overallResponse.status === 'fulfilled' ? overallResponse.value.data : { summary: {}, by_day: [], by_user: [] },
        summary: dashboardResponse.status === 'fulfilled' ? dashboardResponse.value.data : {},
        tasks: tasksResponse.status === 'fulfilled' ? safeArray<any>(tasksResponse.value.data) : [],
        payrollRecords: payrollResponse.status === 'fulfilled' ? safeArray<any>(payrollResponse.value.data?.data) : [],
        notifications: notificationsResponse.status === 'fulfilled' ? safeArray<any>(notificationsResponse.value.data?.data) : [],
        groups: groupsResponse.status === 'fulfilled' ? safeArray<any>(groupsResponse.value.data?.data) : [],
        auditLogs: auditResponse.status === 'fulfilled' ? safeArray<any>(auditResponse.value.data?.data) : [],
        weeklyReport: weeklyResponse.status === 'fulfilled' ? weeklyResponse.value.data : { time_entries: [], by_project: [], total_duration: 0 },
        monthlyReport: monthlyResponse.status === 'fulfilled' ? monthlyResponse.value.data : { by_day: [] },
      };
    },
  });

  const data = dashboardQuery.data || {
    employees: [],
    attendanceRows: [],
    leaves: [],
    overall: { summary: {}, by_day: [], by_user: [] },
    summary: {},
    tasks: [],
    payrollRecords: [],
    notifications: [],
    groups: [],
    auditLogs: [],
    weeklyReport: { time_entries: [], by_project: [], total_duration: 0 },
    monthlyReport: { by_day: [] },
  };

  const leavesToday = data.leaves.filter((leave: any) =>
    leave.status === 'approved' && String(leave.start_date || '') <= todayIso() && String(leave.end_date || '') >= todayIso()
  );
  const leaveUserIdsToday = new Set(leavesToday.map((leave: any) => Number(leave.user_id)));
  const employees = data.employees.map((employee) => leaveUserIdsToday.has(employee.id) ? { ...employee, status: 'On Leave' as const } : employee);

  const departments = useMemo(() => {
    const names = Array.from(new Set(employees.map((employee) => employee.department).filter(Boolean)));
    return ['All', ...names];
  }, [employees]);

  const filteredEmployees = employees
    .filter((employee) => departmentFilter === 'All' || employee.department === departmentFilter)
    .filter((employee) => statusFilter === 'All' || employee.status === statusFilter)
    .filter((employee) => {
      const term = employeeSearch.trim().toLowerCase();
      if (!term) return true;
      return [employee.name, employee.email, employee.department, employee.position].some((value) => value.toLowerCase().includes(term));
    });

  const totalEmployees = employees.length;
  const presentToday = data.attendanceRows.filter((row: any) => Number(row.present_days || 0) > 0 || row.is_checked_in).length;
  const lateToday = data.attendanceRows.reduce((sum: number, row: any) => sum + Number(row.late_days || 0), 0);
  const onLeave = leavesToday.length;
  const newHires = employees.filter((employee) => String(employee.joining_date || employee.created_at || '').startsWith(monthIso())).length;
  const resignations = employees.filter((employee) => String(employee.exit_date || '').startsWith(monthIso())).length;
  const totalDuration = Number(data.overall.summary?.total_duration || data.summary?.today_total_elapsed_duration || 0);
  const weeklyReport: any = data.weeklyReport || {};
  const weeklyTotal = Number(weeklyReport.total_duration || data.summary?.weekly_total_elapsed_duration || 0);
  const activeTimer = data.summary?.active_timer;
  const activeTimerSeconds = activeTimer?.start_time ? Math.max(0, Math.floor((Date.now() - new Date(activeTimer.start_time).getTime()) / 1000)) : 0;

  const attendanceTrend = (data.monthlyReport?.by_day?.length ? data.monthlyReport.by_day : data.overall.by_day || [])
    .slice(-7)
    .map((item: any) => Math.max(0, Math.round(Number(item.working_duration || item.total_duration || item.total_time || 0) / 3600)));

  const activities: DashboardActivity[] = data.auditLogs.map((item: any, index: number) => ({
    id: Number(item.id || index),
    title: `${item.actor?.name || 'System'}: ${humanizeAction(item.action)}`,
    meta: formatDate(item.created_at),
    tone: index % 3 === 0 ? 'green' : index % 3 === 1 ? 'blue' : 'amber',
  }));

  const announcements = data.notifications.slice(0, 4).map((item: any, index: number) => ({
    id: Number(item.id || index),
    title: item.title || item.message || 'Notification',
    date: formatDate(item.created_at),
  }));

  const upcomingBirthdays = employees
    .filter((employee) => employee.date_of_birth)
    .map((employee) => {
      const birthDate = new Date(String(employee.date_of_birth));
      const nextDate = new Date(now.getFullYear(), birthDate.getMonth(), birthDate.getDate());
      if (nextDate < now) nextDate.setFullYear(now.getFullYear() + 1);
      return { ...employee, nextBirthday: nextDate };
    })
    .sort((a, b) => a.nextBirthday.getTime() - b.nextBirthday.getTime())
    .slice(0, 4);

  const departmentCounts = departments
    .filter((department) => department !== 'All')
    .map((department) => ({
      department,
      count: employees.filter((employee) => employee.department === department).length,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 7);

  const leaveSummary: Array<{ label: string; value: number; color: string; bgClass: string }> = Object.values(data.leaves
    .filter((leave: any) => leave.status === 'approved' && String(leave.start_date || '').startsWith(monthIso()))
    .reduce((acc: Record<string, { label: string; value: number; color: string; bgClass: string }>, leave: any, index: number) => {
      const key = String(leave.leave_type || 'full_day');
      const label = key.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      const units = key === 'half_day' ? 0.5 : Math.max(1, Math.ceil((new Date(leave.end_date).getTime() - new Date(leave.start_date).getTime()) / 86400000) + 1);
      acc[key] = acc[key] || { label, value: 0, color: departmentPalette[index % departmentPalette.length], bgClass: ['bg-blue-600', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500'][index % 4] };
      acc[key].value += units;
      return acc;
    }, {}));

  const weeklyEntries = safeArray<any>(weeklyReport.time_entries || weeklyReport.entries);
  const weekDates = Array.from({ length: 7 }).map((_, index) => {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + index);
    return day;
  });
  const timesheetRows: TimesheetRow[] = Object.values(weeklyEntries.reduce((acc: Record<string, TimesheetRow>, entry: any) => {
    const project = entry.project?.name || entry.task?.project?.name || entry.task?.group?.name || 'Unassigned';
    const task = entry.task?.title || entry.description || 'Time entry';
    const key = `${project}-${task}`;
    const duration = Number(entry.effective_duration || entry.duration || 0);
    const entryDate = String(entry.start_time || '').slice(0, 10);
    const dayIndex = weekDates.findIndex((day) => toIsoDate(day) === entryDate);
    acc[key] = acc[key] || { key, project, task, days: Array.from({ length: 7 }).map(() => '-'), daySeconds: Array.from({ length: 7 }).map(() => 0), totalSeconds: 0 };
    if (dayIndex >= 0) {
      acc[key].daySeconds[dayIndex] += duration;
      acc[key].days[dayIndex] = formatCompactDuration(acc[key].daySeconds[dayIndex]);
    }
    acc[key].totalSeconds += duration;
    return acc;
  }, {}));

  const recentTimers = weeklyEntries.slice(0, 4);
  const projectProgress = (weeklyReport.by_project?.length ? weeklyReport.by_project : [])
    .filter((item: any) => item.project?.name || item.total_time)
    .slice(0, 5)
    .map((item: any) => ({
      name: item.project?.name || 'Unassigned project',
      hours: formatDuration(Number(item.total_time || 0)),
      status: 'Active',
      percent: Math.min(100, Math.round((Number(item.total_time || 0) / Math.max(1, weeklyTotal)) * 100)),
    }));

  const payrollTotal = data.payrollRecords.reduce((sum: number, record: any) => sum + Number(record.net_pay || record.gross_pay || 0), 0);
  const payrollDeductions = data.payrollRecords.reduce((sum: number, record: any) => sum + Number(record.deductions || record.tax || 0), 0);
  const presentPercent = totalEmployees ? Math.round((presentToday / totalEmployees) * 100) : 0;
  const leavePercent = totalEmployees ? Math.round((onLeave / totalEmployees) * 100) : 0;
  const latePercent = totalEmployees ? Math.round((lateToday / totalEmployees) * 100) : 0;

  return (
    <div className="min-w-[1120px] space-y-4 bg-[#f5f7fb] text-slate-900">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Dashboard</h1>
          <p className="mt-3 text-sm font-medium text-slate-900">Good morning, {user?.name?.split(' ')[0] || 'there'}!</p>
          <p className="mt-1 text-xs text-slate-500">Here&apos;s what&apos;s happening in your organization today.</p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex h-10 w-64 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-400">
            <Search className="h-4 w-4" />
            <input className="w-full bg-transparent outline-none placeholder:text-slate-400" placeholder="Search anything..." />
          </label>
          <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700">{dateLabel}</button>
          <Link aria-label="Notifications" to="/notifications" className="relative rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
            <Bell className="h-4 w-4" />
            {announcements.length ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500" /> : null}
          </Link>
          <Link aria-label="Settings" to="/settings" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-6 gap-3">
        <KpiCard label="Total Employees" value={totalEmployees} hint={`${newHires} new this month`} icon={Users} tint="bg-blue-50 text-blue-600" />
        <KpiCard label="Present Today" value={presentToday} hint={`${presentPercent}% of total`} icon={UserPlus} tint="bg-emerald-50 text-emerald-600" />
        <KpiCard label="On Leave" value={onLeave} hint={`${leavePercent}% of total`} icon={Umbrella} tint="bg-amber-50 text-amber-600" />
        <KpiCard label="Late Today" value={lateToday} hint={`${latePercent}% of total`} icon={Clock3} tint="bg-rose-50 text-rose-600" />
        <KpiCard label="New Hires" value={String(newHires).padStart(2, '0')} hint="Joined this month" icon={UserPlus} tint="bg-violet-50 text-violet-600" />
        <KpiCard label="Resignations" value={String(resignations).padStart(2, '0')} hint="Exited this month" icon={UserMinus} tint="bg-slate-100 text-slate-600" />
      </section>

      <section className="grid grid-cols-[1.4fr_1fr_1fr] gap-4">
        <Card className="p-4">
          <SectionTitle title="Attendance Overview" action={<button className="text-xs text-slate-500">This Week</button>} />
          <MiniLineChart values={attendanceTrend} />
        </Card>
        <Card className="p-4">
          <SectionTitle title="Leave Summary" action={<button className="text-xs text-slate-500">This Month</button>} />
          <DonutChart items={leaveSummary} />
        </Card>
        <Card className="p-4">
          <SectionTitle title="Department Distribution" action={<button className="text-xs text-slate-500">All Departments</button>} />
          {departmentCounts.length ? (
            <div className="space-y-3">
              {departmentCounts.map((item, index) => {
                const max = Math.max(1, ...departmentCounts.map((entry) => entry.count));
                return (
                  <div key={item.department} className="grid grid-cols-[86px_1fr_30px] items-center gap-3 text-xs">
                    <span className="truncate text-slate-600">{item.department}</span>
                    <span className="h-1.5 rounded-full bg-slate-100">
                      <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(8, (item.count / max) * 100)}%`, background: departmentPalette[index % departmentPalette.length] }} />
                    </span>
                    <span className="text-right text-slate-500">{item.count}</span>
                  </div>
                );
              })}
            </div>
          ) : <EmptyInline>No departments found</EmptyInline>}
        </Card>
      </section>

      <section className="grid grid-cols-[1fr_1fr_1fr_1.35fr_280px] gap-4">
        <Card className="p-4">
          <SectionTitle title="Upcoming Birthdays" action={<Link to="/employees" className="text-xs font-medium text-blue-600">View All</Link>} />
          {upcomingBirthdays.length ? (
            <div className="space-y-3">
              {upcomingBirthdays.map((item) => (
                <div key={item.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{initials(item.name)}</div>
                    <div>
                      <p className="text-xs font-semibold text-slate-900">{item.name}</p>
                      <p className="text-[11px] text-slate-500">{item.nextBirthday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                    </div>
                  </div>
                  <Gift className="h-4 w-4 text-rose-400" />
                </div>
              ))}
            </div>
          ) : <EmptyInline>No birthdays available</EmptyInline>}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Recent Activities" action={<Link to="/audit-logs" className="text-xs font-medium text-blue-600">View All</Link>} />
          {activities.length ? (
            <div className="space-y-3">
              {activities.map((activity) => (
                <div key={activity.id} className="grid grid-cols-[24px_1fr_auto] gap-2 text-xs">
                  <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${activity.tone === 'green' ? 'bg-emerald-50 text-emerald-600' : activity.tone === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-slate-700">{activity.title}</span>
                  <span className="text-[11px] text-slate-400">{activity.meta}</span>
                </div>
              ))}
            </div>
          ) : <EmptyInline>No recent activity yet</EmptyInline>}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Announcements" action={<Link to="/notifications" className="text-xs font-medium text-blue-600">View All</Link>} />
          {announcements.length ? (
            <div className="space-y-3">
              {announcements.map((item, index) => (
                <div key={item.id} className="flex gap-2 text-xs">
                  <Megaphone className={`mt-0.5 h-4 w-4 ${index === 0 ? 'text-amber-500' : 'text-blue-500'}`} />
                  <div>
                    <p className="text-slate-700">{item.title}</p>
                    <p className="mt-1 text-[11px] text-slate-400">{item.date}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyInline>No announcements yet</EmptyInline>}
        </Card>

        <Card className="row-span-2 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">Employees</h2>
            <Link to="/employees" className="text-xs font-medium text-blue-600">View All</Link>
          </div>
          <div className="mb-4 grid grid-cols-[1fr_120px_100px_auto] gap-2">
            <label className="flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-xs text-slate-400">
              <Search className="h-3.5 w-3.5" />
              <input value={employeeSearch} onChange={(event) => setEmployeeSearch(event.target.value)} className="w-full bg-transparent outline-none" placeholder="Search employees..." />
            </label>
            <select value={departmentFilter} onChange={(event) => setDepartmentFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600">
              {departments.map((department) => <option key={department}>{department}</option>)}
            </select>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-600">
              {['All', 'Active', 'Inactive', 'On Leave'].map((status) => <option key={status}>{status}</option>)}
            </select>
            <Link to="/add-user" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              Add Employee
            </Link>
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-100">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Position</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredEmployees.slice(0, 8).map((employee) => (
                  <tr key={employee.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{initials(employee.name)}</div>
                        <div>
                          <p className="font-semibold text-slate-900">{employee.name}</p>
                          <p className="text-[11px] text-slate-500">{employee.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{employee.department}</td>
                    <td className="px-4 py-3 text-slate-600">{employee.position}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${employee.status === 'Active' ? 'bg-emerald-50 text-emerald-700' : employee.status === 'On Leave' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{employee.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredEmployees.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No employees found</EmptyInline></div> : null}
          </div>
          <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
            <span>Showing {filteredEmployees.length ? 1 : 0} to {Math.min(8, filteredEmployees.length)} of {employees.length}</span>
            <div className="flex items-center gap-1">
              <button className="rounded border border-slate-200 px-2 py-1"><ChevronLeft className="h-3.5 w-3.5" /></button>
              <button className="rounded bg-blue-600 px-2.5 py-1 text-white">1</button>
              <button className="rounded border border-slate-200 px-2 py-1"><ChevronRight className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        </Card>

        <Card className="row-span-3 p-4">
          <div className="mb-5 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">Time Tracker</h2>
            <Settings className="h-4 w-4 text-slate-400" />
          </div>
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-5 text-center">
            <p className="text-xs text-slate-500">{activeTimer ? 'You are on the clock' : 'No active timer'}</p>
            <p className="mt-2 text-3xl font-semibold text-blue-600">{activeTimer ? formatCompactDuration(activeTimerSeconds) : '00:00'}</p>
          </div>
          <div className="mt-4 space-y-3 rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><Briefcase className="h-4 w-4" />Project</span>
              <span className="truncate font-semibold text-slate-900">{activeTimer?.project?.name || activeTimer?.task?.project?.name || 'Not assigned'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><FileClock className="h-4 w-4" />Task</span>
              <span className="truncate font-semibold text-slate-900">{activeTimer?.task?.title || 'Not assigned'}</span>
            </div>
            {activeTimer ? <button className="mt-2 h-10 w-full rounded-lg bg-rose-500 text-sm font-semibold text-white">Stop</button> : null}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">Today</p>
              <p className="mt-2 text-lg font-semibold">{formatDuration(totalDuration)}</p>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">This Week</p>
              <p className="mt-2 text-lg font-semibold">{formatDuration(weeklyTotal)}</p>
            </div>
          </div>
          <div className="mt-5">
            <SectionTitle title="Recent Timers" action={<Link to="/reports/hours-tracked" className="text-xs font-medium text-blue-600">View All</Link>} />
            {recentTimers.length ? (
              <div className="space-y-3">
                {recentTimers.map((entry: any) => (
                  <div key={entry.id} className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-slate-500"><TimerReset className="h-4 w-4" /></div>
                      <div>
                        <p className="font-semibold text-slate-900">{entry.project?.name || entry.task?.project?.name || entry.task?.group?.name || 'Unassigned'}</p>
                        <p className="text-[11px] text-slate-500">{entry.task?.title || entry.description || 'Time entry'}</p>
                      </div>
                    </div>
                    <span className="text-slate-500">{formatCompactDuration(Number(entry.effective_duration || entry.duration || 0))}</span>
                  </div>
                ))}
              </div>
            ) : <EmptyInline>No recent timers</EmptyInline>}
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-[1.4fr_0.48fr_0.42fr_0.42fr_0.55fr_280px] gap-4">
        <Card className="col-span-2 p-4">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Timesheets</h2>
              <span className="text-sm text-slate-500">{weekRangeLabel}</span>
            </div>
            <Link to="/reports/hours-tracked" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Open Timesheets</Link>
          </div>
          {timesheetRows.length ? (
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-3 font-medium">Project / Task</th>
                  {weekDates.map((day) => <th key={toIsoDate(day)} className="pb-3 text-center font-medium">{day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</th>)}
                  <th className="pb-3 text-center font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {timesheetRows.map((row) => (
                  <tr key={row.key}>
                    <td className="py-4"><p className="font-semibold text-slate-900">{row.project}</p><p className="text-[11px] text-slate-500">{row.task}</p></td>
                    {row.days.map((day, index) => <td key={index} className="py-4 text-center text-slate-600">{day}</td>)}
                    <td className="py-4 text-center font-semibold text-blue-700">{formatCompactDuration(row.totalSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <EmptyInline>No time entries this week</EmptyInline>}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Calendar" action={<button className="text-xs text-slate-500">Month</button>} />
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-slate-500">
            {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}
            {Array.from({ length: 35 }).map((_, index) => {
              const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
              const dayNumber = index - monthStart.getDay() + 1;
              const isValid = dayNumber > 0 && dayNumber <= new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
              const isToday = isValid && dayNumber === now.getDate();
              return <span key={index} className={`rounded-md py-1 ${isToday ? 'bg-blue-600 text-white' : 'text-slate-600'}`}>{isValid ? dayNumber : ''}</span>;
            })}
          </div>
        </Card>

        <Card className="p-4">
          <SectionTitle title="Leave Balance" action={<Link to="/approval-inbox" className="text-xs font-medium text-blue-600">View All</Link>} />
          {leaveSummary.length ? (
            <div className="space-y-4">
              {leaveSummary.map((item) => (
                <div key={item.label}>
                  <div className="mb-1 flex justify-between text-xs"><span>{item.label}</span><span className="text-slate-500">{item.value} used</span></div>
                  <div className="h-1.5 rounded-full bg-slate-100"><span className={`block h-1.5 rounded-full ${item.bgClass}`} style={{ width: `${Math.min(100, item.value * 10)}%` }} /></div>
                </div>
              ))}
            </div>
          ) : <EmptyInline>No leave balance records</EmptyInline>}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Payroll Summary" action={<Link to="/payroll" className="text-xs text-blue-600">{monthIso()}</Link>} />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Total Payroll Cost</p><p className="mt-2 font-semibold">{formatCurrency(payrollTotal + payrollDeductions)}</p></div>
            <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Net Pay</p><p className="mt-2 font-semibold text-emerald-700">{formatCurrency(payrollTotal)}</p></div>
            <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Deductions</p><p className="mt-2 font-semibold text-rose-600">{formatCurrency(payrollDeductions)}</p></div>
            <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Employees Paid</p><p className="mt-2 font-semibold">{data.payrollRecords.length}</p></div>
          </div>
        </Card>

        <Card className="row-span-2 p-4">
          <SectionTitle title="Projects" action={<Link to="/tasks" className="text-xs font-medium text-blue-600">View All</Link>} />
          {projectProgress.length ? (
            <div className="space-y-3">
              {projectProgress.map((project: any) => (
                <div key={project.name} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between text-xs">
                    <p className="font-semibold text-slate-900">{project.name}</p>
                    <span className="text-emerald-600">{project.status}</span>
                  </div>
                  <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{project.hours}</span>
                    <span>{project.percent}%</span>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyInline>No projects yet</EmptyInline>}
        </Card>

        <Card className="p-4">
          <SectionTitle title="Reports" action={<Link to="/reports/attendance" className="text-xs font-medium text-blue-600">View All</Link>} />
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Attendance Report', '/reports/attendance'],
              ['Leave Report', '/approval-inbox'],
              ['Payroll Report', '/payroll'],
              ['Timesheet Report', '/reports/hours-tracked'],
              ['Project Report', '/reports/projects-tasks'],
              ['Custom Report', '/reports/custom-export'],
            ].map(([report, to]) => (
              <Link key={report} to={to} className="flex min-h-20 flex-col items-center justify-center gap-2 rounded-lg border border-slate-100 bg-slate-50 text-center text-[11px] font-medium text-slate-700">
                <FileBarChart className="h-5 w-5 text-blue-600" />
                {report}
              </Link>
            ))}
          </div>
        </Card>

        <Card className="col-span-2 p-4">
          <SectionTitle title="Attendance Trend" action={<button className="text-xs text-slate-500">This Month</button>} />
          <MiniLineChart values={attendanceTrend} />
        </Card>
      </section>

      {dashboardQuery.isFetching ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">Refreshing dashboard data from the database...</div>
      ) : null}
    </div>
  );
}
