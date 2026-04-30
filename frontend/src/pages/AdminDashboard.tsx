import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  Briefcase,
  Calendar,
  CheckCircle2,
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
  payrollSimpleApi,
  reportApi,
  reportGroupApi,
  screenshotApi,
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

type TrendPoint = {
  label: string;
  detail: string;
  value: number;
  count: number;
};

type DatePreset = 'today' | 'last_2_days' | 'last_5_days' | 'last_7_days' | 'last_15_days' | 'last_month' | 'custom';

type DateRange = {
  startDate: string;
  endDate: string;
};

type DashboardScope = 'overall' | 'employee';

type PersistedDashboardFilters = {
  dashboardScope?: DashboardScope;
  selectedEmployeeId?: number | null;
  scopeDepartmentFilter?: string;
  datePreset?: DatePreset;
  customRange?: Partial<DateRange>;
};

type UniversalSuggestion = {
  id: string;
  label: string;
  description: string;
  category: 'Section' | 'Panel' | 'Employee';
  keywords: string[];
  route?: string;
  sectionId?: string;
  employeeId?: number;
};

const departmentPalette = ['#2563eb', '#22c55e', '#f97316', '#8b5cf6', '#14b8a6', '#f59e0b', '#64748b'];
const toIsoDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const todayIso = () => toIsoDate(new Date());

const resolveDateRange = (preset: DatePreset, customRange: DateRange): DateRange => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === 'custom') {
    const start = customRange.startDate || todayIso();
    const end = customRange.endDate || start;
    return start <= end ? { startDate: start, endDate: end } : { startDate: end, endDate: start };
  }

  if (preset === 'last_month') {
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const end = new Date(today.getFullYear(), today.getMonth(), 0);
    return { startDate: toIsoDate(start), endDate: toIsoDate(end) };
  }

  const daysByPreset: Record<Exclude<DatePreset, 'last_month' | 'custom'>, number> = {
    today: 1,
    last_2_days: 2,
    last_5_days: 5,
    last_7_days: 7,
    last_15_days: 15,
  };
  const start = new Date(today);
  start.setDate(today.getDate() - daysByPreset[preset] + 1);
  return { startDate: toIsoDate(start), endDate: toIsoDate(today) };
};

const datePresetOptions: Array<{ value: DatePreset; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'last_2_days', label: 'Last 2 days' },
  { value: 'last_5_days', label: 'Last 5 days' },
  { value: 'last_7_days', label: 'Last 7 days' },
  { value: 'last_15_days', label: 'Last 15 days' },
  { value: 'last_month', label: 'Last month' },
  { value: 'custom', label: 'Custom' },
];

const dashboardFilterStorageKey = 'admin-dashboard-filters';

const isDatePreset = (value: unknown): value is DatePreset =>
  datePresetOptions.some((option) => option.value === value);

const isDashboardScope = (value: unknown): value is DashboardScope =>
  value === 'overall' || value === 'employee';

