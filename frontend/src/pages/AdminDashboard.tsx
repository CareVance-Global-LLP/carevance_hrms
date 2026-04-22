import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  activityApi,
  attendanceApi,
  attendanceTimeEditApi,
  leaveApi,
  notificationApi,
  payrollApi,
  reportApi,
  reportGroupApi,
  screenshotApi,
  taskApi,
  timeEntryApi,
  userApi,
} from '@/services/api';
import DashboardDetailTabs from '@/components/dashboard/DashboardDetailTabs';
import DashboardFilterBar from '@/components/dashboard/DashboardFilterBar';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import DashboardInsightList from '@/components/dashboard/DashboardInsightList';
import DashboardKPIGrid from '@/components/dashboard/DashboardKPIGrid';
import DashboardTrendCard from '@/components/dashboard/DashboardTrendCard';
import DataTable from '@/components/dashboard/DataTable';
import EmptyStateCard from '@/components/dashboard/EmptyStateCard';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import { FieldLabel, SelectInput, TextInput } from '@/components/ui/FormField';
import { FeedbackBanner, PageErrorState } from '@/components/ui/PageState';
import { useAuth } from '@/contexts/AuthContext';
import { classifyActivityProductivity, normalizeActivityToolLabel } from '@/lib/activityProductivity';
import { deriveDateRangeFromPreset, isDateRangePreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { getWorkingDuration } from '@/lib/timeBreakdown';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { getTimeEntrySubtitle, getTimeEntryTitle } from '@/lib/timeEntryDisplay';
import {
  Activity,
  CalendarClock,
  Camera,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Eye,
  Fingerprint,
  LayoutPanelTop,
  Sparkles,
  Trash2,
  TrendingUp,
  Users,
  X,
} from 'lucide-react';

type DashboardScope = 'organization' | 'employee';

interface PersistedFilterState {
  scope: DashboardScope;
  selectedEmployeeId: number | '';
  datePreset: DateRangePreset;
  startDate: string;
  endDate: string;
  attendanceSearchQuery: string;
  attendanceGroupFilter: number | '';
}

interface LegacyPersistedFilterState extends Partial<PersistedFilterState> {
  selectedUserId?: number | string | null;
}

interface RequestResult<T> {
  value: T;
  warning: string | null;
}

const FILTER_STORAGE_KEY = 'admin-dashboard-filters';
const ATTENDANCE_TABLE_SCROLL_CLASS = 'max-h-[28rem] overflow-y-auto overscroll-contain';

const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};

const formatCurrency = (amount: number, currency = 'INR') =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

const formatDateTime = (value?: string | null) => {
  if (!value) return 'Not available';
  return new Date(value).toLocaleString();
};

const formatShortDate = (value?: string | null) => {
  if (!value) return 'Not available';
  return new Date(value).toLocaleDateString();
};

const percentage = (value: number, total: number) => {
  if (!total) return 0;
  return Math.round((value / total) * 100);
};

const productivityTone = (classification?: string | null) =>
  classification === 'productive'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : classification === 'unproductive'
      ? 'bg-rose-50 text-rose-700 border-rose-200'
      : 'bg-slate-100 text-slate-600 border-slate-200';

const defaultFilters = (): PersistedFilterState => {
  const dates = deriveDateRangeFromPreset('today');
  return {
    scope: 'organization',
    selectedEmployeeId: '',
    datePreset: 'today',
    startDate: dates.startDate,
    endDate: dates.endDate,
    attendanceSearchQuery: '',
    attendanceGroupFilter: '',
  };
};

const readPersistedAdminDashboardFilters = (): PersistedFilterState => {
  const fallback = defaultFilters();
  const parsed = readSessionStorageJson<LegacyPersistedFilterState>(FILTER_STORAGE_KEY);
  if (!parsed) {
    return fallback;
  }

  const datePreset: DateRangePreset = isDateRangePreset(String(parsed.datePreset))
    ? (parsed.datePreset as DateRangePreset)
    : fallback.datePreset;
  const resolvedRange = resolvePersistedDateRange(datePreset, parsed.startDate || fallback.startDate, parsed.endDate || fallback.endDate);
  const selectedEmployeeId = coercePositiveNumber(parsed.selectedEmployeeId ?? parsed.selectedUserId) ?? '';
  const scope: DashboardScope =
    parsed.scope === 'employee' || (parsed.scope == null && selectedEmployeeId !== '')
      ? 'employee'
      : 'organization';

  return {
    scope,
    selectedEmployeeId,
    datePreset,
    startDate: resolvedRange.startDate,
    endDate: resolvedRange.endDate,
    attendanceSearchQuery: typeof parsed.attendanceSearchQuery === 'string' ? parsed.attendanceSearchQuery : fallback.attendanceSearchQuery,
    attendanceGroupFilter: coercePositiveNumber(parsed.attendanceGroupFilter) ?? '',
  };
};

const getRequestWarningMessage = (label: string, error: any) => {
  const message = error?.response?.data?.message || error?.message;
  return message ? `${label}: ${message}` : `${label} is temporarily unavailable.`;
};

const withDashboardFallback = async <T,>(
  label: string,
  request: Promise<any>,
  fallback: T,
  select: (response: any) => T
): Promise<RequestResult<T>> => {
  try {
    const response = await request;
    return {
      value: select(response),
      warning: null,
    };
  } catch (error: any) {
    console.error(`[admin-dashboard] ${label} request failed`, error);
    return {
      value: fallback,
      warning: getRequestWarningMessage(label, error),
    };
  }
};

function DashboardSkeleton() {
  return (
    <div className="space-y-8 animate-pulse">
      <div className="h-52 rounded-[32px] bg-white/75" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-36 rounded-[28px] bg-white/75" />
        ))}
      </div>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <div className="h-80 rounded-[28px] bg-white/75" />
        <div className="h-80 rounded-[28px] bg-white/75" />
      </div>
      <div className="h-96 rounded-[28px] bg-white/75" />
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">{eyebrow}</p>
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-[-0.05em] text-slate-950">{title}</h2>
        <p className="max-w-3xl text-sm text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function StatStrip({
  items,
}: {
  items: Array<{ id: string; label: string; value: string | number; tone?: 'default' | 'warning' | 'good' }>;
}) {
  const toneClass = {
    default: 'bg-slate-50 text-slate-950',
    warning: 'bg-amber-50 text-amber-900',
    good: 'bg-emerald-50 text-emerald-900',
  };

  return (
    <SurfaceCard className="p-4 sm:p-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.id} className={`rounded-[22px] border border-slate-200/80 px-4 py-3 ${toneClass[item.tone || 'default']}`}>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
            <p className="mt-2 text-lg font-semibold tracking-[-0.03em]">{item.value}</p>
          </div>
        ))}
      </div>
    </SurfaceCard>
  );
}

