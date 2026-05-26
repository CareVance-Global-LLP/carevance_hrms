import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { isLikelyMobile } from '@/lib/mobile';
import { hasSuperAdminAccess } from '@/lib/permissions';
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
  Search,
  Settings,
  Umbrella,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { CHAT_NOTIFICATION_TYPES } from '@/lib/chatNotifications';
import { formatDate as formatDateForTimezone, formatDateTime as formatDateTimeForTimezone, formatTime as formatTimeForTimezone, getStartTimeMs } from '@/lib/dateTime';
import { resolveMediaUrl } from '@/lib/mediaUrl';
import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';
import { formatDuration, formatTimerClock, formatCurrency, formatPercent, toIsoDate, todayIso, clampIsoDateToToday, normalizeCustomRange, dateInRange, rangesOverlap, enumerateDateRange, enumerateMonths, initials, humanizeAction, safeArray } from '@/lib/formatters';
import {
  activityApi,
  attendanceApi,
  auditApi,
  leaveApi,
  notificationApi,
  payrollSimpleApi,
  projectApi,
  reportApi,
  reportGroupApi,
  screenshotApi,
  taskApi,
  userApi,
} from '@/services/api';
import { SelectInput } from '@/components/ui/FormField';
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type DashboardEmployee = {
  id: number;
  name: string;
  email: string;
  department: string;
  position: string;
  status: 'Active' | 'Inactive' | 'On Leave';
  is_working?: boolean;
  current_duration?: number;
  total_duration?: number;
  total_elapsed_duration?: number;
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

type DatePreset = 'today' | 'last_2_days' | 'last_5_days' | 'last_7_days' | 'last_15_days' | 'last_month' | 'custom';

type DateRange = {
  startDate: string;
  endDate: string;
};

type DashboardScope = 'overall' | 'employee';

type RangeStatusFilter = 'all' | 'present' | 'present_on_time' | 'present_late' | 'on_leave' | 'absent';

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
const resolveDateRange = (preset: DatePreset, customRange: DateRange): DateRange => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (preset === 'custom') {
    return normalizeCustomRange(customRange);
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

const resolveLeaveUserId = (leave: any) =>
  Number(leave?.user_id || leave?.user?.id || leave?.employee_id || 0);

const buildScopedEmployeeLink = (
  basePath: string,
  selectedEmployeeId: number,
  startDate: string,
  endDate: string
) => {
  const params = new URLSearchParams();
  params.set('user', String(selectedEmployeeId));
  params.set('start', startDate);
  params.set('end', endDate);
  return `${basePath}?${params.toString()}`;
};

const hasToolBuckets = (tools: any) =>
  ['productive', 'unproductive', 'neutral', 'context_dependent'].some((classification) =>
    safeArray<any>(tools?.[classification]).length > 0
  );

const buildFallbackEmployeeInsightsFromActivities = (activities: any[]) => {
  const durationByClassification = {
    productive_duration: 0,
    unproductive_duration: 0,
    neutral_duration: 0,
    context_dependent_duration: 0,
  };
  const toolBuckets: Record<'productive' | 'unproductive' | 'neutral' | 'context_dependent', Map<string, any>> = {
    productive: new Map(),
    unproductive: new Map(),
    neutral: new Map(),
    context_dependent: new Map(),
  };

  activities.forEach((activity) => {
    const classification = String(activity?.classification || 'neutral').toLowerCase();
    const normalizedClassification = (
      classification === 'productive'
      || classification === 'unproductive'
      || classification === 'neutral'
      || classification === 'context_dependent'
    ) ? classification : 'neutral';
    const duration = Math.max(0, Number(activity?.duration || 0));
    const label = String(
      activity?.normalized_domain
      || activity?.normalized_label
      || activity?.software_name
      || activity?.name
      || 'Unknown tool'
    ).trim() || 'Unknown tool';
    const type = String(activity?.tool_type || (activity?.type === 'url' ? 'website' : 'software')).trim() || 'software';
    const bucket = toolBuckets[normalizedClassification as keyof typeof toolBuckets];
    const key = `${type}:${label}`;
    const existing = bucket.get(key) || {
      label,
      type,
      classification: normalizedClassification,
      total_duration: 0,
      total_events: 0,
    };

    existing.total_duration += duration;
    existing.total_events += 1;
    bucket.set(key, existing);
    durationByClassification[`${normalizedClassification}_duration` as keyof typeof durationByClassification] += duration;
  });

  const activityTotalDuration =
    durationByClassification.productive_duration
    + durationByClassification.unproductive_duration
    + durationByClassification.neutral_duration
    + durationByClassification.context_dependent_duration;

  return {
    stats: {
      activity_total_duration: activityTotalDuration,
      productive_duration: durationByClassification.productive_duration,
      unproductive_duration: durationByClassification.unproductive_duration,
      neutral_duration: durationByClassification.neutral_duration,
      context_dependent_duration: durationByClassification.context_dependent_duration,
    },
    selected_user_tools: {
      productive: Array.from(toolBuckets.productive.values()).sort((left, right) => Number(right.total_duration || 0) - Number(left.total_duration || 0)),
      unproductive: Array.from(toolBuckets.unproductive.values()).sort((left, right) => Number(right.total_duration || 0) - Number(left.total_duration || 0)),
      neutral: Array.from(toolBuckets.neutral.values()).sort((left, right) => Number(right.total_duration || 0) - Number(left.total_duration || 0)),
      context_dependent: Array.from(toolBuckets.context_dependent.values()).sort((left, right) => Number(right.total_duration || 0) - Number(left.total_duration || 0)),
    },
  };
};

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
    is_working: Boolean(item?.is_working),
    current_duration: Number(item?.current_duration || 0),
    total_duration: Number(item?.total_duration || 0),
    total_elapsed_duration: Number(item?.total_elapsed_duration || 0),
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

const DepartmentWorkIdleChart = ({ data }: { data: Array<{ department: string; workedSeconds: number; idleSeconds: number; members: number }> }) => {
  const chartData = data
    .map((row) => ({
      department: row.department,
      workedSeconds: row.workedSeconds,
      idleSeconds: row.idleSeconds,
      totalSeconds: row.workedSeconds + row.idleSeconds,
    }))
    .sort((a, b) => b.totalSeconds - a.totalSeconds);

  if (!chartData.length) return null;

  const formatSeconds = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  };

  const maxTotal = Math.max(...chartData.map((d) => d.totalSeconds), 1);
  const yMax = Math.ceil(maxTotal * 1.15);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const worked = payload.find((p: any) => p.dataKey === 'workedSeconds');
    const idle = payload.find((p: any) => p.dataKey === 'idleSeconds');
    const total = (worked?.value || 0) + (idle?.value || 0);
    const idlePercent = total > 0 ? Math.round((idle?.value || 0) / total * 100) : 0;

    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xl">
        <p className="text-sm font-bold text-slate-900">{label}</p>
        <div className="mt-2.5 space-y-2">
          {worked && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-blue-600" />
                <span className="text-xs font-medium text-slate-600">Worked</span>
              </div>
              <span className="text-xs font-bold text-blue-600">{formatSeconds(worked.value)}</span>
            </div>
          )}
          {idle && (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-xs font-medium text-slate-600">Idle</span>
              </div>
              <span className="text-xs font-bold text-amber-600">{formatSeconds(idle.value)}</span>
            </div>
          )}
          <div className="border-t border-slate-100 pt-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-xs font-semibold text-slate-700">Total Time</span>
              <span className="text-xs font-bold text-slate-900">{formatSeconds(total)}</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-4">
              <span className="text-xs text-slate-500">Idle Share</span>
              <span className={`text-xs font-bold ${idlePercent >= 40 ? 'text-rose-600' : 'text-emerald-600'}`}>{idlePercent}%</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="relative select-none" tabIndex={-1} style={{ outline: 'none' }}>
      <ResponsiveContainer width="100%" height={320}>
        <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 80 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis
            dataKey="department"
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }}
            interval={0}
            angle={-45}
            textAnchor="end"
            height={70}
            dy={10}
          />
          <YAxis
            axisLine={false}
            tickLine={false}
            tick={{ fontSize: 11, fill: '#94a3b8' }}
            domain={[0, yMax]}
            tickFormatter={(val: number) => {
              const h = Math.floor(val / 3600);
              const m = Math.floor((val % 3600) / 60);
              if (h > 0 && m > 0) return `${h}h ${m}m`;
              if (h > 0) return `${h}h`;
              return `${m}m`;
            }}
            width={48}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }} offset={16} />
          <Bar dataKey="workedSeconds" name="Worked" stackId="a" radius={[0, 0, 0, 0]} barSize={40}>
            {chartData.map((_entry, index) => (
              <Cell key={`cell-work-${index}`} fill="#2563eb" />
            ))}
          </Bar>
          <Bar dataKey="idleSeconds" name="Idle" stackId="a" radius={[6, 6, 0, 0]} barSize={40}>
            {chartData.map((_entry, index) => (
              <Cell key={`cell-idle-${index}`} fill="#f59e0b" />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

const KpiCard = ({ label, value, hint, icon: Icon, tint, to, onClick }: { label: string; value: string | number; hint: string; icon: any; tint: string; to?: string; onClick?: () => void }) => {
  const content = (
    <div className="flex h-full items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <p className="min-h-8 text-xs leading-4 text-slate-500">{label}</p>
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
      <Link to={to} className="block h-full rounded-lg transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2">
        <Card className="h-full p-4">{content}</Card>
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="block h-full w-full rounded-lg text-left transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
      >
        <Card className="h-full p-4">{content}</Card>
      </button>
    );
  }

  return <Card className="h-full p-4">{content}</Card>;
};

const DonutChart = ({ items }: { items: Array<{ label: string; value: number; color: string; bgClass: string }> }) => {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) {
    return <EmptyInline>No leave data yet</EmptyInline>;
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0];
    const value = data.payload?.value ?? data.value ?? 0;
    const pct = total > 0 ? Math.round(value / total * 100) : 0;
    const label = data.name || data.payload?.label || '';
    const color = data.payload?.color || '';
    if (!label) return null;
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <p className="text-sm font-bold text-slate-900">{label}</p>
        </div>
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs text-slate-500">Days</span>
            <span className="text-xs font-semibold text-slate-900">{value}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs text-slate-500">Share</span>
            <span className="text-xs font-semibold text-slate-900">{pct}%</span>
          </div>
          <div className="border-t border-slate-100 pt-1.5">
            <div className="flex items-center justify-between gap-6">
              <span className="text-xs text-slate-500">Total Days</span>
              <span className="text-xs font-semibold text-slate-900">{total}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex items-center gap-6">
      <div className="relative">
        <ResponsiveContainer width={144} height={144}>
          <PieChart>
            <Pie
              data={items}
              cx="50%"
              cy="50%"
              innerRadius={40}
              outerRadius={68}
              paddingAngle={2}
              dataKey="value"
              nameKey="label"
              stroke="none"
              isAnimationActive={false}
            >
              {items.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip />}
              position={{ x: 200, y: 72 }}
              offset={10}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
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

const AttendancePieChart = ({ items }: { items: Array<{ label: string; value: number; color: string; bgClass: string }> }) => {
  const total = items.reduce((sum, item) => sum + Math.max(0, Number(item.value || 0)), 0);
  if (total <= 0) {
    return <EmptyInline>No attendance data yet</EmptyInline>;
  }

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.length) return null;
    const data = payload[0];
    const value = data.payload?.value ?? data.value ?? 0;
    const pct = total > 0 ? Math.round(value / total * 100) : 0;
    const label = data.name || data.payload?.label || '';
    const color = data.payload?.color || '';
    if (!label) return null;
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-2xl">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
          <p className="text-sm font-bold text-slate-900">{label}</p>
        </div>
        <div className="mt-2.5 space-y-1.5">
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs text-slate-500">Count</span>
            <span className="text-xs font-semibold text-slate-900">{value}</span>
          </div>
          <div className="flex items-center justify-between gap-6">
            <span className="text-xs text-slate-500">Share</span>
            <span className="text-xs font-semibold text-slate-900">{pct}%</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-4 md:grid-cols-[180px_minmax(0,1fr)] md:items-center">
      <div className="relative flex justify-center">
        <ResponsiveContainer width={176} height={176}>
          <PieChart>
            <Pie
              data={items}
              cx="50%"
              cy="50%"
              outerRadius={88}
              innerRadius={52}
              paddingAngle={2}
              dataKey="value"
              nameKey="label"
              stroke="none"
              isAnimationActive={false}
            >
              {items.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
            </Pie>
            <Tooltip
              content={<CustomTooltip />}
              position={{ x: 240, y: 88 }}
              offset={10}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="grid grid-cols-1 gap-2 text-xs">
        {items.map((item) => {
          const pct = total > 0 ? Math.round((Math.max(0, item.value) / total) * 100) : 0;
          return (
            <div key={item.label} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50 px-3 py-2" title={`${item.label}: ${item.value} (${pct}%)`}>
              <span className="flex items-center gap-2 font-medium text-slate-700">
                <span className={`h-2.5 w-2.5 rounded-sm ${item.bgClass}`} />
                {item.label}
              </span>
              <span className="text-slate-500">{item.value} ({pct}%)</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default function AdminDashboard() {
  const { user, organization } = useAuth();

  const displayTimezone = resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE);
  const navigate = useNavigate();
  const formatDate = (value?: string | null) => formatDateForTimezone(value, displayTimezone);
  const formatTime = (value?: string | null) => formatTimeForTimezone(value, displayTimezone);
  const formatDateTime = (value?: string | null) => formatDateTimeForTimezone(value, displayTimezone);
  const persistedFilters = useMemo(readPersistedDashboardFilters, []);
  const [universalSearch, setUniversalSearch] = useState('');
  const [isUniversalSearchOpen, setIsUniversalSearchOpen] = useState(false);
  const [isDashboardNotificationsOpen, setIsDashboardNotificationsOpen] = useState(false);
  const [dashboardNotificationsSeen, setDashboardNotificationsSeen] = useState(false);
  const [clockTick, setClockTick] = useState(() => Date.now());
  const dashboardNotificationsRef = useRef<HTMLDivElement | null>(null);
  const [workSearch, setWorkSearch] = useState('');
  const [workDepartmentFilter, setWorkDepartmentFilter] = useState('All');
  const [workStatusFilter, setWorkStatusFilter] = useState('All');
  const [selectedKpiStatus, setSelectedKpiStatus] = useState<RangeStatusFilter | null>(null);
  const [rangeStatusFilter, setRangeStatusFilter] = useState<RangeStatusFilter>('all');
  const [dashboardScope, setDashboardScope] = useState<DashboardScope>(() =>
    isDashboardScope(persistedFilters.dashboardScope) ? persistedFilters.dashboardScope : 'overall'
  );
  const [scopeSearch, setScopeSearch] = useState('');
  const [scopeDepartmentFilter, setScopeDepartmentFilter] = useState(() => persistedFilters.scopeDepartmentFilter || 'All');
  const scrollToDashboardSection = (sectionId: string) => {
    if (typeof document === 'undefined') return;
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
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
    ...normalizeCustomRange({
      startDate: persistedFilters.customRange?.startDate || todayIso(),
      endDate: persistedFilters.customRange?.endDate || persistedFilters.customRange?.startDate || todayIso(),
    }),
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
    if (isLikelyMobile() && !hasSuperAdminAccess(user)) {
      navigate('/mobile/dashboard', { replace: true });
      return;
    }
  }, [navigate, user]);

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

  useEffect(() => {
    if (workStatusFilter === 'Present Late') {
      setRangeStatusFilter('present_late');
      return;
    }
    if (workStatusFilter === 'Present') {
      setRangeStatusFilter('present');
      return;
    }
    if (workStatusFilter === 'Absent') {
      setRangeStatusFilter('absent');
      return;
    }
    if (workStatusFilter === 'On Leave') {
      setRangeStatusFilter('on_leave');
      return;
    }

    setRangeStatusFilter('all');
  }, [workStatusFilter]);

  const dashboardQuery = useQuery({
    queryKey: ['real-admin-dashboard', selectedStartDate, selectedEndDate, dashboardScope, selectedEmployeeId, scopeDepartmentFilter],
    queryFn: async () => {
      const reportScopeParams = dashboardScope === 'employee' && selectedEmployeeId
        ? { start_date: selectedStartDate, end_date: selectedEndDate, user_ids: [selectedEmployeeId], dashboard_lite: 1 }
        : { start_date: selectedStartDate, end_date: selectedEndDate, dashboard_lite: 1 };
      const [
        usersResponse,
        attendanceResponse,
        leaveResponse,
        overallResponse,
        tasksResponse,
        projectsResponse,
        payrollResponse,
        notificationsResponse,
        groupsResponse,
        auditResponse,
        attendanceCalendarResponse,
      ] = await Promise.allSettled([
        userApi.getAll(),
        attendanceApi.summary({ start_date: selectedStartDate, end_date: selectedEndDate }),
        leaveApi.list({ status: 'approved', limit: 500 }),
        reportApi.overall(reportScopeParams),
        taskApi.getAll({ timer_only: true }),
        projectApi.getAll(),
        payrollSimpleApi.runs(selectedStartDate.slice(0, 7)),
        notificationApi.list({ limit: 8 }),
        reportGroupApi.list(),
        auditApi.list({ per_page: 8 }),
        dashboardScope === 'employee' && selectedEmployeeId
          ? Promise.all(enumerateMonths(selectedRange).map((month) =>
            attendanceApi.calendar({ month, user_id: selectedEmployeeId, scope: 'selected' })
          ))
          : Promise.resolve([]),
      ]);

      const overallPayload = overallResponse.status === 'fulfilled' ? overallResponse.value.data : { summary: {}, by_day: [], by_user: [] };
      const attendanceCalendarDays = attendanceCalendarResponse.status === 'fulfilled'
        ? safeArray<any>(attendanceCalendarResponse.value).flatMap((response) => safeArray<any>(response?.data?.days))
        : [];

      return {
        employees: usersResponse.status === 'fulfilled' ? safeArray<any>(usersResponse.value.data).map(normalizeEmployee).filter((employee) => employee.id > 0) : [],
        attendanceRows: attendanceResponse.status === 'fulfilled' ? safeArray<any>(attendanceResponse.value.data?.data) : [],
        leaves: leaveResponse.status === 'fulfilled' ? safeArray<any>(leaveResponse.value.data?.data) : [],
        overall: overallPayload,
        summary: {},
        tasks: tasksResponse.status === 'fulfilled' ? safeArray<any>(tasksResponse.value.data) : [],
        projects: projectsResponse.status === 'fulfilled' ? safeArray<any>(projectsResponse.value.data) : [],
        payrollRecords: payrollResponse.status === 'fulfilled' ? safeArray<any>(payrollResponse.value.data?.data) : [],
        notifications: notificationsResponse.status === 'fulfilled' ? safeArray<any>(notificationsResponse.value.data?.data) : [],
        groups: groupsResponse.status === 'fulfilled' ? safeArray<any>(groupsResponse.value.data?.data) : [],
        auditLogs: auditResponse.status === 'fulfilled' ? safeArray<any>(auditResponse.value.data?.data) : [],
        weeklyReport: { time_entries: [], entries: [], by_project: [], total_duration: Number(overallPayload?.summary?.total_duration || 0) },
        monthlyReport: { by_day: safeArray<any>(overallPayload?.by_day) },
        attendanceCalendarDays,
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
    projects: [],
    payrollRecords: [],
    notifications: [],
    groups: [],
    auditLogs: [],
    weeklyReport: { time_entries: [], by_project: [], total_duration: 0 },
    monthlyReport: { by_day: [] },
    attendanceCalendarDays: [],
  };
  const isDashboardInitialLoading = dashboardQuery.data === undefined && dashboardQuery.isFetching;

  const leavesInRange = data.leaves.filter((leave: any) =>
    String(leave?.status || '').toLowerCase() === 'approved' && rangesOverlap(leave.start_date, leave.end_date, selectedRange)
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
  const isMultiDayRange = selectedStartDate !== selectedEndDate;
  const scopedEmployeeIds = new Set(
    dashboardScope === 'employee' && selectedEmployee
      ? [selectedEmployee.id]
      : allEmployees
        .filter((employee) => scopeDepartmentFilter === 'All' || employee.department === scopeDepartmentFilter)
        .map((employee) => employee.id)
  );
  const scopedEmployeeIdList = Array.from(scopedEmployeeIds).sort((left, right) => left - right);
  const shouldShowRangeStatusDetail = isMultiDayRange && selectedKpiStatus !== null;
  const rangeAttendanceCalendarQuery = useQuery({
    queryKey: ['dashboard-range-attendance-calendars', selectedStartDate, selectedEndDate, dashboardScope, selectedEmployee?.id || null, scopeDepartmentFilter, scopedEmployeeIdList],
    enabled: shouldShowRangeStatusDetail && scopedEmployeeIdList.length > 0 && scopedEmployeeIdList.length <= 60,
    queryFn: async () => {
      const months = enumerateMonths(selectedRange);
      const entries = await Promise.all(scopedEmployeeIdList.map(async (userId) => {
        const responses = await Promise.all(months.map(async (month) => {
          try {
            return await attendanceApi.calendar({ month, user_id: userId, scope: 'selected' });
          } catch {
            return null;
          }
        }));
        const days = responses
          .flatMap((response) => safeArray<any>(response?.data?.days))
          .filter((day) => dateInRange(day?.date, selectedRange))
          .sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
        return [userId, days] as const;
      }));

      return Object.fromEntries(entries) as Record<number, any[]>;
    },
  });
  const scopedLeavesInRange = leavesInRange.filter((leave: any) => {
    const leaveUserId = resolveLeaveUserId(leave);
    return leaveUserId > 0 && scopedEmployeeIds.has(leaveUserId);
  });
  const leaveUserIdsInRange = new Set(scopedLeavesInRange.map((leave: any) => resolveLeaveUserId(leave)).filter((id: number) => id > 0));
  const attendanceRows = data.attendanceRows.filter((row: any) => scopedEmployeeIds.has(Number(row.user?.id || row.user_id || row.employee_id)));
  const attendanceLeaveUserIds = new Set(attendanceRows
    .filter((row: any) => {
      const attendanceStatus = String(row.attendance_status || row.status || '').toLowerCase();
      return attendanceStatus.includes('leave') || Boolean(row.has_approved_leave_today) || Boolean(row.is_leave);
    })
    .map((row: any) => Number(row.user?.id || row.user_id || row.employee_id))
    .filter((id: number) => id > 0));
  const effectiveLeaveUserIds = new Set<number>([...leaveUserIdsInRange, ...attendanceLeaveUserIds]);
  const employees = allEmployees
    .filter((employee) => scopedEmployeeIds.has(employee.id))
    .map((employee) => effectiveLeaveUserIds.has(employee.id) ? { ...employee, status: 'On Leave' as const } : employee);

  const totalEmployees = employees.length;
  const presentLateInRange = attendanceRows.filter((row: any) => Number(row.late_days || row.late_minutes || 0) > 0).length;
  const presentOnTimeInRange = attendanceRows.filter((row: any) => {
    const isLate = Number(row.late_days || row.late_minutes || 0) > 0;
    return !isLate && (Number(row.present_days || 0) > 0 || hasActiveAttendance(row));
  }).length;
  const totalPresentInRange = presentOnTimeInRange + presentLateInRange;
  const presentPercent = totalEmployees ? Math.round((totalPresentInRange / totalEmployees) * 100) : 0;
  const onLeave = effectiveLeaveUserIds.size;
  const absentCount = Math.max(0, totalEmployees - presentOnTimeInRange - presentLateInRange - onLeave);
  const newHires = employees.filter((employee) => dateInRange(employee.joining_date || employee.created_at, selectedRange)).length;
  const resignations = employees.filter((employee) => dateInRange(employee.exit_date, selectedRange)).length;
  const dashboardSummary = data.summary as any;
  const totalDuration = Number(data.overall.summary?.total_duration || dashboardSummary?.today_total_elapsed_duration || 0);
  const weeklyReport: any = data.weeklyReport || {};
  const weeklyTotal = Number(weeklyReport.total_duration || dashboardSummary?.weekly_total_elapsed_duration || 0);

  const calendarDaysInRange = safeArray<any>(data.attendanceCalendarDays)
    .filter((day) => dateInRange(day?.date, selectedRange))
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const attendanceOnTimeDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => ['present', 'checked_in'].includes(String(day.status || '')) && Number(day.late_minutes || 0) <= 0).length
    : presentOnTimeInRange;
  const attendanceLatePresentDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => Number(day.late_minutes || 0) > 0).length
    : presentLateInRange;
  const attendancePresentDays = attendanceOnTimeDays + attendanceLatePresentDays;
  const attendanceLeaveDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => String(day.status || '').includes('leave') || day.is_leave).length
    : onLeave;
  const attendanceAbsentDays = calendarDaysInRange.length
    ? calendarDaysInRange.filter((day) => {
      const dayDate = String(day.date || '').slice(0, 10);
      return String(day.status || 'none') === 'none' && !day.is_holiday && dayDate <= todayIso();
    }).length
    : absentCount;
  const selectedEmployeePieStatus = attendanceLatePresentDays > 0
    ? { label: 'Present Late', value: 1, color: '#f97316', bgClass: 'bg-orange-500' }
    : attendancePresentDays > 0
      ? { label: 'Present', value: 1, color: '#16a34a', bgClass: 'bg-green-600' }
      : { label: 'Absent', value: 1, color: '#dc2626', bgClass: 'bg-red-600' };
  const isSingleEmployeeDay = dashboardScope === 'employee' && selectedStartDate === selectedEndDate;
  const attendancePieItems = dashboardScope === 'employee'
    ? isSingleEmployeeDay
      ? [selectedEmployeePieStatus]
      : [
        { label: 'Present', value: attendancePresentDays, color: '#16a34a', bgClass: 'bg-green-600' },
        { label: 'Absent', value: attendanceAbsentDays, color: '#dc2626', bgClass: 'bg-red-600' },
        { label: 'Present Late', value: attendanceLatePresentDays, color: '#f97316', bgClass: 'bg-orange-500' },
      ]
    : [
      { label: 'Present', value: totalPresentInRange, color: '#16a34a', bgClass: 'bg-green-600' },
      { label: 'Absent', value: absentCount, color: '#dc2626', bgClass: 'bg-red-600' },
      { label: 'Present Late', value: presentLateInRange, color: '#f97316', bgClass: 'bg-orange-500' },
    ];

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
    isRead: item.is_read !== false,
  }));
  const hasUnreadDashboardNotifications = dashboardNotifications.some((notification) => !notification.isRead);
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

  const weeklyEntries = safeArray<any>(weeklyReport.time_entries || weeklyReport.entries)
    .filter((entry: any) => {
      const entryUserId = Number(entry.user_id || entry.user?.id || entry.employee_id || entry.employee?.id || entry.task?.user_id || 0);
      return !entryUserId || scopedEmployeeIds.has(entryUserId);
    });

  const projectDurations = (Object.values(weeklyEntries.reduce((acc: Record<string, { name: string; total_time: number; entry_count: number }>, entry: any) => {
    const projectName = entry.project?.name || entry.task?.project?.name || entry.task?.group?.name || 'Unassigned project';
    const duration = Number(entry.effective_duration || entry.duration || 0);
    acc[projectName] = acc[projectName] || { name: projectName, total_time: 0, entry_count: 0 };
    acc[projectName].total_time += duration;
    acc[projectName].entry_count += 1;
    return acc;
  }, {})) as Array<{ name: string; total_time: number; entry_count: number }>)
    .sort((left, right) => Number(right.total_time || 0) - Number(left.total_time || 0));
  const projectDurationByName = new Map(projectDurations.map((item) => [String(item.name || '').trim().toLowerCase(), Number(item.total_time || 0)]));
  const projectCatalog = safeArray<any>(data.projects)
    .filter((project) => String(project?.name || '').trim())
    .map((project) => {
      const projectName = String(project.name || '').trim();
      const totalTime = Number(projectDurationByName.get(projectName.toLowerCase()) || 0);
      const completionCandidate = Number(project.progress || project.completion || project.completion_percentage || project.percent_complete || 0);
      const progressPercent = completionCandidate > 0
        ? Math.min(100, Math.round(completionCandidate))
        : Math.min(100, Math.round((totalTime / Math.max(1, weeklyTotal)) * 100));
      const statusLabel = String(project.status || '').trim() || (totalTime > 0 ? 'Active' : 'Planned');

      return {
        name: projectName,
        hours: formatDuration(totalTime),
        status: statusLabel,
        percent: progressPercent,
      };
    });
  const projectProgressSource = (projectCatalog.length ? projectCatalog : (weeklyReport.by_project?.length ? weeklyReport.by_project : projectDurations))
    .filter((item: any) => item.project?.name || item.name || item.total_time)
    .slice(0, 5)
    .map((item: any) => ({
      name: item.project?.name || item.name || 'Unassigned project',
      hours: item.hours || formatDuration(Number(item.total_time || 0)),
      status: item.status || (Number(item.total_time || 0) > 0 ? 'Active' : 'No logs'),
      percent: Number.isFinite(Number(item.percent))
        ? Math.min(100, Math.max(0, Math.round(Number(item.percent))))
        : Math.min(100, Math.round((Number(item.total_time || 0) / Math.max(1, weeklyTotal)) * 100)),
    }));

  const payrollTotal = data.payrollRecords.reduce((sum: number, record: any) => sum + Number(record.net_pay || record.gross_pay || 0), 0);
  const payrollDeductions = data.payrollRecords.reduce((sum: number, record: any) => sum + Number(record.deductions || record.tax || 0), 0);
  const leavePercent = totalEmployees ? Math.round((onLeave / totalEmployees) * 100) : 0;
  const absentPercent = totalEmployees ? Math.round((attendanceAbsentDays / totalEmployees) * 100) : 0;
  const presentLatePercent = totalEmployees ? Math.round((presentLateInRange / totalEmployees) * 100) : 0;
  const attendanceByEmployeeId = new Map(attendanceRows.map((row: any) => [Number(row.user?.id || row.user_id || row.employee_id), row]));
  const overallByUserRows = safeArray<any>(data.overall.by_user)
    .filter((row: any) => scopedEmployeeIds.has(Number(row.user?.id || row.user_id || 0)));
  const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
  const resolveIdleSeconds = (row: any, trackedSeconds: number): number => {
    const reportedIdle = Number(
      row.idle_duration
      ?? row.idle_time
      ?? row.idle_total_duration
      ?? row.non_working_duration
      ?? NaN
    );
    if (Number.isFinite(reportedIdle) && reportedIdle > 0) {
      return Math.min(trackedSeconds, Math.max(0, reportedIdle));
    }

    const reportedWorking = Number(
      row.working_duration
      ?? row.working_time
      ?? row.billable_duration
      ?? row.billable_time
      ?? NaN
    );
    if (Number.isFinite(reportedWorking) && reportedWorking >= 0) {
      return Math.max(0, trackedSeconds - Math.min(trackedSeconds, reportedWorking));
    }

    return 0;
  };
  const selectedEmployeeOverallRow = selectedEmployee
    ? overallByUserRows.find((row: any) => Number(row.user?.id || row.user_id || 0) === selectedEmployee.id) || null
    : null;
  const productivityLeaders = overallByUserRows
    .map((row: any) => {
      const userId = Number(row.user?.id || row.user_id || 0);
      const employee = employeeById.get(userId);
      const trackedSeconds = Number(row.total_duration || 0);
      const idleSeconds = resolveIdleSeconds(row, trackedSeconds);
      const workingSeconds = Math.max(0, trackedSeconds - idleSeconds);
      const productivityPercent = trackedSeconds > 0 ? Math.round((workingSeconds / trackedSeconds) * 100) : 0;

      return {
        userId,
        name: row.user?.name || employee?.name || 'Unknown employee',
        department: employee?.department || 'Unassigned',
        trackedSeconds,
        workingSeconds,
        idleSeconds,
        productivityPercent,
      };
    })
    .sort((left, right) => right.workingSeconds - left.workingSeconds)
    .slice(0, 5);
  const departmentPerformanceRows = (Object.values(overallByUserRows.reduce((acc: Record<string, {
    department: string;
    members: number;
    trackedSeconds: number;
    idleSeconds: number;
    presentMembers: number;
    lateMembers: number;
  }>, row: any) => {
    const userId = Number(row.user?.id || row.user_id || 0);
    const employee = employeeById.get(userId);
    const department = employee?.department || 'Unassigned';
    const attendance = attendanceByEmployeeId.get(userId);
    const trackedSeconds = Number(row.total_duration || 0);
    const idleSeconds = resolveIdleSeconds(row, trackedSeconds);
    const isPresent = Number(attendance?.present_days || 0) > 0 || hasActiveAttendance(attendance);
    const isLate = Number(attendance?.late_minutes || 0) > 0;
    acc[department] = acc[department] || {
      department,
      members: 0,
      trackedSeconds: 0,
      idleSeconds: 0,
      presentMembers: 0,
      lateMembers: 0,
    };
    acc[department].members += 1;
    acc[department].trackedSeconds += trackedSeconds;
    acc[department].idleSeconds += idleSeconds;
    acc[department].presentMembers += isPresent ? 1 : 0;
    acc[department].lateMembers += isLate ? 1 : 0;
    return acc;
  }, {})) as Array<{
    department: string;
    members: number;
    trackedSeconds: number;
    idleSeconds: number;
    presentMembers: number;
    lateMembers: number;
  }>).map((row) => {
    const averageTrackedPerMember = row.members > 0 ? row.trackedSeconds / row.members : 0;
    const idlePercent = row.trackedSeconds > 0 ? Math.round((row.idleSeconds / row.trackedSeconds) * 100) : 0;
    const attendanceCoverage = row.members > 0 ? Math.round((row.presentMembers / row.members) * 100) : 0;
    const needsAttention = averageTrackedPerMember < 2 * 3600 || idlePercent >= 40 || attendanceCoverage < 50;

    return {
      ...row,
      averageTrackedPerMember,
      idlePercent,
      attendanceCoverage,
      healthLabel: needsAttention ? 'Needs attention' : 'Healthy',
    };
  }).sort((left, right) => right.trackedSeconds - left.trackedSeconds).slice(0, 6);
  const departmentsNeedingAttention = departmentPerformanceRows.filter((row) => row.healthLabel === 'Needs attention').length;
  const employeesWithoutTrackedTime = overallByUserRows.filter((row: any) => Number(row.total_duration || 0) <= 0).length;
  const isRangeIncludingToday = selectedStartDate <= todayIso() && selectedEndDate >= todayIso();
  const rangeCalendarByEmployeeId = useMemo(() => {
    const fromQuery = rangeAttendanceCalendarQuery.data || {};
    if (Object.keys(fromQuery).length > 0) {
      return new Map<number, any[]>(
        Object.entries(fromQuery).map(([key, value]) => [Number(key), safeArray<any>(value)])
      );
    }

    if (dashboardScope === 'employee' && selectedEmployee?.id) {
      return new Map<number, any[]>([[selectedEmployee.id, calendarDaysInRange]]);
    }

    return new Map<number, any[]>();
  }, [calendarDaysInRange, dashboardScope, rangeAttendanceCalendarQuery.data, selectedEmployee?.id]);
  const workStatusRows = employees.map((employee) => {
    const attendance = attendanceByEmployeeId.get(employee.id);
    const overallRow = overallByUserRows.find((row: any) => Number(row.user?.id || row.user_id || 0) === employee.id);
    const hasLiveTimerSignal = Boolean(employee.is_working) || Number(employee.current_duration || 0) > 0;
    const isWorking = employee.status !== 'On Leave' && (hasActiveAttendance(attendance) || hasLiveTimerSignal);
    const checkInAt = attendance?.check_in_at || attendance?.open_punch_in_at || attendance?.last_check_in_at || null;
    const checkOutAt = attendance?.check_out_at || attendance?.last_check_out_at || null;
    const presentDays = isRangeIncludingToday
      ? Math.max(Number(attendance?.present_days || 0), isWorking ? 1 : 0)
      : Number(attendance?.present_days || 0);
    const trackedDuration = Number(overallRow?.total_duration || 0);
    const liveDuration = isRangeIncludingToday ? Number(employee.current_duration || 0) : 0;
    const workedDurationFromAttendance = Number(attendance?.total_worked_seconds || attendance?.worked_seconds || 0);
    const todaySeconds = trackedDuration > 0
      ? trackedDuration
      : liveDuration > 0
        ? liveDuration
        : workedDurationFromAttendance > 0
          ? workedDurationFromAttendance
          : 0;
    const idleSeconds = overallRow && trackedDuration > 0 ? resolveIdleSeconds(overallRow, todaySeconds) : 0;
    const workedSeconds = trackedDuration > 0 || liveDuration > 0
      ? Math.max(0, todaySeconds - idleSeconds)
      : todaySeconds;
    return {
      employee,
      status: employee.status === 'On Leave' ? 'On Leave' : isWorking ? 'Working' : 'Not working',
      todaySeconds,
      workedSeconds,
      idleSeconds,
      presentDays,
      lateDays: Number(attendance?.late_days || 0),
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
    const isPresentLate = row.status !== 'On Leave' && (row.lateDays > 0 || (isRangeIncludingToday && row.lateMinutes > 0));
    const isPresent = row.status !== 'On Leave' && row.presentDays > 0;
    const isAbsent = row.status !== 'On Leave' && row.presentDays <= 0 && (!isRangeIncludingToday || !hasActiveAttendance(attendanceByEmployeeId.get(row.employee.id)));
    const matchesStatus =
      workStatusFilter === 'All'
      || row.status === workStatusFilter
      || (workStatusFilter === 'Present' && isPresent)
      || (workStatusFilter === 'Present Late' && isPresentLate)
      || (workStatusFilter === 'Absent' && isAbsent);
    return matchesSearch && matchesDepartment && matchesStatus;
  });
  const activeOverallRangeStatusFilter: RangeStatusFilter = selectedKpiStatus ?? 'all';
  const overallRangeStatusRows = useMemo(() => {
    if (!shouldShowRangeStatusDetail || dashboardScope === 'employee') return [];

    if (activeOverallRangeStatusFilter === 'present_late') {
      return filteredWorkStatusRows
        .map((row) => {
          const days = safeArray<any>(rangeCalendarByEmployeeId.get(row.employee.id));
          const lateEntries = days
            .filter((day) => {
              const lateMinutes = Number(day?.late_minutes || 0);
              const status = String(day?.status || '').toLowerCase();
              return lateMinutes > 0 && (status === 'present' || status === 'checked_in');
            })
            .map((day) => ({
              date: String(day.date || '').slice(0, 10),
              lateMinutes: Number(day.late_minutes || 0),
            }));

          const lateDays = lateEntries.length;
          const averageLateMinutes = lateDays > 0
            ? Math.round(lateEntries.reduce((sum, entry) => sum + entry.lateMinutes, 0) / lateDays)
            : 0;

          return {
            employee: row.employee,
            lateEntries,
            lateDays,
            averageLateMinutes,
          };
        })
        .filter((row) => row.lateDays > 0)
        .sort((left, right) => right.lateDays - left.lateDays);
    }

    if (activeOverallRangeStatusFilter === 'present' || activeOverallRangeStatusFilter === 'present_on_time') {
      return filteredWorkStatusRows
        .map((row) => {
          const days = safeArray<any>(rangeCalendarByEmployeeId.get(row.employee.id));
          const presentEntries = days
            .filter((day) => {
              const status = String(day?.status || '').toLowerCase();
              return status === 'present' || status === 'checked_in';
            })
            .map((day) => ({
              date: String(day.date || '').slice(0, 10),
              lateMinutes: Number(day.late_minutes || 0),
            }));

          const presentDays = presentEntries.length;
          const lateDays = presentEntries.filter((entry) => entry.lateMinutes > 0).length;

          return {
            employee: row.employee,
            presentEntries,
            presentDays,
            onTimeDays: Math.max(0, presentDays - lateDays),
            lateDays,
          };
        })
        .filter((row) => row.presentDays > 0)
        .sort((left, right) => right.presentDays - left.presentDays);
    }

    if (activeOverallRangeStatusFilter === 'on_leave') {
      return filteredWorkStatusRows
        .map((row) => {
          const days = safeArray<any>(rangeCalendarByEmployeeId.get(row.employee.id));
          const leaveDates = days
            .filter((day) => String(day?.status || '').toLowerCase().includes('leave'))
            .map((day) => String(day.date || '').slice(0, 10));

          return {
            employee: row.employee,
            leaveDates,
            total: leaveDates.length,
          };
        })
        .filter((row) => row.total > 0)
        .sort((left, right) => right.total - left.total);
    }

    return filteredWorkStatusRows
      .map((row) => {
        const days = safeArray<any>(rangeCalendarByEmployeeId.get(row.employee.id));
        const absentDates = days
          .filter((day) => {
            const status = String(day?.status || '').toLowerCase();
            const date = String(day?.date || '').slice(0, 10);
            return status === 'none' && !day?.is_holiday && !day?.is_weekend && date <= todayIso();
          })
          .map((day) => String(day.date || '').slice(0, 10));

        return {
          employee: row.employee,
          absentDates,
          total: absentDates.length,
        };
      })
      .filter((row) => row.total > 0)
      .sort((left, right) => right.total - left.total);
  }, [
    activeOverallRangeStatusFilter,
    dashboardScope,
    filteredWorkStatusRows,
    rangeCalendarByEmployeeId,
    shouldShowRangeStatusDetail,
  ]);
  const selectedEmployeeRangeStatusRows = useMemo(() => {
    if (!shouldShowRangeStatusDetail || dashboardScope !== 'employee' || !selectedEmployee) return [];
    const days = safeArray<any>(rangeCalendarByEmployeeId.get(selectedEmployee.id));
    return days.map((day) => {
      const rawStatus = String(day?.status || 'none').toLowerCase();
      const lateMinutes = Number(day?.late_minutes || 0);
      const statusKey = rawStatus === 'checked_in' || rawStatus === 'present'
        ? (lateMinutes > 0 ? 'present_late' : 'present_on_time')
        : rawStatus.includes('leave')
          ? 'on_leave'
          : rawStatus === 'holiday'
            ? 'all'
            : 'absent';
      const label = statusKey === 'present_late'
        ? 'Present Late'
        : statusKey === 'present_on_time'
          ? 'Present On Time'
          : statusKey === 'on_leave'
            ? 'On Leave'
            : rawStatus === 'holiday'
              ? 'Holiday'
              : 'Absent';

      return {
        date: String(day?.date || '').slice(0, 10),
        statusKey,
        status: label,
        lateMinutes,
      };
    });
  }, [dashboardScope, rangeCalendarByEmployeeId, selectedEmployee, shouldShowRangeStatusDetail]);
  const selectedEmployeeRangeCounts = useMemo(() => {
    return selectedEmployeeRangeStatusRows.reduce((acc, row) => {
      if (row.statusKey === 'present_on_time') {
        acc.presentOnTime += 1;
        acc.present += 1;
      } else if (row.statusKey === 'present_late') {
        acc.presentLate += 1;
        acc.present += 1;
      } else if (row.statusKey === 'on_leave') {
        acc.onLeave += 1;
      } else if (row.statusKey === 'absent') {
        acc.absent += 1;
      }
      return acc;
    }, { present: 0, presentOnTime: 0, presentLate: 0, onLeave: 0, absent: 0 });
  }, [selectedEmployeeRangeStatusRows]);
  const filteredSelectedEmployeeRangeStatusRows = useMemo(() => {
    if (rangeStatusFilter === 'all') {
      return selectedEmployeeRangeStatusRows;
    }
    if (rangeStatusFilter === 'present') {
      return selectedEmployeeRangeStatusRows.filter((row) => row.statusKey === 'present_on_time' || row.statusKey === 'present_late');
    }
    if (rangeStatusFilter === 'present_on_time') {
      return selectedEmployeeRangeStatusRows.filter((row) => row.statusKey === 'present_on_time');
    }
    if (rangeStatusFilter === 'present_late') {
      return selectedEmployeeRangeStatusRows.filter((row) => row.statusKey === 'present_late');
    }
    if (rangeStatusFilter === 'on_leave') {
      return selectedEmployeeRangeStatusRows.filter((row) => row.statusKey === 'on_leave');
    }
    return selectedEmployeeRangeStatusRows.filter((row) => row.statusKey === 'absent');
  }, [rangeStatusFilter, selectedEmployeeRangeStatusRows]);
  const effectiveRangeStatusFilter = activeOverallRangeStatusFilter;
  const workingCount = workStatusRows.filter((row) => row.status === 'Working').length;
  const notWorkingCount = workStatusRows.filter((row) => row.status === 'Not working').length;
  const attendanceHealth = [
    { label: 'Working now', value: workingCount, color: 'bg-emerald-500' },
    { label: 'Not started', value: notWorkingCount, color: 'bg-slate-400' },
    { label: 'Present late', value: presentLateInRange, color: 'bg-rose-500' },
    { label: 'On leave', value: onLeave, color: 'bg-amber-500' },
    { label: 'Absent', value: attendanceAbsentDays, color: 'bg-red-500' },
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
      const insights = insightsResponse.status === 'fulfilled' ? insightsResponse.value.data : null;
      const shouldHydrateFromActivities =
        !insights
        || !hasToolBuckets(insights?.selected_user_tools)
        || Number(insights?.stats?.activity_total_duration || 0) <= 0;
      const fallbackInsights = shouldHydrateFromActivities
        ? buildFallbackEmployeeInsightsFromActivities(
            await activityApi.getAllPages({
              user_id: selectedEmployee.id,
              start_date: selectedStartDate,
              end_date: selectedEndDate,
              processed: true,
              per_page: 200,
            })
          )
        : null;

      return {
        profile: profileResponse.status === 'fulfilled' ? profileResponse.value.data : null,
        insights: fallbackInsights
          ? {
              ...(insights || {}),
              stats: {
                ...(insights?.stats || {}),
                ...fallbackInsights.stats,
              },
              selected_user_tools: fallbackInsights.selected_user_tools,
            }
          : insights,
        screenshots: screenshotsResponse.status === 'fulfilled' ? screenshotsResponse.value.data : null,
      };
    },
  });
  const employeeDetail = selectedEmployeeDetailQuery.data;
  const employeeProfile: any = employeeDetail?.profile || null;
  const employeeInsights: any = employeeDetail?.insights || null;
  const employeeScreenshots: any = employeeDetail?.screenshots || null;
  const employeeStats = employeeInsights?.stats || employeeProfile?.summary || {};
  const selectedEmployeeActiveEntry = safeArray<any>(employeeProfile?.recent_time_entries)
    .find((entry: any) => !entry.end_time);
  const selectedEmployeeLiveTimerSignal = Boolean(selectedEmployee?.is_working) || Number(selectedEmployee?.current_duration || 0) > 0;
  const selectedEmployeeIsWorking = Boolean(
    selectedWorkStatus?.status === 'Working'
    || employeeProfile?.status?.is_working
    || selectedEmployeeActiveEntry
    || selectedEmployeeLiveTimerSignal
  );
  const selectedEmployeeTrackedSeconds = Math.max(
    0,
    ...[
      employeeStats.tracked_duration,
      employeeStats.total_duration,
      selectedEmployeeOverallRow?.total_duration,
      selectedWorkStatus?.todaySeconds,
      isRangeIncludingToday ? selectedEmployee?.current_duration : 0,
    ].map((value) => Number(value || 0)).filter((value) => Number.isFinite(value))
  );
  const selectedEmployeeIdleFromOverall = selectedEmployeeOverallRow
    ? resolveIdleSeconds(selectedEmployeeOverallRow, selectedEmployeeTrackedSeconds)
    : NaN;
  const selectedEmployeeIdleSeconds = Number.isFinite(selectedEmployeeIdleFromOverall)
    ? selectedEmployeeIdleFromOverall
    : Number(employeeStats.idle_total_duration || employeeStats.idle_duration || 0);
  const scopeIdleSeconds = dashboardScope === 'employee'
    ? selectedEmployeeIdleSeconds
    : Number(data.overall.summary?.idle_duration || data.overall.summary?.idle_time || 0);
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
  const selectedEmployeeMonitoringLink = selectedEmployee
    ? buildScopedEmployeeLink('/monitoring/screenshots', selectedEmployee.id, selectedStartDate, selectedEndDate)
    : '/monitoring/screenshots';
  const selectedEmployeeProductivityLink = selectedEmployee
    ? buildScopedEmployeeLink('/monitoring/productive-time', selectedEmployee.id, selectedStartDate, selectedEndDate)
    : '/monitoring/productive-time';
  const selectedEmployeeAttendanceLink = selectedEmployee
    ? buildScopedEmployeeLink('/attendance', selectedEmployee.id, selectedStartDate, selectedEndDate)
    : '/attendance';
  const employeeTopTools = [
    ...safeArray<any>(employeeTools.productive),
    ...safeArray<any>(employeeTools.unproductive),
    ...safeArray<any>(employeeTools.neutral),
    ...safeArray<any>(employeeTools.context_dependent),
  ].sort((a, b) => Number(b.total_duration || 0) - Number(a.total_duration || 0)).slice(0, 4);
  const selectedEmployeeTimerStartedAt =
    selectedEmployeeActiveEntry?.start_time ||
    employeeProfile?.status?.current_timer_started_at ||
    (selectedEmployeeIsWorking ? selectedWorkStatus?.checkInAt : null);
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
    { id: 'department-distribution', label: 'Department Distribution', description: 'People count by department', category: 'Section', sectionId: 'department-distribution', keywords: ['department', 'distribution', 'team'] },
    { id: 'scope-summary', label: 'Scope Summary', description: 'Overall or selected employee detail area', category: 'Section', sectionId: 'scope-summary', keywords: ['scope', 'employee detail', 'summary', 'screenshots', 'productivity'] },
    { id: 'work-status', label: 'Current Work Status', description: 'Working, not working, and leave status table', category: 'Section', sectionId: 'current-work-status', keywords: ['working', 'status', 'not working', 'current'] },
    { id: 'time-tracker', label: 'Time Tracker', description: 'Current timer, project, task, and selected range totals', category: 'Section', sectionId: 'time-tracker-card', keywords: ['timer', 'time tracker', 'task', 'project'] },
    { id: 'checkin-log', label: 'Check-In / Check-Out Log', description: 'Last check in, last check out, session, and late status', category: 'Section', sectionId: 'checkin-log', keywords: ['check in', 'check out', 'punch', 'late'] },
    { id: 'attendance-health', label: 'Attendance Health', description: 'Working now, not started, late, and leave bars', category: 'Section', sectionId: 'attendance-health', keywords: ['attendance health', 'health', 'working now'] },
    { id: 'communication-hub', label: 'Communication Hub', description: 'Birthdays, activity, and announcements', category: 'Section', sectionId: 'communication-hub', keywords: ['communication', 'birthdays', 'activity', 'announcements'] },
    { id: 'people-summary', label: 'People Summary', description: 'Active accounts, departments, hires, and leave', category: 'Section', sectionId: 'people-summary', keywords: ['people', 'employees', 'summary'] },
    { id: 'projects-section', label: 'Projects', description: 'Project progress and time distribution', category: 'Section', sectionId: 'projects-section', keywords: ['projects', 'project progress'] },
    { id: 'reports-section', label: 'Reports', description: 'Quick report shortcuts', category: 'Section', sectionId: 'reports-section', keywords: ['reports', 'export', 'attendance report', 'payroll report'] },
    { id: 'employees-page', label: 'Employees Panel', description: 'Open employee management', category: 'Panel', route: '/employees', keywords: ['employee', 'employees', 'directory', 'management'] },
    { id: 'attendance-page', label: 'Attendance Panel', description: 'Open attendance records', category: 'Panel', route: '/attendance', keywords: ['attendance', 'calendar', 'punch'] },
    { id: 'leave-page', label: 'Approval Inbox', description: 'Open leave approvals', category: 'Panel', route: '/approval-inbox?section=leave&view=pending&leave_window=today', keywords: ['leave', 'approval', 'approval inbox'] },
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

  useEffect(() => {
    if (!isDashboardNotificationsOpen || !hasUnreadDashboardNotifications || dashboardNotificationsSeen) {
      return;
    }

    let active = true;
    setDashboardNotificationsSeen(true);

    notificationApi.markAllRead({ exclude_types: CHAT_NOTIFICATION_TYPES }).catch(() => {
      if (active) {
        setDashboardNotificationsSeen(false);
      }
    });

    return () => {
      active = false;
    };
  }, [dashboardNotificationsSeen, hasUnreadDashboardNotifications, isDashboardNotificationsOpen]);

  return (
    <div className="w-full space-y-5 bg-[#f5f7fb] pt-4 text-slate-900">
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
              {hasUnreadDashboardNotifications && !dashboardNotificationsSeen ? <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-rose-500" /> : null}
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
                max={todayIso()}
                onChange={(event) => setCustomRange((current) => {
                  const nextStart = clampIsoDateToToday(event.target.value);
                  const nextEnd = current.endDate < nextStart ? nextStart : clampIsoDateToToday(current.endDate);
                  return { startDate: nextStart, endDate: nextEnd };
                })}
                className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
              />
            </label>
            <label className="text-xs font-medium text-slate-600">
              End date
              <input
                type="date"
                value={customRange.endDate}
                max={todayIso()}
                onChange={(event) => setCustomRange((current) => {
                  const nextEnd = clampIsoDateToToday(event.target.value);
                  return {
                    startDate: current.startDate > nextEnd ? nextEnd : current.startDate,
                    endDate: nextEnd,
                  };
                })}
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
            <SelectInput
              aria-label="Filter dashboard by department"
              value={scopeDepartmentFilter}
              onChange={(event) => {
                setScopeDepartmentFilter(event.target.value);
                setSelectedEmployeeId(null);
              }}
              className="h-9 px-3 text-xs font-medium text-slate-600"
            >
              {departments.map((department) => <option key={department} value={department}>{department === 'All' ? 'All departments' : department}</option>)}
            </SelectInput>
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
            <SelectInput
              aria-label="Select dashboard employee"
              value={selectedEmployee?.id || ''}
              onChange={(event) => setSelectedEmployeeId(Number(event.target.value) || null)}
              className="h-9 px-3 text-xs font-medium text-slate-600"
            >
              {scopeEmployeeMatches.length ? scopeEmployeeMatches.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name} - {employee.department}</option>
              )) : <option value="" disabled>No employee found</option>}
            </SelectInput>
          </div>
        ) : null}
      </Card>

      <section id="dashboard-kpis" className="grid scroll-mt-24 grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-7">
        <KpiCard to="/employees" label="Total Employees" value={totalEmployees} hint={`${newHires} joined in range`} icon={Users} tint="bg-blue-50 text-blue-600" />
        <KpiCard
          label="Present"
          value={totalPresentInRange}
          hint={`${presentPercent}% of total`}
          icon={UserPlus}
          tint="bg-emerald-50 text-emerald-600"
          onClick={() => {
            setWorkStatusFilter('Present');
            setSelectedKpiStatus('present');
            scrollToDashboardSection('current-work-status');
          }}
        />
        <KpiCard
          label="On Leave"
          value={onLeave}
          hint={`${leavePercent}% of total`}
          icon={Umbrella}
          tint="bg-amber-50 text-amber-600"
          onClick={() => {
            setWorkStatusFilter('On Leave');
            setSelectedKpiStatus('on_leave');
            scrollToDashboardSection('current-work-status');
          }}
        />
        <KpiCard
          label="Absent"
          value={attendanceAbsentDays}
          hint={`${absentPercent}% of total`}
          icon={Calendar}
          tint="bg-red-50 text-red-600"
          onClick={() => {
            setWorkStatusFilter('Absent');
            setSelectedKpiStatus('absent');
            scrollToDashboardSection('current-work-status');
          }}
        />
        <KpiCard
          label="Present Late"
          value={presentLateInRange}
          hint={`${presentLatePercent}% of total`}
          icon={Clock3}
          tint="bg-rose-50 text-rose-600"
          onClick={() => {
            setWorkStatusFilter('Present Late');
            setSelectedKpiStatus('present_late');
            scrollToDashboardSection('current-work-status');
          }}
        />
        <KpiCard to="/new-hires" label="New Hires" value={String(newHires).padStart(2, '0')} hint="Joined in range" icon={UserPlus} tint="bg-violet-50 text-violet-600" />
        <KpiCard to="/resignations" label="Resignations" value={String(resignations).padStart(2, '0')} hint="Exited in range" icon={UserMinus} tint="bg-slate-100 text-slate-600" />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.85fr)]">
        <Card id="attendance-overview" className="scroll-mt-24 p-4">
          <SectionTitle title="Attendance Overview" action={<span className="text-xs text-slate-500">{selectedRangePresetLabel}</span>} />
          <AttendancePieChart items={attendancePieItems} />
          <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {[
              ['Present on time', attendanceOnTimeDays],
              ['Present late', attendanceLatePresentDays],
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
        <Card id="department-distribution" className="scroll-mt-24 p-4">
          <SectionTitle title="Department Distribution" action={<Link to="/employees/teams" className="text-xs font-medium text-blue-600">All Departments</Link>} />
          {departmentCounts.length ? (
            <ResponsiveContainer width="100%" height={Math.max(60, departmentCounts.length * 36)}>
              <BarChart data={departmentCounts} layout="vertical" margin={{ top: 4, right: 40, left: 5, bottom: 4 }} barCategoryGap="20%">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="department" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={80} />
                <Tooltip
                  content={({ active, payload }: any) => {
                    if (!active || !payload?.length) return null;
                    const row = payload[0].payload;
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                        <p className="text-xs font-bold text-slate-900">{row.department}</p>
                        <p className="mt-1 text-xs text-slate-500">Employees: <span className="font-semibold text-slate-700">{row.count}</span></p>
                      </div>
                    );
                  }}
                  cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                  offset={28}
                />
                <Bar dataKey="count" name="Employees" radius={[0, 4, 4, 0]} barSize={16}>
                  {departmentCounts.map((item, index) => (
                    <Cell key={item.department} fill={departmentPalette[index % departmentPalette.length]} />
                  ))}
                  <LabelList dataKey="count" position="right" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 500 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
                      <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${selectedWorkStatus?.status === 'On Leave' ? 'bg-amber-50 text-amber-700' : selectedEmployeeIsWorking ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                        {selectedWorkStatus?.status === 'On Leave' ? 'On Leave' : selectedEmployeeIsWorking ? 'Working' : 'Not working'}
                      </span>
                    </div>
                    <p className="mt-1 truncate text-xs text-slate-500">{selectedEmployee.email}</p>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
                      <div><p className="text-slate-400">Department</p><p className="mt-1 font-semibold text-slate-800">{selectedEmployee.department}</p></div>
                      <div><p className="text-slate-400">Role</p><p className="mt-1 font-semibold text-slate-800">{selectedEmployee.position}</p></div>
                      <div><p className="text-slate-400">Last check in</p><p className="mt-1 font-semibold text-slate-800">{formatDateTime(selectedWorkStatus?.checkInAt || employeeProfile?.status?.latest_attendance?.check_in_at)}</p></div>
                      <div><p className="text-slate-400">Last check out</p><p className="mt-1 font-semibold text-slate-800">{selectedEmployeeIsWorking ? 'Still checked in' : formatDateTime(selectedWorkStatus?.checkOutAt || employeeProfile?.status?.latest_attendance?.check_out_at)}</p></div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Tracked</p><p className="mt-2 text-lg font-semibold">{formatDuration(selectedEmployeeTrackedSeconds)}</p></div>
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Attendance</p><p className="mt-2 text-lg font-semibold">{employeePresentDays} present</p></div>
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Idle Time</p><p className="mt-2 text-lg font-semibold text-amber-700">{formatDuration(selectedEmployeeIdleSeconds)}</p></div>
                <div className="rounded-lg border border-slate-100 p-3"><p className="text-[11px] text-slate-500">Screenshots</p><p className="mt-2 text-lg font-semibold text-blue-700">{employeeScreenshotCount}</p></div>
              </div>

              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Screenshot Access</span>
                  <Link to={selectedEmployeeMonitoringLink} className="font-medium text-blue-600">Open Monitoring</Link>
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
                {(() => {
                  const productivityData = [
                    { label: 'Productive', value: Number(employeeStats.productive_duration || 0) },
                    { label: 'Unproductive', value: Number(employeeStats.unproductive_duration || 0) },
                    { label: 'Neutral', value: Number(employeeStats.neutral_duration || 0) },
                    { label: 'Context', value: Number(employeeStats.context_dependent_duration || 0) },
                  ];
                  return (
                    <ResponsiveContainer width="100%" height={140}>
                      <BarChart data={productivityData} layout="vertical" margin={{ top: 4, right: 80, left: 80, bottom: 4 }} barCategoryGap="20%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                        <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={75} />
                        <Tooltip
                          content={({ active, payload }: any) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0].payload;
                            return (
                              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                                <p className="text-xs font-bold text-slate-900">{row.label}</p>
                                <p className="mt-1 text-xs text-slate-500">Duration: <span className="font-semibold text-slate-700">{formatDuration(row.value)}</span></p>
                                <p className="text-xs text-slate-500">Share: <span className="font-semibold text-slate-700">{employeeActivityTotal > 0 ? Math.round((row.value / employeeActivityTotal) * 100) : 0}%</span></p>
                              </div>
                            );
                          }}
                          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                          offset={28}
                        />
                        <Bar dataKey="value" name="Duration" radius={[0, 4, 4, 0]} barSize={16}>
                          <Cell fill="#10b981" />
                          <Cell fill="#f43f5e" />
                          <Cell fill="#94a3b8" />
                          <Cell fill="#f59e0b" />
                          <LabelList dataKey="value" position="right" formatter={(val: number) => formatDuration(val)} style={{ fontSize: '11px', fill: '#64748b', fontWeight: 500 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>

              <div className="rounded-lg border border-slate-100 p-3">
                <div className="mb-3 flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">Top Tools & Sites</span>
                  <Link to={selectedEmployeeProductivityLink} className="font-medium text-blue-600">Details</Link>
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
                  <Link to={selectedEmployeeAttendanceLink} className="font-medium text-blue-600">Open</Link>
                </div>
                {employeeAttendanceRecords.length ? (
                  <div className="space-y-3">
                    {employeeAttendanceRecords.map((record: any) => (
                      <div key={record.id || record.attendance_date} className="flex items-center justify-between gap-3 text-xs">
                        <div>
                          <p className="font-medium text-slate-700">{formatDate(record.attendance_date)}</p>
                          <p className="text-[11px] text-slate-400">{record.late_minutes
                            ? (() => {
                                const hrs = Math.floor(record.late_minutes / 60);
                                const mins = record.late_minutes % 60;
                                if (hrs > 0) {
                                  return mins > 0 ? `${hrs}h ${mins}m late` : `${hrs}h late`;
                                }
                                return `${record.late_minutes} min late`;
                              })()
                            : 'On time'}</p>
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
                <p className="text-[11px] text-slate-500">Present on time</p>
                <p className="mt-2 text-xl font-semibold text-blue-700">{presentOnTimeInRange}</p>
              </div>
              <div className="rounded-lg border border-slate-100 bg-slate-50 p-4">
                <p className="text-[11px] text-slate-500">Present late</p>
                <p className="mt-2 text-xl font-semibold text-rose-600">{presentLateInRange}</p>
              </div>
            </div>
            <div className="rounded-lg border border-slate-100 p-4">
              <div className="mb-3 flex items-center justify-between text-xs">
                <span className="font-semibold text-slate-700">Department scope</span>
                <span className="text-slate-400">{scopeDepartmentFilter === 'All' ? 'All departments' : scopeDepartmentFilter}</span>
              </div>
              {departmentCounts.length ? (
                (() => {
                  const scopeData = departmentCounts.slice(0, 5);
                  return (
                    <ResponsiveContainer width="100%" height={Math.max(60, scopeData.length * 36)}>
                      <BarChart data={scopeData} layout="vertical" margin={{ top: 4, right: 40, left: 5, bottom: 4 }} barCategoryGap="20%">
                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                        <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                        <YAxis type="category" dataKey="department" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={80} />
                        <Tooltip
                          content={({ active, payload }: any) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0].payload;
                            return (
                              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                                <p className="text-xs font-bold text-slate-900">{row.department}</p>
                                <p className="mt-1 text-xs text-slate-500">Employees: <span className="font-semibold text-slate-700">{row.count}</span> / {totalEmployees}</p>
                              </div>
                            );
                          }}
                          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                          offset={28}
                        />
                        <Bar dataKey="count" name="Employees" radius={[0, 4, 4, 0]} barSize={16}>
                          {scopeData.map((item: any, index: number) => (
                            <Cell key={item.department} fill={departmentPalette[index % departmentPalette.length]} />
                          ))}
                          <LabelList dataKey="count" position="right" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 500 }} />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  );
                })()
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
              {['All', 'Present', 'Present Late', 'Absent', 'Working', 'Not working', 'On Leave'].map((status) => <option key={status} value={status}>{status}</option>)}
            </select>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-100">
            <table className="min-w-[900px] w-full text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Employee</th>
                  <th className="px-4 py-3 font-medium">Department</th>
                  <th className="px-4 py-3 font-medium">Tracked</th>
                  <th className="px-4 py-3 font-medium">Worked</th>
                  <th className="px-4 py-3 font-medium">Idle</th>
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
                    <td className="px-4 py-3 font-medium text-emerald-700">{formatDuration(row.workedSeconds)}</td>
                    <td className="px-4 py-3 font-medium text-amber-600">{formatDuration(row.idleSeconds)}</td>
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
          {shouldShowRangeStatusDetail ? (
            <div className="mt-4 rounded-lg border border-slate-100">
              <div className="border-b border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                  {dashboardScope === 'employee'
                    ? 'Range Status Detail'
                    : effectiveRangeStatusFilter === 'present_late'
                      ? 'Present Late Summary'
                      : effectiveRangeStatusFilter === 'present' || effectiveRangeStatusFilter === 'present_on_time'
                        ? 'Present Summary'
                        : effectiveRangeStatusFilter === 'on_leave'
                          ? 'Leave Date Summary'
                          : 'Absent Date Summary'}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {dashboardScope === 'employee' ? (
                    <button
                      type="button"
                      className="rounded-md border border-blue-600 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700"
                    >
                      {rangeStatusFilter === 'all'
                        ? `All (${selectedEmployeeRangeStatusRows.length})`
                        : rangeStatusFilter === 'present'
                          ? `Present (${selectedEmployeeRangeCounts.present})`
                          : rangeStatusFilter === 'present_on_time'
                            ? `Present On Time (${selectedEmployeeRangeCounts.presentOnTime})`
                            : rangeStatusFilter === 'present_late'
                              ? `Present Late (${selectedEmployeeRangeCounts.presentLate})`
                              : rangeStatusFilter === 'on_leave'
                                ? `On Leave (${selectedEmployeeRangeCounts.onLeave})`
                                : `Absent (${selectedEmployeeRangeCounts.absent})`}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="rounded-md border border-blue-600 bg-blue-50 px-2.5 py-1 text-[11px] font-medium text-blue-700"
                    >
                      {effectiveRangeStatusFilter === 'present_late'
                        ? 'Present Late'
                        : effectiveRangeStatusFilter === 'present' || effectiveRangeStatusFilter === 'present_on_time'
                          ? 'Present'
                          : effectiveRangeStatusFilter === 'on_leave'
                            ? 'On Leave'
                            : 'Absent'}
                    </button>
                  )}
                </div>
              </div>
              {rangeAttendanceCalendarQuery.isFetching ? (
                <div className="px-4 py-4 text-xs text-blue-600">Loading range attendance details...</div>
              ) : dashboardScope === 'employee' ? (
                <div className="max-h-[360px] overflow-auto">
                  <table className="min-w-[680px] w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Date</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium">Late</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSelectedEmployeeRangeStatusRows.map((row) => (
                        <tr key={`${row.date}-${row.statusKey}`}>
                          <td className="px-4 py-3 text-slate-700">{formatDate(row.date)}</td>
                          <td className="px-4 py-3">
                            <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${row.status === 'Absent' ? 'bg-red-50 text-red-700' : row.status === 'Present On Time' ? 'bg-emerald-50 text-emerald-700' : row.status === 'Present Late' ? 'bg-rose-50 text-rose-700' : row.status === 'On Leave' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-medium text-slate-700">
                            {row.statusKey === 'present_late'
                              ? (() => {
                                  const hrs = Math.floor(row.lateMinutes / 60);
                                  const mins = row.lateMinutes % 60;
                                  if (hrs > 0) {
                                    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs}h`;
                                  }
                                  return `${row.lateMinutes} min`;
                                })()
                              : row.statusKey === 'present_on_time' ? 'On time' : '--'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredSelectedEmployeeRangeStatusRows.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No records found for selected status and range</EmptyInline></div> : null}
                </div>
              ) : effectiveRangeStatusFilter === 'present_late' ? (
                <div className="max-h-[360px] overflow-auto">
                  <table className="min-w-[940px] w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Department</th>
                        <th className="px-4 py-3 font-medium">Late Dates</th>
                        <th className="px-4 py-3 font-medium">Late Days</th>
                        <th className="px-4 py-3 font-medium">Avg Late Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {overallRangeStatusRows.map((row: any) => (
                        <tr key={row.employee.id}>
                          <td className="px-4 py-3 font-medium text-slate-900">{row.employee.name}</td>
                          <td className="px-4 py-3 text-slate-600">{row.employee.department}</td>
                          <td className="px-4 py-3 text-slate-700">{row.lateEntries.map((entry) => formatDate(entry.date)).join(', ')}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.lateDays}</td>
                          <td className="px-4 py-3 font-semibold text-rose-700">{row.averageLateMinutes} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {overallRangeStatusRows.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No late records found in this range for current filters</EmptyInline></div> : null}
                </div>
              ) : effectiveRangeStatusFilter === 'present' || effectiveRangeStatusFilter === 'present_on_time' ? (
                <div className="max-h-[360px] overflow-auto">
                  <table className="min-w-[980px] w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Department</th>
                        <th className="px-4 py-3 font-medium">Present Dates</th>
                        <th className="px-4 py-3 font-medium">Present Days</th>
                        <th className="px-4 py-3 font-medium">On Time</th>
                        <th className="px-4 py-3 font-medium">Late</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {overallRangeStatusRows.map((row: any) => (
                        <tr key={row.employee.id}>
                          <td className="px-4 py-3 font-medium text-slate-900">{row.employee.name}</td>
                          <td className="px-4 py-3 text-slate-600">{row.employee.department}</td>
                          <td className="px-4 py-3 text-slate-700">{row.presentEntries.map((entry) => formatDate(entry.date)).join(', ')}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.presentDays}</td>
                          <td className="px-4 py-3 font-semibold text-emerald-700">{row.onTimeDays}</td>
                          <td className="px-4 py-3 font-semibold text-rose-700">{row.lateDays}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {overallRangeStatusRows.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No present records found in this range for current filters</EmptyInline></div> : null}
                </div>
              ) : effectiveRangeStatusFilter === 'on_leave' ? (
                <div className="max-h-[360px] overflow-auto">
                  <table className="min-w-[860px] w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Department</th>
                        <th className="px-4 py-3 font-medium">Leave Dates</th>
                        <th className="px-4 py-3 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {overallRangeStatusRows.map((row: any) => (
                        <tr key={row.employee.id}>
                          <td className="px-4 py-3 font-medium text-slate-900">{row.employee.name}</td>
                          <td className="px-4 py-3 text-slate-600">{row.employee.department}</td>
                          <td className="px-4 py-3 text-slate-700">{row.leaveDates.map((date) => formatDate(date)).join(', ')}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {overallRangeStatusRows.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No leave days found in this range for current filters</EmptyInline></div> : null}
                </div>
              ) : (
                <div className="max-h-[360px] overflow-auto">
                  <table className="min-w-[860px] w-full text-left text-xs">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Employee</th>
                        <th className="px-4 py-3 font-medium">Department</th>
                        <th className="px-4 py-3 font-medium">Absent Dates</th>
                        <th className="px-4 py-3 font-medium">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {overallRangeStatusRows.map((row: any) => (
                        <tr key={row.employee.id}>
                          <td className="px-4 py-3 font-medium text-slate-900">{row.employee.name}</td>
                          <td className="px-4 py-3 text-slate-600">{row.employee.department}</td>
                          <td className="px-4 py-3 text-slate-700">{row.absentDates.map((date) => formatDate(date)).join(', ')}</td>
                          <td className="px-4 py-3 font-semibold text-slate-900">{row.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {overallRangeStatusRows.length === 0 ? <div className="border-t border-slate-100 p-4"><EmptyInline>No absent days found in this range for current filters</EmptyInline></div> : null}
                </div>
              )}
            </div>
          ) : null}
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
              <p className="mt-2 text-lg font-semibold text-amber-700">{formatDuration(scopeIdleSeconds)}</p>
            </div>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card id="checkin-log" className="scroll-mt-24 p-4">
          <SectionTitle title="Check-In / Check-Out Log" action={<Link to="/attendance" className="text-xs font-medium text-blue-600">Open Attendance</Link>} />
          <div className={`overflow-x-auto rounded-lg border border-slate-100 ${filteredWorkStatusRows.length > 10 ? 'max-h-[520px] overflow-y-auto' : ''}`}>
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
                {filteredWorkStatusRows.map((row) => (
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
                      <span className={`rounded-md px-2 py-1 text-[11px] font-medium ${!row.checkInAt ? 'bg-slate-100 text-slate-600' : (row.lateDays > 0 || (isRangeIncludingToday && row.lateMinutes > 0)) ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {!row.checkInAt
                          ? 'No punch'
                          : (isRangeIncludingToday && row.lateMinutes > 0)
                            ? (() => {
                                const hrs = Math.floor(row.lateMinutes / 60);
                                const mins = row.lateMinutes % 60;
                                if (hrs > 0) {
                                  return mins > 0 ? `${hrs}h ${mins}m late` : `${hrs}h late`;
                                }
                                return `${row.lateMinutes} min late`;
                              })()
                            : row.lateDays > 0
                              ? `${row.lateDays} late day${row.lateDays === 1 ? '' : 's'}`
                              : 'On time'}
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
          <div className="-ml-1">
            <div className="w-full">
              <ResponsiveContainer width="100%" height={attendanceHealth.length * 40}>
                <BarChart data={attendanceHealth} layout="vertical" margin={{ top: 8, right: 40, left: 5, bottom: 8 }} barCategoryGap="25%">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={[0, totalEmployees]} />
                  <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={100} />
                  <Tooltip
                    content={({ active, payload }: any) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload;
                      return (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                          <p className="text-xs font-bold text-slate-900">{row.label}</p>
                          <p className="mt-1 text-xs text-slate-500">Employees: <span className="font-semibold text-slate-700">{row.value}</span></p>
                        </div>
                      );
                    }}
                    cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                    offset={28}
                  />
                  <Bar dataKey="value" name="Employees" radius={[0, 4, 4, 0]} barSize={24}>
                    {attendanceHealth.map((item: any) => (
                      <Cell key={item.label} fill={item.color === 'bg-emerald-500' ? '#10b981' : item.color === 'bg-slate-400' ? '#94a3b8' : item.color === 'bg-rose-500' ? '#f43f5e' : item.color === 'bg-amber-500' ? '#f59e0b' : item.color === 'bg-red-500' ? '#ef4444' : '#94a3b8'} />
                    ))}
                    <LabelList dataKey="value" position="right" style={{ fontSize: '12px', fill: '#64748b', fontWeight: 600 }} />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
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
              (() => {
                const largestDeptData = departmentCounts.slice(0, 3);
                return (
                  <ResponsiveContainer width="100%" height={largestDeptData.length * 36}>
                    <BarChart data={largestDeptData} layout="vertical" margin={{ top: 4, right: 40, left: 80, bottom: 4 }} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="department" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={80} />
                      <Tooltip
                        content={({ active, payload }: any) => {
                          if (!active || !payload?.length) return null;
                          const row = payload[0].payload;
                          return (
                            <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                              <p className="text-xs font-bold text-slate-900">{row.department}</p>
                              <p className="mt-1 text-xs text-slate-500">Employees: <span className="font-semibold text-slate-700">{row.count}</span></p>
                            </div>
                          );
                        }}
                        cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                        offset={28}
                      />
                      <Bar dataKey="count" name="Employees" radius={[0, 4, 4, 0]} barSize={16}>
                        {largestDeptData.map((item: any, index: number) => (
                          <Cell key={item.department} fill={departmentPalette[index % departmentPalette.length]} />
                        ))}
                        <LabelList dataKey="count" position="right" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 500 }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                );
              })()
            ) : <EmptyInline>No employees found</EmptyInline>}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/employees" className="inline-flex h-9 items-center rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-700">
              Open Directory
            </Link>
          </div>
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card id="task-pipeline" className="scroll-mt-24 p-4">
            <SectionTitle title="Task Pipeline" action={<Link to="/tasks" className="text-xs font-medium text-blue-600">Manage</Link>} />
            {(() => {
              const taskPipelineData = Object.entries(taskStatusCounts).map(([label, count]) => ({ label, count }));
              return (
                <ResponsiveContainer width="100%" height={taskPipelineData.length * 40}>
                  <BarChart data={taskPipelineData} layout="vertical" margin={{ top: 4, right: 40, left: 80, bottom: 4 }} barCategoryGap="25%">
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} domain={[0, taskTotal]} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: '#475569', fontWeight: 500 }} axisLine={false} tickLine={false} width={75} />
                    <Tooltip
                      content={({ active, payload }: any) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0].payload;
                        return (
                          <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                            <p className="text-xs font-bold text-slate-900">{row.label}</p>
                            <p className="mt-1 text-xs text-slate-500">Tasks: <span className="font-semibold text-slate-700">{row.count}</span> / {taskTotal}</p>
                          </div>
                        );
                      }}
                      cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                      offset={28}
                    />
                    <Bar dataKey="count" name="Tasks" radius={[0, 4, 4, 0]} barSize={16}>
                      <Cell fill="#f59e0b" />
                      <Cell fill="#2563eb" />
                      <Cell fill="#10b981" />
                      <LabelList dataKey="count" position="right" style={{ fontSize: '11px', fill: '#64748b', fontWeight: 500 }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              );
            })()}
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
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card id="projects-section" className="scroll-mt-24 p-4">
          <SectionTitle title="Projects" action={<Link to="/projects" className="text-xs font-medium text-blue-600">View All</Link>} />
          {projectProgressSource.length ? (
            <div className="space-y-3">
              {projectProgressSource.map((project: any) => (
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

        <Card id="productivity-leaders" className="scroll-mt-24 p-4">
          <SectionTitle title="Productivity Leaders" action={<Link to="/reports/hours-tracked" className="text-xs font-medium text-blue-600">Open Hours</Link>} />
          {isDashboardInitialLoading ? (
            <EmptyInline>Loading productivity data...</EmptyInline>
          ) : productivityLeaders.length ? (
            <div className="space-y-3">
              {productivityLeaders.map((row) => (
                <div key={row.userId} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-slate-900">{row.name}</p>
                      <p className="truncate text-[11px] text-slate-500">{row.department}</p>
                    </div>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700">{row.productivityPercent}% productive</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                    <span>Tracked: <strong>{formatDuration(row.trackedSeconds)}</strong></span>
                    <span>Working: <strong>{formatDuration(row.workingSeconds)}</strong></span>
                    <span>Idle: <strong>{formatDuration(row.idleSeconds)}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyInline>No productivity rows in this scope</EmptyInline>}
        </Card>
      </section>

      <section>
        <Card id="department-work-idle-chart" className="scroll-mt-24 p-4">
          <SectionTitle title="Department Work vs Idle Time" />
          {departmentPerformanceRows.length ? (
            <>
              <DepartmentWorkIdleChart
                data={departmentPerformanceRows.map((row) => ({
                  department: row.department,
                  workedSeconds: row.trackedSeconds - row.idleSeconds,
                  idleSeconds: row.idleSeconds,
                  members: row.members,
                }))}
              />
              <div className="mt-3 flex items-center justify-center gap-6 text-xs text-slate-600">
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-blue-600" />Worked Time</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm bg-amber-500" />Idle Time</span>
              </div>
            </>
          ) : <EmptyInline>No department data available for the selected range</EmptyInline>}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card id="department-performance" className="scroll-mt-24 p-4">
          <SectionTitle title="Department Performance" action={<Link to="/employees" className="text-xs font-medium text-blue-600">Open Directory</Link>} />
          {departmentPerformanceRows.length ? (
            <div className="space-y-3">
              {departmentPerformanceRows.map((row) => (
                <div key={row.department} className="rounded-lg border border-slate-100 p-3">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <p className="font-semibold text-slate-900">{row.department}</p>
                    <span className={`rounded-full px-2 py-1 text-[11px] font-semibold ${row.healthLabel === 'Needs attention' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{row.healthLabel}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                    <span>Members: <strong>{row.members}</strong></span>
                    <span>Tracked: <strong>{formatDuration(row.trackedSeconds)}</strong></span>
                    <span>Avg / member: <strong>{formatDuration(row.averageTrackedPerMember)}</strong></span>
                    <span>Attendance: <strong>{row.attendanceCoverage}%</strong></span>
                    <span>Idle share: <strong>{row.idlePercent}%</strong></span>
                    <span>Late today: <strong>{row.lateMembers}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          ) : <EmptyInline>No department performance data</EmptyInline>}
        </Card>

        <Card id="admin-focus-board" className="scroll-mt-24 p-4">
          <SectionTitle title="Admin Focus Board" action={<Link to="/analytics" className="text-xs font-medium text-blue-600">Open Analytics</Link>} />
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">Departments Need Attention</p>
              <p className="mt-1 text-xl font-semibold text-rose-700">{departmentsNeedingAttention}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">No Tracked Time</p>
              <p className="mt-1 text-xl font-semibold text-slate-900">{employeesWithoutTrackedTime}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">Open Tasks</p>
              <p className="mt-1 text-xl font-semibold text-amber-700">{taskStatusCounts['To Do'] + taskStatusCounts['In Progress']}</p>
            </div>
            <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
              <p className="text-[11px] text-slate-500">Late Today</p>
              <p className="mt-1 text-xl font-semibold text-orange-700">{presentLateInRange}</p>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-slate-100 bg-white p-3 text-xs text-slate-600">
            Focus first on departments marked <span className="font-semibold text-rose-700">Needs attention</span>, then review employees with zero tracked time.
          </div>
        </Card>
      </section>

      {dashboardQuery.isFetching ? (
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">Refreshing dashboard data from the database...</div>
      ) : null}
    </div>
  );
}
