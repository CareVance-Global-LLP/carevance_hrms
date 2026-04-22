import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { activityApi, reportApi, screenshotApi, userApi } from '@/services/api';
import DateRangeFields from '@/components/dashboard/DateRangeFields';
import PageHeader from '@/components/dashboard/PageHeader';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import DataTable from '@/components/dashboard/DataTable';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FeedbackBanner, PageEmptyState, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel } from '@/components/ui/FormField';
import { classifyActivityProductivity as classifyProductivity, normalizeActivityToolLabel as normalizeToolLabel } from '@/lib/activityProductivity';
import { deriveDateRangeFromPreset, detectDateRangePreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { Activity, AppWindow, Camera, ChevronLeft, ChevronRight, Eye, Globe, RefreshCw, TimerReset, Trash2, Users } from 'lucide-react';
import type { BrowserTrackingHealthSummary } from '@/types';

type MonitoringWorkspaceMode = 'productive-time' | 'unproductive-time' | 'screenshots' | 'app-usage' | 'website-usage';
type SectionFeedback = {
  tone: 'success' | 'error';
  message: string;
} | null;

type PersistedMonitoringWorkspaceFilters = {
  datePreset: DateRangePreset;
  startDate: string;
  endDate: string;
  query: string;
  selectedUserId: number | '';
};

const MONITORING_WORKSPACE_FILTER_STORAGE_KEY = 'monitoring-workspace-filters';
const getMonitoringWorkspaceFilterStorageKey = (mode: MonitoringWorkspaceMode) => `${MONITORING_WORKSPACE_FILTER_STORAGE_KEY}:${mode}`;
const defaultDateRange = deriveDateRangeFromPreset('today');

const getDefaultMonitoringWorkspaceFilters = (): PersistedMonitoringWorkspaceFilters => ({
  datePreset: 'today',
  startDate: defaultDateRange.startDate,
  endDate: defaultDateRange.endDate,
  query: '',
  selectedUserId: '',
});

const readPersistedMonitoringWorkspaceFilters = (mode: MonitoringWorkspaceMode): PersistedMonitoringWorkspaceFilters => {
  const fallback = getDefaultMonitoringWorkspaceFilters();
  const parsed = readSessionStorageJson<PersistedMonitoringWorkspaceFilters>(getMonitoringWorkspaceFilterStorageKey(mode));

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
    query: typeof parsed.query === 'string' ? parsed.query : fallback.query,
    selectedUserId: coercePositiveNumber(parsed.selectedUserId) ?? '',
  };
};
const formatDuration = (seconds: number) => {
  const safe = Number.isFinite(Number(seconds)) ? Number(seconds) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
};
const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : 'No recent activity');
const productivityTone = (classification?: string | null) =>
  classification === 'productive'
    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
    : classification === 'unproductive'
      ? 'bg-rose-50 text-rose-700 ring-1 ring-rose-200'
      : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200';

const browserTrackingTone = (status?: string | null) =>
  status === 'connected'
    ? 'text-emerald-700'
    : status === 'disconnected' || status === 'disabled'
      ? 'text-amber-700'
      : 'text-slate-950';

const formatBrowserTrackingBrowsers = (summary?: BrowserTrackingHealthSummary | null) => {
  const browsers = Array.isArray(summary?.browsers) ? summary.browsers : [];
  if (!browsers.length) {
    return 'Browser tracking';
  }

  return browsers
    .map((browser) => {
      const normalized = String(browser || '').trim().toLowerCase();
      return normalized ? `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}` : '';
    })
    .filter(Boolean)
    .join(', ');
};

const formatBrowserTrackingStatus = (summary?: BrowserTrackingHealthSummary | null) => {
  switch (String(summary?.status || 'unknown')) {
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Tracking off';
    case 'disabled':
      return 'Bridge offline';
    default:
      return 'Unknown';
  }
};

const shouldPreferWindowTitleForDesktopRow = (item: any) => {
  const appName = String(item?.app_name || '').trim().toLowerCase();
  const windowTitle = String(item?.window_title || '').trim();

  if (!windowTitle) {
    return false;
  }

  return ['explorer.exe', 'windows explorer', 'file explorer'].some((keyword) => appName.includes(keyword));
};

const resolveExactActivityLabel = (item: any, mode: MonitoringWorkspaceMode) => {
  if (mode === 'website-usage') {
    return normalizeToolLabel(item?.name || 'Unknown', item?.type || 'url');
  }

  if (shouldPreferWindowTitleForDesktopRow(item)) {
    return String(item?.window_title || 'Unknown').trim();
  }

  return String(
    item?.app_name
    || item?.name
    || item?.window_title
    || item?.software_name
    || item?.normalized_label
    || 'Unknown'
  ).trim();
};

const formatBrowserTrackingHint = (summary?: BrowserTrackingHealthSummary | null) => {
  const deviceLabel = String(summary?.device_label || '').trim();
  const disconnectReason = String(summary?.disconnect_reason || '').trim().replace(/_/g, ' ');

  switch (String(summary?.status || 'unknown')) {
    case 'connected':
      return [
        formatBrowserTrackingBrowsers(summary),
        deviceLabel ? `active on ${deviceLabel}` : 'exact tracking active',
      ].filter(Boolean).join(' ');
    case 'disconnected':
      return deviceLabel
        ? `${deviceLabel} reported ${disconnectReason || 'extension missing'}`
        : `Extension reported ${disconnectReason || 'missing'}`;
    case 'disabled':
      return deviceLabel
        ? `${deviceLabel} reported ${disconnectReason || 'bridge unavailable'}`
        : `Desktop app reported ${disconnectReason || 'bridge unavailable'}`;
    default:
      return 'No exact browser tracking health reported yet';
  }
};