function CompactList({
  title,
  description,
  rows,
  emptyTitle,
  emptyDescription,
}: {
  title: string;
  description: string;
  rows: Array<{ id: string; title: string; subtitle?: string; value?: string }>;
  emptyTitle: string;
  emptyDescription: string;
}) {
  return (
    <SurfaceCard className="p-5">
      <h3 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
      {rows.length === 0 ? (
        <div className="mt-4">
          <EmptyStateCard title={emptyTitle} description={emptyDescription} icon={LayoutPanelTop} />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-3 rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-slate-950">{row.title}</p>
                {row.subtitle ? <p className="mt-1 text-sm text-slate-500">{row.subtitle}</p> : null}
              </div>
              {row.value ? <span className="shrink-0 text-sm font-semibold text-slate-950">{row.value}</span> : null}
            </div>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}

export default function AdminDashboard() {
  const { user } = useAuth();
  const canDeleteScreenshots = user?.role === 'admin';
  const [filters, setFilters] = useState<PersistedFilterState>(() => readPersistedAdminDashboardFilters());
  const [exportFeedback, setExportFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isScreenshotManagerOpen, setIsScreenshotManagerOpen] = useState(false);
  const [screenshotManagerPage, setScreenshotManagerPage] = useState(1);
  const [selectedScreenshotIds, setSelectedScreenshotIds] = useState<number[]>([]);
  const [screenshotActionFeedback, setScreenshotActionFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(null);
  const [isDeletingScreenshots, setIsDeletingScreenshots] = useState(false);
  const [attendanceSearchQuery, setAttendanceSearchQuery] = useState(filters.attendanceSearchQuery);
  const [attendanceGroupFilter, setAttendanceGroupFilter] = useState<number | ''>(filters.attendanceGroupFilter);

  useEffect(() => {
    writeSessionStorageJson(FILTER_STORAGE_KEY, {
      ...filters,
      selectedUserId: filters.selectedEmployeeId,
      attendanceSearchQuery,
      attendanceGroupFilter,
    } satisfies PersistedFilterState & { selectedUserId: number | '' });
  }, [attendanceGroupFilter, attendanceSearchQuery, filters]);

  useEffect(() => {
    setIsScreenshotManagerOpen(false);
    setScreenshotManagerPage(1);
    setSelectedScreenshotIds([]);
    setScreenshotActionFeedback(null);
  }, [filters.scope, filters.selectedEmployeeId, filters.startDate, filters.endDate]);

  const usersQuery = useQuery({
    queryKey: ['admin-dashboard-users'],
    queryFn: async () => {
      const response = await userApi.getAll({ period: 'all' });
      return (response.data || []).filter((item: any) => item.role !== 'client');
    },
  });

  const organizationUsers = usersQuery.data || [];
  const employees = organizationUsers.filter((item: any) => item.role === 'employee');
  const selectableUsers = useMemo(
    () =>
      organizationUsers.filter((item: any) => {
        if (user?.role === 'manager') {
          return item.role === 'employee';
        }

        return item.role === 'employee' || item.role === 'manager';
      }),
    [organizationUsers, user?.role]
  );

  useEffect(() => {
    if (filters.scope === 'employee' && filters.selectedEmployeeId === '' && selectableUsers.length > 0) {
      setFilters((current) => ({ ...current, selectedEmployeeId: selectableUsers[0].id }));
    }
  }, [filters.scope, filters.selectedEmployeeId, selectableUsers]);

  useEffect(() => {
    if (
      !usersQuery.isSuccess ||
      filters.scope === 'employee' &&
      filters.selectedEmployeeId !== '' &&
      !selectableUsers.some((item: any) => Number(item.id) === Number(filters.selectedEmployeeId))
    ) {
      if (!usersQuery.isSuccess) {
        return;
      }

      setFilters((current) => ({
        ...current,
        selectedEmployeeId: selectableUsers[0]?.id || '',
      }));
    }
  }, [filters.scope, filters.selectedEmployeeId, selectableUsers, usersQuery.isSuccess]);

  const organizationQuery = useQuery({
    queryKey: ['admin-dashboard-organization', filters.startDate, filters.endDate, organizationUsers.map((user: any) => user.id).join(',')],
    enabled: filters.scope === 'organization' && usersQuery.isSuccess,
    queryFn: async () => {
      const payrollMonth = filters.endDate.slice(0, 7);
      const organizationTimeEntryResults = organizationUsers.length === 0
        ? []
        : await Promise.all(
            organizationUsers.map((user: any) =>
              withDashboardFallback(
                `Time entries for ${user.name || 'employee'}`,
                timeEntryApi.getAll({
                  user_id: Number(user.id),
                  start_date: filters.startDate,
                  end_date: filters.endDate,
                  page: 1,
                  per_page: 500,
                }),
                [],
                (response) => response.data?.data || []
              )
            )
          );
      const [
        attendanceResult,
        overallResult,
        insightsResult,
        websiteActivityResult,
        leaveResult,
        timeEditResult,
        payrollResult,
        notificationsResult,
        groupsResult,
        tasksResult,
      ] = await Promise.all([
        withDashboardFallback(
          'Attendance summary',
          attendanceApi.summary({ start_date: filters.startDate, end_date: filters.endDate }),
          { data: [] },
          (response) => response.data || { data: [] }
        ),
        withDashboardFallback(
          'Overall report',
          reportApi.overall({ start_date: filters.startDate, end_date: filters.endDate }),
          { summary: {}, by_user: [], by_day: [] },
          (response) => response.data || { summary: {}, by_user: [], by_day: [] }
        ),
        withDashboardFallback(
          'Employee insights',
          reportApi.employeeInsights({ start_date: filters.startDate, end_date: filters.endDate }),
          {
            organization_summary: {},
            live_monitoring: { employees_active: [], employees_inactive: [], employees_on_leave: [] },
            team_rankings: { by_efficiency: [] },
          },
          (response) => response.data || {
            organization_summary: {},
            live_monitoring: { employees_active: [], employees_inactive: [], employees_on_leave: [] },
            team_rankings: { by_efficiency: [] },
          }
        ),
        withDashboardFallback(
          'Website activity',
          activityApi.getAll({ start_date: filters.startDate, end_date: filters.endDate, type: 'url', page: 1 }),
          [],
          (response) => response.data?.data || []
        ),
        withDashboardFallback(
          'Pending leaves',
          leaveApi.list({ status: 'pending' }),
          [],
          (response) => response.data?.data || []
        ),
        withDashboardFallback(
          'Pending time edits',
          attendanceTimeEditApi.list({ status: 'pending' }),
          [],
          (response) => response.data?.data || []
        ),
        withDashboardFallback(
          'Payroll records',
          payrollApi.getRecords({ payroll_month: payrollMonth }),
          [],
          (response) => response.data?.data || []
        ),
        withDashboardFallback(
          'Notifications',
          notificationApi.list({ limit: 6 }),
          [],
          (response) => response.data?.data || []
        ),
        withDashboardFallback(
          'Groups',
          reportGroupApi.list(),
          [],
          (response) => response.data?.data || []
        ),
        withDashboardFallback(
          'Completed tasks',
          taskApi.getAll({ status: 'done' }),
          [],
          (response) => response.data || []
        ),
      ]);

      const requestWarnings = [
        attendanceResult.warning,
        overallResult.warning,
        insightsResult.warning,
        websiteActivityResult.warning,
        leaveResult.warning,
        timeEditResult.warning,
        payrollResult.warning,
        notificationsResult.warning,
        groupsResult.warning,
        tasksResult.warning,
      ].filter(Boolean) as string[];

      const failedTimeEntryRequests = organizationTimeEntryResults.filter((result) => result.warning).length;
      if (failedTimeEntryRequests > 0) {
        requestWarnings.push(
          `Time entries are unavailable for ${failedTimeEntryRequests} employee${failedTimeEntryRequests === 1 ? '' : 's'}.`
        );
      }

      return {
        attendance: attendanceResult.value,
        overall: overallResult.value,
        insights: insightsResult.value,
        websiteActivity: websiteActivityResult.value,
        timeEntries: organizationTimeEntryResults.flatMap((result) => result.value),
        pendingLeaves: leaveResult.value,
        pendingTimeEdits: timeEditResult.value,
        payrollRecords: payrollResult.value,
        notifications: notificationsResult.value,
        groups: groupsResult.value,
        completedTasks: tasksResult.value,
        requestWarnings,
      };
    },
  });

  const employeeQuery = useQuery({
    queryKey: ['admin-dashboard-employee', filters.selectedEmployeeId, filters.startDate, filters.endDate],
    enabled: filters.scope === 'employee' && Boolean(filters.selectedEmployeeId),
    queryFn: async () => {
      const userId = Number(filters.selectedEmployeeId);
      const [
        profileResult,
        insightsResult,
        overallResult,
        timeEntriesResult,
        screenshotsResult,
      ] = await Promise.all([
        withDashboardFallback(
          'Employee profile',
          userApi.getProfile360(userId, { start_date: filters.startDate, end_date: filters.endDate }),
          { summary: {}, status: {} },
          (response) => response.data || { summary: {}, status: {} }
        ),
        withDashboardFallback(
          'Employee insights',
          reportApi.employeeInsights({ start_date: filters.startDate, end_date: filters.endDate, user_id: userId }),
          {
            stats: {},
            selected_user_tools: { productive: [], unproductive: [], neutral: [] },
            live_monitoring: { selected_user: null },
          },
          (response) => response.data || {
            stats: {},
            selected_user_tools: { productive: [], unproductive: [], neutral: [] },
            live_monitoring: { selected_user: null },
          }
        ),
        withDashboardFallback(
          'Employee overall report',
          reportApi.overall({ start_date: filters.startDate, end_date: filters.endDate, user_ids: [userId] }),
          { summary: {}, by_user: [], by_day: [] },
          (response) => response.data || { summary: {}, by_user: [], by_day: [] }
        ),
        withDashboardFallback(
          'Employee time entries',
          timeEntryApi.getAll({ user_id: userId, start_date: filters.startDate, end_date: filters.endDate, page: 1 }),
          [],
          (response) => response.data?.data || []
        ),
        withDashboardFallback(
          'Employee screenshots',
          screenshotApi.getAll({ user_id: userId, start_date: filters.startDate, end_date: filters.endDate, page: 1, per_page: 8 }),
          { data: [], total: 0 },
          (response) => response.data || { data: [], total: 0 }
        ),
      ]);

      const requestWarnings = [
        profileResult.warning,
        insightsResult.warning,
        overallResult.warning,
        timeEntriesResult.warning,
        screenshotsResult.warning,
      ].filter(Boolean) as string[];

      return {
        profile: profileResult.value,
        insights: insightsResult.value,
        overall: overallResult.value,
        timeEntries: timeEntriesResult.value,
        screenshots: screenshotsResult.value?.data || [],
        screenshotsTotal: Number(screenshotsResult.value?.total || screenshotsResult.value?.data?.length || 0),
        requestWarnings,
      };
    },
  });

  const screenshotManagerQuery = useQuery({
    queryKey: ['admin-dashboard-screenshot-gallery', filters.selectedEmployeeId, filters.startDate, filters.endDate, screenshotManagerPage],
    enabled: filters.scope === 'employee' && Boolean(filters.selectedEmployeeId) && isScreenshotManagerOpen,
    queryFn: async () => {
      const userId = Number(filters.selectedEmployeeId);
      const response = await screenshotApi.getAll({
        user_id: userId,
        start_date: filters.startDate,
        end_date: filters.endDate,
        page: screenshotManagerPage,
        per_page: 24,
      });

      return response.data;
    },
  });

  const activeQuery = filters.scope === 'organization' ? organizationQuery : employeeQuery;

  const handleScopeChange = (scope: DashboardScope) => {
    setExportFeedback(null);
    setFilters((current) => ({
      ...current,
      scope,
      selectedEmployeeId:
        scope === 'employee'
          ? current.selectedEmployeeId || selectableUsers[0]?.id || ''
          : current.selectedEmployeeId,
    }));
  };

  const handleDatePresetChange = (preset: DateRangePreset) => {
    setExportFeedback(null);
    if (preset === 'custom') {
      setFilters((current) => ({ ...current, datePreset: preset }));
      return;
    }

    const dates = deriveDateRangeFromPreset(preset);
    setFilters((current) => ({
      ...current,
      datePreset: preset,
      startDate: dates.startDate,
      endDate: dates.endDate,
    }));
  };

  const handleExport = async () => {
    setExportFeedback(null);
    setIsExporting(true);

    try {
      const response = await reportApi.export({
        start_date: filters.startDate,
        end_date: filters.endDate,
        user_ids: filters.scope === 'employee' && filters.selectedEmployeeId ? [Number(filters.selectedEmployeeId)] : undefined,
      });

      const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = blobUrl;
      link.setAttribute('download', `dashboard-${filters.scope}-${filters.startDate}-to-${filters.endDate}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(blobUrl);

      setExportFeedback({ tone: 'success', message: 'Dashboard export completed.' });
    } catch (error: any) {
      setExportFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Failed to export dashboard data.',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const openScreenshotManager = () => {
    setScreenshotActionFeedback(null);
    setSelectedScreenshotIds([]);
    setScreenshotManagerPage(1);
    setIsScreenshotManagerOpen(true);
  };

  const closeScreenshotManager = () => {
    setIsScreenshotManagerOpen(false);
    setSelectedScreenshotIds([]);
    setScreenshotActionFeedback(null);
  };

  if (usersQuery.isLoading || activeQuery.isLoading) {
    return <DashboardSkeleton />;
  }

  if (usersQuery.isError || activeQuery.isError) {
    return (
      <PageErrorState
        message={
          (usersQuery.error as any)?.response?.data?.message ||
          (activeQuery.error as any)?.response?.data?.message ||
          'Failed to load the admin dashboard.'
        }
        onRetry={() => {
          void usersQuery.refetch();
          void activeQuery.refetch();
        }}
      />
    );
  }

  if (filters.scope === 'employee' && !filters.selectedEmployeeId) {
    return (
      <div className="space-y-8 pb-6">
        <DashboardHeader
          eyebrow="Admin dashboard"
          title="Employee analytics view"
          description="Switch to a single employee to review attendance, productivity, activity, leave, payroll, and monitoring from one calmer workspace."
        >
          <DashboardFilterBar
            scope={filters.scope}
            onScopeChange={handleScopeChange}
            selectedEmployeeId={filters.selectedEmployeeId}
            onEmployeeChange={(value) => setFilters((current) => ({ ...current, selectedEmployeeId: value }))}
            employees={selectableUsers}
            datePreset={filters.datePreset}
            onDatePresetChange={handleDatePresetChange}
            startDate={filters.startDate}
            endDate={filters.endDate}
            onStartDateChange={(value) => setFilters((current) => ({ ...current, startDate: value, datePreset: 'custom' }))}
            onEndDateChange={(value) => setFilters((current) => ({ ...current, endDate: value, datePreset: 'custom' }))}
            onRefresh={() => void usersQuery.refetch()}
            onExport={handleExport}
            isRefreshing={usersQuery.isFetching}
            isExporting={isExporting}
          />
        </DashboardHeader>
        <EmptyStateCard title="No employees available" description="Add employees first to unlock the single-employee dashboard view." icon={Users} />
      </div>
    );
  }

  const selectedEmployee = selectableUsers.find((employee: any) => Number(employee.id) === Number(filters.selectedEmployeeId)) || null;
  const organizationData: any = organizationQuery.data;
  const employeeData: any = employeeQuery.data;
  const dashboardWarnings = filters.scope === 'organization'
    ? organizationData?.requestWarnings || []
    : employeeData?.requestWarnings || [];
  const dashboardWarningMessage = dashboardWarnings.length === 0
    ? null
    : `${dashboardWarnings.slice(0, 2).join(' ')}${dashboardWarnings.length > 2 ? ' Additional sections may still be unavailable.' : ''}`;

  const attendanceRows = organizationData?.attendance?.data || [];
  const overallSummary = organizationData?.overall?.summary || {};
  const overallByUser = organizationData?.overall?.by_user || [];
  const overallByDay = organizationData?.overall?.by_day || [];
  const organizationSummary = organizationData?.insights?.organization_summary || {};
  const liveMonitoring = organizationData?.insights?.live_monitoring || {
    employees_active: [],
    employees_inactive: [],
    employees_on_leave: [],
  };
  const organizationTimeEntries = organizationData?.timeEntries || [];
  const teamRankings = organizationData?.insights?.team_rankings?.by_efficiency || [];
  const payrollRecords = organizationData?.payrollRecords || [];
  const organizationWebsiteActivity = organizationData?.websiteActivity || [];
  const pendingLeaves = organizationData?.pendingLeaves || [];
  const pendingTimeEdits = organizationData?.pendingTimeEdits || [];
  const notifications = organizationData?.notifications || [];
  const groups = organizationData?.groups || [];
  const completedTasks = organizationData?.completedTasks || [];
  const employeeGroupsById = groups.reduce((map: Record<number, Array<{ id: number; name: string }>>, group: any) => {
    const groupId = Number(group?.id || 0);
    const groupName = String(group?.name || 'Unknown group');

    (group?.users || []).forEach((member: any) => {
      const memberId = Number(member?.id || 0);
      if (!memberId) return;

      const existingGroups = map[memberId] || [];
      if (!existingGroups.some((item) => item.id === groupId)) {
        existingGroups.push({ id: groupId, name: groupName });
      }
      map[memberId] = existingGroups;
    });

    return map;
  }, {});
  const attendanceGroupOptions = groups
    .map((group: any) => ({ id: Number(group?.id || 0), name: String(group?.name || 'Unknown group') }))
    .filter((group: { id: number; name: string }) => group.id > 0)
    .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name));
  const normalizedAttendanceSearch = attendanceSearchQuery.trim().toLowerCase();
  const filteredAttendanceRows = attendanceRows.filter((row: any) => {
    const userId = Number(row.user?.id || row.user_id || 0);
    const employeeName = String(row.user?.name || '').toLowerCase();
    const employeeEmail = String(row.user?.email || '').toLowerCase();
    const assignedGroups = employeeGroupsById[userId] || [];

    const matchesSearch =
      normalizedAttendanceSearch.length === 0 ||
      employeeName.includes(normalizedAttendanceSearch) ||
      employeeEmail.includes(normalizedAttendanceSearch);

    const matchesGroup =
      attendanceGroupFilter === '' ||
      assignedGroups.some((group) => group.id === Number(attendanceGroupFilter));

    return matchesSearch && matchesGroup;
  });
  const presentAttendanceRows = filteredAttendanceRows.filter((row: any) => Number(row.present_days || row.days_present || 0) > 0);
  const absentAttendanceRows = filteredAttendanceRows.filter((row: any) => Number(row.present_days || row.days_present || 0) <= 0);
  const attendanceTimeEntriesByUser = organizationTimeEntries.reduce((map: Record<number, any[]>, entry: any) => {
    const userId = Number(entry?.user_id || entry?.user?.id || 0);
    if (!userId) return map;

    const existingEntries = map[userId] || [];
    existingEntries.push(entry);
    map[userId] = existingEntries;
    return map;
  }, {});
  const attendanceTimerRows = filteredAttendanceRows.map((row: any) => {
    const userId = Number(row.user?.id || row.user_id || 0);
    const userEntries = attendanceTimeEntriesByUser[userId] || [];
    const firstTimerStart = userEntries.reduce((earliest: string | null, entry: any) => {
      const startTime = typeof entry?.start_time === 'string' ? entry.start_time : null;
      if (!startTime) return earliest;
      if (!earliest) return startTime;
      return new Date(startTime).getTime() < new Date(earliest).getTime() ? startTime : earliest;
    }, null);
    const lastTimerEnd = userEntries.reduce((latest: string | null, entry: any) => {
      const endTime = typeof entry?.end_time === 'string' ? entry.end_time : null;
      if (!endTime) return latest;
      if (!latest) return endTime;
      return new Date(endTime).getTime() > new Date(latest).getTime() ? endTime : latest;
    }, null);

    return {
      ...row,
      first_timer_start: firstTimerStart,
      last_timer_end: lastTimerEnd,
      is_timer_running: userEntries.some((entry: any) => !entry?.end_time),
    };
  });
  const presentEmployees = attendanceRows.filter((row: any) => Number(row.present_days || row.days_present || 0) > 0).length;
  const lateEmployees = attendanceRows.filter((row: any) => Number(row.late_days || 0) > 0).length;
  const absentEmployees = Math.max(attendanceRows.length - presentEmployees, 0);
  const topPerformers = [...overallByUser]
    .sort((a: any, b: any) => getWorkingDuration(b) - getWorkingDuration(a))
    .slice(0, 5);
  const attentionEmployees = [...overallByUser]
    .sort((a: any, b: any) => Number(b.idle_percentage || 0) - Number(a.idle_percentage || 0))
    .slice(0, 5);
  const payrollTotal = payrollRecords.reduce((sum: number, row: any) => sum + Number(row.net_salary || 0), 0);
  const payrollPaidCount = payrollRecords.filter((row: any) => row.payroll_status === 'paid').length;
  const totalPendingApprovals = pendingLeaves.length + pendingTimeEdits.length;

  const profile: any = employeeData?.profile;
  const employeeInsights: any = employeeData?.insights;
  const employeeOverall: any = employeeData?.overall;
  const employeeEntries = employeeData?.timeEntries || [];
  const employeeScreenshots = employeeData?.screenshots || [];
  const employeeScreenshotTotal = Number(employeeData?.screenshotsTotal || employeeScreenshots.length || 0);
  const screenshotGallery = screenshotManagerQuery.data;
  const screenshotGalleryItems = screenshotGallery?.data || [];
  const screenshotGalleryTotal = Number(screenshotGallery?.total || employeeScreenshotTotal || 0);
  const screenshotGalleryLastPage = Math.max(1, Number(screenshotGallery?.last_page || 1));
  const screenshotGalleryCurrentPage = Math.max(1, Number(screenshotGallery?.current_page || screenshotManagerPage));
  const visibleScreenshotIds = screenshotGalleryItems.map((shot: any) => Number(shot.id));
  const allVisibleScreenshotsSelected = visibleScreenshotIds.length > 0 && visibleScreenshotIds.every((id: number) => selectedScreenshotIds.includes(id));
  const employeeSummary: any = profile?.summary || {};
  const employeeOverallSummary: any = employeeOverall?.summary || {};
  const employeeStatus: any = profile?.status || {};
  const employeeAssignments: any = profile?.assignments || {};
  const employeeStats: any = employeeInsights?.stats || {};
  const selectedUserTools = employeeInsights?.selected_user_tools || { productive: [], unproductive: [], neutral: [] };
  const employeeTrend = employeeOverall?.by_day || [];
  const employeeProjectBreakdown = profile?.project_breakdown || [];
  const latestAttendance: any = employeeStatus.latest_attendance;
  const employeeLiveMonitoring: any = employeeInsights?.live_monitoring?.selected_user || null;
  const employeeTrackedDuration = Number(employeeOverallSummary.total_duration ?? employeeSummary.total_duration ?? employeeStats.total_duration ?? 0);
  const employeeIdleDuration = Number(employeeOverallSummary.idle_duration ?? employeeSummary.idle_duration ?? employeeStats.idle_total_duration ?? 0);
  const employeeWorkingDuration = Number(employeeOverallSummary.working_duration ?? employeeSummary.working_duration ?? getWorkingDuration(employeeOverallSummary.total_duration ? employeeOverallSummary : employeeSummary));
  const employeePresentDays = Number(employeeSummary.present_days || 0);
  const employeeAbsentDays = Number(employeeSummary.absent_days ?? Math.max(Number(employeeSummary.attendance_days || 0) - employeePresentDays, 0));
  const employeeLateDays = Number(employeeSummary.late_days || 0);
  const employeeAttendancePercentage = percentage(employeePresentDays, employeePresentDays + employeeAbsentDays);
  const employeeProductivity = percentage(
    employeeWorkingDuration,
    employeeTrackedDuration
  );
  const toolMix = {
    productive: Number(selectedUserTools.productive?.reduce((sum: number, item: any) => sum + Number(item.total_duration || 0), 0) || 0),
    unproductive: Number(selectedUserTools.unproductive?.reduce((sum: number, item: any) => sum + Number(item.total_duration || 0), 0) || 0),
    neutral: Number(selectedUserTools.neutral?.reduce((sum: number, item: any) => sum + Number(item.total_duration || 0), 0) || 0),
  };
  const employeeGroupNames = (employeeAssignments.groups || []).map((group: any) => group.name).filter(Boolean);
  const primaryGroupName = employeeAssignments.primary_group?.name || employeeGroupNames[0] || 'Not assigned';
  const reportingManager = employeeAssignments.reporting_manager || null;
  const assignedProjects = employeeAssignments.assigned_projects || [];

  const toggleScreenshotSelection = (screenshotId: number) => {
    setSelectedScreenshotIds((current) =>
      current.includes(screenshotId)
        ? current.filter((id) => id !== screenshotId)
        : [...current, screenshotId]
    );
  };

  const toggleVisibleScreenshotSelection = () => {
    setSelectedScreenshotIds((current) => {
      if (allVisibleScreenshotsSelected) {
        return current.filter((id) => !visibleScreenshotIds.includes(id));
      }

      return Array.from(new Set([...current, ...visibleScreenshotIds]));
    });
  };

  const refreshScreenshotViews = async () => {
    await employeeQuery.refetch();
    if (isScreenshotManagerOpen) {
      await screenshotManagerQuery.refetch();
    }
  };

  const handleDeleteSelectedScreenshots = async () => {
    if (selectedScreenshotIds.length === 0) {
      return;
    }

    if (!confirm(`Delete ${selectedScreenshotIds.length} selected screenshot${selectedScreenshotIds.length === 1 ? '' : 's'}?`)) {
      return;
    }

    setIsDeletingScreenshots(true);
    setScreenshotActionFeedback(null);

    try {
      const response = await screenshotApi.bulkDelete({
        screenshot_ids: selectedScreenshotIds,
      });

      setSelectedScreenshotIds([]);
      setScreenshotManagerPage(1);
      await refreshScreenshotViews();
      setScreenshotActionFeedback({
        tone: 'success',
        message: response.data?.message || `${selectedScreenshotIds.length} screenshots deleted.`,
      });
    } catch (error: any) {
      setScreenshotActionFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Failed to delete selected screenshots.',
      });
    } finally {
      setIsDeletingScreenshots(false);
    }
  };

  const handleDeleteAllScreenshotsInRange = async () => {
    if (!filters.selectedEmployeeId || employeeScreenshotTotal <= 0) {
      return;
    }

    if (!confirm(`Delete all ${employeeScreenshotTotal} screenshot${employeeScreenshotTotal === 1 ? '' : 's'} for this employee in the current date range?`)) {
      return;
    }

    setIsDeletingScreenshots(true);
    setScreenshotActionFeedback(null);

    try {
      const response = await screenshotApi.bulkDelete({
        delete_all_in_range: true,
        user_id: Number(filters.selectedEmployeeId),
        start_date: filters.startDate,
        end_date: filters.endDate,
      });

      setSelectedScreenshotIds([]);
      setScreenshotManagerPage(1);
      await refreshScreenshotViews();
      setScreenshotActionFeedback({
        tone: 'success',
        message: response.data?.message || 'All screenshots in the selected range were deleted.',
      });
    } catch (error: any) {
      setScreenshotActionFeedback({
        tone: 'error',
        message: error?.response?.data?.message || 'Failed to delete screenshots in the current range.',
      });
    } finally {
      setIsDeletingScreenshots(false);
    }
  };
  const websiteUsageByEmployee = organizationWebsiteActivity.reduce((rows: any[], item: any) => {
    const website = normalizeActivityToolLabel(item.name || '', item.type || 'url');
    const employeeName = item.user?.name || 'Unknown';
    const classification = classifyActivityProductivity(website, item.type || 'url');
    const existing = rows.find((row) => row.employeeName === employeeName && row.website === website && row.classification === classification);

    if (existing) {
      
      existing.duration += Number(item.duration || 0);
      existing.events += 1;
      existing.lastUsedAt =
        item.recorded_at && (!existing.lastUsedAt || +new Date(item.recorded_at) > +new Date(existing.lastUsedAt))
          ? item.recorded_at
          : existing.lastUsedAt;
      return rows;
    }

    rows.push({
      employeeName,
      website,
      classification,
      duration: Number(item.duration || 0),
      events: 1,
      lastUsedAt: item.recorded_at || null,
    });

    return rows;
  }, []).sort((a: any, b: any) => Number(b.duration || 0) - Number(a.duration || 0));

  const pageTitle =
    filters.scope === 'organization'
      ? {
          
          title: 'Dashboard',
          
          
        }
      : {
          eyebrow: 'Admin dashboard',
          title: selectedEmployee ? `${selectedEmployee.name} overview` : 'Employee analytics view',
          description: 'A focused employee view that prioritizes status, attendance, productivity, activity, and only then operational detail.',
        };

  return (
    <div className="space-y-8 pb-6">
      <DashboardHeader
        eyebrow={pageTitle.eyebrow}
        title={pageTitle.title}
        titleClassName={filters.scope === 'organization' ? 'text-[2.15rem] sm:text-[2.6rem]' : undefined}
        description={pageTitle.description}
      >
        <DashboardFilterBar
          scope={filters.scope}
          onScopeChange={handleScopeChange}
          selectedEmployeeId={filters.selectedEmployeeId}
          onEmployeeChange={(value) => {
            setExportFeedback(null);
            setFilters((current) => ({ ...current, selectedEmployeeId: value }));
          }}
          employees={selectableUsers}
          datePreset={filters.datePreset}
          onDatePresetChange={handleDatePresetChange}
          startDate={filters.startDate}
          endDate={filters.endDate}
          onStartDateChange={(value) => setFilters((current) => ({ ...current, startDate: value, datePreset: 'custom' }))}
          onEndDateChange={(value) => setFilters((current) => ({ ...current, endDate: value, datePreset: 'custom' }))}
          onRefresh={() => void activeQuery.refetch()}
          onExport={handleExport}
          isRefreshing={activeQuery.isFetching}
          isExporting={isExporting}
        />
      </DashboardHeader>

      {dashboardWarningMessage ? <FeedbackBanner tone="error" message={dashboardWarningMessage} /> : null}
      {exportFeedback ? <FeedbackBanner tone={exportFeedback.tone} message={exportFeedback.message} /> : null}

      {filters.scope === 'organization' ? (
        <>
          <section className="space-y-4">
            <SectionHeader
              eyebrow="Key metrics"
              title="Operational summary"
              description="The most important signals are surfaced first; lower-priority counters stay compressed below."
            />
            <DashboardKPIGrid
              items={[
                {
                  id: 'present',
                  label: 'Present today',
                  value: presentEmployees,
                  caption: `${employees.length} employees in scope`,
                  meta: `${absentEmployees} absent`,
                  icon: CalendarClock,
                  accent: 'emerald',
                },
                {
                  id: 'active-now',
                  label: 'Total active employees',
                  value: liveMonitoring.employees_active?.length || 0,
                  caption: `${liveMonitoring.employees_inactive?.length || 0} inactive right now`,
                  meta: `${liveMonitoring.employees_on_leave?.length || 0} on leave`,
                  icon: Activity,
                  accent: 'sky',
                },
                {
                  id: 'tracked-hours',
                  label: 'Total hours tracked',
                  value: formatDuration(overallSummary.total_duration || 0),
                  caption: `${formatDuration(getWorkingDuration(overallSummary))} working`,
                  meta: `${formatDuration(overallSummary.idle_duration || 0)} idle`,
                  icon: Clock3,
                  accent: 'violet',
                },
                {
                  id: 'avg-productivity',
                  label: 'Average productivity',
                  value: `${Number(organizationSummary.productive_share || 0).toFixed(1)}%`,
                  caption: 'Organization-wide productive share',
                  meta: `${overallSummary.active_users || 0} active users tracked`,
                  icon: TrendingUp,
                  accent: 'amber',
                },
              ]}
              secondaryItems={[
                { id: 'late', label: 'Late check-ins', value: lateEmployees },
                { id: 'approvals', label: 'Pending approvals', value: totalPendingApprovals },
                { id: 'teams', label: 'Departments / groups', value: groups.length },
                { id: 'payroll-ready', label: 'Payroll processed', value: `${payrollPaidCount}/${payrollRecords.length}` },
              ]}
            />
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Trends"
              title="Hours, productivity, and attendance"
              description="Charts get more breathing room so the organization can be understood in a few seconds."
            />
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <DashboardTrendCard
                title="Weekly hours trend"
                description="Tracked duration by day for the selected range."
                points={overallByDay.map((item: any) => ({
                  id: item.date,
                  label: item.date,
                  value: Number(item.total_duration || 0),
                  formattedValue: formatDuration(item.total_duration || 0),
                  hint: `${formatDuration(getWorkingDuration(item))} working`,
                }))}
                colorClassName="bg-sky-500"
              />
              <DashboardTrendCard
                title="Productivity trend"
                description="Working time against idle time using the current reporting dataset."
                points={overallByDay.map((item: any) => ({
                  id: `productivity-${item.date}`,
                  label: item.date,
                  value: getWorkingDuration(item),
                  formattedValue: `${percentage(getWorkingDuration(item), Number(item.total_duration || 0))}%`,
                  hint: `${formatDuration(item.idle_duration || 0)} idle`,
                }))}
                colorClassName="bg-emerald-500"
              />
            </div>
            <SurfaceCard className="p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Attendance trend</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{presentEmployees}</p>
                  <p className="mt-1 text-sm text-slate-500">Employees with attendance in the selected period.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Attention required</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{attentionEmployees.length}</p>
                  <p className="mt-1 text-sm text-slate-500">Employees currently leading idle-share risk.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Completed tasks</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{completedTasks.length}</p>
                  <p className="mt-1 text-sm text-slate-500">Finished tasks returned by the current task API.</p>
                </div>
              </div>
            </SurfaceCard>
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Insights"
              title="Top performers, risks, teams, and alerts"
              description="Only the most useful insight groups stay visible here; detailed records move lower into tabs."
            />
            <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2 2xl:grid-cols-4">
              <DashboardInsightList
                title="Top performers"
                description="Highest working time in the selected range."
                items={topPerformers.map((row: any) => ({
                  id: String(row.user?.id || row.user?.email),
                  title: row.user?.name || 'Unknown',
                  subtitle: `${formatDuration(row.total_duration || 0)} total tracked`,
                  value: formatDuration(getWorkingDuration(row)),
                  tone: 'good',
                }))}
                emptyDescription="No performer data is available for the current selection."
              />
              <DashboardInsightList
                title="Employees needing attention"
                description="Highest idle share in the selected range."
                items={attentionEmployees.map((row: any) => ({
                  id: String(row.user?.id || row.user?.email),
                  title: row.user?.name || 'Unknown',
                  subtitle: `${formatDuration(row.idle_duration || 0)} idle time`,
                  value: `${Number(row.idle_percentage || 0).toFixed(1)}% idle`,
                  tone: Number(row.idle_percentage || 0) > 25 ? 'critical' : 'warning',
                }))}
                emptyDescription="No attention list is available for the current selection."
              />
              <DashboardInsightList
                title="Department summary"
                description="Most efficient groups from the current reporting backend."
                items={teamRankings.slice(0, 4).map((row: any) => ({
                  id: String(row.group?.id || row.group_name || row.name),
                  title: row.group?.name || row.group_name || row.name || 'Unknown group',
                  subtitle: `${row.members_count || 0} members`,
                  value: `${Number(row.efficiency || row.productive_share || 0).toFixed(1)}%`,
                  tone: 'default',
                }))}
                emptyDescription="No department-level summary was returned."
              />
              <DashboardInsightList
                title="Operational alerts"
                description="Approvals and notifications that need an admin eye."
                items={[
                  {
                    id: 'pending-leave',
                    title: 'Pending leave requests',
                    subtitle: 'Awaiting approval workflow action',
                    value: String(pendingLeaves.length),
                    tone: pendingLeaves.length > 0 ? 'warning' : 'default',
                  },
                  {
                    id: 'pending-time-edits',
                    title: 'Pending time edits',
                    subtitle: 'Attendance corrections requiring review',
                    value: String(pendingTimeEdits.length),
                    tone: pendingTimeEdits.length > 0 ? 'warning' : 'default',
                  },
                  {
                    id: 'notifications',
                    title: notifications[0]?.title || 'No new notifications',
                    subtitle: notifications[0]?.message || 'Admin notifications are clear.',
                    value: String(notifications.length),
                    tone: notifications.length > 0 ? 'default' : 'good',
                  },
                ]}
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Detailed records"
              title="Attendance, approvals, payroll, and updates"
              description="Lower-priority operational detail is grouped into tabs so the page stays shorter and easier to scan."
            />
            <DashboardDetailTabs
              title="Operations detail"
              description="View deeper records only when needed."
              tabs={[
                {
                  id: 'attendance',
                  label: 'Attendance',
                  content: (
                    <div className="space-y-4">
                      <SurfaceCard className="p-5">
                        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)_auto] lg:items-end">
                          <div>
                            <FieldLabel>Search employee</FieldLabel>
                            <TextInput
                              value={attendanceSearchQuery}
                              onChange={(event) => setAttendanceSearchQuery(event.target.value)}
                              placeholder="Search by employee name or email"
                            />
                          </div>
                          <div>
                            <FieldLabel>Group filter</FieldLabel>
                            <SelectInput
                              value={attendanceGroupFilter}
                              onChange={(event) => setAttendanceGroupFilter(event.target.value ? Number(event.target.value) : '')}
                            >
                              <option value="">All groups</option>
                              {attendanceGroupOptions.map((group: { id: number; name: string }) => (
                                <option key={group.id} value={group.id}>
                                  {group.name}
                                </option>
                              ))}
                            </SelectInput>
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="rounded-[20px] border border-slate-200/80 bg-slate-50/80 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Matched</p>
                              <p className="mt-2 text-lg font-semibold text-slate-950">{filteredAttendanceRows.length}</p>
                            </div>
                            <div className="rounded-[20px] border border-emerald-200/80 bg-emerald-50/80 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-emerald-700">Present</p>
                              <p className="mt-2 text-lg font-semibold text-emerald-900">{presentAttendanceRows.length}</p>
                            </div>
                            <div className="rounded-[20px] border border-rose-200/80 bg-rose-50/80 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-rose-700">Absent</p>
                              <p className="mt-2 text-lg font-semibold text-rose-900">{absentAttendanceRows.length}</p>
                            </div>
                          </div>
                        </div>
                      </SurfaceCard>

                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <DataTable
                          title="Present employees"
                          description="Employees with at least one present day in the selected range."
                          rows={presentAttendanceRows}
                          emptyMessage="No present employees match the current search or group filter."
                          bodyClassName={ATTENDANCE_TABLE_SCROLL_CLASS}
                          stickyHeader
                          columns={[
                            {
                              key: 'employee',
                              header: 'Employee',
                              render: (row: any) => {
                                const userId = Number(row.user?.id || row.user_id || 0);
                                const assignedGroups = employeeGroupsById[userId] || [];

                                return (
                                  <div>
                                    <p className="font-medium text-slate-950">{row.user?.name || 'Unknown'}</p>
                                    <p className="text-xs text-slate-500">{row.user?.email || 'No email'}</p>
                                    <p className="mt-1 text-xs text-slate-400">
                                      {assignedGroups.length ? assignedGroups.map((group) => group.name).join(', ') : 'No group assigned'}
                                    </p>
                                  </div>
                                );
                              },
                            },
                            { key: 'present', header: 'Present', render: (row: any) => `${row.present_days || row.days_present || 0} day(s)` },
                            { key: 'late', header: 'Late', render: (row: any) => `${row.late_days || 0} day(s)` },
                            { key: 'worked', header: 'Worked', render: (row: any) => formatDuration(row.total_worked_seconds || row.worked_seconds || 0) },
                            { key: 'status', header: 'Working now', render: (row: any) => (row.is_checked_in || row.is_working ? 'Checked in' : 'Offline') },
                          ]}
                        />

                        <DataTable
                          title="Absent employees"
                          description="Employees with no present day recorded in the selected range."
                          rows={absentAttendanceRows}
                          emptyMessage="No absent employees match the current search or group filter."
                          bodyClassName={ATTENDANCE_TABLE_SCROLL_CLASS}
                          stickyHeader
                          columns={[
                            {
                              key: 'employee',
                              header: 'Employee',
                              render: (row: any) => {
                                const userId = Number(row.user?.id || row.user_id || 0);
                                const assignedGroups = employeeGroupsById[userId] || [];

                                return (
                                  <div>
                                    <p className="font-medium text-slate-950">{row.user?.name || 'Unknown'}</p>
                                    <p className="text-xs text-slate-500">{row.user?.email || 'No email'}</p>
                                    <p className="mt-1 text-xs text-slate-400">
                                      {assignedGroups.length ? assignedGroups.map((group) => group.name).join(', ') : 'No group assigned'}
                                    </p>
                                  </div>
                                );
                              },
                            },
                            { key: 'present', header: 'Present', render: (row: any) => `${row.present_days || row.days_present || 0} day(s)` },
                            { key: 'late', header: 'Late', render: (row: any) => `${row.late_days || 0} day(s)` },
                            { key: 'worked', header: 'Worked', render: (row: any) => formatDuration(row.total_worked_seconds || row.worked_seconds || 0) },
                            { key: 'status', header: 'Working now', render: (row: any) => (row.is_checked_in || row.is_working ? 'Checked in' : 'Offline') },
                          ]}
                        />
                      </div>
                    </div>
                  ),
                },
                {
                  id: 'timer-checks',
                  label: 'Check in/out',
                  content: (
                    <DataTable
                      title="Timer check-in / check-out"
                      description="First timer start and most recent timer stop in the selected range."
                      rows={attendanceTimerRows}
                      emptyMessage="No employees match the current search or group filter."
                      bodyClassName={ATTENDANCE_TABLE_SCROLL_CLASS}
                      stickyHeader
                      columns={[
                        {
                          key: 'employee',
                          header: 'Employee',
                          render: (row: any) => (
                            <div>
                              <p className="font-medium text-slate-950">{row.user?.name || 'Unknown'}</p>
                              <p className="text-xs text-slate-500">{row.user?.email || 'No email'}</p>
                            </div>
                          ),
                        },
                        {
                          key: 'check_in',
                          header: 'Check in',
                          render: (row: any) => row.first_timer_start ? (
                            <div>
                              <p className="font-medium text-slate-950">{new Date(row.first_timer_start).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                              <p className="text-xs text-slate-500">{new Date(row.first_timer_start).toLocaleDateString()}</p>
                            </div>
                          ) : 'No start',
                        },
                        {
                          key: 'check_out',
                          header: 'Check out',
                          render: (row: any) => row.last_timer_end ? (
                            <div>
                              <p className="font-medium text-slate-950">{new Date(row.last_timer_end).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                              <p className="text-xs text-slate-500">{new Date(row.last_timer_end).toLocaleDateString()}</p>
                            </div>
                          ) : row.is_timer_running ? 'Still running' : 'No stop',
                        },
                        {
                          key: 'status',
                          header: 'Status',
                          render: (row: any) => row.is_timer_running ? 'Running' : row.last_timer_end ? 'Stopped' : 'No timer',
                        },
                      ]}
                    />
                  ),
                },
                {
                  id: 'approvals',
                  label: 'Approvals',
                  content: (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <CompactList
                        title="Leave approvals"
                        description="Pending leave requests from the existing leave backend."
                        rows={pendingLeaves.slice(0, 5).map((item: any) => ({
                          id: String(item.id),
                          title: item.user?.name || 'Unknown employee',
                          subtitle: `${item.start_date} to ${item.end_date}`,
                          value: item.status || 'pending',
                        }))}
                        emptyTitle="No leave approvals pending"
                        emptyDescription="Leave requests that need action will appear here."
                      />
                      <CompactList
                        title="Time edit approvals"
                        description="Pending attendance corrections."
                        rows={pendingTimeEdits.slice(0, 5).map((item: any) => ({
                          id: String(item.id),
                          title: item.user?.name || 'Unknown employee',
                          subtitle: item.message || `Attendance date ${item.attendance_date}`,
                          value: item.status || 'pending',
                        }))}
                        emptyTitle="No time edits pending"
                        emptyDescription="Attendance corrections that need action will appear here."
                      />
                    </div>
                  ),
                },
                {
                  id: 'payroll',
                  label: 'Payroll',
                  content: payrollRecords.length === 0 ? (
                    <EmptyStateCard
                      title="No payroll snapshot available"
                      description="The current payroll query did not return records for the selected period."
                      icon={CircleDollarSign}
                    />
                  ) : (
                    <div className="space-y-4">
                      <StatStrip
                        items={[
                          { id: 'net-payroll', label: 'Net payroll total', value: formatCurrency(payrollTotal), tone: 'good' },
                          { id: 'paid-count', label: 'Paid records', value: `${payrollPaidCount}/${payrollRecords.length}` },
                          { id: 'completed-tasks', label: 'Completed tasks', value: completedTasks.length },
                          { id: 'groups', label: 'Groups loaded', value: groups.length },
                        ]}
                      />
                      <DataTable
                        title="Payroll records"
                        description="Current month payroll records from the existing payroll backend."
                        rows={payrollRecords.slice(0, 8)}
                        emptyMessage="No payroll records found."
                        columns={[
                          { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || row.employee_name || 'Unknown' },
                          { key: 'month', header: 'Payroll month', render: (row: any) => row.payroll_month || row.period_month || 'N/A' },
                          { key: 'net', header: 'Net salary', render: (row: any) => formatCurrency(row.net_salary || 0, row.currency || 'INR') },
                          { key: 'status', header: 'Status', render: (row: any) => row.payroll_status || row.payment_status || 'pending' },
                        ]}
                      />
                    </div>
                  ),
                },
                {
                  id: 'notifications',
                  label: 'Updates',
                  content: (
                    <CompactList
                      title="Admin notifications"
                      description="Latest admin-facing notifications available to the signed-in user."
                      rows={notifications.map((item: any) => ({
                        id: String(item.id),
                        title: item.title,
                        subtitle: item.message,
                        value: formatShortDate(item.created_at),
                      }))}
                      emptyTitle="No admin notifications"
                      emptyDescription="This admin account has no recent notifications."
                    />
                  ),
                },
                {
                  id: 'monitoring',
                  label: 'Monitoring',
                  content: (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <CompactList
                          title="Live employee activity"
                          description="Current tool and productivity state from live monitoring."
                          rows={(liveMonitoring.all_users || []).slice(0, 6).map((row: any) => ({
                            id: String(row.user?.id || row.user?.email),
                            title: row.user?.name || 'Unknown employee',
                            subtitle: `${row.current_tool || 'No active tool'} • ${row.work_status || 'inactive'}`,
                            value: row.classification || 'neutral',
                          }))}
                          emptyTitle="No live monitoring data"
                          emptyDescription="No employee live activity rows were returned."
                        />
                        <SurfaceCard className="p-5">
                          <h3 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Website usage by employee</h3>
                          <p className="mt-1 text-sm text-slate-500">When all employees are selected, this shows which websites were used and whether they were productive.</p>
                          <div className="mt-4">
                            <DataTable
                              title="Organization website monitoring"
                              description="Per-employee website usage with productivity labels."
                              rows={websiteUsageByEmployee.slice(0, 10)}
                              emptyMessage="No website activity was returned for the selected range."
                              columns={[
                                { key: 'employee', header: 'Employee', render: (row: any) => row.employeeName },
                                { key: 'website', header: 'Website', render: (row: any) => row.website },
                                {
                                  key: 'classification',
                                  header: 'Productivity',
                                  render: (row: any) => (
                                    <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${productivityTone(row.classification)}`}>
                                      {row.classification}
                                    </span>
                                  ),
                                },
                                { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.duration || 0) },
                              ]}
                            />
                          </div>
                        </SurfaceCard>
                      </div>
                    </div>
                  ),
                },
              ]}
            />
          </section>
        </>
      ) : (
        <>
          <section className="space-y-4">
            <SectionHeader
              eyebrow="Employee overview"
              title="Status first, details second"
              description="The employee view prioritizes personal status and productivity before attendance, leave, payroll, or monitoring detail."
            />
            <SurfaceCard className="overflow-hidden border-0 bg-[linear-gradient(135deg,#0f172a_0%,#12314a_42%,#155e75_100%)] p-6 text-white shadow-[0_38px_100px_-48px_rgba(2,6,23,0.92)]">
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.2fr_0.8fr]">
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-white/10 text-xl font-semibold">
                      {selectedEmployee?.name?.charAt(0).toUpperCase() || 'E'}
                    </div>
                    <div>
                      <p className="text-xs uppercase tracking-[0.24em] text-cyan-100/70">Selected employee</p>
                      <h3 className="text-2xl font-semibold tracking-[-0.04em] text-white">{selectedEmployee?.name || 'Employee overview'}</h3>
                      <p className="text-sm text-cyan-50/80">{selectedEmployee?.email || 'No email available'}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                      <p className="text-xs text-cyan-100/70">Today status</p>
                      <p className="mt-2 text-lg font-semibold">
                        {employeeStatus.is_working ? 'Working' : latestAttendance?.status || 'Offline'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                      <p className="text-xs text-cyan-100/70">Current project</p>
                      <p className="mt-2 text-lg font-semibold">{employeeStatus.current_project || 'No active project'}</p>
                    </div>
                    <div className="rounded-2xl border border-white/15 bg-white/10 px-4 py-3">
                      <p className="text-xs text-cyan-100/70">Latest attendance</p>
                      <p className="mt-2 text-lg font-semibold">{formatShortDate(latestAttendance?.attendance_date)}</p>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <p className="text-xs text-cyan-100/70">Tracked time</p>
                    <p className="mt-2 text-2xl font-semibold">{formatDuration(employeeTrackedDuration)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <p className="text-xs text-cyan-100/70">Working time</p>
                    <p className="mt-2 text-2xl font-semibold">{formatDuration(employeeWorkingDuration)}</p>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <p className="text-xs text-cyan-100/70">Productivity</p>
                    <p className="mt-2 text-2xl font-semibold">{employeeProductivity}%</p>
                  </div>
                  <div className="rounded-2xl border border-white/15 bg-white/10 p-4">
                    <p className="text-xs text-cyan-100/70">Idle time</p>
                    <p className="mt-2 text-2xl font-semibold">{formatDuration(employeeIdleDuration)}</p>
                  </div>
                </div>
              </div>
            </SurfaceCard>
            <DashboardKPIGrid
              items={[
                {
                  id: 'today-status',
                  label: 'Today status',
                  value: employeeStatus.is_working ? 'Working' : latestAttendance?.status || 'Offline',
                  caption: employeeStatus.current_project || 'No active project',
                  meta: `Timer started ${formatDateTime(employeeStatus.current_timer_started_at)}`,
                  icon: Fingerprint,
                  accent: 'sky',
                },
                {
                  id: 'worked-hours',
                  label: 'Tracked time',
                  value: formatDuration(employeeTrackedDuration),
                  caption: `${employeeSummary.entries_count || 0} tracked sessions`,
                  meta: `Working ${formatDuration(employeeWorkingDuration)} after idle adjustment`,
                  icon: Clock3,
                  accent: 'emerald',
                },
                {
                  id: 'active-vs-idle',
                  label: 'Working vs idle',
                  value: `${formatDuration(employeeWorkingDuration)} / ${formatDuration(employeeIdleDuration)}`,
                  caption: `Inside ${formatDuration(employeeTrackedDuration)} tracked time`,
                  meta: `${employeeStats.activity_events || 0} activity events`,
                  icon: Sparkles,
                  accent: 'violet',
                },
                {
                  id: 'productivity',
                  label: 'Productivity score',
                  value: `${employeeProductivity}%`,
                  caption: 'Working share in the selected range',
                  meta: `${employeeAttendancePercentage}% attendance in the selected range`,
                  icon: TrendingUp,
                  accent: 'amber',
                },
              ]}
              secondaryItems={[
                { id: 'present-days', label: 'Present days', value: employeePresentDays },
                { id: 'late-days', label: 'Late days', value: employeeLateDays },
                { id: 'approved-leaves', label: 'Approved leaves', value: employeeSummary.approved_leave_days || 0 },
                { id: 'screenshots', label: 'Screenshots', value: employeeScreenshotTotal },
              ]}
            />
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Assignment snapshot"
              title="Group, manager, and project workload"
              description="This makes it easier for admins to inspect who the employee reports to, which group they belong to, and how their tracked work is split across projects."
            />
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-[0.9fr_1.1fr]">
              <SurfaceCard className="p-5 sm:p-6">
                <h3 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Employee assignment</h3>
                <p className="mt-1 text-sm text-slate-500">Current team placement and reporting structure for the selected employee.</p>
                <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Primary group</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{primaryGroupName}</p>
                    <p className="mt-1 text-sm text-slate-500">
                      {employeeGroupNames.length > 1
                        ? `${employeeGroupNames.length} total groups linked`
                        : employeeGroupNames.length === 1
                          ? 'Single active group'
                          : 'No group assigned yet'}
                    </p>
                  </div>
                  <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Reporting manager</p>
                    <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{reportingManager?.name || 'Not assigned'}</p>
                    <p className="mt-1 text-sm text-slate-500">{reportingManager?.email || 'No manager email available'}</p>
                  </div>
                </div>
                <div className="mt-4 rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">All group memberships</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {employeeGroupNames.length > 0 ? (
                      employeeGroupNames.map((name: string) => (
                        <span key={name} className="inline-flex rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-800">
                          {name}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm text-slate-500">No group memberships found.</span>
                    )}
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                  {[
                    { id: 'assigned-projects', label: 'Assigned Projects', value: assignedProjects.length },
                    { id: 'project-breakdown', label: 'Worked Projects', value: employeeProjectBreakdown.length },
                    { id: 'tracked-sessions', label: 'Tracked Sessions', value: employeeSummary.entries_count || 0 },
                    { id: 'tracked-duration', label: 'Tracked Time', value: formatDuration(employeeTrackedDuration) },
                  ].map((item) => (
                    <div key={item.id} className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
                      <p className="mt-2 text-lg font-semibold tracking-[-0.03em] text-slate-950">{item.value}</p>
                    </div>
                  ))}
                </div>
              </SurfaceCard>

              <DataTable
                title="Project-wise work summary"
                description="Projects connected to this employee and how much tracked work was done on each one in the selected date range."
                rows={employeeProjectBreakdown}
                emptyMessage="No project work was found for the selected employee in this range."
                columns={[
                  {
                    key: 'project',
                    header: 'Project',
                    render: (row: any) => (
                      <div>
                        <p className="font-medium text-slate-950">{row.project?.name || 'Unknown project'}</p>
                        <p className="text-xs text-slate-500">
                          {row.project?.status || 'status unknown'}
                          {row.project?.deadline ? ` • deadline ${formatShortDate(row.project.deadline)}` : ''}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: 'tracked_duration',
                    header: 'Worked',
                    render: (row: any) => formatDuration(Number(row.tracked_duration || 0)),
                  },
                  {
                    key: 'entries_count',
                    header: 'Sessions',
                    render: (row: any) => String(row.entries_count || 0),
                  },
                  {
                    key: 'billable_duration',
                    header: 'Billable',
                    render: (row: any) => formatDuration(Number(row.billable_duration || 0)),
                  },
                  {
                    key: 'last_tracked_at',
                    header: 'Last tracked',
                    render: (row: any) => formatDateTime(row.last_tracked_at),
                  },
                ]}
              />
            </div>
            <CompactList
              title="Project assignment list"
              description="Projects that are currently connected to the employee through assignments or tracked work."
              rows={assignedProjects.map((project: any) => ({
                id: String(project.id),
                title: project.name,
                subtitle: `${project.status || 'status unknown'}${project.deadline ? ` • deadline ${formatShortDate(project.deadline)}` : ''}`,
                value:
                  employeeProjectBreakdown.find((item: any) => Number(item.project?.id) === Number(project.id))
                    ? formatDuration(
                        Number(
                          employeeProjectBreakdown.find((item: any) => Number(item.project?.id) === Number(project.id))?.tracked_duration || 0
                        )
                      )
                    : 'No work tracked',
              }))}
              emptyTitle="No project assignments"
              emptyDescription="This employee does not have any project assignments or tracked project work yet."
            />
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Trends"
              title="Attendance and productivity patterns"
              description="The employee mode keeps trends focused on personal progress instead of repeating company-wide cards."
            />
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <DashboardTrendCard
                title="Weekly hours trend"
                description="Daily worked duration for the selected employee."
                points={employeeTrend.map((item: any) => ({
                  id: item.date,
                  label: item.date,
                  value: Number(item.total_duration || 0),
                  formattedValue: formatDuration(item.total_duration || 0),
                  hint: `${formatDuration(getWorkingDuration(item))} working`,
                }))}
                colorClassName="bg-sky-500"
              />
              <DashboardTrendCard
                title="Attendance trend"
                description="Attendance summary for the selected date range."
                points={[
                  {
                    id: 'present-days',
                    label: 'Present days',
                    value: employeePresentDays,
                    formattedValue: String(employeePresentDays),
                  },
                  {
                    id: 'absent-days',
                    label: 'Absent days',
                    value: employeeAbsentDays,
                    formattedValue: String(employeeAbsentDays),
                  },
                  {
                    id: 'late-days',
                    label: 'Late days',
                    value: employeeLateDays,
                    formattedValue: String(employeeLateDays),
                  },
                ]}
                colorClassName="bg-violet-500"
                footer="These counts are now taken from the selected range instead of the month-only attendance snapshot."
              />
            </div>
            <SurfaceCard className="p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Productive usage</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{formatDuration(toolMix.productive)}</p>
                  <p className="mt-1 text-sm text-slate-500">Time spent in productive monitored tools.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Unproductive usage</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{formatDuration(toolMix.unproductive)}</p>
                  <p className="mt-1 text-sm text-slate-500">Time spent in unproductive monitored tools.</p>
                </div>
                <div className="rounded-[24px] border border-slate-200/80 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Neutral usage</p>
                  <p className="mt-2 text-2xl font-semibold tracking-[-0.04em] text-slate-950">{formatDuration(toolMix.neutral)}</p>
                  <p className="mt-1 text-sm text-slate-500">Remaining time that is not categorized either way.</p>
                </div>
              </div>
            </SurfaceCard>
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Insights"
              title="Attendance, performance, activity, and monitoring"
              description="Only the most useful personal insight groups remain at this level."
            />
            <div className="grid grid-cols-1 items-stretch gap-5 xl:grid-cols-2 2xl:grid-cols-4">
              <DashboardInsightList
                title="Attendance"
                description="Current employee attendance context."
                items={[
                  {
                    id: 'attendance-status',
                    title: latestAttendance?.status || 'No current attendance status',
                    subtitle: `Check in ${latestAttendance?.check_in_at ? new Date(latestAttendance.check_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'} / Check out ${latestAttendance?.check_out_at ? new Date(latestAttendance.check_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--'}`,
                    value: `${employeeAttendancePercentage}%`,
                    tone: employeeAttendancePercentage >= 85 ? 'good' : 'warning',
                  },
                  {
                    id: 'late-days',
                    title: 'Late days in range',
                    subtitle: `${filters.startDate} to ${filters.endDate}`,
                    value: String(employeeLateDays),
                    tone: employeeLateDays > 0 ? 'warning' : 'good',
                  },
                ]}
              />
              <DashboardInsightList
                title="Performance"
                description="Work output and latest context."
                items={[
                  {
                    id: 'current-project',
                    title: employeeStatus.current_project || 'No active project',
                    subtitle: `Timer started: ${formatDateTime(employeeStatus.current_timer_started_at)}`,
                    value: employeeStatus.is_working ? 'Active' : 'Inactive',
                    tone: employeeStatus.is_working ? 'good' : 'default',
                  },
                  {
                    id: 'entries',
                    title: `${employeeSummary.entries_count || 0} tracked sessions`,
                    subtitle: `${formatDuration(employeeTrackedDuration)} total tracked`,
                    value: `${employeeProductivity}%`,
                    tone: employeeProductivity >= 70 ? 'good' : 'warning',
                  },
                ]}
              />
              <DashboardInsightList
                title="Activity"
                description="Top productive and unproductive tools."
                items={[
                  ...(selectedUserTools.productive || []).slice(0, 2).map((item: any) => ({
                    id: `productive-${item.label}`,
                    title: item.label,
                    subtitle: `Productive ${item.type}`,
                    value: formatDuration(item.total_duration || 0),
                    tone: 'good' as const,
                  })),
                  ...(selectedUserTools.unproductive || []).slice(0, 2).map((item: any) => ({
                    id: `unproductive-${item.label}`,
                    title: item.label,
                    subtitle: `Unproductive ${item.type}`,
                    value: formatDuration(item.total_duration || 0),
                    tone: 'warning' as const,
                  })),
                ]}
                emptyDescription="No tool-level monitoring data exists for the current selection."
              />
              <DashboardInsightList
                title="Leave and payroll"
                description="Recent approved and pending employee operations."
                items={[
                  ...(profile?.leave_requests || []).slice(0, 2).map((item: any) => ({
                    id: `leave-${item.id}`,
                    title: `${item.start_date} to ${item.end_date}`,
                    subtitle: item.reason || 'No leave reason provided',
                    value: item.status,
                    tone: item.status === 'approved' ? ('good' as const) : item.status === 'pending' ? ('warning' as const) : ('critical' as const),
                  })),
                  ...(profile?.time_edit_requests || []).slice(0, 2).map((item: any) => ({
                    id: `time-edit-${item.id}`,
                    title: `Time edit for ${item.attendance_date}`,
                    subtitle: item.message || 'No message provided',
                    value: item.status,
                    tone: item.status === 'approved' ? ('good' as const) : item.status === 'pending' ? ('warning' as const) : ('critical' as const),
                  })),
                ]}
                emptyDescription="No leave or time edit requests were found for this employee."
              />
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeader
              eyebrow="Detailed records"
              title="Activity, leave, payroll, and monitoring"
              description="Personal records are grouped under meaningful tabs so the employee page does not reveal everything at once."
            />
            <DashboardDetailTabs
              title="Employee detail"
              description="Open the section you need without carrying the full detail load on screen."
              tabs={[
                {
                  id: 'activity',
                  label: 'Activity',
                  content: (
                    <DataTable
                      title="Recent activity timeline"
                      description="Latest tracked sessions for the selected employee."
                      rows={employeeEntries.slice(0, 8)}
                      emptyMessage="No recent time entries were found."
                      columns={[
                        {
                          key: 'project',
                          header: 'Task',
                          render: (row: any) => (
                            <div>
                              <p className="font-medium text-slate-950">{getTimeEntryTitle(row)}</p>
                              <p className="text-xs text-slate-500">{getTimeEntrySubtitle(row)}</p>
                            </div>
                          ),
                        },
                        { key: 'start', header: 'Start', render: (row: any) => formatDateTime(row.start_time) },
                        { key: 'duration', header: 'Worked', render: (row: any) => formatDuration(row.duration || 0) },
                        { key: 'working', header: 'Working', render: (row: any) => (row.billable ? 'Yes' : 'No') },
                      ]}
                    />
                  ),
                },
                {
                  id: 'leave-payroll',
                  label: 'Leave & Payroll',
                  content: (
                    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                      <CompactList
                        title="Leave and approval history"
                        description="Latest leave and time edit actions returned by profile 360."
                        rows={[
                          ...(profile?.leave_requests || []).slice(0, 4).map((item: any) => ({
                            id: `leave-${item.id}`,
                            title: `${item.start_date} to ${item.end_date}`,
                            subtitle: item.reason || 'No leave reason provided',
                            value: item.status,
                          })),
                          ...(profile?.time_edit_requests || []).slice(0, 3).map((item: any) => ({
                            id: `time-edit-${item.id}`,
                            title: `Time edit for ${item.attendance_date}`,
                            subtitle: item.message || 'No message provided',
                            value: item.status,
                          })),
                        ]}
                        emptyTitle="No leave or time edits"
                        emptyDescription="The current employee profile response does not include leave or time edit items."
                      />
                      {(profile?.payslips || []).length === 0 ? (
                        <EmptyStateCard
                          title="No payslip data"
                          description="No payslips were returned for this employee in the current backend response."
                          icon={CircleDollarSign}
                        />
                      ) : (
                        <CompactList
                          title="Payroll snapshot"
                          description="Latest payslips returned by the employee profile response."
                          rows={(profile?.payslips || []).slice(0, 4).map((item: any) => ({
                            id: String(item.id),
                            title: item.period_month,
                            subtitle: item.payment_status || 'pending payment status',
                            value: formatCurrency(item.net_salary || 0, item.currency || 'INR'),
                          }))}
                          emptyTitle="No payslips found"
                          emptyDescription="No payroll records are available for this employee."
                        />
                      )}
                    </div>
                  ),
                },
                {
                  id: 'monitoring',
                  label: 'Monitoring',
                  content: (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                        <CompactList
                          title="Monitoring pulse"
                          description="Signals from the employee monitoring analytics endpoint."
                          rows={[
                            {
                              id: 'event-count',
                              title: 'Recorded activity events',
                              subtitle: 'App, website, and idle event count in the selected range',
                              value: String(employeeStats.activity_events || 0),
                            },
                            {
                              id: 'idle-duration',
                              title: 'Idle duration',
                              subtitle: 'Measured idle time from monitoring analytics',
                              value: formatDuration(employeeStats.idle_total_duration || 0),
                            },
                            {
                              id: 'screenshots-count',
                              title: 'Screenshot captures',
                              subtitle: 'Counted from the screenshots endpoint in the current date range',
                              value: String(employeeScreenshotTotal),
                            },
                          ]}
                          emptyTitle="No monitoring data"
                          emptyDescription="The current monitoring response did not return summary signals."
                        />
                        <SurfaceCard className="p-5">
                          <h3 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Live activity status</h3>
                          <p className="mt-1 text-sm text-slate-500">What this employee is doing right now and whether it is productive.</p>
                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
                            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current tool</p>
                              <p className="mt-2 font-semibold text-slate-950">{employeeLiveMonitoring?.current_tool || 'No active tool detected'}</p>
                              <p className="mt-1 text-sm capitalize text-slate-500">{employeeLiveMonitoring?.tool_type || employeeLiveMonitoring?.activity_type || 'No tool type'}</p>
                            </div>
                            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Work status</p>
                              <p className="mt-2 font-semibold capitalize text-slate-950">{employeeLiveMonitoring?.work_status?.replace('_', ' ') || 'inactive'}</p>
                              <p className="mt-1 text-sm text-slate-500">{employeeLiveMonitoring?.is_working ? 'Timer active now' : 'No active timer right now'}</p>
                            </div>
                            <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                              <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Productivity</p>
                              <div className="mt-2">
                                <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${productivityTone(employeeLiveMonitoring?.classification)}`}>
                                  {employeeLiveMonitoring?.classification || 'neutral'}
                                </span>
                              </div>
                              <p className="mt-2 text-sm text-slate-500">{formatDateTime(employeeLiveMonitoring?.last_activity_at)}</p>
                            </div>
                          </div>
                        </SurfaceCard>
                      </div>
                      <SurfaceCard className="p-5">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div>
                            <h3 className="text-lg font-semibold tracking-[-0.04em] text-slate-950">Employee screenshots</h3>
                            <p className="mt-1 text-sm text-slate-500">
                              Recent captures for the selected employee with image previews.
                              {employeeScreenshotTotal > employeeScreenshots.length
                                ? ` Showing latest ${employeeScreenshots.length} of ${employeeScreenshotTotal}.`
                                : ` ${employeeScreenshotTotal} capture${employeeScreenshotTotal === 1 ? '' : 's'} in range.`}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="secondary"
                              size="sm"
                              iconLeft={<Eye className="h-4 w-4" />}
                              onClick={openScreenshotManager}
                            >
                              View all screenshots
                            </Button>
                            {canDeleteScreenshots ? (
                              <Button
                                variant="danger"
                                size="sm"
                                iconLeft={<Trash2 className="h-4 w-4" />}
                                onClick={handleDeleteAllScreenshotsInRange}
                                disabled={employeeScreenshotTotal === 0 || isDeletingScreenshots}
                              >
                                Delete all in range
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        {employeeScreenshots.length === 0 ? (
                          <div className="mt-4">
                            <EmptyStateCard
                              title="No screenshots found"
                              description="No screenshot captures were returned for this employee in the current date range."
                              icon={Camera}
                            />
                          </div>
                        ) : (
                          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                            {employeeScreenshots.slice(0, 8).map((shot: any) => (
                              <a
                                key={shot.id}
                                href={shot.path}
                                target="_blank"
                                rel="noreferrer"
                                className="overflow-hidden rounded-[22px] border border-slate-200 bg-white transition hover:border-sky-200"
                              >
                                <img src={shot.path} alt={shot.filename || `Screenshot ${shot.id}`} className="h-40 w-full object-cover" />
                                <div className="space-y-1 p-4">
                                  <p className="font-medium text-slate-950">{formatDateTime(shot.recorded_at)}</p>
                                  <p className="text-xs text-slate-500">{shot.filename || 'Captured screenshot'}</p>
                                </div>
                              </a>
                            ))}
                          </div>
                        )}
                      </SurfaceCard>
                    </div>
                  ),
                },
              ]}
            />
          </section>
        </>
      )}

      {isScreenshotManagerOpen ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/55 p-4 backdrop-blur-sm">
          <div className="flex max-h-[92vh] w-full max-w-7xl flex-col overflow-hidden rounded-[32px] border border-white/70 bg-white shadow-[0_36px_120px_-48px_rgba(15,23,42,0.55)]">
            <div className="flex flex-col gap-4 border-b border-slate-200/80 px-6 py-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-sky-700">Screenshot manager</p>
                <h2 className="mt-2 text-2xl font-semibold tracking-[-0.05em] text-slate-950">
                  {selectedEmployee ? `${selectedEmployee.name} screenshots` : 'Employee screenshots'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  Browse the full screenshot gallery for the selected employee in the current date range, then delete selected captures or clear the full filtered set.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                iconLeft={<X className="h-4 w-4" />}
                onClick={closeScreenshotManager}
                className="self-start"
              >
                Close
              </Button>
            </div>

            <div className="border-b border-slate-200/80 px-6 py-4">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Total in range</p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">{screenshotGalleryTotal}</p>
                  </div>
                  {canDeleteScreenshots ? (
                    <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Selected</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">{selectedScreenshotIds.length}</p>
                    </div>
                  ) : null}
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Date range</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{filters.startDate} to {filters.endDate}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {canDeleteScreenshots ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={toggleVisibleScreenshotSelection}
                        disabled={screenshotGalleryItems.length === 0}
                      >
                        {allVisibleScreenshotsSelected ? 'Unselect visible' : 'Select visible'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft={<Trash2 className="h-4 w-4" />}
                        onClick={handleDeleteSelectedScreenshots}
                        disabled={selectedScreenshotIds.length === 0 || isDeletingScreenshots}
                      >
                        Delete selected
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft={<Trash2 className="h-4 w-4" />}
                        onClick={handleDeleteAllScreenshotsInRange}
                        disabled={screenshotGalleryTotal === 0 || isDeletingScreenshots}
                      >
                        Delete all in range
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
              {screenshotActionFeedback ? (
                <div className="mt-4">
                  <FeedbackBanner tone={screenshotActionFeedback.tone} message={screenshotActionFeedback.message} />
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {screenshotManagerQuery.isLoading ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {Array.from({ length: 8 }).map((_, index) => (
                    <div key={index} className="h-72 animate-pulse rounded-[24px] bg-slate-100" />
                  ))}
                </div>
              ) : screenshotManagerQuery.isError ? (
                <EmptyStateCard
                  title="Failed to load screenshots"
                  description={(screenshotManagerQuery.error as any)?.response?.data?.message || 'The full screenshot gallery could not be loaded.'}
                  icon={Camera}
                />
              ) : screenshotGalleryItems.length === 0 ? (
                <EmptyStateCard
                  title="No screenshots in this range"
                  description="No screenshot captures match the selected employee and date range."
                  icon={Camera}
                />
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {screenshotGalleryItems.map((shot: any) => {
                    const isSelected = selectedScreenshotIds.includes(Number(shot.id));

                    return (
                      <div
                        key={shot.id}
                        className={`overflow-hidden rounded-[24px] border bg-white transition ${
                          isSelected ? 'border-sky-300 shadow-[0_18px_40px_-28px_rgba(14,165,233,0.45)]' : 'border-slate-200'
                        }`}
                      >
                        <div className="relative">
                          <img src={shot.path} alt={shot.filename || `Screenshot ${shot.id}`} className="h-48 w-full object-cover" />
                          {canDeleteScreenshots ? (
                            <label className="absolute left-3 top-3 inline-flex items-center gap-2 rounded-full bg-white/92 px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm">
                              <input
                                type="checkbox"
                                className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-400"
                                checked={isSelected}
                                onChange={() => toggleScreenshotSelection(Number(shot.id))}
                              />
                              Select
                            </label>
                          ) : null}
                          <a
                            href={shot.path}
                            target="_blank"
                            rel="noreferrer"
                            className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-950"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Open
                          </a>
                        </div>
                        <div className="space-y-2 p-4">
                          <p className="font-medium text-slate-950">{formatDateTime(shot.recorded_at)}</p>
                          <p className="truncate text-xs text-slate-500" title={shot.filename || 'Captured screenshot'}>
                            {shot.filename || 'Captured screenshot'}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex flex-col gap-3 border-t border-slate-200/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-slate-500">
                Page {screenshotGalleryCurrentPage} of {screenshotGalleryLastPage}
                {screenshotGalleryTotal > 0 ? ` • ${screenshotGalleryTotal} total screenshot${screenshotGalleryTotal === 1 ? '' : 's'}` : ''}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  iconLeft={<ChevronLeft className="h-4 w-4" />}
                  onClick={() => setScreenshotManagerPage((current) => Math.max(1, current - 1))}
                  disabled={screenshotGalleryCurrentPage <= 1 || screenshotManagerQuery.isFetching}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  iconRight={<ChevronRight className="h-4 w-4" />}
                  onClick={() => setScreenshotManagerPage((current) => Math.min(screenshotGalleryLastPage, current + 1))}
                  disabled={screenshotGalleryCurrentPage >= screenshotGalleryLastPage || screenshotManagerQuery.isFetching}
                >
                  Next
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {activeQuery.isFetching ? (
        <div className="rounded-[22px] border border-sky-200 bg-sky-50/80 px-4 py-3 text-sm text-sky-700">
          Dashboard data is refreshing for the current filter selection.
        </div>
      ) : null}

    </div>
  );
}
