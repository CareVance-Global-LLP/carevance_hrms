import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  activityApi,
  productivityClassificationApi,
  reportApi,
  reportGroupApi,
  taskApi,
  timeEntryApi,
  userApi,
} from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import { hasStrictAdminAccess } from '@/lib/permissions';
import TimelineSwimlanes from '@/features/monitoring/TimelineSwimlanes';
import UsageAnalytics from '@/features/monitoring/UsageAnalytics';
import type { Classification } from '@/features/monitoring/monitoringUi';
import { usePlan } from '@/hooks/usePlan';
import DateRangeFields from '@/components/dashboard/DateRangeFields';
import PageHeader from '@/components/dashboard/PageHeader';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import DataTable from '@/components/dashboard/DataTable';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import TaskSelect from '@/components/ui/TaskSelect';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel, SelectInput } from '@/components/ui/FormField';
import { formatDateTime as formatDateTimeForTimezone } from '@/lib/dateTime';
import { DATE_RANGE_PRESET_OPTIONS, deriveDateRangeFromPreset, detectDateRangePreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';

import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { matchesSearchFilter } from '@/lib/searchSuggestions';
import { getWorkingDuration } from '@/lib/timeBreakdown';
import { summariseAttendanceRow, totalAttendanceRows } from '@/lib/attendanceReportRows';
import { useChartTheme } from '@/hooks/useChartTheme';
import ReportTile from '@/features/reports/ReportTile';
import { formatRecentAge, readRecentReports, rememberReport } from '@/features/reports/recentReports';
import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';
import { formatDurationSmart as formatDuration, formatPercent } from '@/lib/formatters';
import { API_LIMITS, limitConcurrency, batchArray, validateDateRange, getSafeDateRange } from '@/lib/apiLimits';
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Search,
  Award,
  CalendarDays,
  Camera,
  Download,
  FileClock,
  Gauge,
  LineChart,
  ListFilter,
  Monitor,
  
  RefreshCw,
  TimerReset,
  Users,
  Waypoints,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { BarChart, Bar, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';

const formatAttendanceDateTime = (dateStr: string | null | undefined, tz: string): string => {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'short', timeStyle: 'short', timeZone: tz }).format(new Date(dateStr));
  } catch { return String(dateStr).slice(0, 16); }
};

const formatPreviewList = (items: string[] | null | undefined, fallback: string): string => {
  if (!items || items.length === 0) return fallback;
  return items.length <= 3 ? items.join(', ') : `${items.slice(0, 3).join(', ')} +${items.length - 3}`;
};

const formatTimelineToolLabel = (row: any): string => row?.window_title || row?.name || row?.tool_type || row?.software_name || 'Unknown';

const timelineProductivityTone = (classification?: string): string => {
  switch (classification) {
    case 'productive': return 'bg-emerald-100 text-emerald-700';
    case 'unproductive': return 'bg-rose-100 text-rose-700';
    default: return 'bg-slate-100 text-slate-600';
  }
};

