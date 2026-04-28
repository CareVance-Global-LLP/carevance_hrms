import { useEffect, useMemo, useState } from 'react';
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
import { deriveDateRangeFromPreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import { matchesSearchFilter } from '@/lib/searchSuggestions';
import { getWorkingDuration } from '@/lib/timeBreakdown';
import {
  Activity,
  CalendarDays,
  Download,
  LineChart,
  ListFilter,
  RefreshCw,
  TimerReset,
  Users,
  Waypoints,
} from 'lucide-react';

type ReportsWorkspaceMode =
  | 'attendance'
  | 'hours-tracked'
  | 'projects-tasks'
  | 'timeline'
  | 'web-app-usage'
  | 'productivity'
  | 'custom-export';

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

  if (hours === 0 && remainingSeconds > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }

  return `${hours}h ${minutes}m`;
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
    eyebrow: 'Reports',
    title: 'Timeline',
    description: 'Chronological activity feed across app, website, and idle events in the selected range.',
  },
  'web-app-usage': {
    eyebrow: 'Reports',
    title: 'Web & App Usage',
    description: 'Tool usage by employee with productive and unproductive classifications from current monitoring data.',
  },
  productivity: {
    eyebrow: 'Reports',
    title: 'Productivity Summary',
    description: 'Productive share, idle trends, and top contributors across the organization.',
  },
  'custom-export': {
    eyebrow: 'Reports',
    title: 'Custom Export',
    description: 'Generate CSV exports using the current date range and optional user or team filters.',
  },
};

