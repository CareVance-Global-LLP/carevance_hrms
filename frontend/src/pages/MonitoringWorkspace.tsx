import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { activityApi, reportApi, screenshotApi, userApi } from '@/services/api';
import DateRangeFields from '@/components/dashboard/DateRangeFields';
import PageHeader from '@/components/dashboard/PageHeader';
import FilterPanel from '@/components/dashboard/FilterPanel';
import Button from '@/components/ui/Button';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { FeedbackBanner, PageErrorState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel } from '@/components/ui/FormField';
import MonitoringOverview from '@/features/monitoring/MonitoringOverview';
import ScreenshotFilmstrip from '@/features/monitoring/ScreenshotFilmstrip';
import { hasStrictAdminAccess } from '@/lib/permissions';
import { deriveDateRangeFromPreset, detectDateRangePreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { DEFAULT_APP_TIMEZONE, resolveTimeZone } from '@/lib/timezones';
import { todayIso } from '@/lib/formatters';
import { Download, RefreshCw } from 'lucide-react';

type MonitoringWorkspaceMode = 'productive-time' | 'unproductive-time' | 'screenshots';

type SectionFeedback = {
  tone: 'success' | 'error';
  message: string;
} | null;

type PersistedMonitoringWorkspaceFilters = {
  datePreset: DateRangePreset;
  startDate: string;
  endDate: string;
  selectedUserId: number | '';
};

type PendingScreenshotDelete =
  | { kind: 'selected'; count: number }
  | { kind: 'range'; count: number }
  | { kind: 'single'; id: number };

const MONITORING_WORKSPACE_FILTER_STORAGE_KEY = 'monitoring-workspace-filters';
const getMonitoringWorkspaceFilterStorageKey = (mode: MonitoringWorkspaceMode) => `${MONITORING_WORKSPACE_FILTER_STORAGE_KEY}:${mode}`;
const defaultDateRange = deriveDateRangeFromPreset('today');
const SCREENSHOTS_PER_PAGE = 48;
const NEW_SCREENSHOT_POLL_MS = 60_000;

const getDefaultMonitoringWorkspaceFilters = (): PersistedMonitoringWorkspaceFilters => ({
  datePreset: 'today',
  startDate: defaultDateRange.startDate,
  endDate: defaultDateRange.endDate,
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
    selectedUserId: coercePositiveNumber(parsed.selectedUserId) ?? '',
  };
};

const modeCopy: Record<MonitoringWorkspaceMode, { title: string; description: string; eyebrow: string }> = {
  'productive-time': {
    eyebrow: 'Monitoring',
    title: 'Monitoring',
    description: 'Who is working right now, where the tracked time went, and who needs a look.',
  },
  'unproductive-time': {
    eyebrow: 'Monitoring',
    title: 'Monitoring · Unproductive focus',
    description: 'The same command view, ranked and focused on unproductive time.',
  },
  screenshots: {
    eyebrow: 'Monitoring',
    title: 'Screenshots',
    description: 'Captured evidence grouped by person and hour, with each hour’s productivity mix.',
  },
};

export default function MonitoringWorkspace({ mode }: { mode: MonitoringWorkspaceMode }) {
  const { user } = useAuth();
  const canDeleteScreenshots = hasStrictAdminAccess(user);
  const navigate = useNavigate();
  const location = useLocation();
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedMonitoringWorkspaceFilters(mode).datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedMonitoringWorkspaceFilters(mode).startDate);
  const [endDate, setEndDate] = useState(() => readPersistedMonitoringWorkspaceFilters(mode).endDate);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>(() => readPersistedMonitoringWorkspaceFilters(mode).selectedUserId);
  const [screenshotPage, setScreenshotPage] = useState(1);
  const [screenshotFeedback, setScreenshotFeedback] = useState<SectionFeedback>(null);
  const [selectedScreenshotIds, setSelectedScreenshotIds] = useState<number[]>([]);
  const [isDeletingScreenshots, setIsDeletingScreenshots] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<PendingScreenshotDelete | null>(null);
  const [refreshedScreenshotPaths, setRefreshedScreenshotPaths] = useState<Record<number, string>>({});
  // Blob object URLs for screenshot images, keyed by screenshot id. Held in a
  // ref as well as state so the revoke-on-cleanup path can reach them without
  // depending on a stale render closure.
  const [screenshotObjectUrls, setScreenshotObjectUrls] = useState<Record<number, string>>({});
  const screenshotObjectUrlsRef = useRef<Record<number, string>>({});
  const inFlightScreenshotLoadsRef = useRef<Set<number>>(new Set());
  const isMountedRef = useRef(true);
  const [isExporting, setIsExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

  const isOverviewMode = mode === 'productive-time' || mode === 'unproductive-time';

  useEffect(() => {
    const persisted = readPersistedMonitoringWorkspaceFilters(mode);
    setDatePreset(persisted.datePreset);
    setStartDate(persisted.startDate);
    setEndDate(persisted.endDate);
    setSelectedUserId(persisted.selectedUserId);
  }, [mode]);

  useEffect(() => {
    writeSessionStorageJson(
      getMonitoringWorkspaceFilterStorageKey(mode),
      {
        datePreset,
        startDate,
        endDate,
        selectedUserId,
      } satisfies PersistedMonitoringWorkspaceFilters
    );
  }, [datePreset, endDate, mode, selectedUserId, startDate]);

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
    queryKey: ['monitoring-users'],
    queryFn: async () => {
      const response = await userApi.getAll({ period: 'all' });
      return response.data || [];
    },
  });
  const users = useMemo(
    () => {
      const currentUserLevel = user?.hierarchy_level ?? (user?.role === 'admin' ? 10 : user?.role === 'manager' ? 50 : 100);
      return (usersQuery.data || []).filter((employee: any) => {
        const employeeLevel = employee.hierarchy_level ?? (employee.role === 'admin' ? 10 : employee.role === 'manager' ? 50 : 100);
        return currentUserLevel <= 10 || employeeLevel > currentUserLevel;
      });
    },
    [user, usersQuery.data]
  );
  const effectiveSelectedUserId = useMemo<number | ''>(() => {
    if (selectedUserId === '' || !usersQuery.isSuccess) {
      return selectedUserId;
    }

    return users.some((employee: any) => Number(employee.id) === Number(selectedUserId)) ? selectedUserId : '';
  }, [selectedUserId, users, usersQuery.isSuccess]);
  const hasExplicitEmployeeSelection = effectiveSelectedUserId !== '';
  const isSingleDayRange = startDate === endDate;

  const dataQuery = useQuery({
    queryKey: ['monitoring-workspace-data', mode, startDate, endDate, effectiveSelectedUserId, screenshotPage],
    enabled: usersQuery.isSuccess,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      if (isOverviewMode) {
        const response = await reportApi.employeeInsights({
          start_date: startDate,
          end_date: endDate,
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        });
        return response.data;
      }

      const response = await screenshotApi.getAll({
        user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        start_date: startDate,
        end_date: endDate,
        page: screenshotPage,
        per_page: SCREENSHOTS_PER_PAGE,
      });
      return { screenshotsPage: response.data || null };
    },
  });

  // Daily trend for the overview — /reports/employee-insights has no daily
  // series, but /reports/overall returns by_day (worked vs idle per day).
  const trendQuery = useQuery({
    queryKey: ['monitoring-trend', startDate, endDate],
    enabled: usersQuery.isSuccess && isOverviewMode,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const response = await reportApi.overall({ start_date: startDate, end_date: endDate });
      return (response.data as any)?.by_day || [];
    },
  });

  // Hour productivity-mix bars in the filmstrip come from the server's own
  // classification on processed timeline rows. Single-day ranges only — a
  // 30-day sweep would need thousands of rows for a bar nobody can read.
  const mixActivitiesQuery = useQuery({
    queryKey: ['monitoring-hour-mix', startDate, endDate, effectiveSelectedUserId],
    enabled: usersQuery.isSuccess && mode === 'screenshots' && isSingleDayRange,
    placeholderData: (previousData) => previousData,
    queryFn: async () => {
      const response = await activityApi.getAll({
        user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        start_date: startDate,
        end_date: endDate,
        processed: true,
        page: 1,
        per_page: 200,
      });
      return (response.data as any)?.data || [];
    },
  });

  // Instead of silently rearranging the grid every 60 seconds, poll only the
  // count and offer a "N new — refresh" chip when today is on screen.
  const screenshotPageData = mode === 'screenshots' ? ((dataQuery.data as any)?.screenshotsPage || null) : null;
  const screenshotTotal = Number(screenshotPageData?.total || 0);
  const newCountQuery = useQuery({
    queryKey: ['monitoring-screenshot-count', startDate, endDate, effectiveSelectedUserId],
    enabled: usersQuery.isSuccess && mode === 'screenshots' && endDate >= todayIso(),
    refetchInterval: NEW_SCREENSHOT_POLL_MS,
    queryFn: async () => {
      const response = await screenshotApi.getAll({
        user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        start_date: startDate,
        end_date: endDate,
        page: 1,
        per_page: 1,
      });
      return { total: Number(response.data?.total || 0) };
    },
  });
  const newScreenshotCount = Math.max(0, Number(newCountQuery.data?.total ?? screenshotTotal) - screenshotTotal);

  const isLoading = usersQuery.isLoading || (dataQuery.isLoading && !dataQuery.data);
  const isError = usersQuery.isError || dataQuery.isError;
  const usersById = useMemo(
    () => new Map(users.map((employee: any) => [Number(employee.id), employee])),
    [users]
  );
  const displayTimezone = useMemo(() => {
    const viewerTimezone = resolveTimeZone(user?.settings?.timezone || DEFAULT_APP_TIMEZONE);
    if (!effectiveSelectedUserId) {
      return viewerTimezone;
    }
    const targetUser = usersById.get(Number(effectiveSelectedUserId));
    const targetTimezone = targetUser?.settings?.timezone;
    return targetTimezone ? resolveTimeZone(targetTimezone) : viewerTimezone;
  }, [effectiveSelectedUserId, user, usersById]);
  const pageTitle = modeCopy[mode];

  useEffect(() => {
    if (!usersQuery.isSuccess || selectedUserId === '' || effectiveSelectedUserId !== '') {
      return;
    }

    setSelectedUserId('');

    const params = new URLSearchParams(location.search);
    if (!params.has('user') && !params.has('user_id')) {
      return;
    }

    params.delete('user');
    params.delete('user_id');
    navigate(
      {
        pathname: location.pathname,
        search: params.toString() ? `?${params.toString()}` : '',
      },
      { replace: true }
    );
  }, [effectiveSelectedUserId, location.pathname, location.search, navigate, selectedUserId, usersQuery.isSuccess]);

  const insights = isOverviewMode ? (dataQuery.data as any) : null;
  const screenshots = mode === 'screenshots' ? (screenshotPageData?.data || []) : [];
  const screenshotLastPage = Math.max(1, Number(screenshotPageData?.last_page || 1));
  const screenshotCurrentPage = Math.max(1, Number(screenshotPageData?.current_page || screenshotPage));

  const resolveScreenshotUser = (shot: any) => {
    if (shot?.user?.name) {
      return shot.user;
    }

    const resolvedUserId = Number(shot?.user_id || shot?.time_entry?.user_id || 0);
    return resolvedUserId > 0 ? usersById.get(resolvedUserId) || null : null;
  };

  // The file endpoint is authenticated, so an <img> cannot load the signed URL
  // directly — the browser sends no Authorization header. Fetch the bytes
  // through the api client instead and render the resulting object URL.
  const resolveScreenshotPath = (shot: any) => {
    const screenshotId = Number(shot?.id || 0);

    return screenshotId > 0 ? (screenshotObjectUrls[screenshotId] || '') : '';
  };

  const refreshScreenshotPath = async (screenshotId: number) => {
    if (!Number.isFinite(screenshotId) || screenshotId <= 0) {
      return;
    }

    if (refreshedScreenshotPaths[screenshotId]) {
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

  const loadScreenshotObjectUrl = async (screenshotId: number, signedPath: string) => {
    if (screenshotObjectUrlsRef.current[screenshotId] || inFlightScreenshotLoadsRef.current.has(screenshotId)) {
      return;
    }

    inFlightScreenshotLoadsRef.current.add(screenshotId);

    try {
      const objectUrl = await screenshotApi.fetchFileObjectUrl(signedPath);

      // Revoke rather than leak if the workspace was reset mid-flight.
      if (!isMountedRef.current) {
        URL.revokeObjectURL(objectUrl);
        return;
      }

      screenshotObjectUrlsRef.current[screenshotId] = objectUrl;
      setScreenshotObjectUrls((current) => ({ ...current, [screenshotId]: objectUrl }));
    } catch (error) {
      console.warn('Failed to load screenshot image:', error);
      // An expired signature is the common case; mint a fresh link and retry once.
      void refreshScreenshotPath(screenshotId);
    } finally {
      inFlightScreenshotLoadsRef.current.delete(screenshotId);
    }
  };

  // Lazy trigger from the filmstrip: a tile scrolled into view and wants its bytes.
  const handleShotVisible = (shot: any) => {
    const screenshotId = Number(shot?.id || 0);
    if (screenshotId <= 0) {
      return;
    }

    const signedPath = refreshedScreenshotPaths[screenshotId] || String(shot?.path || '');
    if (signedPath) {
      void loadScreenshotObjectUrl(screenshotId, signedPath);
    }
  };

  // A refreshed signature may arrive after the tile already asked and failed —
  // retry those with the fresh path.
  useEffect(() => {
    Object.entries(refreshedScreenshotPaths).forEach(([id, path]) => {
      const screenshotId = Number(id);
      if (screenshotId > 0 && path && !screenshotObjectUrlsRef.current[screenshotId]) {
        void loadScreenshotObjectUrl(screenshotId, path);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshedScreenshotPaths]);

  const releaseScreenshotObjectUrls = () => {
    Object.values(screenshotObjectUrlsRef.current).forEach((url) => URL.revokeObjectURL(url));
    screenshotObjectUrlsRef.current = {};
    inFlightScreenshotLoadsRef.current.clear();
  };

  useEffect(() => {
    setScreenshotFeedback(null);
    setSelectedScreenshotIds([]);
    setIsDeletingScreenshots(false);
    setScreenshotPage(1);
    setRefreshedScreenshotPaths({});
    // Filters changed: the previous page's images are no longer on screen, so
    // free their blobs instead of holding every screenshot the session viewed.
    releaseScreenshotObjectUrls();
    setScreenshotObjectUrls({});
  }, [endDate, mode, selectedUserId, startDate]);

  // Page changed within the same filters: old page blobs are off screen.
  useEffect(() => {
    releaseScreenshotObjectUrls();
    setScreenshotObjectUrls({});
  }, [screenshotPage]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;
      releaseScreenshotObjectUrls();
    };
  }, []);

  const refreshWorkspaceData = async () => {
    const refreshTasks: Array<Promise<unknown>> = [dataQuery.refetch()];
    if (isOverviewMode) {
      refreshTasks.push(trendQuery.refetch());
    } else {
      refreshTasks.push(newCountQuery.refetch());
    }

    await Promise.all(refreshTasks);
  };

  const handleEmployeeFilterChange = (value: number | '') => {
    setSelectedUserId(value);
  };

  const toggleScreenshotSelection = (screenshotId: number) => {
    setSelectedScreenshotIds((current) =>
      current.includes(screenshotId)
        ? current.filter((id) => id !== screenshotId)
        : [...current, screenshotId]
    );
  };

  const executePendingDelete = async () => {
    if (!pendingDelete) {
      return;
    }

    setScreenshotFeedback(null);
    setIsDeletingScreenshots(true);

    try {
      let message = '';

      if (pendingDelete.kind === 'selected') {
        const response = await screenshotApi.bulkDelete({ screenshot_ids: selectedScreenshotIds });
        message = response.data?.message || `${selectedScreenshotIds.length} screenshots deleted.`;
        setSelectedScreenshotIds([]);
      } else if (pendingDelete.kind === 'range') {
        const response = await screenshotApi.bulkDelete({
          delete_all_in_range: true,
          user_id: Number(effectiveSelectedUserId),
          start_date: startDate,
          end_date: endDate,
        });
        message = response.data?.message || 'All screenshots in the selected range were deleted.';
        setSelectedScreenshotIds([]);
      } else {
        await screenshotApi.delete(pendingDelete.id);
        message = 'Screenshot deleted.';
        setSelectedScreenshotIds((current) => current.filter((id) => id !== pendingDelete.id));
      }

      setScreenshotPage(1);
      await refreshWorkspaceData();
      setScreenshotFeedback({ tone: 'success', message });
    } catch (error) {
      console.error('Monitoring workspace screenshot delete failed:', error);
      setScreenshotFeedback({
        tone: 'error',
        message: (error as any)?.response?.data?.message || 'Failed to delete screenshots.',
      });
    } finally {
      setIsDeletingScreenshots(false);
      setPendingDelete(null);
    }
  };

  const pendingDeleteCopy = pendingDelete === null
    ? { title: '', message: '' }
    : pendingDelete.kind === 'selected'
      ? {
        title: `Delete ${pendingDelete.count} screenshot${pendingDelete.count === 1 ? '' : 's'}?`,
        message: 'The selected screenshots will be permanently removed. This cannot be undone.',
      }
      : pendingDelete.kind === 'range'
        ? {
          title: `Delete all ${pendingDelete.count} screenshots in range?`,
          message: 'Every screenshot for this employee in the current date range will be permanently removed. This cannot be undone.',
        }
        : {
          title: 'Delete this screenshot?',
          message: 'This screenshot will be permanently removed. This cannot be undone.',
        };

  const handleExport = async () => {
    setExportMessage('');
    setExportError('');
    setIsExporting(true);
    try {
      const response = await reportApi.export({
        start_date: startDate,
        end_date: endDate,
        user_ids: effectiveSelectedUserId ? [Number(effectiveSelectedUserId)] : undefined,
        report_type: mode,
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
    } catch (error: any) {
      setExportError(error?.response?.data?.message || 'Failed to export report.');
    } finally {
      setIsExporting(false);
    }
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={pageTitle.eyebrow}
        title={pageTitle.title}
        description={pageTitle.description}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => void refreshWorkspaceData()} iconLeft={<RefreshCw className="h-4 w-4" />}>
              Refresh
            </Button>
            <Button onClick={() => void handleExport()} variant="secondary" disabled={isExporting}>
              <Download className="h-4 w-4" />
              {isExporting ? 'Exporting...' : 'Export CSV'}
            </Button>
          </div>
        }
      />

      {exportMessage && (
        <FeedbackBanner tone="success" message={exportMessage} onDismiss={() => setExportMessage('')} />
      )}
      {exportError && (
        <FeedbackBanner tone="error" message={exportError} onDismiss={() => setExportError('')} />
      )}
      {screenshotFeedback && (
        <FeedbackBanner
          tone={screenshotFeedback.tone}
          message={screenshotFeedback.message}
          onDismiss={() => setScreenshotFeedback(null)}
        />
      )}

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
        {isOverviewMode && (
          <div>
            <FieldLabel>Focus</FieldLabel>
            <div className="flex gap-1.5">
              <Button
                variant={mode === 'productive-time' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => navigate('/monitoring/productive-time')}
              >
                Productive
              </Button>
              <Button
                variant={mode === 'unproductive-time' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => navigate('/monitoring/unproductive-time')}
              >
                Unproductive
              </Button>
            </div>
          </div>
        )}
      </FilterPanel>

      {isOverviewMode && (
        <MonitoringOverview
          insights={insights}
          users={users}
          trend={trendQuery.data || null}
          trendLoading={trendQuery.isLoading}
          focus={mode === 'unproductive-time' ? 'unproductive' : 'productive'}
          selectedUserId={effectiveSelectedUserId}
          onSelectUser={handleEmployeeFilterChange}
          onOpenScreenshots={(userId) => {
            const params = new URLSearchParams();
            params.set('user', String(userId));
            params.set('start', startDate);
            params.set('end', endDate);
            navigate(`/monitoring/screenshots?${params.toString()}`);
          }}
          timezone={displayTimezone}
          isFetching={dataQuery.isFetching}
        />
      )}

      {mode === 'screenshots' && (
        screenshots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <p className="text-sm font-medium text-slate-700">No screenshots in this range.</p>
            <p className="mt-1 text-sm text-slate-500">
              Try a wider date range or a different employee — captures only exist while a timer runs with monitoring enabled.
            </p>
          </div>
        ) : (
          <ScreenshotFilmstrip
            screenshots={screenshots}
            total={screenshotTotal}
            currentPage={screenshotCurrentPage}
            lastPage={screenshotLastPage}
            onPageChange={setScreenshotPage}
            resolveShotUrl={resolveScreenshotPath}
            onShotVisible={handleShotVisible}
            resolveShotUser={resolveScreenshotUser}
            timezone={displayTimezone}
            isFetching={dataQuery.isFetching}
            canDelete={canDeleteScreenshots}
            selectedIds={selectedScreenshotIds}
            onToggleSelect={toggleScreenshotSelection}
            onClearSelection={() => setSelectedScreenshotIds([])}
            onDeleteSelected={() => setPendingDelete({ kind: 'selected', count: selectedScreenshotIds.length })}
            onDeleteShot={(id) => setPendingDelete({ kind: 'single', id })}
            hasEmployeeFilter={hasExplicitEmployeeSelection}
            onDeleteAllInRange={() => setPendingDelete({ kind: 'range', count: screenshotTotal })}
            deleting={isDeletingScreenshots}
            newCount={newScreenshotCount}
            onRefresh={() => void refreshWorkspaceData()}
            dayActivities={isSingleDayRange ? (mixActivitiesQuery.data || null) : null}
            isSingleDayRange={isSingleDayRange}
          />
        )
      )}

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title={pendingDeleteCopy.title}
        message={pendingDeleteCopy.message}
        confirmLabel="Delete"
        tone="danger"
        isLoading={isDeletingScreenshots}
        onConfirm={() => void executePendingDelete()}
        onClose={() => setPendingDelete(null)}
      />
    </div>
  );
}
