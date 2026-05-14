import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  activityApi,
  reportApi,
  reportGroupApi,
  taskApi,
  timeEntryApi,
  userApi,
} from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
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
import { deriveDateRangeFromPreset, detectDateRangePreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { matchesSearchFilter } from '@/lib/searchSuggestions';
import { getWorkingDuration } from '@/lib/timeBreakdown';
import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Building2,
  CalendarDays,
  Camera,
  CheckCircle2,
  Download,
  FileClock,
  FileSpreadsheet,
  Gauge,
  LineChart,
  ListFilter,
  Monitor,
  RefreshCw,
  TimerReset,
  Users,
  Waypoints,
} from 'lucide-react';

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
  { key: 'tracked_time', label: 'Tracked Time', description: 'Total tracked duration.' },
  { key: 'worked_time', label: 'Worked Time', description: 'Attendance worked duration.' },
  { key: 'idle_time', label: 'Idle Time', description: 'Measured idle duration.' },
  { key: 'working_time', label: 'Working Time', description: 'Tracked time minus idle time.' },
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

const formatDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(Number.isFinite(Number(seconds)) ? Number(seconds) : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (hours > 0) {
    return remainingSeconds > 0 ? `${hours}h ${minutes}m ${remainingSeconds}s` : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${remainingSeconds}s`;
};
const formatTimelineDuration = (seconds: number) => {
  const safe = Math.max(0, Math.floor(Number.isFinite(Number(seconds)) ? Number(seconds) : 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainingSeconds = safe % 60;

  if (hours > 0) {
    return remainingSeconds > 0 ? `${hours}h ${minutes}m ${remainingSeconds}s` : `${hours}h ${minutes}m`;
  }

  if (minutes > 0) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }

  return `${remainingSeconds}s`;
};
const formatAttendanceDateTime = (value?: string | null, timezone = DEFAULT_APP_TIMEZONE) =>
  formatDateTimeForTimezone(value, timezone, 'en-US', '--');
const shouldPreferWindowTitleForSoftwareRow = (row: any) => {
  const appName = String(row?.app_name || '').trim().toLowerCase();
  const windowTitle = String(row?.window_title || '').trim();

  if (!windowTitle) {
    return false;
  }

  return ['explorer.exe', 'windows explorer', 'file explorer'].some((keyword) => appName.includes(keyword));
};

const formatTimelineSoftwareLabel = (row: any) => (
  shouldPreferWindowTitleForSoftwareRow(row)
  ? row?.window_title
  : row?.app_name
  || row?.name
  || row?.window_title
  || row?.software_name
  || row?.normalized_label
  || 'Unknown app'
);
const formatTimelineToolLabel = (row: any) => {
  if (row?.type === 'idle') {
    return row?.name || 'Idle';
  }

  if (row?.tool_type === 'website') {
    return row?.normalized_domain || row?.normalized_label || row?.name || 'Unknown site';
  }

  if (row?.tool_type === 'software') {
    return formatTimelineSoftwareLabel(row);
  }

  return row?.normalized_label || formatTimelineSoftwareLabel(row) || row?.normalized_domain || row?.name || 'Unknown';
};
const timelineProductivityTone = (classification?: string | null) =>
  classification === 'productive'
    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    : classification === 'unproductive'
      ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
      : classification === 'context_dependent'
        ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200'
        : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200';
const formatPreviewList = (items: unknown[], emptyLabel: string, limit = 3) => {
  const normalizedItems = Array.from(new Set(items.map((item) => String(item || '').trim()).filter(Boolean)));
  if (!normalizedItems.length) {
    return emptyLabel;
  }

  const preview = normalizedItems.slice(0, limit).join(', ');
  return normalizedItems.length > limit ? `${preview} +${normalizedItems.length - limit} more` : preview;
};
const formatPercent = (value: number) => `${Number.isFinite(value) ? value.toFixed(1) : '0.0'}%`;
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

  const entryCollections = await Promise.all(
    uniqueUserIds.map(async (userId) => {
      const collectedEntries: any[] = [];
      let currentPage = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const response = await timeEntryApi.getAll({
          user_id: userId,
          start_date: startDate,
          end_date: endDate,
          page: currentPage,
          per_page: 1000,
        });
        const payload = response.data;

        collectedEntries.push(...(payload.data || []));
        if (!payload.last_page || payload.current_page >= payload.last_page) {
          hasMorePages = false;
        } else {
          currentPage += 1;
        }
      }

      return collectedEntries;
    })
  );

  return entryCollections.flat();
};

const modeCopy: Record<ReportsWorkspaceMode, { title: string; description: string; eyebrow: string }> = {
  'reports-hub': {
    eyebrow: 'Reports',
    title: 'Reports Center',
    description: 'All operational reports in one place: attendance, hours, task, payroll, timeline, and exports.',
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

const reportCatalogItems = [
  {
    title: 'Attendance Report',
    description: 'Presence, leave, absence, attendance rate, and employee attendance exceptions.',
    to: '/reports/attendance',
    category: 'Workforce health',
    highlights: ['Attendance %', 'Leave detail', 'Exceptions'],
    icon: CalendarDays,
    accent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  {
    title: 'Hours Tracked',
    description: 'Tracked time, working time, idle time, daily totals, and employee hour rows.',
    to: '/reports/hours-tracked',
    category: 'Time tracking',
    highlights: ['Tracked hours', 'Idle share', 'Daily trend'],
    icon: FileClock,
    accent: 'bg-sky-50 text-sky-700 ring-sky-200',
  },
  {
    title: 'Task Overview',
    description: 'Task allocation, project coverage, assignee detail, status, priority, and due dates.',
    to: '/reports/projects-tasks',
    category: 'Delivery status',
    highlights: ['Task load', 'Assignee detail', 'Tracked effort'],
    icon: ListFilter,
    accent: 'bg-violet-50 text-violet-700 ring-violet-200',
  },
  {
    title: 'Timeline Report',
    description: 'Chronological activity report for app, website, idle, employee, and duration rows.',
    to: '/reports/timeline',
    category: 'Activity audit',
    highlights: ['Raw timeline', 'App and site events', 'Idle periods'],
    icon: Waypoints,
    accent: 'bg-amber-50 text-amber-700 ring-amber-200',
  },
  {
    title: 'Payroll Report',
    description: 'Payroll report area for runs, payslips, reimbursements, salary structures, and payroll exports.',
    to: '/payroll/reports',
    category: 'Compensation ops',
    highlights: ['Runs', 'Payslips', 'Structures'],
    icon: FileSpreadsheet,
    accent: 'bg-rose-50 text-rose-700 ring-rose-200',
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

const analyticsCatalogItems = [
  {
    title: 'Productivity Summary',
    description: 'Productive share, idle share, daily productivity trend, and employee contributor analytics.',
    to: '/reports/productivity',
    category: 'Focus trends',
    highlights: ['Productive share', 'Idle trend', 'Top contributors'],
    icon: Gauge,
    accent: 'bg-blue-50 text-blue-700 ring-blue-200',
  },
  {
    title: 'Web & App Usage',
    description: 'Classified website and application usage with productive, unproductive, and context-dependent tools.',
    to: '/reports/web-app-usage',
    category: 'Tool usage',
    highlights: ['Apps', 'Websites', 'Classification'],
    icon: Monitor,
    accent: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  },
  {
    title: 'Productive Time',
    description: 'Focused monitoring analytics for productive employees, tools, and work sessions.',
    to: '/monitoring/productive-time',
    category: 'High-output work',
    highlights: ['Focused employees', 'Tools', 'Sessions'],
    icon: LineChart,
    accent: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  },
  {
    title: 'Unproductive Time',
    description: 'Unproductive time analytics, tool patterns, and employee attention signals.',
    to: '/monitoring/unproductive-time',
    category: 'Attention drift',
    highlights: ['Time loss', 'Tool patterns', 'Attention signals'],
    icon: Activity,
    accent: 'bg-orange-50 text-orange-700 ring-orange-200',
  },
  {
    title: 'Timeline Analytics',
    description: 'Activity event analytics across app, website, idle, duration, and productivity classification.',
    to: '/reports/timeline',
    category: 'Behavior sequence',
    highlights: ['Event flow', 'Duration', 'Productivity class'],
    icon: Waypoints,
    accent: 'bg-purple-50 text-purple-700 ring-purple-200',
  },
  {
    title: 'App Usage',
    description: 'Application analytics grouped by employee, duration, and usage classification.',
    to: '/monitoring/app-usage',
    category: 'Desktop apps',
    highlights: ['Apps by employee', 'Duration', 'Usage class'],
    icon: BarChart3,
    accent: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  },
  {
    title: 'Website Usage',
    description: 'Website analytics grouped by employee, domain, duration, and usage classification.',
    to: '/monitoring/website-usage',
    category: 'Web domains',
    highlights: ['Domains', 'Duration', 'Usage class'],
    icon: Monitor,
    accent: 'bg-teal-50 text-teal-700 ring-teal-200',
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
  const location = useLocation();
  const displayTimezone = resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedReportsWorkspaceFilters(mode).datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedReportsWorkspaceFilters(mode).startDate);
  const [endDate, setEndDate] = useState(() => readPersistedReportsWorkspaceFilters(mode).endDate);
  const [selectedTaskId, setSelectedTaskId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedTaskId);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedUserId);
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedGroupId);
  const [timelinePage, setTimelinePage] = useState(1);
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

  useEffect(() => {
    const persisted = readPersistedReportsWorkspaceFilters(mode);
    setDatePreset(persisted.datePreset);
    setStartDate(persisted.startDate);
    setEndDate(persisted.endDate);
    setSelectedTaskId(persisted.selectedTaskId);
    setSelectedUserId(persisted.selectedUserId);
    setSelectedGroupId(persisted.selectedGroupId);
  }, [mode]);

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
    () => (usersQuery.data || []).filter((employee: any) => user?.role !== 'manager' || employee.role === 'employee'),
    [user?.role, usersQuery.data]
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
    queryKey: ['report-workspace-data', mode, startDate, endDate, effectiveSelectedUserId, effectiveSelectedGroupId, timelinePage, hoursPage],
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
        const response = await activityApi.getAll({
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
          group_ids: effectiveSelectedGroupId ? [Number(effectiveSelectedGroupId)] : undefined,
          start_date: startDate,
          end_date: endDate,
          processed: true,
          page: timelinePage,
          per_page: 10,
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
    const presentDays = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.days_present || 0), 0);
    const leaveDays = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.leave_days || 0), 0);
    const workedSeconds = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.worked_seconds || 0), 0);
    const expectedDays = attendanceRows.reduce(
      (sum: number, row: any) => sum + Number(row.calendar_days_in_range || row.working_days_in_range || 0),
      0
    );
    const absentDays = Math.max(0, expectedDays - presentDays - leaveDays);
    const currentWorking = attendanceRows.filter((row: any) => row.is_working).length;
    const averageAttendanceRate = attendanceRows.length
      ? attendanceRows.reduce((sum: number, row: any) => sum + Number(row.attendance_rate || 0), 0) / attendanceRows.length
      : 0;
    return {
      presentDays,
      leaveDays,
      absentDays,
      workedSeconds,
      employees: attendanceRows.length,
      expectedDays,
      currentWorking,
      averageAttendanceRate,
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
    }>();

    attendanceRows.forEach((row: any) => {
      const department = resolveAttendanceDepartment(row);
      const expectedDays = Number(row.calendar_days_in_range || row.working_days_in_range || 0);
      const presentDays = Number(row.days_present || 0);
      const leaveDays = Number(row.leave_days || 0);
      const existing = groupedRows.get(department) || {
        department,
        employees: 0,
        presentDays: 0,
        leaveDays: 0,
        absentDays: 0,
        workedSeconds: 0,
        expectedDays: 0,
        workingNow: 0,
      };

      existing.employees += 1;
      existing.presentDays += presentDays;
      existing.leaveDays += leaveDays;
      existing.absentDays += Math.max(0, expectedDays - presentDays - leaveDays);
      existing.workedSeconds += Number(row.worked_seconds || 0);
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
        const expectedDays = Number(row.calendar_days_in_range || row.working_days_in_range || 0);
        const absentDays = Math.max(0, expectedDays - Number(row.days_present || 0) - Number(row.leave_days || 0));
        return {
          ...row,
          absent_days: absentDays,
          risk_score: absentDays * 10 + Math.max(0, 75 - Number(row.attendance_rate || 0)),
        };
      })
      .filter((row: any) => row.absent_days > 0 || Number(row.attendance_rate || 0) < 80)
      .sort((left: any, right: any) => Number(right.risk_score || 0) - Number(left.risk_score || 0))
      .slice(0, 8);
  }, [attendanceRows, mode]);
  const attendanceRiskRows = useMemo(() => {
    if (mode !== 'attendance') return [];
    return [...attendanceRows]
      .map((row: any) => {
        const expectedDays = Number(row.calendar_days_in_range || row.working_days_in_range || 0);
        const presentDays = Number(row.days_present || 0);
        const leaveDays = Number(row.leave_days || 0);
        const absentDays = Math.max(0, expectedDays - presentDays - leaveDays);
        const rate = Number(row.attendance_rate || 0);
        return {
          ...row,
          absentDays,
          rate,
          risk: clampPercent((100 - rate) + absentDays * 6),
        };
      })
      .sort((left: any, right: any) => Number(right.risk || 0) - Number(left.risk || 0))
      .slice(0, 5);
  }, [attendanceRows, mode]);
  const attendanceDayMatrixRows = useMemo(() => {
    if (mode !== 'attendance') return [];
    return attendanceRows.slice(0, 6).map((row: any) => {
      const expectedDays = Math.max(1, Number(row.calendar_days_in_range || row.working_days_in_range || 0));
      const presentDays = Math.max(0, Number(row.days_present || 0));
      const leaveDays = Math.max(0, Number(row.leave_days || 0));
      return {
        row,
        cells: Array.from({ length: Math.min(14, expectedDays) }, (_, index) => {
          if (index < presentDays) return 'present';
          if (index < presentDays + leaveDays) return 'leave';
          return 'absent';
        }),
      };
    });
  }, [attendanceRows, mode]);

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

  const timelinePayload = mode === 'timeline' && dataQuery.data && !Array.isArray(dataQuery.data)
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
  const timelineSummary = useMemo(() => {
    if (mode !== 'timeline') return null;
    return {
      apps: timelineRows.filter((item: any) => item.type === 'app').length,
      urls: timelineRows.filter((item: any) => item.type === 'url' || item.tool_type === 'website').length,
      idle: timelineRows.filter((item: any) => item.type === 'idle').length,
    };
  }, [mode, timelineRows]);

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

  const catalogItems = mode === 'analytics-hub' ? analyticsCatalogItems : reportCatalogItems;

  if (isHubMode) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow={pageTitle.eyebrow}
          title={pageTitle.title}
          description={pageTitle.description}
        />

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {catalogItems.map((item) => {
            const Icon = item.icon;

            return (
              <Link
                key={item.title}
                to={item.to}
                className="group flex min-h-[172px] flex-col justify-between rounded-lg border border-slate-200 bg-white p-5 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                      {mode === 'analytics-hub' ? 'Analytics' : 'Report'}
                    </p>
                    <p className="mt-2 text-xs font-medium text-slate-500">{item.category}</p>
                    <h2 className="mt-2 text-lg font-semibold text-slate-950">{item.title}</h2>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
                    <div className="mt-4 flex flex-wrap gap-2">
                      {item.highlights.map((highlight) => (
                        <span key={highlight} className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
                          {highlight}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg ring-1 ${item.accent}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                </div>
                <span className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-blue-600 transition group-hover:text-blue-700">
                  Open {item.title}
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <SurfaceCard className="p-5">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Coverage</p>
              <p className="mt-2 text-2xl font-semibold text-slate-950">{catalogItems.length}</p>
              <p className="mt-1 text-sm text-slate-500">
                {mode === 'analytics-hub' ? 'analytics views' : 'report modules'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Primary Use</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {mode === 'analytics-hub' ? 'Understand patterns' : 'Prepare records'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {mode === 'analytics-hub'
                  ? 'Use these views to inspect trends, focus, and usage behavior.'
                  : 'Use these views for attendance, hours, tasks, payroll, and export records.'}
              </p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Data Scope</p>
              <p className="mt-2 text-lg font-semibold text-slate-950">
                {mode === 'analytics-hub' ? 'Live monitoring signals' : 'Operational reports'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                Each tile opens the focused workspace with its own filters and tables.
              </p>
            </div>
          </div>
        </SurfaceCard>
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
            {mode === 'custom-export' ? 'Customize Export' : (isExporting ? 'Exporting...' : 'Export CSV')}
          </Button>
        }
      />

      {exportMessage ? <FeedbackBanner tone="success" message={exportMessage} /> : null}
      {exportError ? <FeedbackBanner tone="error" message={exportError} /> : null}

      {mode === 'custom-export' && customExportModalOpen ? (
        <div className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/60 p-4">
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
          <FieldLabel>Team</FieldLabel>
          <SelectInput value={selectedGroupId} onChange={(event) => setSelectedGroupId(event.target.value ? Number(event.target.value) : '')}>
            <option value="">All groups</option>
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
            <MetricCard label="Absent Days" value={attendanceTotals.absentDays} hint="Expected days not covered by presence or leave" icon={AlertTriangle} accent="rose" />
            <MetricCard label="Worked Time" value={formatDuration(attendanceTotals.workedSeconds)} hint="Tracked attendance time" icon={TimerReset} accent="violet" />
            <MetricCard label="Avg Attendance" value={formatPercent(attendanceTotals.averageAttendanceRate)} hint="Average attendance rate in this scope" icon={Gauge} accent="slate" />
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
                <p className="mt-1 text-xs text-slate-500">{attendanceRiskRows[0]?.user?.name ? `${attendanceRiskRows[0].user.name} currently has the highest attendance risk.` : 'No significant attendance risk detected in this scope.'}</p>
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

            <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#f0fdf4_0%,#ffffff_58%,#f8fafc_100%)] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-950">Attendance Risk Radar</h3>
                    <p className="mt-1 text-xs text-slate-500">Hover rows to inspect the highest absence and low-rate pressure points.</p>
                  </div>
                  <span className="rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-semibold text-white shadow-sm">
                    {formatPercent(attendanceTotals.averageAttendanceRate)}
                  </span>
                </div>
                <div className="mt-5 space-y-3">
                  {attendanceRiskRows.length === 0 ? (
                    <p className="text-sm text-slate-500">No attendance risk rows in this scope.</p>
                  ) : attendanceRiskRows.map((row: any) => (
                    <div key={row.user?.id || row.user?.email || row.user?.name} className="group rounded-lg border border-white/80 bg-white/85 p-3 shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
                      <div className="flex items-center justify-between text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-slate-950">{row.user?.name || 'Unknown employee'}</p>
                          <p className="text-xs text-slate-500">{resolveAttendanceDepartment(row)} | {row.absentDays} absent days</p>
                        </div>
                        <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-semibold text-slate-700 group-hover:bg-emerald-100 group-hover:text-emerald-700">{formatPercent(row.risk)} risk</span>
                      </div>
                      <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-[linear-gradient(90deg,#10b981_0%,#f59e0b_58%,#ef4444_100%)] transition-all duration-500 group-hover:brightness-110" style={{ width: `${Math.max(8, row.risk)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <p className="mt-3 text-xs text-slate-500">Working now</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-950">{attendanceTotals.currentWorking}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-md">
                    <AlertTriangle className="h-5 w-5 text-amber-600" />
                    <p className="mt-3 text-xs text-slate-500">Exception rows</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-950">{attendanceExceptionRows.length}</p>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-4 transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    <p className="mt-3 text-xs text-slate-500">Departments</p>
                    <p className="mt-1 text-2xl font-semibold text-slate-950">{attendanceDepartmentRows.length}</p>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="text-sm font-semibold text-slate-950">Employee Day Matrix</h3>
                  <p className="mt-1 text-xs text-slate-500">Compact day-level pattern: present, leave, and absent signals per employee.</p>
                  <div className="mt-4 space-y-3">
                    {attendanceDayMatrixRows.map(({ row, cells }: any) => (
                      <div key={row.user?.id || row.user?.email || row.user?.name} className="grid grid-cols-[minmax(7rem,0.65fr)_1fr] items-center gap-3">
                        <p className="truncate text-xs font-medium text-slate-700">{row.user?.name || 'Unknown'}</p>
                        <div className="grid grid-cols-7 gap-1 sm:grid-cols-14">
                          {cells.map((cell: string, index: number) => (
                            <span
                              key={`${row.user?.id || row.user?.email || row.user?.name}-${index}`}
                              title={`${row.user?.name || 'Employee'} day ${index + 1}: ${cell}`}
                              className={`h-5 rounded transition duration-200 hover:scale-125 ${
                                cell === 'present' ? 'bg-emerald-500' : cell === 'leave' ? 'bg-amber-400' : 'bg-rose-400'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
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
                { key: 'worked', header: 'Worked', render: (row: any) => formatDuration(row.workedSeconds) },
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
                { key: 'rate', header: 'Rate', render: (row: any) => `${row.attendance_rate}%` },
                { key: 'worked', header: 'Worked', render: (row: any) => formatDuration(row.worked_seconds || 0) },
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
              { key: 'present', header: 'Present', render: (row: any) => `${row.days_present} / ${row.calendar_days_in_range || row.working_days_in_range}` },
              { key: 'leave', header: 'Leave', render: (row: any) => row.leave_days },
              { key: 'attendance_rate', header: 'Attendance %', render: (row: any) => `${row.attendance_rate}%` },
              { key: 'worked', header: 'Worked', render: (row: any) => formatDuration(row.worked_seconds) },
              { key: 'status', header: 'Status', render: (row: any) => (row.is_working ? 'Working' : 'Offline') },
            ]}
          />
        </>
      ) : null}

      {(mode === 'hours-tracked' || mode === 'productivity' || mode === 'custom-export') && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Tracked Time" value={formatDuration(overallSummary.total_duration || 0)} hint="Total duration in range" icon={TimerReset} accent="sky" />
            <MetricCard label="Working Time" value={formatDuration(getWorkingDuration(overallSummary))} hint="Tracked time minus measured idle time" icon={LineChart} accent="emerald" />
            <MetricCard label="Idle Time" value={formatDuration(overallSummary.idle_duration || 0)} hint="Measured idle time inside tracked time" icon={Activity} accent="amber" />
            <MetricCard
              label="Active Users"
              value={overallSummary.active_users || 0}
              hint={mode === 'hours-tracked' && hoursPagination ? `${hoursTotal} users total, ${byUser.length} loaded` : `${overallSummary.users_count || 0} users tracked`}
              icon={Users}
              accent="violet"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="space-y-3">
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
                  { key: 'total', header: 'Tracked', render: (row: any) => formatDuration(row.total_duration || 0) },
                  { key: 'working', header: 'Working', render: (row: any) => formatDuration(getWorkingDuration(row)) },
                  { key: 'idle', header: 'Idle', render: (row: any) => formatDuration(row.idle_duration || 0) },
                  { key: 'idle_pct', header: 'Idle %', render: (row: any) => `${Number(row.idle_percentage || 0).toFixed(1)}%` },
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
            </div>
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
                <div className={`mt-5 space-y-3 ${shouldScrollByDay ? 'max-h-[360px] overflow-y-auto pr-2' : ''}`.trim()}>
                  {byDay.map((item: any) => {
                    const width = Math.max(
                      8,
                      Math.round((Number(item.total_duration || 0) / Math.max(1, ...byDay.map((entry: any) => Number(entry.total_duration || 0)))) * 100)
                    );
                    return (
                      <div key={item.date} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-slate-600">{item.date}</span>
                          <span className="font-medium text-slate-950">{formatDuration(item.total_duration || 0)}</span>
                        </div>
                        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-sky-500" style={{ width: `${width}%` }} />
                        </div>
                      </div>
                    );
                  })}
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
            <MetricCard label="Tracked Time" value={formatDuration(filteredProjectTimeEntries.reduce((sum: number, entry: any) => sum + Number(entry.duration || 0), 0))} hint="Task-linked time in scope" icon={TimerReset} accent="emerald" />
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
                  header: 'Tracked',
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
                { key: 'tracked', header: 'Tracked', render: (row: any) => formatDuration(row.tracked_seconds || 0) },
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
              { key: 'tracked', header: 'Tracked', render: (row: any) => formatDuration(row.tracked_seconds || 0) },
              { key: 'due', header: 'Due Date', render: (row: any) => row.due_date ? row.due_date.split('T')[0] : 'No due date' },
            ]}
          />
        </>
      )}

      {mode === 'timeline' && timelineSummary && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Events" value={timelinePagination.total} hint="All timeline events" icon={Waypoints} accent="sky" />
            <MetricCard label="Apps" value={timelineSummary.apps} hint="Desktop/app events on this page" icon={Activity} accent="emerald" />
            <MetricCard label="Web" value={timelineSummary.urls} hint="Website events on this page" icon={LineChart} accent="violet" />
            <MetricCard label="Idle" value={timelineSummary.idle} hint="Idle periods on this page" icon={TimerReset} accent="amber" />
          </div>

          <div className="space-y-3">
            <DataTable
              title="Activity Timeline"
              description="Recent app, website, and idle events in chronological order."
              rows={timelineRows.slice().sort((a: any, b: any) => +new Date(b.recorded_at) - +new Date(a.recorded_at))}
              emptyMessage="No timeline events found."
              headerAction={renderPanelRefreshButton()}
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
                      {row?.name && row?.name !== formatTimelineToolLabel(row) ? (
                        <p className="text-xs text-slate-500">{row.name}</p>
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
                Page {timelinePagination.currentPage} of {timelinePagination.lastPage} - {timelinePagination.total} events
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
        </>
      )}

      {mode === 'web-app-usage' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={hasSelectedEmployee ? 'Selected Employee' : 'Scope'}
              value={hasSelectedEmployee ? usageData?.selected_user?.name || 'Selected employee' : 'All employees'}
              hint={hasSelectedEmployee ? usageData?.selected_user?.email || 'Using selected employee filter' : selectedGroupId ? 'Team filter selected' : 'Organization-wide view'}
              icon={Users}
              accent="sky"
            />
            <MetricCard label="Worked" value={formatDuration(usageWorkedDuration)} hint={hasSelectedEmployee ? 'Tracked time minus measured idle time' : 'Working time across current scope'} icon={TimerReset} accent="emerald" />
            <MetricCard label="Productive Share" value={`${Number(orgSummary.productive_share || 0).toFixed(1)}%`} hint="Organization average" icon={LineChart} accent="violet" />
            <MetricCard
              label={hasSelectedEmployee ? 'Idle' : 'Employees'}
              value={hasSelectedEmployee ? formatDuration(usageStats.idle_total_duration || 0) : employeeRankings.length}
              hint={hasSelectedEmployee ? 'Selected employee idle time' : 'Employees in current monitoring dataset'}
              icon={Activity}
              accent="amber"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <DataTable
              title={hasSelectedEmployee ? 'Productive Tools' : 'Top Productive Tools'}
              description={hasSelectedEmployee ? 'Top productive websites and apps for the selected employee.' : 'Top productive websites and apps across the current scope.'}
              rows={usageProductiveRows}
              emptyMessage="No productive tool usage found."
              headerAction={renderPanelRefreshButton()}
              bodyClassName={usageProductiveRows.length > 5 ? 'max-h-[320px] overflow-y-auto' : undefined}
              columns={[
                { key: 'label', header: 'Tool', render: (row: any) => row.label },
                { key: 'type', header: 'Type', render: (row: any) => row.type },
                { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.total_duration || 0) },
              ]}
            />
            <DataTable
              title={hasSelectedEmployee ? 'Unproductive Tools' : 'Top Unproductive Tools'}
              description={hasSelectedEmployee ? 'Top unproductive websites and apps for the selected employee.' : 'Top unproductive websites and apps across the current scope.'}
              rows={usageUnproductiveRows}
              emptyMessage="No unproductive tool usage found."
              headerAction={renderPanelRefreshButton()}
              bodyClassName={usageUnproductiveRows.length > 5 ? 'max-h-[320px] overflow-y-auto' : undefined}
              columns={[
                { key: 'label', header: 'Tool', render: (row: any) => row.label },
                { key: 'type', header: 'Type', render: (row: any) => row.type },
                { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.total_duration || 0) },
              ]}
            />
            <DataTable
              title={hasSelectedEmployee ? 'Context-Dependent Tools' : 'Top Context-Dependent Tools'}
              description={hasSelectedEmployee ? 'Tools that need business context for the selected employee.' : 'Tools that need business context across the current scope.'}
              rows={usageContextRows}
              emptyMessage="No context-dependent tool usage found."
              headerAction={renderPanelRefreshButton()}
              bodyClassName={usageContextRows.length > 5 ? 'max-h-[320px] overflow-y-auto' : undefined}
              columns={[
                { key: 'label', header: 'Tool', render: (row: any) => row.label },
                { key: 'type', header: 'Type', render: (row: any) => row.type },
                { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.total_duration || 0) },
              ]}
            />
          </div>

          <DataTable
            title="Top Productive Employees"
            description={hasSelectedEmployee ? 'Employee ranking by productive duration from the current monitoring dataset.' : 'Employee ranking by productive duration across the current monitoring dataset.'}
            rows={employeeRankings}
            emptyMessage="No employee ranking data found."
            headerAction={renderPanelRefreshButton()}
            bodyClassName={employeeRankings.length > 5 ? 'max-h-[320px] overflow-y-auto' : undefined}
            columns={[
              { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
              { key: 'productive_duration', header: 'Productive Time', render: (row: any) => formatDuration(row.productive_duration || 0) },
              { key: 'worked', header: 'Worked', render: (row: any) => formatDuration(getWorkingDuration(row) || row.total_duration || 0) },
              { key: 'matched_users', header: 'Search Pool', render: () => usageMatchedUsers.length },
            ]}
          />
        </>
      )}

      {mode === 'custom-export' ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <SurfaceCard className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Export Scope</h2>
                <p className="mt-1 text-sm text-slate-500">Use the current filters to export the same report range used across dashboards.</p>
              </div>
              {renderPanelRefreshButton()}
            </div>
            <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Date Range</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">{startDate} to {endDate}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Filters</p>
                <p className="mt-2 text-lg font-semibold text-slate-950">
                  {effectiveSelectedUserId ? 'Single employee' : selectedGroupId ? 'Single group' : 'Organization-wide'}
                </p>
              </div>
            </div>
            <div className="mt-5">
              <Button onClick={() => void handleExport()}>
                <Download className="h-4 w-4" />
                Download Current Export
              </Button>
            </div>
          </SurfaceCard>

          <SurfaceCard className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Data Preview</h2>
                <p className="mt-1 text-sm text-slate-500">Current totals from the selected export scope.</p>
              </div>
              {renderPanelRefreshButton()}
            </div>
            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Tracked time</span>
                <span className="font-medium text-slate-950">{formatDuration(overallSummary.total_duration || 0)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Working time</span>
                <span className="font-medium text-slate-950">{formatDuration(getWorkingDuration(overallSummary))}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Idle time</span>
                <span className="font-medium text-slate-950">{formatDuration(overallSummary.idle_duration || 0)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">Active users</span>
                <span className="font-medium text-slate-950">{overallSummary.active_users || 0}</span>
              </div>
            </div>
          </SurfaceCard>
        </div>
      ) : null}

      {mode !== 'custom-export' &&
      mode !== 'attendance' &&
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