const readPersistedDashboardFilters = (): PersistedDashboardFilters => {
  if (typeof window === 'undefined') return {};

  try {
    const raw = window.localStorage.getItem(dashboardFilterStorageKey);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

const dateInRange = (value: string | null | undefined, range: DateRange) => {
  if (!value) return false;
  const date = String(value).slice(0, 10);
  return date >= range.startDate && date <= range.endDate;
};

const rangesOverlap = (startValue: string | null | undefined, endValue: string | null | undefined, range: DateRange) => {
  if (!startValue && !endValue) return false;
  const start = String(startValue || endValue).slice(0, 10);
  const end = String(endValue || startValue).slice(0, 10);
  return start <= range.endDate && end >= range.startDate;
};

const enumerateDateRange = (range: DateRange) => {
  const dates: Date[] = [];
  const cursor = new Date(`${range.startDate}T00:00:00`);
  const end = new Date(`${range.endDate}T00:00:00`);
  while (cursor <= end && dates.length < 62) {
    dates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
};

const enumerateMonths = (range: DateRange) => {
  const months: string[] = [];
  const cursor = new Date(`${range.startDate.slice(0, 7)}-01T00:00:00`);
  const end = new Date(`${range.endDate.slice(0, 7)}-01T00:00:00`);
  while (cursor <= end && months.length < 24) {
    months.push(toIsoDate(cursor).slice(0, 7));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
};

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

const formatTimerClock = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Math.max(0, Number(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = Math.floor(safe % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
};

const getStartTimeMs = (startTime?: string | null) => {
  if (!startTime) return NaN;
  const parsed = new Date(startTime).getTime();
  if (Number.isFinite(parsed)) return parsed;
  return new Date(startTime.replace(' ', 'T')).getTime();
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(amount || 0));

const formatPercent = (value: number) => `${Math.round(Number.isFinite(value) ? value : 0)}%`;

const formatDate = (value?: string | null) => {
  if (!value) return 'Today';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Today';
  return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const formatTime = (value?: string | null) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not recorded';
  return parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
};

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not recorded';
  return `${parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${parsed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
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

const hasActiveAttendance = (attendance: any) =>
  Boolean(
    attendance?.is_checked_in ||
      attendance?.open_punch_in_at ||
      attendance?.open_punch?.punch_in_at ||
      (attendance?.check_in_at && !attendance?.check_out_at)
  );

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

const Card = ({ children, className = '', id }: { children: ReactNode; className?: string; id?: string }) => (
  <section id={id} className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>{children}</section>
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

const KpiCard = ({ label, value, hint, icon: Icon, tint, to }: { label: string; value: string | number; hint: string; icon: any; tint: string; to?: string }) => {
  const content = (
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
  );

  if (to) {
    return (
      <Link to={to} className="block rounded-lg transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
        <Card className="p-4">{content}</Card>
      </Link>
    );
  }

  return <Card className="p-4">{content}</Card>;
};

const MiniLineChart = ({ points, values }: { points?: TrendPoint[]; values?: number[] }) => {
  const chartPoints = points?.length
    ? points
    : (values?.length ? values : [0, 0, 0, 0, 0, 0, 0]).map((value, index) => ({
      label: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][index] || `Day ${index + 1}`,
      detail: `${value}`,
      value,
      count: value,
    }));
  const chartValues = chartPoints.map((point) => point.value);
  const max = Math.max(1, ...chartValues);
  const plottedPoints = chartValues.map((value, index) => {
    const x = 16 + index * (268 / Math.max(1, chartValues.length - 1));
    const y = 142 - (value / max) * 112;
    return { x, y, point: chartPoints[index] };
  });
  const polyline = plottedPoints.map(({ x, y }) => `${x},${y}`).join(' ');

  return (
    <svg viewBox="0 0 310 172" className="h-48 w-full overflow-visible">
      {[0, 1, 2, 3].map((line) => {
        const y = 32 + line * 34;
        return (
          <g key={line}>
            <line x1="16" x2="294" y1={y} y2={y} stroke="#eef2f7" />
            {line < 3 ? <text x="296" y={y + 3} fill="#cbd5e1" fontSize="8">{Math.round(max - (line * max) / 3)}</text> : null}
          </g>
        );
      })}
      <polyline points={polyline} fill="none" stroke="#2563eb" strokeWidth="2.5" />
      {plottedPoints.map(({ x, y, point }, index) => (
        <g key={`${point.label}-${index}`} className="group cursor-pointer">
          <title>{`${point.label}: ${point.detail}`}</title>
          <line x1={x} x2={x} y1="30" y2="142" stroke="#dbeafe" strokeWidth="1.5" className="opacity-0 transition-opacity group-hover:opacity-100" />
          <circle cx={x} cy={y} r="9" fill="#2563eb" opacity="0" className="transition-opacity group-hover:opacity-10" />
          <circle cx={x} cy={y} r="3.5" fill="#fff" stroke="#2563eb" strokeWidth="2" className="transition-all group-hover:fill-blue-600 group-hover:stroke-blue-600" />
          <text x={x} y={Math.max(14, y - 10)} textAnchor="middle" fill="#2563eb" fontSize="9" fontWeight="600" className="opacity-0 transition-opacity group-hover:opacity-100">
            {point.detail}
          </text>
        </g>
      ))}
      {plottedPoints.map(({ x, point }, index) => (
        <text key={`${point.label}-label-${index}`} x={x} y="160" textAnchor="middle" fill="#94a3b8" fontSize="10">{point.label}</text>
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
  const navigate = useNavigate();
  const persistedFilters = useMemo(readPersistedDashboardFilters, []);
  const [universalSearch, setUniversalSearch] = useState('');
  const [isUniversalSearchOpen, setIsUniversalSearchOpen] = useState(false);
  const [isDashboardNotificationsOpen, setIsDashboardNotificationsOpen] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const dashboardNotificationsRef = useRef<HTMLDivElement | null>(null);
  const [workSearch, setWorkSearch] = useState('');
  const [workDepartmentFilter, setWorkDepartmentFilter] = useState('All');
  const [workStatusFilter, setWorkStatusFilter] = useState('All');
  const [dashboardScope, setDashboardScope] = useState<DashboardScope>(() =>
    isDashboardScope(persistedFilters.dashboardScope) ? persistedFilters.dashboardScope : 'overall'
  );
  const [scopeSearch, setScopeSearch] = useState('');
  const [scopeDepartmentFilter, setScopeDepartmentFilter] = useState(() => persistedFilters.scopeDepartmentFilter || 'All');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<number | null>(() => {
    const persistedEmployeeId = Number(persistedFilters.selectedEmployeeId);
    return persistedFilters.selectedEmployeeId != null && Number.isFinite(persistedEmployeeId) && persistedEmployeeId > 0
      ? persistedEmployeeId
      : null;
  });
  const [datePreset, setDatePreset] = useState<DatePreset>(() =>
    isDatePreset(persistedFilters.datePreset) ? persistedFilters.datePreset : 'today'
  );
  const [customRange, setCustomRange] = useState<DateRange>(() => ({
    startDate: persistedFilters.customRange?.startDate || todayIso(),
    endDate: persistedFilters.customRange?.endDate || persistedFilters.customRange?.startDate || todayIso(),
  }));
  const selectedRange = useMemo(() => resolveDateRange(datePreset, customRange), [customRange, datePreset]);
  const selectedStartDate = selectedRange.startDate;
  const selectedEndDate = selectedRange.endDate;
  const selectedRangeLabel = selectedStartDate === selectedEndDate
    ? formatDate(selectedStartDate)
    : `${formatDate(selectedStartDate)} - ${formatDate(selectedEndDate)}`;
  const selectedRangePresetLabel = datePresetOptions.find((option) => option.value === datePreset)?.label || 'Custom';
  const now = new Date();
  const dateLabel = selectedRangeLabel;

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const nextFilters: PersistedDashboardFilters = {
      dashboardScope,
      selectedEmployeeId,
      scopeDepartmentFilter,
      datePreset,
      customRange,
    };
    window.localStorage.setItem(dashboardFilterStorageKey, JSON.stringify(nextFilters));
  }, [customRange, dashboardScope, datePreset, scopeDepartmentFilter, selectedEmployeeId]);

  const dashboardQuery = useQuery({
    queryKey: ['real-admin-dashboard', selectedStartDate, selectedEndDate, dashboardScope, selectedEmployeeId, scopeDepartmentFilter],
    queryFn: async () => {
      const reportScopeParams = dashboardScope === 'employee' && selectedEmployeeId
        ? { start_date: selectedStartDate, end_date: selectedEndDate, user_ids: [selectedEmployeeId] }
        : { start_date: selectedStartDate, end_date: selectedEndDate };
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
        rangeReportResponse,
        trendResponse,
        attendanceCalendarResponse,
      ] = await Promise.allSettled([
        userApi.getAll(),
        attendanceApi.summary({ start_date: selectedStartDate, end_date: selectedEndDate }),
        leaveApi.list({ status: 'approved' }),
        reportApi.overall(reportScopeParams),
        dashboardApi.summary(),
        taskApi.getAll(),
        payrollSimpleApi.runs(selectedStartDate.slice(0, 7)),
        notificationApi.list({ limit: 8 }),
        reportGroupApi.list(),
        auditApi.list({ per_page: 8 }),
        reportApi.weekly({ start_date: selectedStartDate, end_date: selectedEndDate, scope: 'organization' }),
        reportApi.overall(reportScopeParams),
        Promise.allSettled(enumerateMonths({ startDate: selectedStartDate, endDate: selectedEndDate }).map((month) => attendanceApi.calendar({
          month,
          scope: dashboardScope === 'employee' && selectedEmployeeId ? 'selected' : 'overall',
          user_id: dashboardScope === 'employee' && selectedEmployeeId ? selectedEmployeeId : undefined,
        }))),
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
        weeklyReport: rangeReportResponse.status === 'fulfilled' ? rangeReportResponse.value.data : { time_entries: [], by_project: [], total_duration: 0 },
        monthlyReport: trendResponse.status === 'fulfilled' ? trendResponse.value.data : { by_day: [] },
        attendanceCalendarDays: attendanceCalendarResponse.status === 'fulfilled'
          ? attendanceCalendarResponse.value.flatMap((result) => result.status === 'fulfilled' ? safeArray<any>(result.value.data?.days) : [])
          : [],
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
    attendanceCalendarDays: [],
  };

  const leavesInRange = data.leaves.filter((leave: any) =>
    leave.status === 'approved' && rangesOverlap(leave.start_date, leave.end_date, selectedRange)
  );
  const allEmployees = data.employees;

  const departments = useMemo(() => {
    const names = Array.from(new Set(allEmployees.map((employee) => employee.department).filter(Boolean)));
    return ['All', ...names];
  }, [allEmployees]);

  const scopeEmployeeMatches = allEmployees.filter((employee) => {
    const search = scopeSearch.trim().toLowerCase();
    const matchesSearch = !search || [employee.name, employee.email, employee.position, employee.department]
      .some((value) => String(value || '').toLowerCase().includes(search));
    const matchesDepartment = scopeDepartmentFilter === 'All' || employee.department === scopeDepartmentFilter;
    return matchesSearch && matchesDepartment;
  });
  const selectedEmployee = dashboardScope === 'employee'
    ? allEmployees.find((employee) => employee.id === selectedEmployeeId)
      || scopeEmployeeMatches[0]
      || allEmployees[0]
      || null
    : null;
  const scopedEmployeeIds = new Set(
    dashboardScope === 'employee' && selectedEmployee
      ? [selectedEmployee.id]
      : allEmployees
        .filter((employee) => scopeDepartmentFilter === 'All' || employee.department === scopeDepartmentFilter)
        .map((employee) => employee.id)
  );
  const scopedLeavesInRange = leavesInRange.filter((leave: any) => scopedEmployeeIds.has(Number(leave.user_id)));
  const leaveUserIdsInRange = new Set(scopedLeavesInRange.map((leave: any) => Number(leave.user_id)));
  const employees = allEmployees
    .filter((employee) => scopedEmployeeIds.has(employee.id))
    .map((employee) => leaveUserIdsInRange.has(employee.id) ? { ...employee, status: 'On Leave' as const } : employee);
  const attendanceRows = data.attendanceRows.filter((row: any) => scopedEmployeeIds.has(Number(row.user?.id || row.user_id || row.employee_id)));

  const totalEmployees = employees.length;
  const presentToday = attendanceRows.filter((row: any) => Number(row.present_days || 0) > 0 || hasActiveAttendance(row)).length;
  const lateToday = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.late_days || 0), 0);
  const onLeave = scopedLeavesInRange.length;
  const newHires = employees.filter((employee) => dateInRange(employee.joining_date || employee.created_at, selectedRange)).length;
  const resignations = employees.filter((employee) => dateInRange(employee.exit_date, selectedRange)).length;
  const totalDuration = Number(data.overall.summary?.total_duration || data.summary?.today_total_elapsed_duration || 0);
  const weeklyReport: any = data.weeklyReport || {};
  const weeklyTotal = Number(weeklyReport.total_duration || data.summary?.weekly_total_elapsed_duration || 0);

  const allRangeDates = enumerateDateRange(selectedRange);
  const calendarDaysInRange = safeArray<any>(data.attendanceCalendarDays)
    .filter((day) => dateInRange(day?.date, selectedRange))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const trendSource = calendarDaysInRange.slice(-7);
  const fallbackTrendDates = allRangeDates.slice(-Math.min(7, Math.max(1, allRangeDates.length)));
  const attendanceTrendPoints: TrendPoint[] = (trendSource.length ? trendSource : fallbackTrendDates).map((item: any, index: number) => {
    const rawDate = item instanceof Date ? toIsoDate(item) : String(item?.date || '');
    const parsedDate = rawDate ? new Date(`${rawDate.slice(0, 10)}T00:00:00`) : null;
    const label = parsedDate && !Number.isNaN(parsedDate.getTime())
      ? parsedDate.toLocaleDateString('en-US', { weekday: 'short' })
      : `Day ${index + 1}`;
    const status = item instanceof Date ? 'none' : String(item?.status || 'none');
    const lateMinutes = item instanceof Date ? 0 : Number(item?.late_minutes || 0);
    const isPresentDay = status === 'present' || status === 'checked_in';
    const isLeaveDay = status.includes('leave') || Boolean(item?.is_leave);
    const isHoliday = Boolean(item?.is_holiday);
    const isWeekend = Boolean(item?.is_weekend);
    const statusLabel = isPresentDay ? 'Present' : isLeaveDay ? 'On leave' : isHoliday ? 'Holiday' : isWeekend ? 'Weekend' : 'Absent';
    const detail = parsedDate && !Number.isNaN(parsedDate.getTime())
      ? `${parsedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${statusLabel}${lateMinutes > 0 ? `, ${lateMinutes} min late` : ''}`
      : statusLabel;
    return {
      label,
      detail,
      value: isPresentDay ? 1 : isLeaveDay ? 0.5 : 0,
      count: isPresentDay ? 1 : 0,
    };
  });
  const attendancePresentDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => ['present', 'checked_in'].includes(String(day.status || ''))).length
    : presentToday;
  const attendanceLateDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => Number(day.late_minutes || 0) > 0).length
    : lateToday;
  const attendanceLeaveDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => String(day.status || '').includes('leave') || day.is_leave).length
    : onLeave;
  const attendanceAbsentDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => {
      const dayDate = String(day.date || '').slice(0, 10);
      return String(day.status || 'none') === 'none' && !day.is_weekend && !day.is_holiday && dayDate <= todayIso();
    }).length
    : Math.max(0, totalEmployees - presentToday - onLeave);

  const activities: DashboardActivity[] = data.auditLogs.map((item: any, index: number) => ({
    id: Number(item.id || index),
    title: `${item.actor?.name || 'System'}: ${humanizeAction(item.action)}`,
    meta: formatDate(item.created_at),
    tone: index % 3 === 0 ? 'green' : index % 3 === 1 ? 'blue' : 'amber',
  }));

  const dashboardNotifications = data.notifications.slice(0, 5).map((item: any, index: number) => ({
    id: Number(item.id || index),
    title: item.title || item.message || 'Notification',
    message: item.message || 'Open the notifications center for more details.',
    date: formatDate(item.created_at),
  }));
  const announcements = dashboardNotifications.slice(0, 4).map((item) => ({
    id: item.id,
    title: item.title,
    date: item.date,
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

  const leaveSummary: Array<{ label: string; value: number; color: string; bgClass: string }> = Object.values(scopedLeavesInRange
    .reduce((acc: Record<string, { label: string; value: number; color: string; bgClass: string }>, leave: any, index: number) => {
      const key = String(leave.leave_type || 'full_day');
      const label = key.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
      const leaveStart = new Date(`${String(leave.start_date || selectedStartDate).slice(0, 10)}T00:00:00`);
      const leaveEnd = new Date(`${String(leave.end_date || leave.start_date || selectedEndDate).slice(0, 10)}T00:00:00`);
      const rangeStart = new Date(`${selectedStartDate}T00:00:00`);
      const rangeEnd = new Date(`${selectedEndDate}T00:00:00`);
      const clampedStart = new Date(Math.max(leaveStart.getTime(), rangeStart.getTime()));
      const clampedEnd = new Date(Math.min(leaveEnd.getTime(), rangeEnd.getTime()));
      const units = key === 'half_day' ? 0.5 : Math.max(1, Math.ceil((clampedEnd.getTime() - clampedStart.getTime()) / 86400000) + 1);
      acc[key] = acc[key] || { label, value: 0, color: departmentPalette[index % departmentPalette.length], bgClass: ['bg-blue-600', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500'][index % 4] };
      acc[key].value += units;
      return acc;
    }, {}));

  const weeklyEntries = safeArray<any>(weeklyReport.time_entries || weeklyReport.entries)
    .filter((entry: any) => {
      const entryUserId = Number(entry.user_id || entry.user?.id || entry.employee_id || entry.employee?.id || entry.task?.user_id || 0);
      return !entryUserId || scopedEmployeeIds.has(entryUserId);
    });
  const timesheetDates = allRangeDates.length > 15 ? allRangeDates.slice(-15) : allRangeDates;
  const timesheetDateCount = timesheetDates.length || 1;
  const timesheetRangeLabel = allRangeDates.length > timesheetDates.length
    ? `Latest ${timesheetDates.length} days from ${selectedRangeLabel}`
    : selectedRangeLabel;
  const timesheetRows: TimesheetRow[] = Object.values(weeklyEntries.reduce((acc: Record<string, TimesheetRow>, entry: any) => {
    const project = entry.project?.name || entry.task?.project?.name || entry.task?.group?.name || 'Unassigned';
    const task = entry.task?.title || entry.description || 'Time entry';
    const key = `${project}-${task}`;
    const duration = Number(entry.effective_duration || entry.duration || 0);
    const entryDate = String(entry.start_time || '').slice(0, 10);
    const dayIndex = timesheetDates.findIndex((day) => toIsoDate(day) === entryDate);
    acc[key] = acc[key] || { key, project, task, days: Array.from({ length: timesheetDateCount }).map(() => '-'), daySeconds: Array.from({ length: timesheetDateCount }).map(() => 0), totalSeconds: 0 };
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
  const attendanceByEmployeeId = new Map(attendanceRows.map((row: any) => [Number(row.user?.id || row.user_id || row.employee_id), row]));
  const workStatusRows = employees.map((employee) => {
    const attendance = attendanceByEmployeeId.get(employee.id);
    const isWorking = employee.status !== 'On Leave' && hasActiveAttendance(attendance);
    const checkInAt = attendance?.check_in_at || attendance?.open_punch_in_at || attendance?.last_check_in_at || null;
    const checkOutAt = attendance?.check_out_at || attendance?.last_check_out_at || null;
    const presentDays = Math.max(Number(attendance?.present_days || 0), isWorking ? 1 : 0);
    return {
      employee,
      status: employee.status === 'On Leave' ? 'On Leave' : isWorking ? 'Working' : 'Not working',
      todaySeconds: Number(attendance?.total_worked_seconds || attendance?.worked_seconds || 0),
      presentDays,
      lateMinutes: Number(attendance?.late_minutes || 0),
      checkInAt,
      checkOutAt,
      lastSeen: isWorking ? 'Checked in now' : checkOutAt ? `Checked out ${formatTime(checkOutAt)}` : attendance ? 'Seen in range' : 'No punch in range',
    };
  });
  const filteredWorkStatusRows = workStatusRows.filter((row) => {
    const search = workSearch.trim().toLowerCase();
    const matchesSearch = !search || [row.employee.name, row.employee.email, row.employee.position, row.employee.department]
      .some((value) => String(value || '').toLowerCase().includes(search));
    const matchesDepartment = workDepartmentFilter === 'All' || row.employee.department === workDepartmentFilter;
    const matchesStatus = workStatusFilter === 'All' || row.status === workStatusFilter;
    return matchesSearch && matchesDepartment && matchesStatus;
  });
  const workingCount = workStatusRows.filter((row) => row.status === 'Working').length;
  const notWorkingCount = workStatusRows.filter((row) => row.status === 'Not working').length;
  const attendanceHealth = [
    { label: 'Working now', value: workingCount, color: 'bg-emerald-500' },
    { label: 'Not started', value: notWorkingCount, color: 'bg-slate-400' },
    { label: 'Late', value: lateToday, color: 'bg-rose-500' },
    { label: 'On leave', value: onLeave, color: 'bg-amber-500' },
  ];
  const taskStatusCounts: Record<string, number> = data.tasks.reduce((acc: Record<string, number>, task: any) => {
    const status = String(task.status || 'todo').toLowerCase();
    const key = status.includes('progress') ? 'In Progress' : status.includes('done') || status.includes('complete') ? 'Done' : 'To Do';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, { 'To Do': 0, 'In Progress': 0, Done: 0 });
  const taskTotal = Math.max(1, data.tasks.length);
  const selectedWorkStatus = selectedEmployee ? workStatusRows.find((row) => row.employee.id === selectedEmployee.id) : null;
  const selectedEmployeeDetailQuery = useQuery({
    queryKey: ['dashboard-employee-detail', selectedEmployee?.id, selectedStartDate, selectedEndDate],
    enabled: dashboardScope === 'employee' && Boolean(selectedEmployee?.id),
    queryFn: async () => {
      if (!selectedEmployee?.id) return null;
      const [profileResponse, insightsResponse, screenshotsResponse] = await Promise.allSettled([
        userApi.getProfile360(selectedEmployee.id, { start_date: selectedStartDate, end_date: selectedEndDate }),
        reportApi.employeeInsights({ start_date: selectedStartDate, end_date: selectedEndDate, user_id: selectedEmployee.id }),
        screenshotApi.getAll({ user_id: selectedEmployee.id, start_date: selectedStartDate, end_date: selectedEndDate, page: 1, per_page: 4 }),
      ]);

      return {
        profile: profileResponse.status === 'fulfilled' ? profileResponse.value.data : null,
        insights: insightsResponse.status === 'fulfilled' ? insightsResponse.value.data : null,
        screenshots: screenshotsResponse.status === 'fulfilled' ? screenshotsResponse.value.data : null,
      };
    },
  });
  const employeeDetail = selectedEmployeeDetailQuery.data;
  const employeeProfile: any = employeeDetail?.profile || null;
  const employeeInsights: any = employeeDetail?.insights || null;
  const employeeScreenshots: any = employeeDetail?.screenshots || null;
  const employeeStats = employeeInsights?.stats || employeeProfile?.summary || {};
  const selectedEmployeeIdleSeconds = Number(employeeStats.idle_total_duration || employeeStats.idle_duration || 0);
  const employeePresentDays = Math.max(
    Number(employeeStats.present_days || 0),
    Number(selectedWorkStatus?.presentDays || 0)
  );
  const employeeTools = employeeInsights?.selected_user_tools || {};
  const employeeActivityTotal = Math.max(1, Number(employeeStats.activity_total_duration || 0));
  const employeeProductiveShare = (Number(employeeStats.productive_duration || 0) / employeeActivityTotal) * 100;
  const employeeScreenshotRows = safeArray<any>(employeeScreenshots?.data || employeeInsights?.recent_screenshots).slice(0, 4);
  const employeeScreenshotCount = Number(employeeScreenshots?.total || employeeScreenshots?.meta?.total || employeeScreenshotRows.length || 0);
  const employeeRecentEntries = safeArray<any>(employeeProfile?.recent_time_entries).slice(0, 4);
  const employeeAttendanceRecords = safeArray<any>(employeeProfile?.attendance_records).slice(0, 4);
  const employeeTopTools = [
    ...safeArray<any>(employeeTools.productive),
    ...safeArray<any>(employeeTools.unproductive),
    ...safeArray<any>(employeeTools.neutral),
    ...safeArray<any>(employeeTools.context_dependent),
  ].sort((a, b) => Number(b.total_duration || 0) - Number(a.total_duration || 0)).slice(0, 4);
  const selectedEmployeeActiveEntry = safeArray<any>(employeeProfile?.recent_time_entries)
    .find((entry: any) => !entry.end_time);
  const selectedEmployeeTimerStartedAt =
    selectedEmployeeActiveEntry?.start_time ||
    employeeProfile?.status?.current_timer_started_at ||
    (selectedWorkStatus?.status === 'Working' ? selectedWorkStatus.checkInAt : null);
  const selectedEmployeeTimer = dashboardScope === 'employee' && selectedEmployee && selectedEmployeeTimerStartedAt
    ? {
      id: selectedEmployeeActiveEntry?.id || selectedEmployee.id,
      duration: selectedEmployeeActiveEntry?.duration,
      start_time: selectedEmployeeTimerStartedAt,
      projectName:
        selectedEmployeeActiveEntry?.project?.name ||
        selectedEmployeeActiveEntry?.task?.project?.name ||
        employeeProfile?.status?.current_project ||
        'Not assigned',
      taskTitle:
        selectedEmployeeActiveEntry?.task?.title ||
        employeeProfile?.status?.current_task ||
        'Not assigned',
    }
    : null;

  useEffect(() => {
    if (!selectedEmployeeTimer) return;

    setClockTick(Date.now());
    const interval = window.setInterval(() => {
      setClockTick(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, [selectedEmployeeTimer?.duration, selectedEmployeeTimer?.id, selectedEmployeeTimer?.start_time]);

  const selectedEmployeeTimerBaseSeconds = Number.isFinite(Number(selectedEmployeeTimer?.duration)) ? Number(selectedEmployeeTimer?.duration) : 0;
  const selectedEmployeeTimerStartMs = getStartTimeMs(selectedEmployeeTimer?.start_time);
  const selectedEmployeeTimerElapsedSeconds = selectedEmployeeTimer && Number.isFinite(selectedEmployeeTimerStartMs)
    ? Math.max(0, Math.floor((clockTick - selectedEmployeeTimerStartMs) / 1000))
    : 0;
  const selectedEmployeeTimerSeconds = selectedEmployeeTimer
    ? Math.max(selectedEmployeeTimerBaseSeconds, selectedEmployeeTimerElapsedSeconds)
    : 0;

  const baseUniversalSuggestions: UniversalSuggestion[] = [
    { id: 'date-filter', label: 'Date Filter', description: 'Change today, last days, last month, or custom dates', category: 'Section', sectionId: 'date-filter', keywords: ['date', 'filter', 'today', 'custom', 'month'] },
    { id: 'dashboard-scope', label: 'Dashboard Scope', description: 'Switch between overall, department, and specific employee views', category: 'Section', sectionId: 'dashboard-scope', keywords: ['scope', 'overall', 'specific employee', 'department'] },
    { id: 'kpis', label: 'Dashboard Statistics', description: 'Total employees, present, leave, late, hires, and resignations', category: 'Section', sectionId: 'dashboard-kpis', keywords: ['statistics', 'stats', 'cards', 'employees', 'present', 'late', 'leave'] },
    { id: 'attendance-overview', label: 'Attendance Overview', description: 'Present, late, leave, absent chart for the selected scope', category: 'Section', sectionId: 'attendance-overview', keywords: ['attendance', 'present', 'late', 'absent', 'overview', 'chart'] },
    { id: 'leave-summary', label: 'Leave Summary', description: 'Approved leave usage in the selected range', category: 'Section', sectionId: 'leave-summary', keywords: ['leave', 'summary', 'approval'] },
    { id: 'department-distribution', label: 'Department Distribution', description: 'People count by department', category: 'Section', sectionId: 'department-distribution', keywords: ['department', 'distribution', 'team'] },
    { id: 'scope-summary', label: 'Scope Summary', description: 'Overall or selected employee detail area', category: 'Section', sectionId: 'scope-summary', keywords: ['scope', 'employee detail', 'summary', 'screenshots', 'productivity'] },
    { id: 'work-status', label: 'Current Work Status', description: 'Working, not working, and leave status table', category: 'Section', sectionId: 'current-work-status', keywords: ['working', 'status', 'not working', 'current'] },
    { id: 'time-tracker', label: 'Time Tracker', description: 'Current timer, project, task, and selected range totals', category: 'Section', sectionId: 'time-tracker-card', keywords: ['timer', 'time tracker', 'task', 'project'] },
    { id: 'checkin-log', label: 'Check-In / Check-Out Log', description: 'Last check in, last check out, session, and late status', category: 'Section', sectionId: 'checkin-log', keywords: ['check in', 'check out', 'punch', 'late'] },
    { id: 'attendance-health', label: 'Attendance Health', description: 'Working now, not started, late, and leave bars', category: 'Section', sectionId: 'attendance-health', keywords: ['attendance health', 'health', 'working now'] },
    { id: 'communication-hub', label: 'Communication Hub', description: 'Birthdays, activity, and announcements', category: 'Section', sectionId: 'communication-hub', keywords: ['communication', 'birthdays', 'activity', 'announcements'] },
    { id: 'people-summary', label: 'People Summary', description: 'Active accounts, departments, hires, and leave', category: 'Section', sectionId: 'people-summary', keywords: ['people', 'employees', 'summary'] },
    { id: 'timesheets', label: 'Timesheets', description: 'Range-based project and task time table', category: 'Section', sectionId: 'timesheets', keywords: ['timesheet', 'hours', 'tracked'] },
    { id: 'projects-section', label: 'Projects', description: 'Project progress and time distribution', category: 'Section', sectionId: 'projects-section', keywords: ['projects', 'project progress'] },
    { id: 'reports-section', label: 'Reports', description: 'Quick report shortcuts', category: 'Section', sectionId: 'reports-section', keywords: ['reports', 'export', 'attendance report', 'payroll report'] },
    { id: 'employees-page', label: 'Employees Panel', description: 'Open employee management', category: 'Panel', route: '/employees', keywords: ['employee', 'employees', 'directory', 'management'] },
    { id: 'attendance-page', label: 'Attendance Panel', description: 'Open attendance records', category: 'Panel', route: '/attendance', keywords: ['attendance', 'calendar', 'punch'] },
    { id: 'leave-page', label: 'Leave Panel', description: 'Open leave approvals', category: 'Panel', route: '/approval-inbox', keywords: ['leave', 'approval', 'inbox'] },
    { id: 'monitoring-page', label: 'Monitoring Panel', description: 'Open screenshots, timeline, web and app usage', category: 'Panel', route: '/monitoring', keywords: ['monitoring', 'screenshots', 'timeline', 'web usage', 'app usage'] },
    { id: 'payroll-page', label: 'Payroll Panel', description: 'Open payroll workspace', category: 'Panel', route: '/payroll', keywords: ['payroll', 'salary', 'pay'] },
    { id: 'tasks-page', label: 'Tasks Panel', description: 'Open task management', category: 'Panel', route: '/tasks', keywords: ['tasks', 'task', 'work'] },
    { id: 'projects-page', label: 'Projects Panel', description: 'Open project workspace', category: 'Panel', route: '/projects', keywords: ['projects', 'project'] },
    { id: 'chat-page', label: 'Chat Panel', description: 'Open organization chat', category: 'Panel', route: '/chat', keywords: ['chat', 'messages'] },
    { id: 'settings-page', label: 'Settings Panel', description: 'Open settings, integrations, custom fields, and audit logs', category: 'Panel', route: '/settings', keywords: ['settings', 'integrations', 'custom fields', 'audit logs'] },
  ];

  const universalSuggestions = [
    ...baseUniversalSuggestions,
    ...allEmployees.map((employee): UniversalSuggestion => ({
      id: `employee-${employee.id}`,
      label: employee.name,
      description: `${employee.position} - ${employee.department}`,
      category: 'Employee',
      employeeId: employee.id,
      keywords: [employee.name, employee.email, employee.position, employee.department],
    })),
  ];
  const filteredUniversalSuggestions = universalSearch.trim()
    ? universalSuggestions
      .filter((item) => {
        const search = universalSearch.trim().toLowerCase();
        return [item.label, item.description, item.category, ...item.keywords]
          .some((value) => String(value || '').toLowerCase().includes(search));
      })
      .slice(0, 8)
    : universalSuggestions.slice(0, 6);
  const openUniversalSuggestion = (suggestion?: UniversalSuggestion) => {
    if (!suggestion) return;
    setUniversalSearch(suggestion.label);
    setIsUniversalSearchOpen(false);
    if (suggestion.employeeId) {
      setDashboardScope('employee');
      setSelectedEmployeeId(suggestion.employeeId);
      setScopeSearch(suggestion.label);
      window.setTimeout(() => document.getElementById('scope-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      return;
    }
    if (suggestion.route) {
      navigate(suggestion.route);
      return;
    }
    if (suggestion.sectionId) {
      document.getElementById(suggestion.sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (!isDashboardNotificationsOpen) return;

    const handleOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (target && !dashboardNotificationsRef.current?.contains(target)) {
        setIsDashboardNotificationsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsDashboardNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDashboardNotificationsOpen]);

  return (
    <div className="w-full space-y-5 bg-[#f5f7fb] pb-8 pt-4 text-slate-900">
      <div className="relative z-20 mx-auto w-full max-w-4xl">
        <label className="flex h-12 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 text-sm text-slate-400 shadow-sm">
          <Search className="h-4 w-4 shrink-0 text-blue-600" />
          <input
            aria-label="Universal dashboard search"
            value={universalSearch}
            onFocus={() => setIsUniversalSearchOpen(true)}
            onChange={(event) => {
              setUniversalSearch(event.target.value);
              setIsUniversalSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                openUniversalSuggestion(filteredUniversalSuggestions[0]);
              }
              if (event.key === 'Escape') setIsUniversalSearchOpen(false);
            }}
            className="w-full bg-transparent outline-none placeholder:text-slate-400"
            placeholder="Search panels, employees, reports, settings, attendance..."
          />
          <span className="hidden rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500 sm:inline">Enter</span>
        </label>
        {isUniversalSearchOpen ? (
          <div className="absolute left-0 right-0 top-14 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
            {filteredUniversalSuggestions.length ? (
              <div className="max-h-80 overflow-y-auto p-2">
                {filteredUniversalSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.id}
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => openUniversalSuggestion(suggestion)}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-blue-50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-900">{suggestion.label}</span>
                      <span className="block truncate text-xs text-slate-500">{suggestion.description}</span>
                    </span>
                    <span className="shrink-0 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500">{suggestion.category}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-4 text-sm text-slate-500">No matching panel, section, or employee found.</div>
            )}
          </div>
        ) : null}
      </div>

      <header className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-950">Dashboard</h1>
          <p className="mt-3 text-sm font-medium text-slate-900">Good morning, {user?.name?.split(' ')[0] || 'there'}!</p>
          <p className="mt-1 text-xs text-slate-500">Here&apos;s what&apos;s happening in your organization for the selected date range.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700">
            <Calendar className="h-4 w-4 text-blue-600" />
            {dateLabel}
          </div>
          <Link
            aria-label="Add user"
            to="/add-user"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-blue-100 bg-blue-600 text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80"
          >
            <UserPlus className="h-4 w-4" />
          </Link>
          <div ref={dashboardNotificationsRef} className="relative">
            <button
              type="button"
              aria-label="Notifications"
              aria-haspopup="dialog"
              aria-expanded={isDashboardNotificationsOpen}
              onClick={() => setIsDashboardNotificationsOpen((open) => !open)}
              className={`relative rounded-lg border p-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/80 ${isDashboardNotificationsOpen ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              <Bell className="h-4 w-4" />
              {announcements.length ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500" /> : null}
            </button>

            {isDashboardNotificationsOpen ? (
              <div
                role="region"
                aria-label="Dashboard notifications"
                className="absolute right-0 top-full z-40 mt-3 w-[min(22rem,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
              >
                <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
                  <p className="text-sm font-semibold text-slate-950">Notifications</p>
                  <Link
                    to="/notifications"
                    onClick={() => setIsDashboardNotificationsOpen(false)}
                    className="text-xs font-semibold text-blue-600 hover:text-blue-700"
                  >
                    View all notifications
                  </Link>
                </div>
                <div className="max-h-80 overflow-y-auto">
                  {dashboardNotifications.length ? (
                    dashboardNotifications.map((notification) => (
                      <div key={notification.id} className="border-b border-slate-100 px-4 py-3 last:border-b-0">
                        <p className="text-sm font-semibold text-slate-950">{notification.title}</p>
                        <p className="mt-1 text-xs leading-5 text-slate-600">{notification.message}</p>
                        <p className="mt-2 text-[11px] font-medium text-slate-400">{notification.date}</p>
                      </div>
                    ))
                  ) : (
                    <p className="px-4 py-5 text-sm text-slate-500">No notifications</p>
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <Link aria-label="Settings" to="/settings" className="rounded-lg border border-slate-200 bg-white p-2 text-slate-600">
            <Settings className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <Card id="date-filter" className="scroll-mt-24 p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">Date Filter</p>
            <p className="mt-1 truncate text-sm font-medium text-slate-900">{selectedRangePresetLabel}: {selectedRangeLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {datePresetOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDatePreset(option.value)}
                className={`h-9 rounded-lg border px-3 text-xs font-medium transition ${datePreset === option.value ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'}`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        {datePreset === 'custom' ? (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 sm:grid-cols-[minmax(0,180px)_minmax(0,180px)_1fr] sm:items-end">
            <label className="text-xs font-medium text-slate-600">
              Start date
              <input
                type="date"
                value={customRange.startDate}
                onChange={(event) => setCustomRange((current) => ({ ...current, startDate: event.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              End date
              <input
                type="date"
                value={customRange.endDate}
                onChange={(event) => setCustomRange((current) => ({ ...current, endDate: event.target.value }))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
              />
            </label>
            <p className="text-xs leading-5 text-slate-500">
              Custom ranges automatically apply after you choose dates. If the dates are reversed, the dashboard reads them in the correct order.
            </p>
          </div>
        ) : null}
      </Card>

      <Card id="dashboard-scope" className="scroll-mt-24 p-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">Dashboard Scope</p>
            <p className="mt-1 text-sm font-medium text-slate-900">
              {dashboardScope === 'employee' && selectedEmployee ? selectedEmployee.name : scopeDepartmentFilter === 'All' ? 'Overall organization' : `${scopeDepartmentFilter} department`}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(['overall', 'employee'] as DashboardScope[]).map((scope) => (
              <button
                key={scope}
                type="button"
                onClick={() => {
                  setDashboardScope(scope);
                  if (scope === 'overall') setSelectedEmployeeId(null);
                }}
                className={`h-9 rounded-lg border px-3 text-xs font-medium capitalize transition ${dashboardScope === scope ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'}`}
              >
                {scope === 'employee' ? 'Specific Employee' : 'Overall'}
              </button>
            ))}
            <select
              aria-label="Filter dashboard by department"
              value={scopeDepartmentFilter}
              onChange={(event) => {
                setScopeDepartmentFilter(event.target.value);
                setSelectedEmployeeId(null);
              }}
              className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 outline-none"
            >
              {departments.map((department) => <option key={department} value={department}>{department === 'All' ? 'All departments' : department}</option>)}
            </select>
          </div>
        </div>
        {dashboardScope === 'employee' ? (
          <div className="mt-3 grid gap-3 border-t border-slate-100 pt-3 xl:grid-cols-[minmax(0,1fr)_minmax(220px,320px)] xl:items-start">
            <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-400">
              <Search className="h-4 w-4 shrink-0" />
              <input
                aria-label="Search scoped employee"
                value={scopeSearch}
                onChange={(event) => {
                  setScopeSearch(event.target.value);
                  setSelectedEmployeeId(null);
                }}
                className="w-full min-w-0 bg-transparent outline-none placeholder:text-slate-400"
                placeholder="Search employee name, email, role, department..."
              />
            </label>
            <select
              aria-label="Select dashboard employee"
              value={selectedEmployee?.id || ''}
              onChange={(event) => setSelectedEmployeeId(Number(event.target.value) || null)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none"
            >
              {scopeEmployeeMatches.length ? scopeEmployeeMatches.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name} - {employee.department}</option>
              )) : <option value="">No employee found</option>}
            </select>
          </div>
        ) : null}
      </Card>

      <section id="dashboard-kpis" className="grid scroll-mt-24 grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-6">
        <KpiCard to="/employees" label="Total Employees" value={totalEmployees} hint={`${newHires} joined in range`} icon={Users} tint="bg-blue-50 text-blue-600" />
        <KpiCard to="/attendance" label="Present" value={presentToday} hint={`${presentPercent}% of total`} icon={UserPlus} tint="bg-emerald-50 text-emerald-600" />
        <KpiCard to="/approval-inbox" label="On Leave" value={onLeave} hint={`${leavePercent}% of total`} icon={Umbrella} tint="bg-amber-50 text-amber-600" />
        <KpiCard to="/attendance" label="Late" value={lateToday} hint={`${latePercent}% of total`} icon={Clock3} tint="bg-rose-50 text-rose-600" />
        <KpiCard to="/add-user" label="New Hires" value={String(newHires).padStart(2, '0')} hint="Joined in range" icon={UserPlus} tint="bg-violet-50 text-violet-600" />
        <KpiCard to="/employees" label="Resignations" value={String(resignations).padStart(2, '0')} hint="Exited in range" icon={UserMinus} tint="bg-slate-100 text-slate-600" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)_minmax(0,0.85fr)]">
        <Card id="attendance-overview" className="scroll-mt-24 p-4">
          <SectionTitle title="Attendance Overview" action={<span className="text-xs text-slate-500">{selectedRangePresetLabel}</span>} />
          <MiniLineChart points={attendanceTrendPoints} />
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              ['Present days', attendancePresentDays],
              ['Late days', attendanceLateDays],
              ['On leave', attendanceLeaveDays],
              ['Absent days', attendanceAbsentDays],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 transition hover:border-blue-200 hover:bg-blue-50 hover:shadow-sm">
                <p className="text-[11px] text-slate-500">{label}</p>
                <p className="mt-1 truncate text-xs font-semibold text-slate-900">{value}</p>
              </div>
            ))}
          </div>
        </Card>
        <Card id="leave-summary" className="scroll-mt-24 p-4">
          <SectionTitle title="Leave Summary" action={<span className="text-xs text-slate-500">{selectedRangePresetLabel}</span>} />
          <DonutChart items={leaveSummary} />
        </Card>
        <Card id="department-distribution" className="scroll-mt-24 p-4">
          <SectionTitle title="Department Distribution" action={<Link to="/employees/teams" className="text-xs font-medium text-blue-600">All Departments</Link>} />
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

      <Card id="scope-summary" className="scroll-mt-24 p-4">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{dashboardScope === 'employee' ? 'Selected Employee Detail' : 'Scope Summary'}</h2>
            <p className="mt-1 text-xs text-slate-500">
              {dashboardScope === 'employee'
                ? 'The whole dashboard is focused on the selected employee and date range.'
                : 'The whole dashboard is showing the selected overall scope, department, and date range.'}
            </p>
          </div>
          <span className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600">{dateLabel}</span>
        </div>

        {dashboardScope === 'employee' && selectedEmployee ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <div className="space-y-4">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-blue-50 text-sm font-semibold text-blue-700">{initials(selectedEmployee.name)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-base font-semibold text-slate-950">{selectedEmployee.name}</h3>
                      <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${selectedWorkStatus?.status === 'Working' ? 'bg-emerald-50 text-emerald-700' : selectedWorkStatus?.status === 'On Leave' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                        {selectedWorkStatus?.status || selectedEmployee.status}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">{selectedEmployee.email}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div><p className="text-slate-400">Department</p><p className="mt-1 font-semibold text-slate-800">{selectedEmployee.department}</p></div>
                      <div><p className="text-slate-400">Role</p><p className="mt-1 font-semibold text-slate-800">{selectedEmployee.position}</p></div>
                      <div><p className="text-slate-400">Last check in</p><p className="mt-1 font-semibold text-slate-800">{formatDateTime(selectedWorkStatus?.checkInAt || employeeProfile?.status?.latest_attendance?.check_in_at)}</p></div>
                      <div><p className="text-slate-400">Last check out</p><p className="mt-1 font-semibold text-slate-800">{selectedWorkStatus?.status === 'Working' ? 'Still checked in' : formatDateTime(selectedWorkStatus?.checkOutAt || employeeProfile?.status?.latest_attendance?.check_out_at)}</p></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Tracked</p><p className="mt-2 text-lg font-semibold">{formatDuration(selectedWorkStatus?.todaySeconds || 0)}</p></div>
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Attendance</p><p className="mt-2 text-lg font-semibold">{employeePresentDays} present</p></div>
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Idle Time</p><p className="mt-2 text-lg font-semibold text-amber-700">{formatDuration(selectedEmployeeIdleSeconds)}</p></div>
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Screenshots</p><p className="mt-2 text-lg font-semibold text-blue-700">{employeeScreenshotCount}</p></div>
              </div>

              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Screenshot Access</span>
                  <Link to={`/monitoring/screenshots?user_id=${selectedEmployee.id}`} className="font-medium text-blue-600">Open Monitoring</Link>
                </div>
                {employeeScreenshotRows.length ? (
                  <div className="grid grid-cols-2 gap-2">
                    {employeeScreenshotRows.map((shot: any) => (
                      <div key={shot.id} className="rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs">
                        <p className="truncate font-medium text-slate-700">{shot.filename || `Screenshot ${shot.id}`}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{formatDateTime(shot.recorded_at || shot.created_at)}</p>
                      </div>
                    ))}
                  </div>
                ) : <EmptyInline>No screenshots in this range</EmptyInline>}
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Productivity</span>
                  <span className="text-slate-500">{formatPercent(employeeProductiveShare)} productive</span>
                </div>
                {[
                  ['Productive', Number(employeeStats.productive_duration || 0), 'bg-emerald-500'],
                  ['Unproductive', Number(employeeStats.unproductive_duration || 0), 'bg-rose-500'],
                  ['Neutral', Number(employeeStats.neutral_duration || 0), 'bg-slate-400'],
                  ['Context', Number(employeeStats.context_dependent_duration || 0), 'bg-amber-500'],
                ].map(([label, seconds, color]) => (
                  <div key={String(label)} className="mb-3 last:mb-0">
                    <div className="mb-1 flex justify-between text-xs"><span className="text-slate-600">{label}</span><span className="text-slate-500">{formatDuration(Number(seconds))}</span></div>
                    <div className="h-2 rounded-full bg-slate-100"><span className={`block h-2 rounded-full ${color}`} style={{ width: `${Math.max(Number(seconds) ? 8 : 0, (Number(seconds) / employeeActivityTotal) * 100)}%` }} /></div>
                  </div>
                ))}
              </div>

              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Top Tools & Sites</span>
                  <Link to={`/monitoring/productive-time?user_id=${selectedEmployee.id}`} className="font-medium text-blue-600">Details</Link>
                </div>
                {employeeTopTools.length ? (
                  <div className="space-y-3">
                    {employeeTopTools.map((tool: any, index) => (
                      <div key={`${tool.label}-${index}`} className="flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-700">{tool.label || 'Unknown tool'}</p>
                          <p className="text-[11px] capitalize text-slate-400">{String(tool.classification || 'neutral').replace('_', ' ')}</p>
                        </div>
                        <span className="shrink-0 text-slate-500">{formatDuration(Number(tool.total_duration || 0))}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyInline>No activity tools found</EmptyInline>}
              </div>

              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Recent Work</span>
                  <Link to={`/reports/hours-tracked?user_id=${selectedEmployee.id}`} className="font-medium text-blue-600">Timesheets</Link>
                </div>
                {employeeRecentEntries.length ? (
                  <div className="space-y-3">
                    {employeeRecentEntries.map((entry: any) => (
                      <div key={entry.id} className="flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-700">{entry.project?.name || entry.task?.project?.name || 'Unassigned'}</p>
                          <p className="truncate text-[11px] text-slate-400">{entry.task?.title || entry.description || formatDateTime(entry.start_time)}</p>
                        </div>
                        <span className="shrink-0 text-slate-500">{formatDuration(Number(entry.effective_duration || entry.duration || 0))}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyInline>No recent time entries</EmptyInline>}
              </div>

              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Attendance History</span>
                  <Link to={`/attendance?user_id=${selectedEmployee.id}`} className="font-medium text-blue-600">Open</Link>
                </div>
                {employeeAttendanceRecords.length ? (
                  <div className="space-y-3">
                    {employeeAttendanceRecords.map((record: any) => (
                      <div key={record.id || record.attendance_date} className="flex items-center justify-between gap-3 text-xs">
                        <div>
                          <p className="font-medium text-slate-700">{formatDate(record.attendance_date)}</p>
                          <p className="text-[11px] text-slate-400">{record.late_minutes ? `${record.late_minutes} min late` : 'On time'}</p>
                        </div>
                        <span className="rounded-md bg-slate-100 px-2 py-1 text-[11px] capitalize text-slate-600">{String(record.status || 'none').replace('_', ' ')}</span>
                      </div>
                    ))}
                  </div>
                ) : <EmptyInline>No attendance records</EmptyInline>}
              </div>
            </div>
          </div>
        ) : dashboardScope === 'overall' ? (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <p className="text-[11px] text-slate-500">People in scope</p>
                <p className="mt-2 text-xl font-semibold text-slate-950">{totalEmployees}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <p className="text-[11px] text-slate-500">Working now</p>
                <p className="mt-2 text-xl font-semibold text-emerald-700">{workingCount}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <p className="text-[11px] text-slate-500">Present</p>
                <p className="mt-2 text-xl font-semibold text-blue-700">{presentToday}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <p className="text-[11px] text-slate-500">Late</p>
                <p className="mt-2 text-xl font-semibold text-rose-600">{lateToday}</p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 p-4">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">Department scope</span>
                <span className="text-slate-400">{scopeDepartmentFilter === 'All' ? 'All departments' : scopeDepartmentFilter}</span>
              </div>
              {departmentCounts.length ? (
                <div className="space-y-3">
                  {departmentCounts.slice(0, 5).map((item, index) => (
                    <div key={item.department} className="flex items-center justify-between gap-3 text-xs">
                      <span className="truncate text-slate-600">{item.department}</span>
                      <span className="h-1.5 flex-1 rounded-full bg-slate-100">
                        <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(8, (item.count / Math.max(1, totalEmployees)) * 100)}%`, background: departmentPalette[index % departmentPalette.length] }} />
                      </span>
                      <span className="text-slate-500">{item.count}</span>
                    </div>
                  ))}
                </div>
              ) : <EmptyInline>No people match this scope</EmptyInline>}
            </div>
          </div>
        ) : <EmptyInline>Select an employee above to view complete details</EmptyInline>}
        {selectedEmployeeDetailQuery.isFetching ? <p className="mt-3 text-xs text-blue-600">Loading employee details...</p> : null}
      </Card>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card id="current-work-status" className="scroll-mt-24 p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Current Work Status</h2>
              <p className="mt-1 text-xs text-slate-500">Live attendance and working state for the selected range, with department and status filters.</p>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-700"><p className="font-semibold">{workingCount}</p><p>Working</p></div>
              <div className="rounded-lg bg-slate-100 px-3 py-2 text-slate-600"><p className="font-semibold">{notWorkingCount}</p><p>Not working</p></div>
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-amber-700"><p className="font-semibold">{onLeave}</p><p>On leave</p></div>
            </div>
          </div>
          <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_170px]">
            <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-400">
              <Search className="h-4 w-4 shrink-0" />
              <input
                aria-label="Search work status"
                value={workSearch}
                onChange={(event) => setWorkSearch(event.target.value)}
                className="w-full min-w-0 bg-transparent outline-none placeholder:text-slate-400"
                placeholder="Search employee, role, email..."
              />
            </label>
            <select
              aria-label="Filter work status by department"
              value={workDepartmentFilter}
              onChange={(event) => setWorkDepartmentFilter(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none"
            >
              {departments.map((department) => <option key={department} value={department}>{department}</option>)}
            </select>
            <select
              aria-label="Filter work status"
              value={workStatusFilter}
              onChange={(event) => setWorkStatusFilter(event.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-600 outline-none"
            >
              {['All', 'Working', 'Not working', 'On Leave'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="min-w-[760px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Tracked</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Last signal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredWorkStatusRows.slice(0, 8).map((row) => (
                  <tr key={row.employee.id}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{initials(row.employee.name)}</div>
                        <div>
                          <p className="font-semibold text-slate-900">{row.employee.name}</p>
                          <p className="text-[11px] text-slate-500">{row.employee.position}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{row.employee.department}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{formatDuration(row.todaySeconds)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${row.status === 'Working' ? 'bg-emerald-50 text-emerald-700' : row.status === 'On Leave' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{row.status}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{row.lastSeen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredWorkStatusRows.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No employees found</EmptyInline></div> : null}
          </div>
          <div className="mt-3 text-[11px] text-slate-400">Showing {Math.min(filteredWorkStatusRows.length, 8)} of {filteredWorkStatusRows.length} matching employees</div>
        </Card>

        <Card id="time-tracker-card" className="scroll-mt-24 p-4">
          <SectionTitle title="Time Tracker" action={<Settings className="h-4 w-4 text-slate-400" />} />
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-5 text-center">
            <p className="text-xs text-slate-500">
              {selectedEmployeeTimer ? `${selectedEmployee?.name || 'Selected employee'} active timer` : 'No active timer'}
            </p>
            <p className="mt-2 text-3xl font-semibold text-blue-600">{formatTimerClock(selectedEmployeeTimerSeconds)}</p>
          </div>
          <div className="mt-4 space-y-3 rounded-lg border border-slate-100 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><Briefcase className="h-4 w-4" />Project</span>
              <span className="truncate font-semibold text-slate-900">{selectedEmployeeTimer?.projectName || 'Not assigned'}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-slate-500"><FileClock className="h-4 w-4" />Task</span>
              <span className="truncate font-semibold text-slate-900">{selectedEmployeeTimer?.taskTitle || 'Not assigned'}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">Selected Range</p>
              <p className="mt-2 text-lg font-semibold">{formatDuration(totalDuration)}</p>
            </div>
            <div className="rounded-lg border border-slate-100 p-3">
              <p className="text-xs text-slate-500">Idle Time</p>
              <p className="mt-2 text-lg font-semibold text-amber-700">{formatDuration(selectedEmployeeIdleSeconds)}</p>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card id="checkin-log" className="scroll-mt-24 p-4">
          <SectionTitle title="Check-In / Check-Out Log" action={<Link to="/attendance" className="text-xs font-medium text-blue-600">Open Attendance</Link>} />
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="min-w-[760px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Last check in</th>
                  <th className="px-4 py-3 font-medium">Last check out</th>
                  <th className="px-4 py-3 font-medium">Session</th>
                  <th className="px-4 py-3 font-medium">Late</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredWorkStatusRows.slice(0, 6).map((row) => (
                  <tr key={row.employee.id}>
                    <td className="px-4 py-3">
                      <div className="flex min-w-0 items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-700">{initials(row.employee.name)}</div>
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-900">{row.employee.name}</p>
                          <p className="truncate text-[11px] text-slate-500">{row.employee.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{formatDateTime(row.checkInAt)}</td>
                    <td className="px-4 py-3 text-slate-600">{row.status === 'Working' ? 'Still checked in' : formatDateTime(row.checkOutAt)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{row.status === 'Working' ? 'Working now' : formatDuration(row.todaySeconds)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${!row.checkInAt ? 'bg-slate-100 text-slate-600' : row.lateMinutes > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {!row.checkInAt ? 'No punch' : row.lateMinutes > 0 ? `${row.lateMinutes} min late` : 'On time'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredWorkStatusRows.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No punch records match the filters</EmptyInline></div> : null}
          </div>
        </Card>

        <Card id="attendance-health" className="scroll-mt-24 p-4">
          <SectionTitle title="Attendance Health" action={<span className="text-xs text-slate-500">{selectedRangePresetLabel}</span>} />
          <div className="space-y-4">
            {attendanceHealth.map((item) => (
              <div key={item.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{item.label}</span>
                  <span className="text-slate-500">{item.value}</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100">
                  <span className={`block h-2 rounded-full ${item.color}`} style={{ width: `${Math.max(item.value ? 8 : 0, (item.value / Math.max(1, totalEmployees)) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-700">Quick insight</p>
            <p className="mt-2 text-xs leading-5 text-slate-500">
              {workingCount > 0 ? `${workingCount} employee${workingCount === 1 ? '' : 's'} currently checked in.` : 'No one is actively checked in right now.'}
            </p>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <Card id="communication-hub" className="scroll-mt-24 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-slate-950">Communication Hub</h2>
            <Link to="/chat" className="text-xs font-medium text-blue-600">Open Chat</Link>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="min-w-0 rounded-lg border border-slate-100 p-3">
              <SectionTitle title="Birthdays" action={<Gift className="h-4 w-4 text-rose-400" />} />
              {upcomingBirthdays.length ? (
                <div className="space-y-3">
                  {upcomingBirthdays.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">{initials(item.name)}</div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-slate-900">{item.name}</p>
                        <p className="text-[11px] text-slate-500">{item.nextBirthday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyInline>No birthdays available</EmptyInline>}
            </div>
            <div className="min-w-0 rounded-lg border border-slate-100 p-3">
              <SectionTitle title="Activity" action={<Link to="/audit-logs" className="text-xs font-medium text-blue-600">View</Link>} />
              {activities.length ? (
                <div className="space-y-3">
                  {activities.slice(0, 5).map((activity) => (
                    <div key={activity.id} className="grid grid-cols-[24px_1fr] gap-2 text-xs">
                      <span className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full ${activity.tone === 'green' ? 'bg-emerald-50 text-emerald-600' : activity.tone === 'blue' ? 'bg-blue-50 text-blue-600' : 'bg-amber-50 text-amber-600'}`}>
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0"><span className="block truncate text-slate-700">{activity.title}</span><span className="text-[11px] text-slate-400">{activity.meta}</span></span>
                    </div>
                  ))}
                </div>
              ) : <EmptyInline>No recent activity yet</EmptyInline>}
            </div>
            <div className="min-w-0 rounded-lg border border-slate-100 p-3">
              <SectionTitle title="Announcements" action={<Link to="/notifications" className="text-xs font-medium text-blue-600">View</Link>} />
              {announcements.length ? (
                <div className="space-y-3">
                  {announcements.map((item, index) => (
                    <div key={item.id} className="flex gap-2 text-xs">
                      <Megaphone className={`mt-0.5 h-4 w-4 shrink-0 ${index === 0 ? 'text-amber-500' : 'text-blue-500'}`} />
                      <div className="min-w-0">
                        <p className="truncate text-slate-700">{item.title}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{item.date}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : <EmptyInline>No announcements yet</EmptyInline>}
            </div>
          </div>
        </Card>

        <Card id="people-summary" className="scroll-mt-24 p-4">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">People Summary</h2>
              <p className="mt-1 text-xs text-slate-500">Use the work-status table above for live people details.</p>
            </div>
            <Link to="/employees" className="text-xs font-medium text-blue-600">Manage Employees</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-[11px] text-slate-500">Active Accounts</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{employees.filter((employee) => employee.status !== 'Inactive').length}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-[11px] text-slate-500">Departments</p>
              <p className="mt-2 text-xl font-semibold text-slate-950">{Math.max(0, departments.length - 1)}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-[11px] text-slate-500">New Hires</p>
              <p className="mt-2 text-xl font-semibold text-blue-700">{newHires}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
              <p className="text-[11px] text-slate-500">On Leave</p>
              <p className="mt-2 text-xl font-semibold text-amber-700">{onLeave}</p>
            </div>
          </div>
          <div className="mt-4 rounded-lg border border-slate-100 p-3">
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-700">Largest Departments</span>
              <span className="text-slate-400">{totalEmployees} people</span>
            </div>
            {departmentCounts.length ? (
              <div className="space-y-2">
                {departmentCounts.slice(0, 3).map((item, index) => (
                  <div key={item.department} className="flex items-center justify-between gap-3 text-xs">
                    <span className="truncate text-slate-600">{item.department}</span>
                    <span className="h-1.5 flex-1 rounded-full bg-slate-100">
                      <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(8, (item.count / Math.max(1, totalEmployees)) * 100)}%`, background: departmentPalette[index % departmentPalette.length] }} />
                    </span>
                    <span className="text-slate-500">{item.count}</span>
                  </div>
                ))}
              </div>
            ) : <EmptyInline>No employees found</EmptyInline>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/add-user" className="inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              Add Employee
            </Link>
            <Link to="/employees" className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
              Open Directory
            </Link>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card id="timesheets" className="scroll-mt-24 p-4">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold">Timesheets</h2>
              <span className="text-sm text-slate-500">{timesheetRangeLabel}</span>
            </div>
            <Link to="/reports/hours-tracked" className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white">Open Timesheets</Link>
          </div>
          {timesheetRows.length ? (
            <table className="w-full text-left text-xs">
              <thead className="text-slate-500">
                <tr>
                  <th className="pb-3 font-medium">Project / Task</th>
                  {timesheetDates.map((day) => <th key={toIsoDate(day)} className="pb-3 text-center font-medium">{day.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' })}</th>)}
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
          ) : <EmptyInline>No time entries in this range</EmptyInline>}
        </Card>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card id="task-pipeline" className="scroll-mt-24 p-4">
            <SectionTitle title="Task Pipeline" action={<Link to="/tasks" className="text-xs font-medium text-blue-600">Manage</Link>} />
            <div className="space-y-4">
              {Object.entries(taskStatusCounts).map(([label, count]) => (
                <div key={label}>
                  <div className="mb-1 flex justify-between text-xs"><span className="font-medium text-slate-700">{label}</span><span className="text-slate-500">{count}</span></div>
                  <div className="h-2 rounded-full bg-slate-100">
                    <span className={`block h-2 rounded-full ${label === 'Done' ? 'bg-emerald-500' : label === 'In Progress' ? 'bg-blue-600' : 'bg-amber-500'}`} style={{ width: `${Math.max(8, (count / taskTotal) * 100)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </Card>
          <Card id="payroll-snapshot" className="scroll-mt-24 p-4">
            <SectionTitle title="Payroll Snapshot" action={<Link to="/payroll" className="text-xs text-blue-600">{selectedStartDate.slice(0, 7)}</Link>} />
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Payroll Cost</p><p className="mt-2 font-semibold">{formatCurrency(payrollTotal + payrollDeductions)}</p></div>
              <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Net Pay</p><p className="mt-2 font-semibold text-emerald-700">{formatCurrency(payrollTotal)}</p></div>
              <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Deductions</p><p className="mt-2 font-semibold text-rose-600">{formatCurrency(payrollDeductions)}</p></div>
              <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Employees Paid</p><p className="mt-2 font-semibold">{data.payrollRecords.length}</p></div>
            </div>
          </Card>
          <Card id="leave-balance" className="scroll-mt-24 p-4">
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
          <Card id="recent-timers" className="scroll-mt-24 p-4">
            <SectionTitle title="Recent Timers" action={<Link to="/reports/hours-tracked" className="text-xs font-medium text-blue-600">View All</Link>} />
            {recentTimers.length ? (
              <div className="space-y-3">
                {recentTimers.map((entry: any) => (
                  <div key={entry.id} className="flex items-center justify-between gap-3 text-xs">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-500"><TimerReset className="h-4 w-4" /></div>
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{entry.project?.name || entry.task?.project?.name || entry.task?.group?.name || 'Unassigned'}</p>
                        <p className="truncate text-[11px] text-slate-500">{entry.task?.title || entry.description || 'Time entry'}</p>
                      </div>
                    </div>
                    <span className="text-slate-500">{formatCompactDuration(Number(entry.effective_duration || entry.duration || 0))}</span>
                  </div>
                ))}
              </div>
            ) : <EmptyInline>No recent timers</EmptyInline>}
          </Card>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <Card id="projects-section" className="scroll-mt-24 p-4">
          <SectionTitle title="Projects" action={<Link to="/projects" className="text-xs font-medium text-blue-600">View All</Link>} />
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

        <Card id="reports-section" className="scroll-mt-24 p-4">
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

        <Card id="attendance-trend" className="scroll-mt-24 p-4">
          <SectionTitle title="Attendance Trend" action={<span className="text-xs text-slate-500">{selectedRangePresetLabel}</span>} />
          <MiniLineChart points={attendanceTrendPoints} />
        </Card>
      </section>

      {dashboardQuery.isFetching ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">Refreshing dashboard data from the database...</div>
      ) : null}
    </div>
  );
}