export default function ReportsWorkspace({ mode }: { mode: ReportsWorkspaceMode }) {
  const { user } = useAuth();
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedReportsWorkspaceFilters(mode).datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedReportsWorkspaceFilters(mode).startDate);
  const [endDate, setEndDate] = useState(() => readPersistedReportsWorkspaceFilters(mode).endDate);
  const [selectedTaskId, setSelectedTaskId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedTaskId);
  const [selectedUserId, setSelectedUserId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedUserId);
  const [selectedGroupId, setSelectedGroupId] = useState<number | ''>(() => readPersistedReportsWorkspaceFilters(mode).selectedGroupId);
  const [exportMessage, setExportMessage] = useState('');
  const [exportError, setExportError] = useState('');

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
    queryFn: async () => {
      const response = await userApi.getAll({ period: 'all' });
      return response.data || [];
    },
  });
  const groupsQuery = useQuery({
    queryKey: ['report-workspace-groups'],
    queryFn: async () => {
      const response = await reportGroupApi.list();
      return response.data?.data || [];
    },
  });
  const users = useMemo(
    () => (usersQuery.data || []).filter((employee: any) => user?.role !== 'manager' || employee.role === 'employee'),
    [user?.role, usersQuery.data]
  );
  const groups = groupsQuery.data || [];
  const effectiveSelectedUserId = useMemo<number | ''>(() => {
    if (selectedUserId === '') {
      return '';
    }

    return users.some((employee: any) => Number(employee.id) === Number(selectedUserId))
      ? Number(selectedUserId)
      : '';
  }, [selectedUserId, users]);
  const selectedEmployee = useMemo(
    () => users.find((employee: any) => Number(employee.id) === Number(effectiveSelectedUserId)) || null,
    [effectiveSelectedUserId, users]
  );
  const projectsEmployeeNameSearch = mode === 'projects-tasks' && selectedEmployee ? String(selectedEmployee.name || '').trim() : '';
  const selectedGroup = selectedGroupId ? groups.find((group: any) => Number(group.id) === Number(selectedGroupId)) : null;
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
    if (!usersQuery.isSuccess || selectedUserId === '') {
      return;
    }

    const hasSelectedUser = users.some((employee: any) => Number(employee.id) === Number(selectedUserId));
    if (!hasSelectedUser) {
      setSelectedUserId('');
    }
  }, [selectedUserId, users, usersQuery.isSuccess]);

  const dataQuery = useQuery({
    queryKey: ['report-workspace-data', mode, startDate, endDate, effectiveSelectedUserId, selectedGroupId],
    enabled: usersQuery.isSuccess && groupsQuery.isSuccess,
    placeholderData: (previousData, previousQuery) => (
      shouldReuseReportPlaceholderData(previousQuery?.queryKey, mode)
        ? previousData
        : undefined
    ),
    refetchInterval: mode === 'timeline' || mode === 'web-app-usage' || mode === 'productivity' ? 1000 : false,
    refetchIntervalInBackground: mode === 'timeline' || mode === 'web-app-usage' || mode === 'productivity',
    queryFn: async () => {
      if (mode === 'attendance') {
        const response = await reportApi.attendance({
          start_date: startDate,
          end_date: endDate,
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
        });
        return response.data;
      }

      if (mode === 'hours-tracked' || mode === 'productivity' || mode === 'custom-export') {
        const response = await reportApi.overall({
          start_date: startDate,
          end_date: endDate,
          user_ids: effectiveSelectedUserId ? [Number(effectiveSelectedUserId)] : undefined,
          group_ids: selectedGroupId ? [Number(selectedGroupId)] : undefined,
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
        return activityApi.getAllPages({
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
          group_ids: selectedGroupId ? [Number(selectedGroupId)] : undefined,
          start_date: startDate,
          end_date: endDate,
          processed: true,
          per_page: 200,
        });
      }

      if (mode === 'web-app-usage') {
        const response = await reportApi.employeeInsights({
          start_date: startDate,
          end_date: endDate,
          user_id: effectiveSelectedUserId ? Number(effectiveSelectedUserId) : undefined,
          group_ids: selectedGroupId ? [Number(selectedGroupId)] : undefined,
        });
        return response.data;
      }

      return null;
    },
  });

  const isLoading = usersQuery.isLoading || groupsQuery.isLoading || (dataQuery.isLoading && !dataQuery.data);
  const isError = usersQuery.isError || groupsQuery.isError || dataQuery.isError;
  const pageTitle = modeCopy[mode];

  const attendanceRows = (dataQuery.data as any)?.data || [];
  const attendanceTotals = useMemo(() => {
    if (mode !== 'attendance') return null;
    const presentDays = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.days_present || 0), 0);
    const leaveDays = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.leave_days || 0), 0);
    const workedSeconds = attendanceRows.reduce((sum: number, row: any) => sum + Number(row.worked_seconds || 0), 0);
    return {
      presentDays,
      leaveDays,
      workedSeconds,
      employees: attendanceRows.length,
    };
  }, [attendanceRows, mode]);

  const overallData = dataQuery.data as any;
  const overallSummary = overallData?.summary || {};
  const byUser = overallData?.by_user || [];
  const byDay = overallData?.by_day || [];
  const shouldScrollByUser = byUser.length > 5;
  const shouldScrollByDay = byDay.length > 5;

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

  const timelineRows = Array.isArray(dataQuery.data) ? dataQuery.data : [];
  const timelineSummary = useMemo(() => {
    if (mode !== 'timeline') return null;
    return {
      apps: timelineRows.filter((item: any) => item.type === 'app').length,
      urls: timelineRows.filter((item: any) => item.type === 'url').length,
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

  const handleExport = async () => {
    setExportMessage('');
    setExportError('');
    try {
      const response = await reportApi.export({
        start_date: startDate,
        end_date: endDate,
        user_ids: effectiveSelectedUserId ? [Number(effectiveSelectedUserId)] : undefined,
        group_ids: selectedGroupId ? [Number(selectedGroupId)] : undefined,
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

  if (isLoading) {
    return <PageLoadingState label={`Loading ${pageTitle.title.toLowerCase()}...`} />;
  }

  if (isError) {
    return (
      <PageErrorState
        message={
          (dataQuery.error as any)?.response?.data?.message ||
          (usersQuery.error as any)?.response?.data?.message ||
          (groupsQuery.error as any)?.response?.data?.message ||
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

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={pageTitle.eyebrow}
        title={pageTitle.title}
        description={pageTitle.description}
        actions={
          <Button onClick={handleExport} variant="secondary">
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        }
      />

      {exportMessage ? <FeedbackBanner tone="success" message={exportMessage} /> : null}
      {exportError ? <FeedbackBanner tone="error" message={exportError} /> : null}

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
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Employees" value={attendanceTotals.employees} hint="Employees in range" icon={Users} accent="sky" />
            <MetricCard label="Present Days" value={attendanceTotals.presentDays} hint="Total present days" icon={CalendarDays} accent="emerald" />
            <MetricCard label="Leave Days" value={attendanceTotals.leaveDays} hint="Approved leave in range" icon={ListFilter} accent="amber" />
            <MetricCard label="Worked Time" value={formatDuration(attendanceTotals.workedSeconds)} hint="Tracked attendance time" icon={TimerReset} accent="violet" />
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
            <MetricCard label="Active Users" value={overallSummary.active_users || 0} hint={`${overallSummary.users_count || 0} users tracked`} icon={Users} accent="violet" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DataTable
              title={mode === 'productivity' ? 'Employee Productivity' : 'Employee Hours'}
              description="Per-user totals, idle share, and latest activity."
              rows={byUser}
              emptyMessage="No employee rows found."
              headerAction={renderPanelRefreshButton()}
              bodyClassName={shouldScrollByUser ? 'max-h-[360px] overflow-y-auto' : undefined}
              columns={[
                { key: 'user', header: 'User', render: (row: any) => <div><p className="font-medium text-slate-950">{row.user?.name}</p><p className="text-xs text-slate-500">{row.user?.email}</p></div> },
                { key: 'total', header: 'Tracked', render: (row: any) => formatDuration(row.total_duration || 0) },
                { key: 'working', header: 'Working', render: (row: any) => formatDuration(getWorkingDuration(row)) },
                { key: 'idle', header: 'Idle', render: (row: any) => formatDuration(row.idle_duration || 0) },
                { key: 'idle_pct', header: 'Idle %', render: (row: any) => `${Number(row.idle_percentage || 0).toFixed(1)}%` },
              ]}
            />
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
            <MetricCard label="Events" value={timelineRows.length} hint="All timeline events" icon={Waypoints} accent="sky" />
            <MetricCard label="Apps" value={timelineSummary.apps} hint="Desktop/app events" icon={Activity} accent="emerald" />
            <MetricCard label="Web" value={timelineSummary.urls} hint="Website events" icon={LineChart} accent="violet" />
            <MetricCard label="Idle" value={timelineSummary.idle} hint="Idle periods" icon={TimerReset} accent="amber" />
          </div>

          <DataTable
            title="Activity Timeline"
            description="Recent app, website, and idle events in chronological order."
            rows={timelineRows.slice().sort((a: any, b: any) => +new Date(b.recorded_at) - +new Date(a.recorded_at))}
            emptyMessage="No timeline events found."
            headerAction={renderPanelRefreshButton()}
            bodyClassName={timelineRows.length > 8 ? 'max-h-[420px] overflow-y-auto' : undefined}
            columns={[
              { key: 'recorded_at', header: 'When', render: (row: any) => new Date(row.recorded_at).toLocaleString() },
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
              <Button onClick={handleExport}>
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