const modeCopy: Record<MonitoringWorkspaceMode, { title: string; description: string; eyebrow: string }> = {
  'productive-time': {
    eyebrow: 'Monitoring',
    title: 'Productive Time',
    description: 'Review productive duration, top performers, and the organization’s most effective tools.',
  },
  'unproductive-time': {
    eyebrow: 'Monitoring',
    title: 'Unproductive Time',
    description: 'Inspect unproductive duration, low-efficiency teams, and tool usage dragging performance.',
  },
  screenshots: {
    eyebrow: 'Monitoring',
    title: 'Screenshots',
    description: 'Browse captured screenshots across the organization with employee-level filtering.',
  },
  'app-usage': {
    eyebrow: 'Monitoring',
    title: 'App Usage',
    description: 'Track application usage frequency and duration from recorded activity events.',
  },
  'website-usage': {
    eyebrow: 'Monitoring',
    title: 'Website Usage',
    description: 'Track website usage frequency and duration from recorded browsing activity events.',
  },
};
const SCREENSHOT_REFRESH_INTERVAL_MS = 60_000;

export default function MonitoringWorkspace({ mode }: { mode: MonitoringWorkspaceMode }) {
  const { user } = useAuth();
  const canDeleteScreenshots = user?.role === 'admin';
  const navigate = useNavigate();
  const location = useLocation();
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedMonitoringWorkspaceFilters(mode).datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedMonitoringWorkspaceFilters(mode).startDate);
  const [endDate, setEndDate] = useState(() => readPersistedMonitoringWorkspaceFilters(mode).endDate);
  const [query, setQuery] = useState(() => readPersistedMonitoringWorkspaceFilters(mode).query);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>(() => readPersistedMonitoringWorkspaceFilters(mode).selectedUserId);
  const [screenshotPage, setScreenshotPage] = useState(1);
  const [screenshotFeedback, setScreenshotFeedback] = useState<SectionFeedback>(null);
  const [selectedScreenshotIds, setSelectedScreenshotIds] = useState<number[]>([]);
  const [isDeletingScreenshots, setIsDeletingScreenshots] = useState(false);
  const [refreshedScreenshotPaths, setRefreshedScreenshotPaths] = useState<Record<number, string>>({});

  useEffect(() => {
    const persisted = readPersistedMonitoringWorkspaceFilters(mode);
    setDatePreset(persisted.datePreset);
    setStartDate(persisted.startDate);
    setEndDate(persisted.endDate);
    setQuery(persisted.query);
    setSelectedUserId(persisted.selectedUserId);
  }, [mode]);

  useEffect(() => {
    writeSessionStorageJson(
      getMonitoringWorkspaceFilterStorageKey(mode),
      {
        datePreset,
        startDate,
        endDate,
        query,
        selectedUserId,
      } satisfies PersistedMonitoringWorkspaceFilters
    );
  }, [datePreset, endDate, mode, query, selectedUserId, startDate]);

  useEffect(() => {
    if (!location.search) return;

    const params = new URLSearchParams(location.search);
    const nextStartDate = params.get('start');
    const nextEndDate = params.get('end');
    const nextQuery = params.get('q');
    const nextUserId = params.get('user');

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

    if (nextQuery !== null) {
      setQuery(nextQuery);
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
    queryKey: ['monitoring-users'],
    queryFn: async () => {
      const response = await userApi.getAll({ period: 'all' });
      return response.data || [];
    },
  });
  const users = useMemo(
    () => (usersQuery.data || []).filter((employee: any) => user?.role !== 'manager' || employee.role === 'employee'),
    [user?.role, usersQuery.data]
  );
  const effectiveSelectedUserId = useMemo<number | ''>(() => {
    if (selectedUserId === '' || !usersQuery.isSuccess) {
      return selectedUserId;
    }

    return users.some((employee: any) => Number(employee.id) === Number(selectedUserId)) ? selectedUserId : '';
  }, [selectedUserId, users, usersQuery.isSuccess]);
  const hasExplicitEmployeeSelection = effectiveSelectedUserId !== '';
  const screenshotTotalQueryEnabled =
    usersQuery.isSuccess && hasExplicitEmployeeSelection && (mode === 'productive-time' || mode === 'unproductive-time');

  const dataQuery = useQuery({
    queryKey: ['monitoring-workspace-data', mode, startDate, endDate, query, effectiveSelectedUserId, screenshotPage],
    enabled: usersQuery.isSuccess,
    placeholderData: (previousData) => previousData,
    refetchOnWindowFocus: mode === 'screenshots',
    refetchInterval: mode === 'screenshots' ? SCREENSHOT_REFRESH_INTERVAL_MS : false,
    queryFn: async () => {
      if (mode === 'productive-time' || mode === 'unproductive-time') {
        const response = await reportApi.employeeInsights({
          start_date: startDate,
          end_date: endDate,
          q: query || undefined,
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        });
        return response.data;
      }

      if (mode === 'screenshots') {
        const [screenshotsResponse, insightsResponse] = await Promise.all([
          screenshotApi.getAll({
            user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
            start_date: startDate,
            end_date: endDate,
            page: screenshotPage,
            per_page: 24,
          }),
          reportApi.employeeInsights({
            start_date: startDate,
            end_date: endDate,
            q: query || undefined,
            user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
          }),
        ]);

        return {
          screenshotsPage: screenshotsResponse.data || null,
          insights: insightsResponse.data,
        };
      }

      const [activityResponse, insightsResponse] = await Promise.all([
        activityApi.getAll({
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
          type: mode === 'app-usage' ? 'app' : 'url',
          start_date: startDate,
          end_date: endDate,
          page: 1,
        }),
        reportApi.employeeInsights({
          start_date: startDate,
          end_date: endDate,
          q: query || undefined,
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        }),
      ]);

      return {
        activities: activityResponse.data?.data || [],
        insights: insightsResponse.data,
      };
    },
  });

  const screenshotTotalQuery = useQuery({
    queryKey: ['monitoring-screenshot-total', effectiveSelectedUserId, startDate, endDate],
    enabled: screenshotTotalQueryEnabled,
    queryFn: async () => {
      const response = await screenshotApi.getAll({
        user_id: Number(effectiveSelectedUserId),
        start_date: startDate,
        end_date: endDate,
        page: 1,
        per_page: 1,
      });

      return {
        total: Number(response.data?.total || 0),
      };
    },
  });

  const isLoading = usersQuery.isLoading || (dataQuery.isLoading && !dataQuery.data);
  const isError = usersQuery.isError || dataQuery.isError;
  const usersById = useMemo(
    () => new Map(users.map((employee: any) => [Number(employee.id), employee])),
    [users]
  );
  const pageTitle = modeCopy[mode];
  const selectedEmployeeLabel = effectiveSelectedUserId
    ? users.find((employee: any) => Number(employee.id) === Number(effectiveSelectedUserId))?.name || 'Selected employee'
    : 'All employees';

  useEffect(() => {
    if (!usersQuery.isSuccess || selectedUserId === '' || effectiveSelectedUserId !== '') {
      return;
    }

    setSelectedUserId('');

    const params = new URLSearchParams(location.search);
    if (!params.has('user')) {
      return;
    }

    params.delete('user');
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      },
      { replace: true }
    );
  }, [effectiveSelectedUserId, location.pathname, location.search, navigate, selectedUserId, usersQuery.isSuccess]);

  const insights =
    mode === 'productive-time' || mode === 'unproductive-time'
      ? (dataQuery.data as any)
      : (dataQuery.data as any)?.insights || null;
  const screenshotPageData = mode === 'screenshots' ? ((dataQuery.data as any)?.screenshotsPage || null) : null;
  const screenshots = mode === 'screenshots' ? (screenshotPageData?.data || []) : [];
  const screenshotTotal =
    mode === 'screenshots'
      ? Number(screenshotPageData?.total || screenshots.length || 0)
      : Number(screenshotTotalQuery.data?.total || 0);
  const screenshotLastPage = Math.max(1, Number(screenshotPageData?.last_page || 1));
  const screenshotCurrentPage = Math.max(1, Number(screenshotPageData?.current_page || screenshotPage));
  const visibleScreenshotIds = screenshots.map((shot: any) => Number(shot.id));
  const allVisibleScreenshotsSelected =
    visibleScreenshotIds.length > 0 && visibleScreenshotIds.every((id: number) => selectedScreenshotIds.includes(id));
  const activityRows = mode === 'app-usage' || mode === 'website-usage' ? ((dataQuery.data as any)?.activities || []) : [];
  const resolveScreenshotUser = (shot: any) => {
    if (shot?.user?.name) {
      return shot.user;
    }

    const resolvedUserId = Number(shot?.user_id || shot?.time_entry?.user_id || 0);
    return resolvedUserId > 0 ? usersById.get(resolvedUserId) || null : null;
  };
  const resolveScreenshotPath = (shot: any) => {
    const screenshotId = Number(shot?.id || 0);
    const refreshedPath = screenshotId > 0 ? refreshedScreenshotPaths[screenshotId] : '';

    return refreshedPath || String(shot?.path || '');
  };
  const refreshScreenshotPath = async (screenshotId: number) => {
    if (!Number.isFinite(screenshotId) || screenshotId <= 0) {
      return;
    }

    try {
      const response = await screenshotApi.get(screenshotId);
      const nextPath = String(response.data?.path || '').trim();

      if (!nextPath) {
        return;
      }

      setRefreshedScreenshotPaths((current) => (
        current[screenshotId] === nextPath
          ? current
          : { ...current, [screenshotId]: nextPath }
      ));
    } catch (error) {
      console.warn('Failed to refresh screenshot link:', error);
    }
  };

  const aggregatedActivity = useMemo(() => {
    if (mode !== 'app-usage' && mode !== 'website-usage') return [];
    const mapped = new Map<string, { label: string; duration: number; count: number; users: Set<string>; classification: string }>();

    activityRows.forEach((item: any) => {
      const label = resolveExactActivityLabel(item, mode);
      const key = label || 'Unknown';
      const classification = classifyProductivity(label, item.type || (mode === 'website-usage' ? 'url' : 'app'));
      if (!mapped.has(key)) {
        mapped.set(key, { label: key, duration: 0, count: 0, users: new Set(), classification });
      }
      const current = mapped.get(key)!;
      current.duration += Number(item.duration || 0);
      current.count += 1;
      if (item.user?.name) {
        current.users.add(item.user.name);
      }
    });

    return Array.from(mapped.values())
      .map((item) => ({ ...item, user_count: item.users.size }))
      .sort((a, b) => b.duration - a.duration);
  }, [activityRows, mode]);

  const employeeWebsiteRows = useMemo(() => {
    if (mode !== 'website-usage') return [];

    const mapped = new Map<string, { employee: any; website: string; classification: string; duration: number; events: number; last_used_at?: string | null }>();

    activityRows.forEach((item: any) => {
      const employeeId = item.user?.id || 'unknown';
      const website = normalizeToolLabel(item.name || 'Unknown', item.type || 'url');
      const classification = classifyProductivity(website, item.type || 'url');
      const key = `${employeeId}:${website}:${classification}`;

      if (!mapped.has(key)) {
        mapped.set(key, {
          employee: item.user || null,
          website,
          classification,
          duration: 0,
          events: 0,
          last_used_at: item.recorded_at || null,
        });
      }

      const current = mapped.get(key)!;
      current.duration += Number(item.duration || 0);
      current.events += 1;
      if (item.recorded_at && (!current.last_used_at || +new Date(item.recorded_at) > +new Date(current.last_used_at))) {
        current.last_used_at = item.recorded_at;
      }
    });

    return Array.from(mapped.values()).sort((a, b) => b.duration - a.duration);
  }, [activityRows, mode]);

  useEffect(() => {
    setScreenshotFeedback(null);
    setSelectedScreenshotIds([]);
    setIsDeletingScreenshots(false);
    setScreenshotPage(1);
    setRefreshedScreenshotPaths({});
  }, [endDate, mode, query, selectedUserId, startDate]);

  const refreshWorkspaceData = async () => {
    const refreshTasks: Array<Promise<unknown>> = [dataQuery.refetch()];

    if (screenshotTotalQueryEnabled) {
      refreshTasks.push(screenshotTotalQuery.refetch());
    }

    await Promise.all(refreshTasks);
  };

  const renderPanelRefreshButton = () => (
    <Button variant="ghost" size="sm" onClick={() => void refreshWorkspaceData()} iconLeft={<RefreshCw className="h-4 w-4" />}>
      Refresh
    </Button>
  );
  const handleEmployeeFilterChange = (value: number | '') => {
    setSelectedUserId(value);
    setQuery('');
  };

  if (isLoading) {
    return <PageLoadingState label={`Loading ${pageTitle.title.toLowerCase()}...`} />;
  }

  if (isError) {
    return (
      <PageErrorState
        message={(dataQuery.error as any)?.response?.data?.message || (usersQuery.error as any)?.response?.data?.message || 'Failed to load monitoring data.'}
        onRetry={() => {
          void usersQuery.refetch();
          void dataQuery.refetch();
        }}
      />
    );
  }

  const organizationSummary = insights?.organization_summary || {};
  const selectedUserTools = insights?.selected_user_tools || { productive: [], unproductive: [], neutral: [] };
  const organizationTools = insights?.organization_tools || { productive: [], unproductive: [] };
  const employeeRankings = insights?.employee_rankings?.by_productive_duration || [];
  const liveMonitoring = insights?.live_monitoring || { employees_active: [], employees_inactive: [], employees_on_leave: [], selected_user: null, all_users: [] };
  const selectedUserLive = liveMonitoring.selected_user || null;
  const recentEmployeeScreenshots = insights?.recent_screenshots || [];
  const screenshotCountLabel = screenshotTotalQuery.data ? screenshotTotal : recentEmployeeScreenshots.length;
  const topUnproductiveTool = selectedUserTools.unproductive?.[0] || null;
  const productiveTableRows = hasExplicitEmployeeSelection ? selectedUserTools.productive || [] : organizationTools.productive || [];
  const unproductiveTableRows = hasExplicitEmployeeSelection ? selectedUserTools.unproductive || [] : organizationTools.unproductive || [];
  const selectedUserBrowserTracking = (selectedUserLive?.browser_tracking || null) as BrowserTrackingHealthSummary | null;

  const renderBrowserTrackingCard = (browserTracking: BrowserTrackingHealthSummary | null) => (
    <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Browser tracking</p>
      <p className={`mt-2 text-base font-semibold ${browserTrackingTone(browserTracking?.status)}`}>
        {formatBrowserTrackingStatus(browserTracking)}
      </p>
      <p className="mt-1 text-sm text-slate-500">{formatBrowserTrackingHint(browserTracking)}</p>
    </div>
  );

  const openScreenshotGallery = () => {
    if (!hasExplicitEmployeeSelection || !effectiveSelectedUserId || screenshotTotal <= 0) {
      return;
    }

    const params = new URLSearchParams();
    params.set('user', String(effectiveSelectedUserId));
    params.set('start', startDate);
    params.set('end', endDate);

    if (query.trim()) {
      params.set('q', query.trim());
    }

    navigate(`/monitoring/screenshots?${params.toString()}`);
  };

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

  const handleDeleteSelectedScreenshots = async () => {
    if (selectedScreenshotIds.length === 0) {
      return;
    }

    if (!confirm(`Delete ${selectedScreenshotIds.length} selected screenshot${selectedScreenshotIds.length === 1 ? '' : 's'}?`)) {
      return;
    }

    setScreenshotFeedback(null);
    setIsDeletingScreenshots(true);

    try {
      const response = await screenshotApi.bulkDelete({
        screenshot_ids: selectedScreenshotIds,
      });

      setSelectedScreenshotIds([]);
      setScreenshotPage(1);
      await refreshWorkspaceData();
      setScreenshotFeedback({
        tone: 'success',
        message: response.data?.message || `${selectedScreenshotIds.length} screenshots deleted.`,
      });
    } catch (error) {
      console.error('Monitoring workspace selected screenshot delete failed:', error);
      setScreenshotFeedback({
        tone: 'error',
        message: (error as any)?.response?.data?.message || 'Failed to delete selected screenshots.',
      });
    } finally {
      setIsDeletingScreenshots(false);
    }
  };

  const handleDeleteAllScreenshotsInRange = async () => {
    if (!hasExplicitEmployeeSelection || !effectiveSelectedUserId || screenshotTotal <= 0) {
      return;
    }

    if (!confirm(`Delete all ${screenshotTotal} screenshot${screenshotTotal === 1 ? '' : 's'} for this employee in the current date range?`)) {
      return;
    }

    setScreenshotFeedback(null);
    setIsDeletingScreenshots(true);

    try {
      const response = await screenshotApi.bulkDelete({
        delete_all_in_range: true,
        user_id: Number(effectiveSelectedUserId),
        start_date: startDate,
        end_date: endDate,
      });

      setSelectedScreenshotIds([]);
      setScreenshotPage(1);
      await refreshWorkspaceData();
      setScreenshotFeedback({
        tone: 'success',
        message: response.data?.message || 'All screenshots in the selected range were deleted.',
      });
    } catch (error) {
      console.error('Monitoring workspace bulk screenshot delete failed:', error);
      setScreenshotFeedback({
        tone: 'error',
        message: (error as any)?.response?.data?.message || 'Failed to delete screenshots in the current range.',
      });
    } finally {
      setIsDeletingScreenshots(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow={pageTitle.eyebrow} title={pageTitle.title} description={pageTitle.description} />

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
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
        <div>
          <FieldLabel>Employee</FieldLabel>
          <EmployeeSelect employees={users} value={effectiveSelectedUserId} onChange={handleEmployeeFilterChange} includeAllOption />
        </div>
      </FilterPanel>

      {(mode === 'productive-time' || mode === 'unproductive-time') && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard
              label={mode === 'productive-time' ? 'Productive Share' : 'Unproductive Share'}
              value={`${Number(mode === 'productive-time' ? organizationSummary.productive_share || 0 : organizationSummary.unproductive_share || 0).toFixed(1)}%`}
              hint="Organization average"
              icon={Activity}
              accent={mode === 'productive-time' ? 'emerald' : 'amber'}
            />
            <MetricCard
              label="Active Employees"
              value={liveMonitoring.employees_active?.length || 0}
              hint="Currently active now"
              icon={Users}
              accent="sky"
            />
            <MetricCard
              label="Inactive Employees"
              value={liveMonitoring.employees_inactive?.length || 0}
              hint="No recent activity"
              icon={TimerReset}
              accent="violet"
            />
            <MetricCard
              label="On Leave"
              value={liveMonitoring.employees_on_leave?.length || 0}
              hint="Leave approved today"
              icon={Users}
              accent="slate"
            />
          </div>

          {hasExplicitEmployeeSelection && selectedUserLive ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <SurfaceCard className="p-5">
                <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Selected employee live monitoring</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950">{selectedUserLive.user?.name || 'Selected employee'}</h2>
                    <p className="mt-1 text-sm text-slate-500">{selectedUserLive.user?.email || 'No email available'}</p>
                  </div>
                  <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold capitalize ${productivityTone(selectedUserLive.classification)}`}>
                    {selectedUserLive.classification || 'neutral'}
                  </div>
                </div>

                <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current tool</p>
                    <p className="mt-2 text-base font-semibold text-slate-950">{selectedUserLive.current_tool || 'No active tool detected'}</p>
                    <p className="mt-1 text-sm capitalize text-slate-500">{selectedUserLive.tool_type || selectedUserLive.activity_type || 'No tool type'}</p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Work status</p>
                    <p className="mt-2 text-base font-semibold capitalize text-slate-950">{selectedUserLive.work_status?.replace('_', ' ') || 'inactive'}</p>
                    <p className="mt-1 text-sm text-slate-500">{selectedUserLive.is_working ? 'Timer is active right now' : 'No active timer right now'}</p>
                  </div>
                  <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last activity</p>
                    <p className="mt-2 text-base font-semibold text-slate-950">{formatDateTime(selectedUserLive.last_activity_at)}</p>
                    <p className="mt-1 text-sm text-slate-500">Latest captured monitoring event</p>
                  </div>
                  {renderBrowserTrackingCard(selectedUserBrowserTracking)}
                </div>

                <div className="mt-4 rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Top unproductive tool</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{topUnproductiveTool?.label || 'No unproductive tool found'}</p>
                  <p className="mt-1 text-sm text-slate-500">
                    {topUnproductiveTool ? `${topUnproductiveTool.type} • ${formatDuration(topUnproductiveTool.total_duration || 0)}` : 'No unproductive usage in the selected range'}
                  </p>
                </div>
              </SurfaceCard>

              <SurfaceCard className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Recent screenshots</h2>
                    <p className="mt-1 text-sm text-slate-500">Latest screenshot captures for the selected employee.</p>
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                    <span className="text-xs text-slate-500">{screenshotCountLabel} found</span>
                    <Button
                      variant="secondary"
                      size="sm"
                      iconLeft={<Eye className="h-4 w-4" />}
                      onClick={openScreenshotGallery}
                      disabled={screenshotTotal === 0}
                    >
                      View all screenshots
                    </Button>
                    {canDeleteScreenshots ? (
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft={<Trash2 className="h-4 w-4" />}
                        onClick={() => void handleDeleteAllScreenshotsInRange()}
                        disabled={!hasExplicitEmployeeSelection || screenshotTotal === 0 || isDeletingScreenshots}
                      >
                        {isDeletingScreenshots ? 'Deleting...' : 'Delete all in range'}
                      </Button>
                    ) : null}
                    {renderPanelRefreshButton()}
                  </div>
                </div>
                {screenshotFeedback ? (
                  <div className="mt-4">
                    <FeedbackBanner tone={screenshotFeedback.tone} message={screenshotFeedback.message} />
                  </div>
                ) : null}

                {recentEmployeeScreenshots.length === 0 ? (
                  <div className="mt-4">
                    <PageEmptyState title="No screenshots found" description="No recent screenshots were returned for this employee." />
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {recentEmployeeScreenshots.slice(0, 4).map((shot: any) => {
                      const shotPath = resolveScreenshotPath(shot);

                      return (
                        <a
                          key={shot.id}
                          href={shotPath}
                          target="_blank"
                          rel="noreferrer"
                          className="overflow-hidden rounded-[20px] border border-slate-200 bg-white transition hover:border-sky-200"
                        >
                          <img
                            src={shotPath}
                            alt={shot.filename || `Screenshot ${shot.id}`}
                            className="h-36 w-full object-cover"
                            onError={(event) => {
                              if (event.currentTarget.dataset.retrying === 'true') {
                                return;
                              }

                              event.currentTarget.dataset.retrying = 'true';
                              void refreshScreenshotPath(Number(shot.id));
                            }}
                          />
                          <div className="space-y-2 p-3">
                            <p className="text-sm font-medium text-slate-950">{formatDateTime(shot.recorded_at || shot.created_at)}</p>
                            <p className="text-xs text-slate-500">{shot.filename || 'Captured screenshot'}</p>
                          </div>
                        </a>
                      );
                    })}
                  </div>
                )}
              </SurfaceCard>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DataTable
              title={mode === 'productive-time' ? 'Top Productive Tools' : 'Top Unproductive Tools'}
              description={
                hasExplicitEmployeeSelection
                  ? mode === 'productive-time'
                    ? 'Productive tools for the selected employee in the current range.'
                    : 'Unproductive tools for the selected employee in the current range.'
                  : 'Organization-level tool rankings from employee monitoring analytics.'
              }
              rows={mode === 'productive-time' ? productiveTableRows : unproductiveTableRows}
              emptyMessage="No tool analytics found."
              headerAction={renderPanelRefreshButton()}
              columns={[
                { key: 'label', header: 'Tool', render: (row: any) => row.label },
                { key: 'type', header: 'Type', render: (row: any) => row.type },
                { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.total_duration || 0) },
                {
                  key: 'avg',
                  header: hasExplicitEmployeeSelection ? 'Events' : 'Avg / Employee',
                  render: (row: any) => hasExplicitEmployeeSelection ? String(row.total_events || 0) : formatDuration(row.avg_duration_per_employee || 0),
                },
              ]}
            />
            <DataTable
              title={mode === 'productive-time' ? 'Employee Ranking' : 'Selected Employee Risk Tools'}
              description={mode === 'productive-time' ? 'Ranked by productive duration.' : 'Focused view of tools classified as unproductive for the selected employee.'}
              rows={mode === 'productive-time' ? employeeRankings : selectedUserTools.unproductive || []}
              emptyMessage="No ranking data found."
              headerAction={renderPanelRefreshButton()}
              columns={
                mode === 'productive-time'
                  ? [
                      { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
                      { key: 'productive', header: 'Productive Time', render: (row: any) => formatDuration(row.productive_duration || 0) },
                      { key: 'total', header: 'Worked', render: (row: any) => formatDuration(row.total_duration || 0) },
                    ]
                  : [
                      { key: 'tool', header: 'Tool', render: (row: any) => row.label },
                      { key: 'type', header: 'Type', render: (row: any) => row.type },
                      { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.total_duration || 0) },
                    ]
              }
            />
          </div>

          {mode === 'productive-time' ? (
            <DataTable
              title="Top Unproductive Tools"
              description={hasExplicitEmployeeSelection ? 'Unproductive tools for the selected employee in the current range.' : 'Organization-level unproductive tool rankings from employee monitoring analytics.'}
              rows={unproductiveTableRows}
              emptyMessage="No unproductive tool analytics found."
              headerAction={renderPanelRefreshButton()}
              columns={[
                { key: 'label', header: 'Tool', render: (row: any) => row.label },
                { key: 'type', header: 'Type', render: (row: any) => row.type },
                { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.total_duration || 0) },
                { key: 'events', header: 'Events', render: (row: any) => row.total_events || '0' },
              ]}
            />
          ) : null}
        </>
      )}

      {mode === 'screenshots' && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Screenshots" value={screenshotTotal} hint="Total captures in current range" icon={Camera} accent="sky" />
            <MetricCard label="Employees" value={new Set(screenshots.map((item: any) => resolveScreenshotUser(item)?.id || item.user_id).filter(Boolean)).size} hint="Employees with screenshots" icon={Users} accent="emerald" />
            <MetricCard label="Selected Filter" value={selectedEmployeeLabel} hint="Current employee filter" icon={Activity} accent="violet" />
            <MetricCard label="Range" value={`${startDate} to ${endDate}`} hint="Date controls for workspace context" icon={TimerReset} accent="amber" />
          </div>

          {hasExplicitEmployeeSelection && selectedUserLive ? (
            <SurfaceCard className="p-5">
              <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Live monitoring</p>
                  <h2 className="mt-2 text-xl font-semibold tracking-[-0.04em] text-slate-950">{selectedUserLive.user?.name || 'Selected employee'}</h2>
                  <p className="mt-1 text-sm text-slate-500">{selectedUserLive.user?.email || 'No email available'}</p>
                </div>
                <div className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold capitalize ${productivityTone(selectedUserLive.classification)}`}>
                  {selectedUserLive.classification || 'neutral'}
                </div>
              </div>

              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current activity</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{selectedUserLive.current_tool || 'No active tool detected'}</p>
                  <p className="mt-1 text-sm capitalize text-slate-500">{selectedUserLive.tool_type || selectedUserLive.activity_type || 'No tool type'}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Work status</p>
                  <p className="mt-2 text-base font-semibold capitalize text-slate-950">{selectedUserLive.work_status?.replace('_', ' ') || 'inactive'}</p>
                  <p className="mt-1 text-sm text-slate-500">{selectedUserLive.is_working ? 'Timer is active right now' : 'No active timer right now'}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last activity</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{formatDateTime(selectedUserLive.last_activity_at)}</p>
                  <p className="mt-1 text-sm text-slate-500">Latest captured monitoring event</p>
                </div>
                {renderBrowserTrackingCard(selectedUserBrowserTracking)}
              </div>
            </SurfaceCard>
          ) : null}

          {screenshotTotal === 0 ? (
            <PageEmptyState title="No screenshots found" description="Captured screenshots will appear here when available." />
          ) : (
            <SurfaceCard className="p-5">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Total in range</p>
                    <p className="mt-2 text-lg font-semibold text-slate-950">{screenshotTotal}</p>
                  </div>
                  {canDeleteScreenshots ? (
                    <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Selected</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">{selectedScreenshotIds.length}</p>
                    </div>
                  ) : null}
                  <div className="rounded-[22px] border border-slate-200/80 bg-slate-50/70 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Date range</p>
                    <p className="mt-2 text-sm font-semibold text-slate-950">{startDate} to {endDate}</p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 lg:justify-end">
                  {canDeleteScreenshots ? (
                    <>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={toggleVisibleScreenshotSelection}
                        disabled={screenshots.length === 0}
                      >
                        {allVisibleScreenshotsSelected ? 'Unselect visible' : 'Select visible'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft={<Trash2 className="h-4 w-4" />}
                        onClick={() => void handleDeleteSelectedScreenshots()}
                        disabled={selectedScreenshotIds.length === 0 || isDeletingScreenshots}
                      >
                        Delete selected
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        iconLeft={<Trash2 className="h-4 w-4" />}
                        onClick={() => void handleDeleteAllScreenshotsInRange()}
                        disabled={!hasExplicitEmployeeSelection || screenshotTotal === 0 || isDeletingScreenshots}
                      >
                        {isDeletingScreenshots ? 'Deleting...' : 'Delete all in range'}
                      </Button>
                    </>
                  ) : null}
                  {renderPanelRefreshButton()}
                </div>
              </div>
              {screenshotFeedback ? (
                <div className="mt-4">
                  <FeedbackBanner tone={screenshotFeedback.tone} message={screenshotFeedback.message} />
                </div>
              ) : null}
              <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {screenshots.map((shot: any) => {
                  const isSelected = selectedScreenshotIds.includes(Number(shot.id));
                  const screenshotUser = resolveScreenshotUser(shot);
                  const shotPath = resolveScreenshotPath(shot);

                  return (
                    <div
                      key={shot.id}
                      className={`overflow-hidden rounded-[24px] border bg-white transition ${
                        isSelected ? 'border-sky-300 shadow-[0_18px_40px_-28px_rgba(14,165,233,0.45)]' : 'border-slate-200'
                      }`}
                    >
                      <div className="relative">
                        <img
                          src={shotPath}
                          alt={shot.filename || `Screenshot ${shot.id}`}
                          className="h-44 w-full object-cover"
                          onError={(event) => {
                            if (event.currentTarget.dataset.retrying === 'true') {
                              return;
                            }

                            event.currentTarget.dataset.retrying = 'true';
                            void refreshScreenshotPath(Number(shot.id));
                          }}
                        />
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
                          href={shotPath}
                          target="_blank"
                          rel="noreferrer"
                          className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-slate-950/80 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-950"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Open
                        </a>
                      </div>
                      <div className="space-y-2 p-4">
                        <p className="font-medium text-slate-950">{screenshotUser?.name || 'Unknown employee'}</p>
                        <p className="text-xs text-slate-500">{formatDateTime(shot.recorded_at)}</p>
                        <p className="truncate text-xs text-slate-500" title={shot.filename || 'Captured screenshot'}>
                          {shot.filename || 'Captured screenshot'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-col gap-3 border-t border-slate-200/80 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-slate-500">
                  Page {screenshotCurrentPage} of {screenshotLastPage}
                  {screenshotTotal > 0 ? ` • ${screenshotTotal} total screenshot${screenshotTotal === 1 ? '' : 's'}` : ''}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    iconLeft={<ChevronLeft className="h-4 w-4" />}
                    onClick={() => setScreenshotPage((current) => Math.max(1, current - 1))}
                    disabled={screenshotCurrentPage <= 1 || dataQuery.isFetching}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    iconRight={<ChevronRight className="h-4 w-4" />}
                    onClick={() => setScreenshotPage((current) => Math.min(screenshotLastPage, current + 1))}
                    disabled={screenshotCurrentPage >= screenshotLastPage || dataQuery.isFetching}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </SurfaceCard>
          )}
        </>
      )}

      {(mode === 'app-usage' || mode === 'website-usage') && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Tracked Tools" value={aggregatedActivity.length} hint="Unique names in current range" icon={mode === 'app-usage' ? AppWindow : Globe} accent="sky" />
            <MetricCard label="Events" value={activityRows.length} hint="Raw activity events" icon={Activity} accent="emerald" />
            <MetricCard label="Tracked Time" value={formatDuration(activityRows.reduce((sum: number, row: any) => sum + Number(row.duration || 0), 0))} hint="Duration across all events" icon={TimerReset} accent="amber" />
            <MetricCard label="Employees" value={new Set(activityRows.map((row: any) => row.user?.id).filter(Boolean)).size} hint="Employees in result set" icon={Users} accent="violet" />
          </div>

          {hasExplicitEmployeeSelection && selectedUserLive ? (
            <SurfaceCard className="p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Live Activity</h2>
                  <p className="mt-1 text-sm text-slate-500">What the selected employee is doing right now and whether it is productive.</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold capitalize ${productivityTone(selectedUserLive.classification)}`}>
                    {selectedUserLive.classification || 'neutral'}
                  </span>
                  {renderPanelRefreshButton()}
                </div>
              </div>
              <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Employee</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{selectedUserLive.user?.name || 'Unknown'}</p>
                  <p className="mt-1 text-sm text-slate-500">{selectedUserLive.user?.email || 'No email available'}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Current tool</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{selectedUserLive.current_tool || 'No active tool detected'}</p>
                  <p className="mt-1 text-sm capitalize text-slate-500">{selectedUserLive.work_status?.replace('_', ' ') || 'inactive'}</p>
                </div>
                <div className="rounded-[22px] border border-slate-200 bg-slate-50/70 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Last seen</p>
                  <p className="mt-2 text-base font-semibold text-slate-950">{formatDateTime(selectedUserLive.last_activity_at)}</p>
                  <p className="mt-1 text-sm text-slate-500">Most recent monitoring signal</p>
                </div>
                {renderBrowserTrackingCard(selectedUserBrowserTracking)}
              </div>
            </SurfaceCard>
          ) : null}

          <div className={`grid grid-cols-1 gap-5 ${mode === 'website-usage' ? 'xl:grid-cols-2 xl:items-start' : ''}`.trim()}>
            <DataTable
              title={mode === 'app-usage' ? 'Application Usage' : 'Website Usage'}
              description="Aggregated duration, event count, and employee coverage for each tool."
              rows={aggregatedActivity}
              emptyMessage="No activity usage found."
              headerAction={renderPanelRefreshButton()}
              bodyClassName="max-h-[30rem] overflow-y-auto"
              stickyHeader
              columns={[
                { key: 'label', header: 'Name', render: (row: any) => row.label },
                { key: 'classification', header: 'Productivity', render: (row: any) => <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${productivityTone(row.classification)}`}>{row.classification}</span> },
                { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.duration || 0) },
                { key: 'count', header: 'Events', render: (row: any) => row.count },
                { key: 'users', header: 'Employees', render: (row: any) => row.user_count },
              ]}
            />

            {mode === 'website-usage' ? (
              <DataTable
                title={hasExplicitEmployeeSelection ? 'Selected Employee Website Breakdown' : 'Website Usage By Employee'}
                description={
                  hasExplicitEmployeeSelection
                    ? 'Website-by-website productivity view for the selected employee.'
                    : 'All employees, which websites they used, and whether each site was productive or not.'
                }
                rows={employeeWebsiteRows}
                emptyMessage="No website rows found."
                headerAction={renderPanelRefreshButton()}
                bodyClassName="max-h-[30rem] overflow-y-auto"
                stickyHeader
                columns={[
                  { key: 'employee', header: 'Employee', render: (row: any) => row.employee?.name || 'Unknown' },
                  { key: 'website', header: 'Website', render: (row: any) => row.website },
                  { key: 'classification', header: 'Productivity', render: (row: any) => <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${productivityTone(row.classification)}`}>{row.classification}</span> },
                  { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.duration || 0) },
                  { key: 'events', header: 'Events', render: (row: any) => row.events },
                  { key: 'last_used_at', header: 'Last Used', render: (row: any) => formatDateTime(row.last_used_at) },
                ]}
              />
            ) : null}
          </div>

          <DataTable
            title="Raw Activity"
            description="Underlying activity events captured from the monitoring pipeline."
            rows={activityRows.slice().sort((a: any, b: any) => +new Date(b.recorded_at) - +new Date(a.recorded_at))}
            emptyMessage="No raw events found."
            headerAction={renderPanelRefreshButton()}
            bodyClassName="max-h-[34rem] overflow-y-auto"
            stickyHeader
            columns={[
              { key: 'recorded_at', header: 'When', render: (row: any) => new Date(row.recorded_at).toLocaleString() },
              { key: 'employee', header: 'Employee', render: (row: any) => row.user?.name || 'Unknown' },
              { key: 'name', header: 'Name', render: (row: any) => row.name },
              { key: 'classification', header: 'Productivity', render: (row: any) => <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${productivityTone(classifyProductivity(normalizeToolLabel(row.name || '', row.type || 'app'), row.type || 'app'))}`}>{classifyProductivity(normalizeToolLabel(row.name || '', row.type || 'app'), row.type || 'app')}</span> },
              { key: 'duration', header: 'Duration', render: (row: any) => formatDuration(row.duration || 0) },
            ]}
          />
        </>
      )}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => void dataQuery.refetch()}>
          Refresh data
        </Button>
      </div>
    </div>
  );
}