const formatTimelineDuration = (seconds: number): string => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${seconds}s`;
};

type ReportsWorkspaceMode =
  | 'reports-hub'
  | 'analytics-hub'
  | 'attendance'
  | 'hours-tracked'
  | 'projects-tasks'
  | 'timeline'
  | 'web-app-usage'
  | 'productivity'
  | 'custom-export';

type CustomExportScope = 'employee' | 'department';
type CustomExportFieldKey =
  | 'start_date'
  | 'end_date'
  | 'employee_name'
  | 'employee_email'
  | 'employee_region'
  | 'department'
  | 'working_days'
  | 'present_days'
  | 'leave_days'
  | 'late_days'
  | 'absent_days'
  | 'attendance_rate'
  | 'tracked_time'
  | 'worked_time'
  | 'idle_time'
  | 'working_time'
  | 'overtime_time'
  | 'first_check_in_at'
  | 'last_check_out_at';

const customExportFieldOptions: Array<{ key: CustomExportFieldKey; label: string; description: string }> = [
  { key: 'start_date', label: 'Start Date', description: 'Report range start date.' },
  { key: 'end_date', label: 'End Date', description: 'Report range end date.' },
  { key: 'employee_name', label: 'Employee Name', description: 'Employee full name.' },
  { key: 'employee_email', label: 'Employee Email', description: 'Employee email address.' },
  { key: 'employee_region', label: 'Employee Region', description: 'Region/country from user settings.' },
  { key: 'department', label: 'Department', description: 'Primary department/team.' },
  { key: 'working_days', label: 'Working Days', description: 'Working days count in selected range.' },
  { key: 'present_days', label: 'Present Days', description: 'Attendance present day count.' },
  { key: 'leave_days', label: 'Leave Days', description: 'Approved leave day count.' },
  { key: 'late_days', label: 'Late Days', description: 'Days marked with late minutes.' },
  { key: 'absent_days', label: 'Absent Days', description: 'Working days without present or leave.' },
  { key: 'attendance_rate', label: 'Attendance Rate (%)', description: 'Present/working-day attendance rate.' },
  { key: 'tracked_time', label: 'Track Time', description: 'Total tracked duration.' },
  { key: 'worked_time', label: 'Work Time', description: 'Attendance worked duration.' },
  { key: 'idle_time', label: 'Idle Time', description: 'Measured idle duration.' },
  { key: 'working_time', label: 'Work Time', description: 'Tracked time minus idle time.' },
  { key: 'overtime_time', label: 'Overtime Time', description: 'Worked duration above 8h/day baseline.' },
  { key: 'first_check_in_at', label: 'First Check-In', description: 'Earliest check-in in range.' },
  { key: 'last_check_out_at', label: 'Last Check-Out', description: 'Latest check-out in range.' },
];

const defaultCustomExportFields: CustomExportFieldKey[] = [
  'start_date',
  'end_date',
  'employee_name',
  'employee_email',
  'employee_region',
  'department',
  'working_days',
  'present_days',
  'leave_days',
  'late_days',
  'absent_days',
  'attendance_rate',
  'tracked_time',
  'worked_time',
  'idle_time',
  'working_time',
  'overtime_time',
  'first_check_in_at',
  'last_check_out_at',
];

type PersistedReportsWorkspaceFilters = {
  datePreset: DateRangePreset;
  startDate: string;
  endDate: string;
  selectedTaskId: number | '';
  selectedUserId: number | '';
  selectedGroupId: number | '';
};

const REPORTS_WORKSPACE_FILTER_STORAGE_KEY = 'reports-workspace-filters';
const getReportsWorkspaceFilterStorageKey = (mode: ReportsWorkspaceMode) => `${REPORTS_WORKSPACE_FILTER_STORAGE_KEY}:${mode}`;
const defaultDateRange = deriveDateRangeFromPreset('today');

const getDefaultReportsWorkspaceFilters = (): PersistedReportsWorkspaceFilters => ({
  datePreset: 'today',
  startDate: defaultDateRange.startDate,
  endDate: defaultDateRange.endDate,
  selectedTaskId: '',
  selectedUserId: '',
  selectedGroupId: '',
});

const readPersistedReportsWorkspaceFilters = (mode: ReportsWorkspaceMode): PersistedReportsWorkspaceFilters => {
  const fallback = getDefaultReportsWorkspaceFilters();
  const parsed = readSessionStorageJson<PersistedReportsWorkspaceFilters>(getReportsWorkspaceFilterStorageKey(mode));

  if (!parsed) {
    return fallback;
  }

  const datePreset: DateRangePreset =
    parsed.datePreset === 'today'
    || parsed.datePreset === '2d'
    || parsed.datePreset === '7d'
    || parsed.datePreset === '15d'
    || parsed.datePreset === '30d'
    || parsed.datePreset === 'custom'
      ? parsed.datePreset
      : fallback.datePreset;
  const resolvedRange = resolvePersistedDateRange(
    datePreset,
    typeof parsed.startDate === 'string' && parsed.startDate ? parsed.startDate : fallback.startDate,
    typeof parsed.endDate === 'string' && parsed.endDate ? parsed.endDate : fallback.endDate
  );

  return {
    datePreset,
    startDate: resolvedRange.startDate,
    endDate: resolvedRange.endDate,
    selectedTaskId: coercePositiveNumber(parsed.selectedTaskId) ?? '',
    selectedUserId: coercePositiveNumber(parsed.selectedUserId) ?? '',
    selectedGroupId: coercePositiveNumber(parsed.selectedGroupId) ?? '',
  };
};

const shouldReuseReportPlaceholderData = (
  previousQueryKey: readonly unknown[] | undefined,
  mode: ReportsWorkspaceMode
) => (
  Array.isArray(previousQueryKey)
  && previousQueryKey[0] === 'report-workspace-data'
  && previousQueryKey[1] === mode
);


const clampPercent = (value: number) => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
const resolveAttendanceDepartment = (row: any) =>
  row?.department
  || row?.user?.department
  || row?.user?.employee_work_info?.department?.name
  || row?.user?.employeeWorkInfo?.department?.name
  || row?.user?.employee_work_info?.department_name
  || row?.user?.work_info?.department
  || 'Unassigned';
const fetchTimeEntriesForUsers = async (userIds: number[], startDate: string, endDate: string) => {
  const uniqueUserIds = Array.from(new Set(userIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)));
  if (!uniqueUserIds.length) return [];

  // Limit to max 500 users to prevent overload
  const limitedUserIds = uniqueUserIds.slice(0, 500);
  if (uniqueUserIds.length > 500) {
    console.warn(`fetchTimeEntriesForUsers: Limited from ${uniqueUserIds.length} to 500 users`);
  }

  // Process users in batches of 50
  const userBatches = batchArray(limitedUserIds, API_LIMITS.USERS_BATCH_SIZE);
  const allEntries: any[] = [];

  for (const batch of userBatches) {
    // Limit concurrency to 5 parallel requests
    const batchResults = await limitConcurrency(
      batch.map(async (userId) => {
        const collectedEntries: any[] = [];
        let currentPage = 1;
        let hasMorePages = true;
        let totalFetched = 0;

        // Limit: max 10 pages per user (1000 records with per_page=100)
        while (hasMorePages && currentPage <= API_LIMITS.MAX_PAGES) {
          const response = await timeEntryApi.getAll({
            user_id: userId,
            start_date: startDate,
            end_date: endDate,
            page: currentPage,
            per_page: 100, // Reduced from 1000
          });
          const payload = response.data;
          const entries = payload.data || [];

          collectedEntries.push(...entries);
          totalFetched += entries.length;

          // Stop if we've hit the per-user limit
          if (totalFetched >= API_LIMITS.TIME_ENTRIES_PER_USER) {
            console.warn(`timeEntryApi: User ${userId} limit reached (${API_LIMITS.TIME_ENTRIES_PER_USER})`);
            break;
          }

          if (!payload.last_page || payload.current_page >= payload.last_page) {
            hasMorePages = false;
          } else {
            currentPage += 1;
          }
        }

        return collectedEntries;
      }),
      API_LIMITS.CONCURRENT_REQUESTS
    );

    allEntries.push(...batchResults.flat());
  }

  return allEntries;
};

const modeCopy: Record<ReportsWorkspaceMode, { title: string; description: string; eyebrow: string }> = {
  'reports-hub': {
    eyebrow: 'Reports',
    title: 'Reports Center',
    description: 'All operational reports in one place: attendance, hours, task, timeline, and exports.',
  },
  'analytics-hub': {
    eyebrow: 'Analytics',
    title: 'Analytics Center',
    description: 'All analytics views in one place: productivity, usage, focus, screenshots, and activity signals.',
  },
  attendance: {
    eyebrow: 'Reports',
    title: 'Attendance Report',
    description: 'Attendance coverage, leave days, working status, and range-based employee summaries.',
  },
  'hours-tracked': {
    eyebrow: 'Reports',
    title: 'Hours Tracked',
    description: 'Tracked time, working time, idle time, and employee-level hour distribution.',
  },
  'projects-tasks': {
    eyebrow: 'Reports',
    title: 'Task Overview',
    description: 'Task allocation, assignee coverage, and time consumed across active work items.',
  },

  timeline: {
    eyebrow: 'Analytics',
    title: 'Timeline',
    description: 'Chronological activity feed across app, website, and idle events in the selected range.',
  },
  'web-app-usage': {
    eyebrow: 'Analytics',
    title: 'Web & App Usage',
    description: 'Tool usage by employee with productive and unproductive classifications from current monitoring data.',
  },
  productivity: {
    eyebrow: 'Analytics',
    title: 'Productivity Summary',
    description: 'Productive share, idle trends, and top contributors across the organization.',
  },
  'custom-export': {
    eyebrow: 'Reports',
    title: 'Custom Export',
    description: 'Generate CSV exports using the current date range and optional user or team filters.',
  },
};

interface ReportCatalogItem {
  title: string;
  description: string;
  to: string;
  category: string;
  highlights: string[];
  icon: LucideIcon;
  accent: string;
  planFeature?: string;
  /** Key into the hub summary payload. Absent means the tile has no live figure. */
  summaryKey?: string;
}

const reportCatalogItems: ReportCatalogItem[] = [
  {
    title: 'Attendance Report',
    summaryKey: 'attendance',
    description: 'Presence, leave, absence, attendance rate, and employee attendance exceptions.',
    to: '/reports/attendance',
    category: 'Workforce health',
    highlights: ['Attendance %', 'Leave detail', 'Exceptions'],
    icon: CalendarDays,
    accent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  {
    title: 'Hours Tracked',
    summaryKey: 'hours-tracked',
    description: 'Tracked time, working time, idle time, daily totals, and employee hour rows.',
    to: '/reports/hours-tracked',
    category: 'Time tracking',
    highlights: ['Tracked hours', 'Idle share', 'Daily trend'],
    icon: FileClock,
    accent: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  {
    title: 'Task Overview',
    summaryKey: 'projects-tasks',
    description: 'Task allocation, project coverage, assignee detail, status, priority, and due dates.',
    to: '/reports/projects-tasks',
    category: 'Delivery status',
    highlights: ['Task load', 'Assignee detail', 'Tracked effort'],
    icon: ListFilter,
    accent: 'bg-violet-50 text-violet-700 ring-violet-200',
    planFeature: 'task_tracking',
  },
  {
    title: 'Timeline Report',
    summaryKey: 'timeline',
    description: 'Chronological activity report for app, website, idle, employee, and duration rows.',
    to: '/reports/timeline',
    category: 'Activity audit',
    highlights: ['Raw timeline', 'App and site events', 'Idle periods'],
    icon: Waypoints,
    accent: 'bg-amber-50 text-amber-700 ring-amber-200',
    planFeature: 'employee_timeline',
  },
  {
    title: 'Custom Export',
    description: 'Build and download CSV exports from the selected date, employee, and team scope.',
    to: '/reports/custom-export',
    category: 'Data export',
    highlights: ['CSV output', 'Date range', 'Team filters'],
    icon: Download,
    accent: 'bg-slate-100 text-slate-700 ring-slate-200',
  },
];

const analyticsCatalogItems: ReportCatalogItem[] = [
  {
    title: 'Productivity Summary',
    description: 'Productive share, idle share, daily productivity trend, and employee contributor analytics.',
    to: '/reports/productivity',
    category: 'Focus trends',
    highlights: ['Productive share', 'Idle trend', 'Top contributors'],
    icon: Gauge,
    accent: 'bg-blue-50 text-blue-700 ring-blue-200',
    planFeature: 'monitoring',
  },
  {
    title: 'Web & App Usage',
    description: 'Classified website and application usage with productive, unproductive, and context-dependent tools.',
    to: '/reports/web-app-usage',
    category: 'Tool usage',
    highlights: ['Apps', 'Websites', 'Classification'],
    icon: Monitor,
    accent: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
    planFeature: 'monitoring',
  },
  {
    title: 'Productive Time',
    description: 'Focused monitoring analytics for productive employees, tools, and work sessions.',
    to: '/monitoring/productive-time',
    category: 'High-output work',
    highlights: ['Focused employees', 'Tools', 'Sessions'],
    icon: LineChart,
    accent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    planFeature: 'monitoring',
  },
  {
    title: 'Unproductive Time',
    description: 'Unproductive time analytics, tool patterns, and employee attention signals.',
    to: '/monitoring/unproductive-time',
    category: 'Attention drift',
    highlights: ['Time loss', 'Tool patterns', 'Attention signals'],
    icon: Activity,
    accent: 'bg-orange-50 text-orange-700 ring-orange-200',
    planFeature: 'monitoring',
  },
  {
    title: 'Timeline Analytics',
    description: 'Activity event analytics across app, website, idle, duration, and productivity classification.',
    to: '/reports/timeline',
    category: 'Behavior sequence',
    highlights: ['Event flow', 'Duration', 'Productivity class'],
    icon: Waypoints,
    accent: 'bg-purple-50 text-purple-700 ring-purple-200',
    planFeature: 'employee_timeline',
  },
  {
    title: 'Screenshots',
    description: 'Screenshot review analytics for tracked work sessions and employee activity proof.',
    to: '/monitoring/screenshots',
    category: 'Visual verification',
    highlights: ['Proof of work', 'Session review', 'Captured activity'],
    icon: Camera,
    accent: 'bg-slate-100 text-slate-700 ring-slate-200',
  },
];

export default function ReportsWorkspace({ mode }: { mode: ReportsWorkspaceMode }) {
  const { user } = useAuth();
  const { hasFeature } = usePlan();
  const location = useLocation();
  const displayTimezone = resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedReportsWorkspaceFilters(mode).datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedReportsWorkspaceFilters(mode).startDate);
  const [endDate, setEndDate] = useState(() => readPersistedReportsWorkspaceFilters(mode).endDate);
  const [selectedTaskId, setSelectedTaskId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedTaskId);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedUserId);
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedGroupId);
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineView, setTimelineView] = useState<'day' | 'log'>('day');
  const [timelineTypeFilter, setTimelineTypeFilter] = useState<'' | 'app' | 'url' | 'idle'>('');
  const [timelineClassFilter, setTimelineClassFilter] = useState<'' | Classification>('');
  const [hoursPage, setHoursPage] = useState(1);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const [customExportModalOpen, setCustomExportModalOpen] = useState(false);
  const [customExportScope, setCustomExportScope] = useState<CustomExportScope>('employee');
  const [customExportFields, setCustomExportFields] = useState<CustomExportFieldKey[]>(defaultCustomExportFields);
  const [customExportUserIds, setCustomExportUserIds] = useState<number[]>([]);
  const [customExportDepartmentIds, setCustomExportDepartmentIds] = useState<number[]>([]);
  const [customExportEmployeeSearch, setCustomExportEmployeeSearch] = useState('');
  const hasAutoOpenedCustomExportModal = useRef(false);
  const isHubMode = mode === 'reports-hub' || mode === 'analytics-hub';
  const [hubQuery, setHubQuery] = useState('');
  // Recharts takes colours as props, so it cannot reach the CSS token layer the
  // rest of the app themes through — this hook is the bridge.
  const chartTheme = useChartTheme();

  useEffect(() => {
    const persisted = readPersistedReportsWorkspaceFilters(mode);
    setDatePreset(persisted.datePreset);
    setStartDate(persisted.startDate);
    setEndDate(persisted.endDate);
    setSelectedTaskId(persisted.selectedTaskId);
    setSelectedUserId(persisted.selectedUserId);
    setSelectedGroupId(persisted.selectedGroupId);
  }, [mode]);

  // The swimlane view only makes sense for a single day; ranges read as a log.
  useEffect(() => {
    setTimelineView(startDate === endDate ? 'day' : 'log');
    setTimelinePage(1);
  }, [startDate, endDate]);

  // Validate and limit date range for performance (max 30 days)
  useEffect(() => {
    if (!validateDateRange(startDate, endDate, API_LIMITS.REPORT_DAYS_MAX)) {
      console.warn(`ReportsWorkspace: Date range exceeds ${API_LIMITS.REPORT_DAYS_MAX} days, auto-adjusting`);
      const safeRange = getSafeDateRange(endDate, API_LIMITS.REPORT_DAYS_MAX);
      setStartDate(safeRange.startDate);
      setEndDate(safeRange.endDate);
      setDatePreset('custom');
    }
  }, [startDate, endDate]);

  useEffect(() => {
    writeSessionStorageJson(
      getReportsWorkspaceFilterStorageKey(mode),
      {
        datePreset,
        startDate,
        endDate,
        selectedTaskId,
        selectedUserId,
        selectedGroupId,
      } satisfies PersistedReportsWorkspaceFilters
    );
  }, [datePreset, endDate, mode, selectedGroupId, selectedTaskId, selectedUserId, startDate]);

  useEffect(() => {
    if (!location.search) return;

    const params = new URLSearchParams(location.search);
    const nextStartDate = params.get('start');
    const nextEndDate = params.get('end');
    const nextUserId = params.get('user') || params.get('user_id');

    if (nextStartDate && nextEndDate) {
      setStartDate(nextStartDate);
      setEndDate(nextEndDate);
      setDatePreset(detectDateRangePreset(nextStartDate, nextEndDate));
    } else if (nextStartDate || nextEndDate) {
      if (nextStartDate) {
        setStartDate(nextStartDate);
      }
      if (nextEndDate) {
        setEndDate(nextEndDate);
      }
      setDatePreset('custom');
    }

    if (nextUserId !== null) {
      const parsedUserId = Number(nextUserId);
      setSelectedUserId(Number.isFinite(parsedUserId) && parsedUserId > 0 ? parsedUserId : '');
    }
  }, [location.search]);

  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') {
      return;
    }

    const nextRange = deriveDateRangeFromPreset(preset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  const customExportRangePresetLabel = DATE_RANGE_PRESET_OPTIONS.find((option) => option.value === datePreset)?.label || 'Custom range';
  const customExportRangeLabel = startDate === endDate ? startDate : `${startDate} - ${endDate}`;

  const usersQuery = useQuery({
    queryKey: ['report-workspace-users'],
    enabled: !isHubMode,
    queryFn: async () => {
      const response = await userApi.getAll({ simple: 1 });
      return response.data || [];
    },
  });
  const groupsQuery = useQuery({
    queryKey: ['report-workspace-groups'],
    enabled: !isHubMode,
    queryFn: async () => {
      const response = await reportGroupApi.list({ simple: 1 });
      return response.data?.data || [];
    },
  });
  const users = useMemo(
    () => {
      const currentUserLevel = user?.hierarchy_level ?? (user?.role === 'admin' ? 10 : user?.role === 'manager' ? 50 : 100);
      return (usersQuery.data || []).filter((employee: any) => {
        const employeeLevel = employee.hierarchy_level ?? (employee.role === 'admin' ? 10 : employee.role === 'manager' ? 50 : 100);
        return currentUserLevel <= 10 || Number(employee.id) === Number(user?.id) || employeeLevel > currentUserLevel;
      });
    },
    [user, usersQuery.data]
  );
  const groups = groupsQuery.data || [];
  const canUseGroupFilters = groupsQuery.isSuccess;
  const effectiveSelectedUserId = useMemo<number | ''>(() => {
    if (selectedUserId === '') {
      return '';
    }

    return users.some((employee: any) => Number(employee.id) === Number(selectedUserId))
      ? Number(selectedUserId)
      : '';
  }, [selectedUserId, users]);
  const effectiveSelectedGroupId = useMemo<number | ''>(() => {
    if (!canUseGroupFilters || selectedGroupId === '') {
      return '';
    }

    return groups.some((group: any) => Number(group.id) === Number(selectedGroupId))
      ? Number(selectedGroupId)
      : '';
  }, [canUseGroupFilters, groups, selectedGroupId]);

  useEffect(() => {
    setTimelinePage(1);
    setHoursPage(1);
  }, [effectiveSelectedGroupId, effectiveSelectedUserId, endDate, mode, startDate]);

  const selectedEmployee = useMemo(
    () => users.find((employee: any) => Number(employee.id) === Number(effectiveSelectedUserId)) || null,
    [effectiveSelectedUserId, users]
  );
  const projectsEmployeeNameSearch = mode === 'projects-tasks' && selectedEmployee ? String(selectedEmployee.name || '').trim() : '';
  const selectedGroup = effectiveSelectedGroupId ? groups.find((group: any) => Number(group.id) === Number(effectiveSelectedGroupId)) : null;
  const modalScopedUsers = useMemo(() => {
    if (!selectedGroup) {
      return users;
    }

    const groupUserIds = new Set((selectedGroup.users || []).map((member: any) => Number(member.id)));
    return users.filter((employee: any) => groupUserIds.has(Number(employee.id)));
  }, [selectedGroup, users]);
  const modalScopedUserIdSet = useMemo(() => new Set(modalScopedUsers.map((employee: any) => Number(employee.id))), [modalScopedUsers]);
  const modalDepartmentOptions = useMemo(() => {
    const scopedGroups = selectedGroup
      ? groups.filter((group: any) => Number(group.id) === Number(selectedGroup.id))
      : groups;

    return scopedGroups
      .map((group: any) => {
        const employeeIds = (group.users || [])
          .map((member: any) => Number(member.id))
          .filter((id: number) => modalScopedUserIdSet.has(id));

        return {
          id: Number(group.id),
          name: String(group.name || 'Unnamed department'),
          employeeIds: Array.from(new Set(employeeIds)),
        };
      })
      .filter((group: any) => group.id > 0 && group.employeeIds.length > 0);
  }, [groups, modalScopedUserIdSet, selectedGroup]);
  const departmentFilteredUsers = useMemo(() => {
    if (customExportDepartmentIds.length === 0) {
      return modalScopedUsers;
    }

    const allowedIds = new Set(
      modalDepartmentOptions
        .filter((group: any) => customExportDepartmentIds.includes(Number(group.id)))
        .flatMap((group: any) => group.employeeIds)
    );

    return modalScopedUsers.filter((employee: any) => allowedIds.has(Number(employee.id)));
  }, [customExportDepartmentIds, modalDepartmentOptions, modalScopedUsers]);
  const visibleModalUsers = useMemo(() => {
    const search = customExportEmployeeSearch.trim().toLowerCase();
    if (!search) {
      return departmentFilteredUsers;
    }

    return departmentFilteredUsers.filter((employee: any) => {
      const name = String(employee.name || '').toLowerCase();
      const email = String(employee.email || '').toLowerCase();
      return name.includes(search) || email.includes(search);
    });
  }, [customExportEmployeeSearch, departmentFilteredUsers]);
  const selectedModalUsers = useMemo(() => {
    const selectedSet = new Set(customExportUserIds);
    return modalScopedUsers.filter((employee: any) => selectedSet.has(Number(employee.id)));
  }, [customExportUserIds, modalScopedUsers]);
  const scopedUserIds = useMemo(() => {
    let ids = users.map((user: any) => Number(user.id));

    if (selectedGroup) {
      const groupUserIds = new Set((selectedGroup.users || []).map((user: any) => Number(user.id)));
      ids = ids.filter((id) => groupUserIds.has(id));
    }

    if (effectiveSelectedUserId) {
      ids = ids.filter((id) => id === Number(effectiveSelectedUserId));
    }

    return Array.from(new Set(ids));
  }, [effectiveSelectedUserId, selectedGroup, users]);

  useEffect(() => {
    if (customExportDepartmentIds.length === 0) {
      return;
    }

    const allowedIds = new Set(departmentFilteredUsers.map((employee: any) => Number(employee.id)));
    setCustomExportUserIds((current) => current.filter((id) => allowedIds.has(Number(id))));
  }, [customExportDepartmentIds, departmentFilteredUsers]);

  useEffect(() => {
    if (mode !== 'custom-export' || hasAutoOpenedCustomExportModal.current) {
      return;
    }

    if (!usersQuery.isSuccess || !groupsQuery.isSuccess) {
      return;
    }

    const preselectedIds = effectiveSelectedUserId
      ? [Number(effectiveSelectedUserId)]
      : modalScopedUsers.map((employee: any) => Number(employee.id));

    setCustomExportUserIds(preselectedIds);
    setCustomExportDepartmentIds(selectedGroup ? [Number(selectedGroup.id)] : []);
    setCustomExportEmployeeSearch('');
    setCustomExportModalOpen(true);
    hasAutoOpenedCustomExportModal.current = true;
  }, [effectiveSelectedUserId, groupsQuery.isSuccess, mode, modalScopedUsers, selectedGroup, usersQuery.isSuccess]);

  useEffect(() => {
    if (!usersQuery.isSuccess || selectedUserId === '') {
      return;
    }

    const hasSelectedUser = users.some((employee: any) => Number(employee.id) === Number(selectedUserId));
    if (!hasSelectedUser) {
      setSelectedUserId('');
    }
  }, [selectedUserId, users, usersQuery.isSuccess]);

  useEffect(() => {
    if (!canUseGroupFilters || selectedGroupId === '') {
      return;
    }

    const hasSelectedGroup = groups.some((group: any) => Number(group.id) === Number(selectedGroupId));
    if (!hasSelectedGroup) {
      setSelectedGroupId('');
    }
  }, [canUseGroupFilters, groups, selectedGroupId]);

  const dataQuery = useQuery({
    queryKey: ['report-workspace-data', mode, startDate, endDate, effectiveSelectedUserId, effectiveSelectedGroupId, timelinePage, timelineView, timelineTypeFilter, timelineClassFilter, hoursPage],
    enabled: isHubMode || (usersQuery.isSuccess && (groupsQuery.isSuccess || groupsQuery.isError)),
    placeholderData: (previousData, previousQuery) => (
      shouldReuseReportPlaceholderData(previousQuery?.queryKey, mode)
        ? previousData
        : undefined
    ),
    refetchInterval: mode === 'timeline' || mode === 'web-app-usage' || mode === 'productivity' ? 60_000 : false,
    refetchIntervalInBackground: false,
    queryFn: async () => {
      if (isHubMode) {
        return null;
      }

      if (mode === 'attendance') {
        const response = await reportApi.attendance({
          start_date: startDate,
          end_date: endDate,
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        });
        return response.data;
      }

      if (mode === 'hours-tracked' || mode === 'productivity' || mode === 'custom-export') {
        const startMs = new Date(`${startDate}T00:00:00`).getTime();
        const endMs = new Date(`${endDate}T00:00:00`).getTime();
        const rangeDays = Number.isFinite(startMs) && Number.isFinite(endMs)
          ? Math.max(1, Math.floor((Math.max(startMs, endMs) - Math.min(startMs, endMs)) / 86_400_000) + 1)
          : 1;
        const shouldScopeWideHours = mode === 'hours-tracked'
          && !effectiveSelectedUserId
          && !effectiveSelectedGroupId;
        const formatLocalDate = (timestampMs: number) => {
          const date = new Date(timestampMs);
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${year}-${month}-${day}`;
        };
        const effectiveStartDate = shouldScopeWideHours && rangeDays > 14
          ? formatLocalDate(Math.max(startMs, endMs) - (13 * 86_400_000))
          : startDate;
        const effectiveEndDate = shouldScopeWideHours && rangeDays > 14
          ? formatLocalDate(Math.max(startMs, endMs))
          : endDate;
        const shouldSkipActivity = false;
        const response = await reportApi.overall({
          start_date: effectiveStartDate,
          end_date: effectiveEndDate,
          user_ids: effectiveSelectedUserId ? [Number(effectiveSelectedUserId)] : undefined,
          group_ids: effectiveSelectedGroupId ? [Number(effectiveSelectedGroupId)] : undefined,
          skip_activity: shouldSkipActivity ? 1 : undefined,
          page: mode === 'hours-tracked' ? hoursPage : undefined,
          per_page: mode === 'hours-tracked' ? 25 : undefined,
        });
        return response.data;
      }

      if (mode === 'projects-tasks') {
        const [tasksResponse, timeEntries] = await Promise.all([
          taskApi.getAll(),
          fetchTimeEntriesForUsers(scopedUserIds, startDate, endDate),
        ]);

        return {
          tasks: tasksResponse.data || [],
          timeEntries,
        };
      }

      if (mode === 'timeline') {
        if (timelineView === 'day') {
          // The swimlanes need every block of the day at once. The processed
          // endpoint serves 200 rows per page now, so this is 1–5 requests.
          const rows = await activityApi.getAllPages({
            user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
            group_ids: effectiveSelectedGroupId ? [Number(effectiveSelectedGroupId)] : undefined,
            // One day, always: the swimlanes draw a 24-hour strip. Sending the
            // whole range here would pull days it cannot show and overrun the
            // record cap on the day it can.
            start_date: endDate,
            end_date: endDate,
            processed: true,
            per_page: 200,
            max_records: 1000,
          });
          return { swimlaneRows: rows, truncated: rows.length >= 1000 };
        }

        const response = await activityApi.getAll({
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
          group_ids: effectiveSelectedGroupId ? [Number(effectiveSelectedGroupId)] : undefined,
          start_date: startDate,
          end_date: endDate,
          processed: true,
          type: timelineTypeFilter || undefined,
          classification: timelineClassFilter || undefined,
          page: timelinePage,
          per_page: 50,
        });
        return response.data;
      }

      if (mode === 'web-app-usage') {
        const response = await reportApi.employeeInsights({
          start_date: startDate,
          end_date: endDate,
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
          group_ids: effectiveSelectedGroupId ? [Number(effectiveSelectedGroupId)] : undefined,
        });
        return response.data;
      }

      return null;
    },
  });

  const isLoading = usersQuery.isLoading || (groupsQuery.isLoading && !groupsQuery.isError) || (dataQuery.isLoading && !dataQuery.data);
  const isError = usersQuery.isError || dataQuery.isError;
  const pageTitle = modeCopy[mode];

  const attendanceRows = (dataQuery.data as any)?.data || [];
  const attendanceTotals = useMemo(() => {
    if (mode !== 'attendance') return null;
    // Count present: employees who have checked in (have check_in_at or is_working flag)
    const presentCount = attendanceRows.filter((row: any) => 
      row.is_working || row.check_in_at || row.days_present > 0
    ).length;
    const workedSeconds = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.worked_seconds || 0), 0);
    const breakSeconds = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.total_break_seconds || 0), 0);
    const currentWorking = attendanceRows.filter((row: any) => row.is_working).length;
    // Owed / present / off / missed all come from one helper now. This block
    // used to spell out `calendar_days_in_range - days_present - leave_days`,
    // which counts every weekly off as a day somebody failed to show up.
    const schedule = totalAttendanceRows(attendanceRows);

    return {
      presentDays: schedule.presentDays,
      presentCount,
      leaveDays: schedule.leaveDays,
      absentDays: schedule.absentDays,
      weeklyOffDays: schedule.weeklyOffDays,
      holidayDays: schedule.holidayDays,
      schedulePolicyBacked: schedule.everyRowIsSchedulePolicyBacked,
      workedSeconds,
      breakSeconds,
      employees: attendanceRows.length,
      expectedDays: schedule.expectedDays,
      currentWorking,
      averageAttendanceRate: schedule.averageAttendanceRate,
    };
  }, [attendanceRows, mode]);
  const attendanceDepartmentRows = useMemo(() => {
    if (mode !== 'attendance') return [];
    const groupedRows = new Map<string, {
      department: string;
      employees: number;
      presentDays: number;
      leaveDays: number;
      absentDays: number;
      workedSeconds: number;
      expectedDays: number;
      workingNow: number;
      breakSeconds: number;
    }>();

    attendanceRows.forEach((row: any) => {
      const department = resolveAttendanceDepartment(row);
      const { expectedDays, presentDays, leaveDays, absentDays } = summariseAttendanceRow(row);
      const existing = groupedRows.get(department) || {
        department,
        employees: 0,
        presentDays: 0,
        leaveDays: 0,
        absentDays: 0,
        workedSeconds: 0,
        expectedDays: 0,
        workingNow: 0,
        breakSeconds: 0,
      };

      existing.employees += 1;
      existing.presentDays += presentDays;
      existing.leaveDays += leaveDays;
      existing.absentDays += absentDays;
      existing.workedSeconds += Number(row.worked_seconds || 0);
      existing.breakSeconds += Number(row.total_break_seconds || 0);
      existing.expectedDays += expectedDays;
      existing.workingNow += row.is_working ? 1 : 0;
      groupedRows.set(department, existing);
    });

    return Array.from(groupedRows.values()).sort((left, right) => right.presentDays - left.presentDays);
  }, [attendanceRows, mode]);
  const attendanceExceptionRows = useMemo(() => {
    if (mode !== 'attendance') return [];
    return [...attendanceRows]
      .map((row: any) => {
        // Both figures are now against days OWED. Judged against calendar days
        // the risk score treated a weekly off as a miss, so somebody with
        // perfect attendance in a 31-day month scored nine absences and a 71%
        // rate — under the 80% cut, and listed here as an exception.
        const { absentDays, attendanceRate, weeklyOffDays, expectedDays } = summariseAttendanceRow(row);
        return {
          ...row,
          absent_days: absentDays,
          weekly_off_days: weeklyOffDays,
          expected_days: expectedDays,
          scheduled_attendance_rate: attendanceRate,
          risk_score: absentDays * 10 + Math.max(0, 75 - attendanceRate),
        };
      })
      .filter((row: any) => row.absent_days > 0 || Number(row.scheduled_attendance_rate || 0) < 80)
      .sort((left: any, right: any) => Number(right.risk_score || 0) - Number(left.risk_score || 0))
      .slice(0, 8);
  }, [attendanceRows, mode]);
  const attendanceDepartmentBarRows = useMemo(() => {
    if (mode !== 'attendance') return [];

    return attendanceDepartmentRows
      .map((row) => ({
        ...row,
        attendanceRate: clampPercent((Number(row.presentDays || 0) / Math.max(1, Number(row.expectedDays || 0))) * 100),
      }))
      .sort((left, right) => Number(right.attendanceRate || 0) - Number(left.attendanceRate || 0))
      .slice(0, 6);
  }, [attendanceDepartmentRows, mode]);

  const attendanceComposition = useMemo(() => {
    if (mode !== 'attendance' || !attendanceTotals) return [];

    const segments = [
      { label: 'Present', value: Number(attendanceTotals.presentDays || 0), color: '#10b981' },
      { label: 'Leave', value: Number(attendanceTotals.leaveDays || 0), color: '#f59e0b' },
      { label: 'Absent', value: Number(attendanceTotals.absentDays || 0), color: '#ef4444' },
    ];
    const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.value, 0));

    return segments.map((segment) => ({
      ...segment,
      share: clampPercent((segment.value / total) * 100),
    }));
  }, [attendanceTotals, mode]);

  const overallData = dataQuery.data as any;
  const overallSummary = overallData?.summary || {};
  const byUser = overallData?.by_user || [];
  const byDay = overallData?.by_day || [];
  const shouldScrollByUser = byUser.length > 5;
  const shouldScrollByDay = byDay.length > 5;
  const hoursPagination = overallData?.pagination || null;
  const hoursCurrentPage = Math.max(1, Number(hoursPagination?.current_page || hoursPage || 1));
  const hoursLastPage = Math.max(1, Number(hoursPagination?.last_page || 1));
  const hoursTotal = Number(hoursPagination?.total || byUser.length || 0);

  const projectsData = dataQuery.data as any;
  const tasks = projectsData?.tasks || [];
  const projectTimeEntries = projectsData?.timeEntries || [];
  const hasProjectsTasksScope = effectiveSelectedUserId !== '' || selectedGroupId !== '';
  const scopedUserIdSet = useMemo(() => new Set(scopedUserIds), [scopedUserIds]);
  const usersById = useMemo(() => new Map<number, any>(users.map((user: any) => [Number(user.id), user])), [users]);
  const groupsById = useMemo(() => new Map<number, any>(groups.map((group: any) => [Number(group.id), group])), [groups]);
  const taskFilterOptions = useMemo(() => {
    if (mode !== 'projects-tasks') {
      return [];
    }

    return tasks.filter((task: any) => {
      const matchesSelectedGroup = !selectedGroupId || Number(task.group_id) === Number(selectedGroupId);
      const matchesSelectedUser = !effectiveSelectedUserId || Number(task.assignee_id) === Number(effectiveSelectedUserId);
      return !hasProjectsTasksScope || (matchesSelectedGroup && matchesSelectedUser);
    });
  }, [effectiveSelectedUserId, hasProjectsTasksScope, mode, selectedGroupId, tasks]);
  const effectiveSelectedTaskId = useMemo<number | ''>(() => {
    if (selectedTaskId === '') {
      return '';
    }

    return taskFilterOptions.some((task: any) => Number(task.id) === Number(selectedTaskId))
      ? Number(selectedTaskId)
      : '';
  }, [selectedTaskId, taskFilterOptions]);
  const hasSelectedTask = effectiveSelectedTaskId !== '';
  const filteredTasks = useMemo(() => {
    if (mode !== 'projects-tasks') return [];

    return tasks.filter((task: any) => {
      const assignee = usersById.get(Number(task.assignee_id));
      const matchesSelectedGroup = !selectedGroupId || Number(task.group_id) === Number(selectedGroupId);
      const matchesSelectedUser = !effectiveSelectedUserId || Number(task.assignee_id) === Number(effectiveSelectedUserId);
      const matchesScope = !hasProjectsTasksScope || (matchesSelectedGroup && matchesSelectedUser);
      const matchesSelectedTask = !hasSelectedTask || Number(task.id) === Number(effectiveSelectedTaskId);
      const matchesEmployeeSearch = matchesSearchFilter(projectsEmployeeNameSearch, [assignee?.name]);

      return matchesScope && matchesSelectedTask && matchesEmployeeSearch;
    });
  }, [
    effectiveSelectedTaskId,
    hasProjectsTasksScope,
    hasSelectedTask,
    mode,
    effectiveSelectedUserId,
    projectsEmployeeNameSearch,
    selectedGroupId,
    tasks,
    usersById,
  ]);
  const filteredProjectTimeEntries = useMemo(() => {
    if (mode !== 'projects-tasks') return [];

    return projectTimeEntries.filter((entry: any) => {
      const projectId = Number(entry.project_id);
      if (!projectId) return false;

      const user = usersById.get(Number(entry.user_id));
      const matchesScope = !hasProjectsTasksScope || scopedUserIdSet.has(Number(entry.user_id));
      const matchesSelectedTask = !hasSelectedTask || Number(entry.task_id) === Number(effectiveSelectedTaskId);
      const matchesEmployeeSearch = matchesSearchFilter(projectsEmployeeNameSearch, [user?.name]);

      return matchesScope && matchesSelectedTask && matchesEmployeeSearch;
    });
  }, [
    effectiveSelectedTaskId,
    hasProjectsTasksScope,
    hasSelectedTask,
    mode,
    projectTimeEntries,
    projectsEmployeeNameSearch,
    scopedUserIdSet,
    usersById,
  ]);
  const filteredTaskGroupIds = useMemo(
    () => Array.from(new Set(filteredTasks.map((task: any) => Number(task.group_id)).filter((groupId) => groupId > 0))),
    [filteredTasks]
  );
  const filteredTasksByAssigneeId = useMemo(() => {
    const groupedTasks = new Map<number, any[]>();

    filteredTasks.forEach((task: any) => {
      const assigneeId = Number(task.assignee_id || task.assignee?.id);
      if (!assigneeId) return;

      const existingTasks = groupedTasks.get(assigneeId) || [];
      existingTasks.push(task);
      groupedTasks.set(assigneeId, existingTasks);
    });

    return groupedTasks;
  }, [filteredTasks]);
  const filteredProjectTimeEntriesByUserId = useMemo(() => {
    const groupedEntries = new Map<number, any[]>();

    filteredProjectTimeEntries.forEach((entry: any) => {
      const userId = Number(entry.user_id || entry.user?.id);
      if (!userId) return;

      const existingEntries = groupedEntries.get(userId) || [];
      existingEntries.push(entry);
      groupedEntries.set(userId, existingEntries);
    });

    return groupedEntries;
  }, [filteredProjectTimeEntries]);
  const matchedProjectEmployees = useMemo(() => {
    if (mode !== 'projects-tasks' || !projectsEmployeeNameSearch) {
      return [];
    }

    const visibleUsers = hasProjectsTasksScope
      ? users.filter((employee: any) => scopedUserIdSet.has(Number(employee.id)))
      : users;

    return visibleUsers.filter((employee: any) => matchesSearchFilter(projectsEmployeeNameSearch, [employee.name]));
  }, [hasProjectsTasksScope, mode, projectsEmployeeNameSearch, scopedUserIdSet, users]);

  const taskAllocationRows = useMemo(() => {
    if (mode !== 'projects-tasks') {
      return [];
    }

    return filteredTasks.map((task: any) => {
      const group = groupsById.get(Number(task.group_id)) || task.group;
      const assigneeName = usersById.get(Number(task.assignee_id))?.name || task.assignee?.name || 'Unassigned';
      const taskEntries = filteredProjectTimeEntries
        .filter((entry: any) => Number(entry.task_id) === Number(task.id));
      const trackedSeconds = taskEntries.reduce((sum: number, entry: any) => sum + Number(entry.duration || 0), 0);
      const completionLabel = task.status === 'done' ? 'Completed' : 'Open';

      return {
        ...task,
        group_name: group?.name || 'No group',
        assignee_name: assigneeName,
        completion_label: completionLabel,
        tracked_seconds: trackedSeconds,
      };
    });
  }, [filteredProjectTimeEntries, filteredTasks, groupsById, mode, usersById]);
  const employeeFocusRows = useMemo(() => {
    if (mode !== 'projects-tasks' || !projectsEmployeeNameSearch) {
      return [];
    }

    return matchedProjectEmployees.map((employee: any) => {
      const employeeId = Number(employee.id);
      const employeeTasks = filteredTasksByAssigneeId.get(employeeId) || [];
      const employeeEntries = filteredProjectTimeEntriesByUserId.get(employeeId) || [];
      const completedTaskCount = employeeTasks.filter((task: any) => task.status === 'done').length;
      const openTaskCount = employeeTasks.filter((task: any) => task.status !== 'done').length;
      const completionRate = employeeTasks.length > 0 ? Math.round((completedTaskCount / employeeTasks.length) * 100) : 0;

      return {
        ...employee,
        assigned_task_count: employeeTasks.length,
        open_task_count: openTaskCount,
        completed_task_count: completedTaskCount,
        completion_rate: completionRate,
        assigned_task_names: employeeTasks.map((task: any) => task.title),
        assigned_group_names: Array.from(
          new Set(
            employeeTasks
              .map((task: any) => groupsById.get(Number(task.group_id))?.name || task.group?.name)
              .filter(Boolean)
          )
        ),
        tracked_seconds: employeeEntries.reduce((sum: number, entry: any) => sum + Number(entry.duration || 0), 0),
      };
    });
  }, [filteredProjectTimeEntriesByUserId, filteredTasksByAssigneeId, groupsById, matchedProjectEmployees, mode, projectsEmployeeNameSearch]);
  const selectedTaskOverviewRow = useMemo(() => {
    if (!hasSelectedTask || mode !== 'projects-tasks') {
      return null;
    }

    return taskAllocationRows.find((row: any) => Number(row.id) === Number(effectiveSelectedTaskId)) || null;
  }, [effectiveSelectedTaskId, hasSelectedTask, mode, taskAllocationRows]);

  const timelineSwimlaneData = mode === 'timeline' && (dataQuery.data as any)?.swimlaneRows
    ? (dataQuery.data as any)
    : null;
  const timelinePayload = mode === 'timeline' && dataQuery.data && !Array.isArray(dataQuery.data) && !timelineSwimlaneData
    ? dataQuery.data as any
    : null;
  const timelineRows = Array.isArray(dataQuery.data)
    ? dataQuery.data
    : (Array.isArray(timelinePayload?.data) ? timelinePayload.data : []);
  const timelinePagination = {
    currentPage: Math.max(1, Number(timelinePayload?.current_page || timelinePage || 1)),
    lastPage: Math.max(1, Number(timelinePayload?.last_page || 1)),
    total: Number.isFinite(Number(timelinePayload?.total)) ? Number(timelinePayload?.total) : timelineRows.length,
    hasMore: Boolean(timelinePayload?.has_more) || Number(timelinePayload?.current_page || timelinePage || 1) < Number(timelinePayload?.last_page || 1),
  };
  const shiftTimelineDay = (delta: number) => {
    const base = new Date(`${startDate}T00:00:00`);
    if (Number.isNaN(base.getTime())) return;
    base.setDate(base.getDate() + delta);
    const iso = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
    setDatePreset('custom');
    setStartDate(iso);
    setEndDate(iso);
  };

  /*
   * Day view narrows to one day WITHOUT rewriting the date filter.
   *
   * It used to set startDate = endDate, so choosing "Last 7 days" and then Day
   * view silently threw six days out of the filter — and switching back to the
   * log showed a single day, with nothing on screen explaining where the range
   * had gone. The swimlanes still need one day at a time; that is a property of
   * the drawing, not a reason to edit what somebody asked for.
   */
  const switchTimelineView = (view: 'day' | 'log') => {
    setTimelinePage(1);
    setTimelineView(view);
  };

  /** The single day the swimlanes draw: the end of whatever range is selected. */
  const timelineFocusDate = endDate;
  const timelineRangeIsMultiDay = startDate !== endDate;

  const canReclassifyTools = hasStrictAdminAccess(user);
  const handleReclassifyTool = async (
    targetType: 'app' | 'domain',
    targetValue: string,
    classification: Classification
  ): Promise<boolean> => {
    try {
      await productivityClassificationApi.create({
        target_type: targetType,
        target_value: targetValue,
        classification,
      });
      void dataQuery.refetch();
      return true;
    } catch (error) {
      console.error('Tool reclassification failed:', error);
      return false;
    }
  };

  const usageData = dataQuery.data as any;
  const usageStats = usageData?.stats || {};
  const usageSelectedTools = usageData?.selected_user_tools || { productive: [], unproductive: [], neutral: [], context_dependent: [] };
  const usageMatchedUsers = usageData?.matched_users || [];
  const orgSummary = usageData?.organization_summary || {};
  const usageOrganizationTools = usageData?.organization_tools || { productive: [], unproductive: [], context_dependent: [] };
  const employeeRankings = usageData?.employee_rankings?.by_productive_duration || [];
  const hasSelectedEmployee = effectiveSelectedUserId !== '';
  const usageWorkedDuration = hasSelectedEmployee
    ? getWorkingDuration(usageStats)
    : getWorkingDuration(orgSummary);
  const usageProductiveRows = hasSelectedEmployee ? usageSelectedTools.productive || [] : usageOrganizationTools.productive || [];
  const usageUnproductiveRows = hasSelectedEmployee ? usageSelectedTools.unproductive || [] : usageOrganizationTools.unproductive || [];
  const usageContextRows = hasSelectedEmployee ? usageSelectedTools.context_dependent || [] : usageOrganizationTools.context_dependent || [];

  const handleExport = async (options?: { scope?: CustomExportScope; fields?: CustomExportFieldKey[]; userIds?: number[] }) => {
    if (mode === 'custom-export' && !options) {
      const preselectedIds = effectiveSelectedUserId
        ? [Number(effectiveSelectedUserId)]
        : modalScopedUsers.map((employee: any) => Number(employee.id));
      setCustomExportUserIds(preselectedIds);
      setCustomExportDepartmentIds(selectedGroup ? [Number(selectedGroup.id)] : []);
      setCustomExportEmployeeSearch('');
      setCustomExportModalOpen(true);
      return;
    }

    const fields = options?.fields || customExportFields;
    if (mode === 'custom-export' && fields.length === 0) {
      setExportError('Select at least one field before exporting.');
      return;
    }

    const selectedUserIds = options?.userIds || customExportUserIds;
    setExportMessage('');
    setExportError('');
    setIsExporting(true);
    try {
      const response = await reportApi.export({
        start_date: startDate,
        end_date: endDate,
        user_ids: mode === 'custom-export'
          ? (selectedUserIds.length ? selectedUserIds : undefined)
          : (effectiveSelectedUserId ? [Number(effectiveSelectedUserId)] : undefined),
        group_ids: selectedGroupId ? [Number(selectedGroupId)] : undefined,
        export_scope: mode === 'custom-export' ? (options?.scope || customExportScope) : undefined,
        fields: mode === 'custom-export' ? fields : undefined,
        report_type: mode === 'custom-export' ? undefined : mode,
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', `report-${mode}-${startDate}-to-${endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setExportMessage('Export completed.');
      if (mode === 'custom-export') {
        setCustomExportModalOpen(false);
      }
    } catch (error: any) {
      setExportError(error?.response?.data?.message || 'Failed to export report.');
    } finally {
      setIsExporting(false);
    }
  };

  const renderPanelRefreshButton = () => (
    <Button variant="ghost" size="sm" onClick={() => void dataQuery.refetch()} iconLeft={<RefreshCw className="h-4 w-4" />}>
      Refresh
    </Button>
  );
  const handleEmployeeFilterChange = (value: number | '') => {
    setSelectedUserId(value);
  };

  useEffect(() => {
    if (mode !== 'projects-tasks' || selectedTaskId === '') {
      return;
    }

    const hasSelectedTaskOption = taskFilterOptions.some((task: any) => Number(task.id) === Number(selectedTaskId));
    if (!hasSelectedTaskOption) {
      setSelectedTaskId('');
    }
  }, [mode, selectedTaskId, taskFilterOptions]);

  const catalogItems = useMemo(() => {
    const baseItems = mode === 'analytics-hub' ? analyticsCatalogItems : reportCatalogItems;
    return baseItems.filter((item) => !item.planFeature || hasFeature(item.planFeature));
  }, [mode, hasFeature]);

  // One summary call for the whole hub — five separate report queries just to
  // render a menu would cost more than the problem it solves. Any module that
  // fails server-side is simply absent, and its tile falls back to a plain link.
  const hubSummaryQuery = useQuery({
    queryKey: ['reports', 'hub-summary'],
    queryFn: async () => (await reportApi.hubSummary()).data,
    enabled: isHubMode,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  const recentReports = useMemo(() => (isHubMode ? readRecentReports() : []), [isHubMode]);

  // Opening a focused report records it, so the hub can offer it back later.
  useEffect(() => {
    if (isHubMode) return;
    const entry = [...reportCatalogItems, ...analyticsCatalogItems].find((item) => item.to === location.pathname);
    if (entry) rememberReport({ to: entry.to, title: entry.title });
  }, [isHubMode, location.pathname]);

  if (isHubMode) {
    const needle = hubQuery.trim().toLowerCase();
    const shownItems = needle
      ? catalogItems.filter((item) =>
          `${item.title} ${item.description} ${item.category}`.toLowerCase().includes(needle)
        )
      : catalogItems;

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <h1 className="text-2xl font-semibold tracking-[-0.03em] text-slate-950">{pageTitle.title}</h1>
            <p className="text-sm text-slate-600">
              {hubSummaryQuery.data?.start_date
                ? `Last 7 days · compared with the week before`
                : pageTitle.description}
            </p>
          </div>

          {catalogItems.length > 3 ? (
            <div className="relative min-w-[200px]">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-600"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Search reports"
                placeholder="Search reports..."
                value={hubQuery}
                onChange={(event) => setHubQuery(event.target.value)}
                className="min-h-10 w-full rounded-lg border border-slate-200 bg-surface-card pl-9 pr-3 text-sm text-slate-900 placeholder:text-slate-600 focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-sky-300"
              />
            </div>
          ) : null}
        </div>

        {recentReports.length > 0 && !needle ? (
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-semibold uppercase tracking-[0.12em] text-slate-600">Recently opened</span>
            {recentReports.map((recent) => (
              <Link
                key={recent.to}
                to={recent.to}
                className="rounded-full border border-slate-200 bg-surface-card px-2.5 py-1 font-medium text-slate-700 transition hover:border-blue-300 hover:text-blue-800"
              >
                {recent.title}
                <span className="ml-1.5 text-slate-600">{formatRecentAge(recent.at)}</span>
              </Link>
            ))}
          </div>
        ) : null}

        {shownItems.length === 0 ? (
          <PageEmptyState title="No report matches that search" description="Try a different term." />
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shownItems.map((item) => (
              <ReportTile
                key={item.title}
                title={item.title}
                description={item.description}
                to={item.to}
                icon={item.icon}
                summary={hubSummaryQuery.data?.data?.[item.summaryKey ?? '']}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  if (isLoading) {
    return <PageLoadingState label={`Loading ${pageTitle.title.toLowerCase()}...`} />;
  }

  if (isError) {
    return (
      <PageErrorState
        message={
            (dataQuery.error as any)?.response?.data?.message ||
            (usersQuery.error as any)?.response?.data?.message ||
            'Failed to load report data.'
          }
        onRetry={() => {
          void usersQuery.refetch();
          void groupsQuery.refetch();
          void dataQuery.refetch();
        }}
      />
    );
  }

  if (mode === 'custom-export') {
    return (
      <div className="space-y-6">
        {exportMessage ? <FeedbackBanner tone="success" message={exportMessage} /> : null}
        {exportError ? <FeedbackBanner tone="error" message={exportError} /> : null}

        <SurfaceCard className="w-full p-6 sm:p-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">Custom Export Builder</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">Choose report fields</h2>
              <p className="mt-2 text-sm text-slate-500">
                Select employee-wise or department-wise scope, choose columns, then download.
                Time metrics include both minutes and hours in the CSV.
              </p>
            </div>
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SurfaceCard className="p-4">
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-blue-700">Date Filter</p>
                  <p className="mt-1 truncate text-sm font-medium text-slate-900">{customExportRangePresetLabel}: {customExportRangeLabel}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {DATE_RANGE_PRESET_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => handleDatePresetChange(option.value)}
                      className={`h-9 rounded-lg border px-3 text-xs font-medium transition ${datePreset === option.value ? 'border-blue-600 bg-blue-600 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700'}`}
                    >
                      {option.value === 'custom' ? 'Custom' : option.label}
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
                      value={startDate}
                      onChange={(event) => {
                        const nextStart = event.target.value;
                        setDatePreset('custom');
                        setStartDate(nextStart);
                        if (endDate < nextStart) {
                          setEndDate(nextStart);
                        }
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
                    />
                  </label>
                  <label className="text-xs font-medium text-slate-600">
                    End date
                    <input
                      type="date"
                      value={endDate}
                      onChange={(event) => {
                        const nextEnd = event.target.value;
                        setDatePreset('custom');
                        if (startDate > nextEnd) {
                          setStartDate(nextEnd);
                        }
                        setEndDate(nextEnd);
                      }}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-blue-400"
                    />
                  </label>
                  <p className="text-xs leading-5 text-slate-500">
                    Custom ranges automatically apply after you choose dates. If the dates are reversed, the range is fixed automatically.
                  </p>
                </div>
              ) : null}
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Export Scope</p>
              <div className="mt-3 space-y-2 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="custom-export-scope"
                    checked={customExportScope === 'employee'}
                    onChange={() => setCustomExportScope('employee')}
                  />
                  Employee-wise
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="custom-export-scope"
                    checked={customExportScope === 'department'}
                    onChange={() => setCustomExportScope('department')}
                  />
                  Department-wise
                </label>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Current filters apply: {selectedEmployee ? selectedEmployee.name : 'All employees'} | {selectedGroup ? selectedGroup.name : 'All departments'}
              </p>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Departments</p>
              <p className="mt-2 text-xs text-slate-500">{modalDepartmentOptions.length} departments available.</p>
              <div className="mt-3 max-h-36 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                {modalDepartmentOptions.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-500">No departments found for current scope.</p>
                ) : modalDepartmentOptions.map((department: any) => {
                  const checked = customExportDepartmentIds.includes(Number(department.id));
                  return (
                    <label key={department.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-white">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setCustomExportDepartmentIds((current) => (
                            current.includes(Number(department.id))
                              ? current.filter((id) => Number(id) !== Number(department.id))
                              : [...current, Number(department.id)]
                          ));
                        }}
                      />
                      <span className="truncate">{department.name} ({department.employeeIds.length})</span>
                    </label>
                  );
                })}
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Employees</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    const visibleIds = departmentFilteredUsers.map((employee: any) => Number(employee.id));
                    setCustomExportUserIds((current) => Array.from(new Set([...current, ...visibleIds])));
                  }}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCustomExportUserIds([])}
                >
                  Clear
                </Button>
              </div>
              <div className="mt-3">
                <input
                  type="text"
                  value={customExportEmployeeSearch}
                  onChange={(event) => setCustomExportEmployeeSearch(event.target.value)}
                  placeholder="Search employee name or email"
                  className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </div>
              <p className="mt-3 text-xs text-slate-500">{customExportUserIds.length} employees selected.</p>
              {selectedModalUsers.length > 0 ? (
                <div className="mt-2 flex max-h-16 flex-wrap gap-2 overflow-y-auto">
                  {selectedModalUsers.map((employee: any) => (
                    <span key={employee.id} className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">
                      {employee.name}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="mt-3 max-h-40 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                {visibleModalUsers.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-slate-500">No employees in current filters.</p>
                ) : visibleModalUsers.map((employee: any) => {
                  const employeeId = Number(employee.id);
                  const checked = customExportUserIds.includes(employeeId);
                  return (
                    <label key={employeeId} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-white">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          setCustomExportUserIds((current) => (
                            current.includes(employeeId)
                              ? current.filter((id) => id !== employeeId)
                              : [...current, employeeId]
                          ));
                        }}
                      />
                      <span className="truncate">{employee.name} ({employee.email})</span>
                    </label>
                  );
                })}
              </div>
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Field Controls</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCustomExportFields(customExportFieldOptions.map((option) => option.key))}
                >
                  Select all
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCustomExportFields(defaultCustomExportFields)}
                >
                  Reset recommended
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setCustomExportFields([])}
                >
                  Clear
                </Button>
              </div>
              <p className="mt-3 text-xs text-slate-500">{customExportFields.length} fields selected.</p>
            </SurfaceCard>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {customExportFieldOptions.map((option) => {
              const checked = customExportFields.includes(option.key);
              return (
                <label
                  key={option.key}
                  className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${checked ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      setCustomExportFields((current) => (
                        current.includes(option.key)
                          ? current.filter((field) => field !== option.key)
                          : [...current, option.key]
                      ));
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="mt-6 flex justify-end">
            <Button
              onClick={() => void handleExport({ scope: customExportScope, fields: customExportFields, userIds: customExportUserIds })}
              disabled={isExporting || customExportFields.length === 0 || customExportUserIds.length === 0}
            >
              {isExporting ? 'Exporting...' : 'Download CSV'}
            </Button>
          </div>
        </SurfaceCard>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={pageTitle.eyebrow}
        title={pageTitle.title}
        description={pageTitle.description}
        actions={
          <Button onClick={() => void handleExport()} variant="secondary" disabled={isExporting}>
            <Download className="h-4 w-4" />
            {isExporting ? 'Exporting...' : 'Export CSV'}
          </Button>
        }
      />

      {exportMessage ? <FeedbackBanner tone="success" message={exportMessage} /> : null}
      {exportError ? <FeedbackBanner tone="error" message={exportError} /> : null}

      {customExportModalOpen ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-lg bg-white p-6 shadow-sm sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-600">Custom Export Builder</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">Choose report fields</h2>
                <p className="mt-2 text-sm text-slate-500">
                  Select employee-wise or department-wise scope, choose columns, then download.
                  Time metrics include both minutes and hours in the CSV.
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setCustomExportModalOpen(false)}>Close</Button>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
              <SurfaceCard className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Date Range</p>
                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="text-xs text-slate-500">
                    <span className="mb-1 block font-semibold uppercase tracking-[0.12em]">Start Date</span>
                    <input
                      type="date"
                      value={startDate}
                      readOnly
                      className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                  <label className="text-xs text-slate-500">
                    <span className="mb-1 block font-semibold uppercase tracking-[0.12em]">End Date</span>
                    <input
                      type="date"
                      value={endDate}
                      readOnly
                      className="w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900"
                    />
                  </label>
                </div>
                <p className="mt-3 text-xs text-slate-500">This export includes data from {startDate} to {endDate}.</p>
              </SurfaceCard>

              <SurfaceCard className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Export Scope</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="custom-export-scope"
                      checked={customExportScope === 'employee'}
                      onChange={() => setCustomExportScope('employee')}
                    />
                    Employee-wise
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="custom-export-scope"
                      checked={customExportScope === 'department'}
                      onChange={() => setCustomExportScope('department')}
                    />
                    Department-wise
                  </label>
                </div>
                <p className="mt-3 text-xs text-slate-500">
                  Current filters apply: {selectedEmployee ? selectedEmployee.name : 'All employees'} | {selectedGroup ? selectedGroup.name : 'All departments'}
                </p>
              </SurfaceCard>

              <SurfaceCard className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Departments</p>
                <p className="mt-2 text-xs text-slate-500">{modalDepartmentOptions.length} departments available.</p>
                <div className="mt-3 max-h-36 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                  {modalDepartmentOptions.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-500">No departments found for current scope.</p>
                  ) : modalDepartmentOptions.map((department: any) => {
                    const checked = customExportDepartmentIds.includes(Number(department.id));
                    return (
                      <label key={department.id} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setCustomExportDepartmentIds((current) => (
                              current.includes(Number(department.id))
                                ? current.filter((id) => Number(id) !== Number(department.id))
                                : [...current, Number(department.id)]
                            ));
                          }}
                        />
                        <span className="truncate">{department.name} ({department.employeeIds.length})</span>
                      </label>
                    );
                  })}
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Employees</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const visibleIds = departmentFilteredUsers.map((employee: any) => Number(employee.id));
                      setCustomExportUserIds((current) => Array.from(new Set([...current, ...visibleIds])));
                    }}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setCustomExportUserIds([])}
                  >
                    Clear
                  </Button>
                </div>
                <div className="mt-3">
                  <input
                    type="text"
                    value={customExportEmployeeSearch}
                    onChange={(event) => setCustomExportEmployeeSearch(event.target.value)}
                    placeholder="Search employee name or email"
                    className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
                  />
                </div>
                <p className="mt-3 text-xs text-slate-500">{customExportUserIds.length} employees selected.</p>
                {selectedModalUsers.length > 0 ? (
                  <div className="mt-2 flex max-h-16 flex-wrap gap-2 overflow-y-auto">
                    {selectedModalUsers.map((employee: any) => (
                      <span key={employee.id} className="rounded-full bg-sky-100 px-2 py-1 text-xs font-medium text-sky-700">
                        {employee.name}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 max-h-40 space-y-2 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-2">
                  {visibleModalUsers.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-slate-500">No employees in current filters.</p>
                  ) : visibleModalUsers.map((employee: any) => {
                    const employeeId = Number(employee.id);
                    const checked = customExportUserIds.includes(employeeId);
                    return (
                      <label key={employeeId} className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-white">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setCustomExportUserIds((current) => (
                              current.includes(employeeId)
                                ? current.filter((id) => id !== employeeId)
                                : [...current, employeeId]
                            ));
                          }}
                        />
                        <span className="truncate">{employee.name} ({employee.email})</span>
                      </label>
                    );
                  })}
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Field Controls</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setCustomExportFields(customExportFieldOptions.map((option) => option.key))}
                  >
                    Select all
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setCustomExportFields(defaultCustomExportFields)}
                  >
                    Reset recommended
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={() => setCustomExportFields([])}
                  >
                    Clear
                  </Button>
                </div>
                <p className="mt-3 text-xs text-slate-500">{customExportFields.length} fields selected.</p>
              </SurfaceCard>
            </div>

            <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {customExportFieldOptions.map((option) => {
                const checked = customExportFields.includes(option.key);
                return (
                  <label
                    key={option.key}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition ${checked ? 'border-sky-300 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        setCustomExportFields((current) => (
                          current.includes(option.key)
                            ? current.filter((field) => field !== option.key)
                            : [...current, option.key]
                        ));
                      }}
                      className="mt-1"
                    />
                    <span>
                      <span className="block text-sm font-semibold text-slate-900">{option.label}</span>
                      <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
                    </span>
                  </label>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={() => setCustomExportModalOpen(false)} disabled={isExporting}>Cancel</Button>
              <Button
                onClick={() => void handleExport({ scope: customExportScope, fields: customExportFields, userIds: customExportUserIds })}
                disabled={isExporting || customExportFields.length === 0 || customExportUserIds.length === 0}
              >
                {isExporting ? 'Exporting...' : 'Download CSV'}
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <FilterPanel className={`grid grid-cols-1 gap-3 md:grid-cols-2 ${mode === 'projects-tasks' ? 'xl:grid-cols-8' : 'xl:grid-cols-5'}`}>
        <DateRangeFields
          datePreset={datePreset}
          onDatePresetChange={handleDatePresetChange}
          startDate={startDate}
          endDate={endDate}
          onStartDateChange={(value) => {
            setDatePreset('custom');
            setStartDate(value);
          }}
          onEndDateChange={(value) => {
            setDatePreset('custom');
            setEndDate(value);
          }}
        />
        {mode === 'projects-tasks' ? (
          <>
            <div className="xl:col-span-2">
              <FieldLabel><span className="whitespace-nowrap">Task</span></FieldLabel>
              <TaskSelect
                tasks={taskFilterOptions}
                value={effectiveSelectedTaskId}
                onChange={setSelectedTaskId}
                includeAllOption
                allOptionLabel="All tasks"
                searchPlaceholder="Search task title"
                emptyMessage="No task matched the current search."
              />
            </div>
            <div className="xl:col-span-2">
              <FieldLabel><span className="whitespace-nowrap">Employee</span></FieldLabel>
              <EmployeeSelect
                employees={users}
                value={effectiveSelectedUserId}
                onChange={handleEmployeeFilterChange}
                includeAllOption
              />
            </div>
          </>
        ) : (
          <div>
            <FieldLabel>Employee</FieldLabel>
            <EmployeeSelect
              employees={users}
              value={effectiveSelectedUserId}
              onChange={handleEmployeeFilterChange}
              includeAllOption
            />
          </div>
        )}
        <div>
          <FieldLabel>Department</FieldLabel>
          <SelectInput value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value ? Number(event.target.value) : '')}>
            <option value="">All departments</option>
            {groups.map((group: any) => (
              <option key={group.id} value={group.id}>
                {group.name}
              </option>
            ))}
          </SelectInput>
        </div>
      </FilterPanel>

      {mode === 'attendance' && attendanceTotals ? (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-6">
            <MetricCard label="Employees" value={attendanceTotals.employees} hint="Employees in range" icon={Users} accent="sky" />
            <MetricCard label="Present Days" value={attendanceTotals.presentDays} hint="Total present days" icon={CalendarDays} accent="emerald" />
            <MetricCard label="Leave Days" value={attendanceTotals.leaveDays} hint="Approved leave in range" icon={ListFilter} accent="amber" />
            {/* A weekly off is a day nobody was owed. It gets its own card so
                it can never again be read off the Absent Days figure, which is
                exactly where it used to end up. */}
            <MetricCard
              label="Weekly Offs"
              value={attendanceTotals.weeklyOffDays}
              hint={attendanceTotals.schedulePolicyBacked
                ? 'Days off under each employee’s weekly-off policy'
                : 'Saturday and Sunday — no weekly-off policy is configured yet'}
              icon={CalendarDays}
              accent="slate"
            />
            <MetricCard label="Absent Days" value={attendanceTotals.absentDays} hint="Rostered days that finished with no presence and no leave" icon={AlertTriangle} accent="rose" />
            <MetricCard label="Worked Time" value={formatDuration(attendanceTotals.workedSeconds)} hint="Tracked attendance time" icon={TimerReset} accent="violet" />
            <MetricCard label="Break Time" value={formatDuration(attendanceTotals.breakSeconds)} hint="Total break time in range" icon={TimerReset} accent="amber" />
            <MetricCard label="Avg Attendance" value={formatPercent(attendanceTotals.averageAttendanceRate)} hint="Present days as a share of days rostered" icon={Gauge} accent="slate" />
          </div>

          <SurfaceCard className="p-5">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Coverage Window</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{startDate} to {endDate}</p>
                <p className="mt-1 text-xs text-slate-500">Current filters are applied to every table and summary on this page.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Attendance Health</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{attendanceExceptionRows.length} exception rows need review</p>
                <p className="mt-1 text-xs text-slate-500">{attendanceTotals.currentWorking} employees are working right now in the selected scope.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Department Spread</p>
                <p className="mt-2 text-sm font-semibold text-slate-950">{attendanceDepartmentRows.length} departments represented</p>
                <p className="mt-1 text-xs text-slate-500">{attendanceDepartmentBarRows[0]?.department ? `${attendanceDepartmentBarRows[0].department} currently has the strongest attendance coverage.` : 'No department attendance data available in this scope.'}</p>
              </div>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-5">
            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-600">Report Specific Analysis</p>
                <h2 className="mt-2 text-lg font-semibold text-slate-950">
                  {selectedEmployee ? selectedEmployee.name : selectedGroup ? `${selectedGroup.name} Department` : 'Organization Attendance Detail'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Detailed attendance context for {startDate} to {endDate}, including org, department, or employee scope depending on the selected filters.
                </p>
              </div>
              {renderPanelRefreshButton()}
            </div>

            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
              {/* Attendance Overview Chart */}
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">Attendance Overview</h3>
                    <p className="text-xs text-slate-500">Distribution of employee attendance status</p>
                  </div>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-semibold text-emerald-700">
                    {formatPercent(attendanceTotals.averageAttendanceRate)}
                  </span>
                </div>
                
                {/* Horizontal Bar Chart */}
                <div className="space-y-4">
                  {/* Present */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-emerald-500"></div>
                        <span className="text-slate-700">Present (Checked In)</span>
                      </div>
                      <span className="font-semibold text-slate-950">{attendanceTotals.presentCount || 0}</span>
                    </div>
                    <div className="h-6 rounded-md bg-slate-100 overflow-hidden">
                      <div 
                        className="h-full bg-emerald-500 transition-all duration-500 flex items-center justify-end pr-2" 
                        style={{ width: `${attendanceTotals.employees ? Math.min(100, ((attendanceTotals.presentCount || 0) / attendanceTotals.employees) * 100) : 0}%` }}
                      >
                        {(attendanceTotals.presentCount || 0) > 0 && (
                          <span className="text-xs text-white font-medium">
                            {formatPercent(attendanceTotals.employees ? ((attendanceTotals.presentCount || 0) / attendanceTotals.employees) * 100 : 0)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Late Arrivals */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-amber-500"></div>
                        <span className="text-slate-700">Late Arrivals</span>
                      </div>
                      <span className="font-semibold text-slate-950">{attendanceExceptionRows.filter((r: any) => r.lateMinutes > 0).length}</span>
                    </div>
                    <div className="h-6 rounded-md bg-slate-100 overflow-hidden">
                      <div 
                        className="h-full bg-amber-500 transition-all duration-500 flex items-center justify-end pr-2" 
                        style={{ width: `${attendanceTotals.presentCount ? Math.min(100, (attendanceExceptionRows.filter((r: any) => r.lateMinutes > 0).length / Math.max(1, attendanceTotals.presentCount)) * 100) : 0}%` }}
                      >
                        {attendanceExceptionRows.filter((r: any) => r.lateMinutes > 0).length > 0 && (
                          <span className="text-xs text-white font-medium">
                            {formatPercent(attendanceTotals.presentCount ? (attendanceExceptionRows.filter((r: any) => r.lateMinutes > 0).length / Math.max(1, attendanceTotals.presentCount)) * 100 : 0)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* On Leave */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                        <span className="text-slate-700">On Leave</span>
                      </div>
                      <span className="font-semibold text-slate-950">{attendanceRows.filter((r: any) => r.leave_days > 0).length}</span>
                    </div>
                    <div className="h-6 rounded-md bg-slate-100 overflow-hidden">
                      <div 
                        className="h-full bg-blue-500 transition-all duration-500 flex items-center justify-end pr-2" 
                        style={{ width: `${attendanceTotals.employees ? Math.min(100, (attendanceRows.filter((r: any) => r.leave_days > 0).length / attendanceTotals.employees) * 100) : 0}%` }}
                      >
                        {attendanceRows.filter((r: any) => r.leave_days > 0).length > 0 && (
                          <span className="text-xs text-white font-medium">
                            {formatPercent(attendanceTotals.employees ? (attendanceRows.filter((r: any) => r.leave_days > 0).length / attendanceTotals.employees) * 100 : 0)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Absent */}
                  <div>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full bg-rose-500"></div>
                        <span className="text-slate-700">Absent</span>
                      </div>
                      <span className="font-semibold text-slate-950">{attendanceRows.filter((r: any) => !r.is_working && !r.check_in_at && r.days_present === 0 && r.leave_days === 0).length}</span>
                    </div>
                    <div className="h-6 rounded-md bg-slate-100 overflow-hidden">
                      <div 
                        className="h-full bg-rose-500 transition-all duration-500 flex items-center justify-end pr-2" 
                        style={{ width: `${attendanceTotals.employees ? Math.min(100, (attendanceRows.filter((r: any) => !r.is_working && !r.check_in_at && r.days_present === 0 && r.leave_days === 0).length / attendanceTotals.employees) * 100) : 0}%` }}
                      >
                        {attendanceRows.filter((r: any) => !r.is_working && !r.check_in_at && r.days_present === 0 && r.leave_days === 0).length > 0 && (
                          <span className="text-xs text-white font-medium">
                            {formatPercent(attendanceTotals.employees ? (attendanceRows.filter((r: any) => !r.is_working && !r.check_in_at && r.days_present === 0 && r.leave_days === 0).length / attendanceTotals.employees) * 100 : 0)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Legend */}
                <div className="mt-4 pt-4 border-t border-slate-100 grid grid-cols-2 gap-2 text-xs">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                    <span className="text-slate-600">Present: Employees who checked in</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                    <span className="text-slate-600">Late: Arrived after scheduled time</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                    <span className="text-slate-600">Leave: Approved absence</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                    <span className="text-slate-600">Absent: No show without approval</span>
                  </div>
                </div>
              </div>

              {/* Top Performers & At-Risk */}
              <div className="space-y-4">
                {/* Top Performers */}
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">Top Performers</h3>
                      <p className="text-xs text-slate-500">Highest attendance rate this period</p>
                    </div>
                    <Award className="h-5 w-5 text-amber-500" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {attendanceExceptionRows
                      .filter((row: any) => (row.risk_score || 0) < 30)
                      .slice(0, 5)
                      .map((row: any) => (
                        <div key={row.user?.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
                              {(row.user?.name || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-medium text-slate-900">{row.user?.name || 'Unknown'}</p>
                              <p className="text-[10px] text-slate-500">{resolveAttendanceDepartment(row)}</p>
                            </div>
                          </div>
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                            {formatPercent(100 - (row.risk_score || 0))}
                          </span>
                        </div>
                      ))}
                    {attendanceExceptionRows.filter((row: any) => (row.risk_score || 0) < 30).length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-4">No top performers in selected period</p>
                    )}
                  </div>
                </div>

                {/* Needs Attention */}
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-slate-950">Needs Attention</h3>
                      <p className="text-xs text-slate-500">High absence rate or attendance issues</p>
                    </div>
                    <AlertCircle className="h-5 w-5 text-rose-500" />
                  </div>
                  <div className="mt-4 space-y-3">
                    {attendanceExceptionRows
                      .filter((row: any) => (row.risk_score || 0) >= 50)
                      .slice(0, 5)
                      .map((row: any) => (
                        <div key={row.user?.id} className="flex items-center justify-between rounded-lg border border-rose-100 bg-rose-50/30 p-2.5">
                          <div className="flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-100 text-xs font-semibold text-rose-700">
                              {(row.user?.name || 'U').charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="text-xs font-medium text-slate-900">{row.user?.name || 'Unknown'}</p>
                              <p className="text-[10px] text-slate-500">{row.absent_days} absent days</p>
                            </div>
                          </div>
                          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-medium text-rose-700">
                            {formatPercent(row.risk_score)} risk
                          </span>
                        </div>
                      ))}
                    {attendanceExceptionRows.filter((row: any) => (row.risk_score || 0) >= 50).length === 0 && (
                      <p className="text-sm text-slate-500 text-center py-4">No at-risk employees in selected period</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </SurfaceCard>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DataTable
              title="Department Attendance Detail"
              description="Department-level rollup for org or group attendance reporting."
              rows={attendanceDepartmentRows}
              emptyMessage="No department attendance details found."
              columns={[
                { key: 'department', header: 'Department', render: (row: any) => row.department },
                { key: 'employees', header: 'Employees', render: (row: any) => row.employees },
                { key: 'present', header: 'Present', render: (row: any) => row.presentDays },
                { key: 'leave', header: 'Leave', render: (row: any) => row.leaveDays },
                { key: 'absent', header: 'Absent', render: (row: any) => row.absentDays },
                { key: 'rate', header: 'Rate', render: (row: any) => formatPercent((row.presentDays / Math.max(1, row.expectedDays)) * 100) },
                { key: 'worked', header: 'Work Time', render: (row: any) => formatDuration(row.workedSeconds) },
                { key: 'break', header: 'Break Time', render: (row: any) => formatDuration(row.breakSeconds) },
              ]}
            />

            <DataTable
              title="Attendance Exceptions"
              description="Employees that need attention because absences or attendance percentage are outside expected range."
              rows={attendanceExceptionRows}
              emptyMessage="No attendance exceptions found for this scope."
              columns={[
                { key: 'employee', header: 'Employee', render: (row: any) => <div><p className="font-medium text-slate-950">{row.user?.name}</p><p className="text-xs text-slate-500">{row.user?.email}</p></div> },
                { key: 'department', header: 'Department', render: (row: any) => resolveAttendanceDepartment(row) },
                { key: 'absent', header: 'Absent', render: (row: any) => row.absent_days },
                { key: 'weekly_off', header: 'Weekly Off', render: (row: any) => row.weekly_off_days },
                // The scheduled rate, not the calendar one — an employee is
                // listed here on this number, and the calendar rate marked
                // every weekly off against them.
                { key: 'rate', header: 'Rate', render: (row: any) => formatPercent(row.scheduled_attendance_rate) },
                { key: 'worked', header: 'Work Time', render: (row: any) => formatDuration(row.worked_seconds || 0) },
                { key: 'break', header: 'Break Time', render: (row: any) => formatDuration(row.total_break_seconds || 0) },
              ]}
            />
          </div>

          <DataTable
            title="Attendance Breakdown"
            description="Presence, leave, attendance rate, and current work state per employee."
            rows={attendanceRows}
            emptyMessage="No attendance rows found for the selected range."
            headerAction={renderPanelRefreshButton()}
            columns={[
              { key: 'employee', header: 'Employee', render: (row: any) => <div><p className="font-medium text-slate-950">{row.user?.name}</p><p className="text-xs text-slate-500">{row.user?.email}</p></div> },
              // Out of days ROSTERED, not out of days on the calendar. The old
              // denominator counted every weekly off as a day this person was
              // expected in, so nobody could ever reach 100%.
              { key: 'present', header: 'Present', render: (row: any) => `${row.days_present} / ${summariseAttendanceRow(row).expectedDays}` },
              { key: 'leave', header: 'Leave', render: (row: any) => row.leave_days },
              { key: 'weekly_off', header: 'Weekly Off', render: (row: any) => summariseAttendanceRow(row).weeklyOffDays },
              { key: 'absent', header: 'Absent', render: (row: any) => summariseAttendanceRow(row).absentDays },
              { key: 'attendance_rate', header: 'Attendance %', render: (row: any) => formatPercent(summariseAttendanceRow(row).attendanceRate) },
               { key: 'worked', header: 'Work Time', render: (row: any) => formatDuration(row.worked_seconds) },
               { key: 'break', header: 'Break Time', render: (row: any) => formatDuration(row.total_break_seconds || 0) },
               { key: 'status', header: 'Status', render: (row: any) => (row.is_working ? 'Working' : 'Offline') },
            ]}
          />
        </>
      ) : null}

      {(mode === 'hours-tracked' || mode === 'productivity') && (
        <>
          {/* Five cards, five columns — in a four-column grid "Active Users"
              orphaned onto a row of its own at every width above xl. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Track Time" value={formatDuration(overallSummary.total_duration || 0)} hint="Total duration in range" icon={TimerReset} accent="sky" />
            <MetricCard label="Work Time" value={formatDuration(getWorkingDuration(overallSummary))} hint="Tracked time minus measured idle time" icon={LineChart} accent="emerald" />
            <MetricCard label="Idle Time" value={formatDuration(overallSummary.idle_duration || 0)} hint="Measured idle time inside tracked time" icon={Activity} accent="amber" />
            <MetricCard label="Break Time" value={formatDuration(overallSummary.total_break_seconds || 0)} hint="Total break time in range" icon={TimerReset} accent="slate" />
            <MetricCard
              label="Active Users"
              value={overallSummary.active_users || 0}
              hint={mode === 'hours-tracked' && hoursPagination ? `${hoursTotal} users total, ${byUser.length} loaded` : `${overallSummary.users_count || 0} users tracked`}
              icon={Users}
              accent="violet"
            />
          </div>

          <div className="space-y-4">
            <DataTable
              title={mode === 'productivity' ? 'Employee Productivity' : 'Employee Hours'}
              description="Per-user totals, idle share, and latest activity."
              rows={byUser}
              emptyMessage="No employee rows found."
              headerAction={renderPanelRefreshButton()}
              bodyClassName={shouldScrollByUser ? 'max-h-[360px] overflow-y-auto' : undefined}
              columns={[
                { key: 'user', header: 'User', render: (row: any) => <div><p className="font-medium text-slate-950">{row.user?.name}</p><p className="text-xs text-slate-500">{row.user?.email}</p></div> },
                {
                  key: 'first_check_in_at',
                  header: 'Check In',
                  render: (row: any) => formatAttendanceDateTime(row.first_check_in_at, displayTimezone),
                },
                {
                  key: 'last_check_out_at',
                  header: 'Last Check Out',
                  render: (row: any) => formatAttendanceDateTime(row.last_check_out_at, displayTimezone),
                },
                {
                  key: 'attendance_rate',
                  header: 'Attendance',
                  render: (row: any) => {
                    const presentDays = Number(row.attendance_days_present || 0);
                    const totalDays = Math.max(1, Number(row.attendance_days_in_range || 0));
                    return `${Number(row.attendance_rate || 0).toFixed(1)}% (${presentDays}/${totalDays})`;
                  },
                },
                { key: 'total', header: 'Track Time', render: (row: any) => formatDuration(row.total_duration || 0) },
                { key: 'working', header: 'Work Time', render: (row: any) => formatDuration(getWorkingDuration(row)) },
                { key: 'idle', header: 'Idle Time', render: (row: any) => formatDuration(row.idle_duration || 0) },
                { key: 'idle_pct', header: 'Idle %', render: (row: any) => `${Number(row.idle_percentage || 0).toFixed(1)}%` },
                { key: 'break', header: 'Break Time', render: (row: any) => formatDuration(row.break_seconds || 0) },
                {
                  key: 'overtime',
                  header: 'Overtime',
                  render: (row: any) => {
                    const workingSec = getWorkingDuration(row);
                    // Working days, not calendar days: a Mon–Sun range owes 5
                    // days of work, not 7. Reading calendar days first counted
                    // both weekend days as 8-hour obligations.
                    const daysInRange = Number(row.working_days_in_range || row.calendar_days_in_range || 1);
                    const thresholdSec = daysInRange * 8 * 3600;
                    const overtimeSec = Math.max(0, workingSec - thresholdSec);
                    const h = Math.floor(overtimeSec / 3600);
                    const m = Math.floor((overtimeSec % 3600) / 60);
                    return `${h}h ${m}m`;
                  },
                },
              ]}
            />
            {mode === 'hours-tracked' && hoursTotal > 0 ? (
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <span>
                  Page {hoursCurrentPage} of {hoursLastPage} - {hoursTotal} employee rows
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={hoursCurrentPage <= 1 || dataQuery.isFetching}
                    onClick={() => setHoursPage((page) => Math.max(1, page - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={hoursCurrentPage >= hoursLastPage || dataQuery.isFetching}
                    onClick={() => setHoursPage((page) => Math.min(hoursLastPage, page + 1))}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}

            <SurfaceCard className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Daily Trend</h2>
                  <p className="mt-1 text-sm text-slate-500">Daily totals within the selected range.</p>
                </div>
                {renderPanelRefreshButton()}
              </div>
              {byDay.length === 0 ? (
                <div className="mt-6">
                  <PageEmptyState title="No trend data" description="Tracked work by day will appear here." />
                </div>
              ) : (
                <div className="mt-5">
                  <ResponsiveContainer width="100%" height={Math.max(120, byDay.length * 36)}>
                    <BarChart data={byDay} layout="vertical" margin={{ top: 4, right: 64, left: 80, bottom: 4 }} barCategoryGap="25%">
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 11, fill: chartTheme.axisLabel }} tickFormatter={(v) => formatDuration(v)} axisLine={false} tickLine={false} />
                      <YAxis type="category" dataKey="date" tick={{ fontSize: 11, fill: chartTheme.axisLabel, fontWeight: 500 }} axisLine={false} tickLine={false} width={75} />
                        <Tooltip
                          content={({ active, payload }: any) => {
                            if (!active || !payload?.length) return null;
                            const row = payload[0].payload;
                            return (
                              <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-xl">
                                <p className="text-xs font-bold text-slate-900">{row.date}</p>
                                <p className="mt-1 text-xs text-slate-500">Tracked: <span className="font-semibold text-slate-700">{formatDuration(row.total_duration || 0)}</span></p>
                                {Number.isFinite(Number(row.total_break_seconds)) && (
                                  <p className="mt-1 text-xs text-slate-500">Break: <span className="font-semibold text-slate-700">{formatDuration(row.total_break_seconds || 0)}</span></p>
                                )}
                              </div>
                            );
                          }}
                          cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                          offset={28}
                        />
                      <Bar dataKey="total_duration" name="Track Time" radius={[0, 4, 4, 0]} barSize={18}>
                        {byDay.map((item: any) => {
                          const maxDuration = Math.max(1, ...byDay.map((e: any) => Number(e.total_duration || 0)));
                          const ratio = Number(item.total_duration || 0) / maxDuration;
                          // Opacity carries the ratio so the ramp works on either
                          // ground; the three fixed blues were tuned for a white
                          // surface and washed out on the dark one.
                          return (
                            <Cell
                              key={item.date}
                              fill={chartTheme.series[0]}
                              fillOpacity={ratio >= 0.75 ? 1 : ratio >= 0.4 ? 0.7 : 0.4}
                            />
                          );
                        })}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </SurfaceCard>
          </div>
        </>
      )}

      {mode === 'projects-tasks' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Groups" value={filteredTaskGroupIds.length} hint="Groups with matching tasks" icon={Users} accent="sky" />
            <MetricCard label="Tasks" value={filteredTasks.length} hint="Tasks in scope" icon={ListFilter} accent="violet" />
            <MetricCard label="Open Tasks" value={filteredTasks.filter((task: any) => task.status !== 'done').length} hint="Todo and in-progress tasks" icon={Waypoints} accent="amber" />
            <MetricCard label="Track Time" value={formatDuration(filteredProjectTimeEntries.reduce((sum: number, entry: any) => sum + Number(entry.duration || 0), 0))} hint="Task-linked time in scope" icon={TimerReset} accent="emerald" />
          </div>

          {projectsEmployeeNameSearch ? (
            <DataTable
              title="Employee Work Focus"
              description="Assigned task and completion stats for the current employee search."
              rows={employeeFocusRows}
              emptyMessage="No employees in this search have assigned work or tracked task activity in the selected range."
              headerAction={renderPanelRefreshButton()}
              columns={[
                {
                  key: 'employee',
                  header: 'Employee',
                  render: (row: any) => (
                    <div>
                      <p className="font-medium text-slate-950">{row.name}</p>
                      <p className="text-xs text-slate-500">{row.email}</p>
                    </div>
                  ),
                },
                {
                  key: 'assigned_tasks',
                  header: 'Assigned Tasks',
                  render: (row: any) => (
                    <div>
                      <p className="font-medium text-slate-950">{row.assigned_task_count} task{row.assigned_task_count === 1 ? '' : 's'}</p>
                      <p className="text-xs text-slate-500">{formatPreviewList(row.assigned_task_names, 'No assigned tasks')}</p>
                    </div>
                  ),
                },
                {
                  key: 'stats',
                  header: 'Task Stats',
                  render: (row: any) => (
                    <div>
                      <p className="font-medium text-slate-950">{row.completed_task_count} done / {row.open_task_count} open</p>
                      <p className="text-xs text-slate-500">{row.completion_rate}% completion</p>
                    </div>
                  ),
                },
                {
                  key: 'groups',
                  header: 'Groups',
                  render: (row: any) => formatPreviewList(row.assigned_group_names, 'No linked group'),
                },
                {
                  key: 'tracked',
                  header: 'Track Time',
                  render: (row: any) => formatDuration(row.tracked_seconds || 0),
                },
              ]}
            />
          ) : null}

          {selectedTaskOverviewRow ? (
            <DataTable
              title="Selected Task Details"
              description="Current task status, assignee, group, and tracked duration for the selected task."
              rows={[selectedTaskOverviewRow]}
              emptyMessage="No task details found for the selected task."
              headerAction={renderPanelRefreshButton()}
              columns={[
                {
                  key: 'task',
                  header: 'Task',
                  render: (row: any) => (
                    <div>
                      <p className="font-medium text-slate-950">{row.title}</p>
                      <p className="text-xs text-slate-500">{row.description || 'No description'}</p>
                    </div>
                  ),
                },
                { key: 'group', header: 'Group', render: (row: any) => row.group_name || 'No group' },
                { key: 'status', header: 'Status', render: (row: any) => row.status },
                { key: 'priority', header: 'Priority', render: (row: any) => row.priority },
                {
                  key: 'assignee',
                  header: 'Assignee',
                  render: (row: any) => (
                    <div>
                      <p className="font-medium text-slate-950">{row.assignee_name}</p>
                      <p className="text-xs text-slate-500">{row.completion_label}</p>
                    </div>
                  ),
                },
                { key: 'tracked', header: 'Track Time', render: (row: any) => formatDuration(row.tracked_seconds || 0) },
                { key: 'due', header: 'Due Date', render: (row: any) => row.due_date ? row.due_date.split('T')[0] : 'No due date' },
              ]}
            />
          ) : null}

          <DataTable
            title="Task Overview"
            description="Task status, assignees, group coverage, and tracked duration."
            rows={hasSelectedTask && selectedTaskOverviewRow ? [selectedTaskOverviewRow] : taskAllocationRows}
            emptyMessage="No task data found."
            headerAction={renderPanelRefreshButton()}
            columns={[
              { key: 'task', header: 'Task', render: (row: any) => <div><p className="font-medium text-slate-950">{row.title}</p><p className="text-xs text-slate-500">{row.description || 'No description'}</p></div> },
              { key: 'group', header: 'Group', render: (row: any) => row.group_name || 'No group' },
              { key: 'status', header: 'Status', render: (row: any) => row.status },
              { key: 'priority', header: 'Priority', render: (row: any) => row.priority },
              {
                key: 'assignee',
                header: 'Assignee',
                render: (row: any) => (
                  <div>
                    <p className="font-medium text-slate-950">{row.assignee_name}</p>
                    <p className="text-xs text-slate-500">{row.completion_label}</p>
                  </div>
                ),
              },
              { key: 'tracked', header: 'Track Time', render: (row: any) => formatDuration(row.tracked_seconds || 0) },
              { key: 'due', header: 'Due Date', render: (row: any) => row.due_date ? row.due_date.split('T')[0] : 'No due date' },
            ]}
          />
        </>
      )}

      {mode === 'timeline' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex overflow-hidden rounded-lg border border-slate-200">
              <button
                type="button"
                aria-pressed={timelineView === 'day'}
                onClick={() => switchTimelineView('day')}
                className={`px-3.5 py-2 text-xs font-semibold transition ${timelineView === 'day' ? 'bg-blue-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Day view
              </button>
              <button
                type="button"
                aria-pressed={timelineView === 'log'}
                onClick={() => switchTimelineView('log')}
                className={`px-3.5 py-2 text-xs font-semibold transition ${timelineView === 'log' ? 'bg-blue-700 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                Event log
              </button>
            </div>

            {timelineView === 'day' && timelineRangeIsMultiDay && (
              /*
               * Says which day is on screen rather than quietly editing the
               * filter to match. The range the person chose is still theirs —
               * switching back to the event log shows all of it.
               */
              <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs text-slate-600">
                Showing{' '}
                <strong className="font-semibold text-slate-800">
                  {new Date(`${timelineFocusDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </strong>
                {' '}— the last day of the selected range. The event log covers the whole range.
              </span>
            )}

            {timelineView === 'day' && !timelineRangeIsMultiDay && (
              <div className="flex items-center gap-1">
                <Button type="button" variant="ghost" size="sm" aria-label="Previous day" onClick={() => shiftTimelineDay(-1)}>
                  ◀
                </Button>
                <span className="font-mono text-xs font-semibold text-slate-700">
                  {new Date(`${startDate}T00:00:00`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </span>
                <Button type="button" variant="ghost" size="sm" aria-label="Next day" onClick={() => shiftTimelineDay(1)}>
                  ▶
                </Button>
              </div>
            )}

            {timelineView === 'log' && (
              <div className="flex flex-wrap items-center gap-1.5">
                {([['', 'All'], ['app', 'Apps'], ['url', 'Web'], ['idle', 'Idle']] as Array<['' | 'app' | 'url' | 'idle', string]>).map(([key, label]) => (
                  <button
                    key={`type-${key}`}
                    type="button"
                    aria-pressed={timelineTypeFilter === key}
                    onClick={() => {
                      setTimelineTypeFilter(key);
                      setTimelinePage(1);
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${timelineTypeFilter === key ? 'bg-blue-700 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}
                  >
                    {label}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
                {([['', 'Any class'], ['productive', 'Productive'], ['neutral', 'Neutral'], ['context_dependent', 'Context'], ['unproductive', 'Unproductive']] as Array<['' | Classification, string]>).map(([key, label]) => (
                  <button
                    key={`class-${key}`}
                    type="button"
                    aria-pressed={timelineClassFilter === key}
                    onClick={() => {
                      setTimelineClassFilter(key);
                      setTimelinePage(1);
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${timelineClassFilter === key ? 'bg-blue-700 text-white' : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}

            <span className="ml-auto">{renderPanelRefreshButton()}</span>
          </div>

          {timelineView === 'day' ? (
            <TimelineSwimlanes
              rows={timelineSwimlaneData?.swimlaneRows || []}
              timezone={displayTimezone}
              focusedUserId={effectiveSelectedUserId}
              onFocusPerson={(id) => setSelectedUserId(id)}
              truncated={Boolean(timelineSwimlaneData?.truncated)}
            />
          ) : (
            <div className="space-y-3">
              <DataTable
                title="Activity Timeline"
                description="App, website, and idle events, newest first. Use the chips above to narrow by kind or classification."
                rows={timelineRows.slice().sort((a: any, b: any) => +new Date(b.recorded_at) - +new Date(a.recorded_at))}
                emptyMessage="No timeline events match these filters."
                columns={[
                  { key: 'recorded_at', header: 'When', render: (row: any) => formatDateTimeForTimezone(row.recorded_at, displayTimezone, 'en-US', 'Not recorded') },
                  { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
                  { key: 'type', header: 'Type', render: (row: any) => row.tool_type || row.type },
                  {
                    key: 'name',
                    header: 'Tool',
                    render: (row: any) => (
                      <div>
                        <p className="font-medium text-slate-950">{formatTimelineToolLabel(row)}</p>
                        {row?.classification_reason ? (
                          <p className="text-xs text-slate-500">{row.classification_reason}</p>
                        ) : null}
                      </div>
                    ),
                  },
                  {
                    key: 'classification',
                    header: 'Productivity',
                    render: (row: any) => (
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${timelineProductivityTone(row.classification)}`}>
                        {row.classification || 'neutral'}
                      </span>
                    ),
                  },
                  { key: 'duration', header: 'Duration', render: (row: any) => formatTimelineDuration(row.duration || 0) },
                ]}
              />
              <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <span>
                  Page {timelinePagination.currentPage} of {timelinePagination.lastPage} · {timelinePagination.total} events
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={timelinePagination.currentPage <= 1 || dataQuery.isFetching}
                    onClick={() => setTimelinePage((page) => Math.max(1, page - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={!timelinePagination.hasMore || dataQuery.isFetching}
                    onClick={() => setTimelinePage((page) => page + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {mode === 'web-app-usage' && (
        <UsageAnalytics
          data={usageData}
          hasSelectedEmployee={hasSelectedEmployee}
          scopeLabel={
            hasSelectedEmployee
              ? usageData?.selected_user?.name || 'Selected employee'
              : selectedGroup?.name || 'All employees'
          }
          isFetching={dataQuery.isFetching}
          canReclassify={canReclassifyTools}
          onReclassify={handleReclassifyTool}
        />
      )}

      {mode !== 'attendance' &&
      mode !== 'hours-tracked' &&
      mode !== 'projects-tasks' &&
      mode !== 'timeline' &&
      mode !== 'web-app-usage' &&
      mode !== 'productivity' ? (
        <PageEmptyState title="No report mode selected" description="Choose another report from the top navigation." />
      ) : null}
    </div>
  );
}
