import { useEffect, useMemo, useState } from 'react';
import { reportApi, screenshotApi } from '@/services/api';
import DateRangeFields from '@/components/dashboard/DateRangeFields';
import FilterPanel from '@/components/dashboard/FilterPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import PageHeader from '@/components/dashboard/PageHeader';
import SurfaceCard from '@/components/dashboard/SurfaceCard';
import Button from '@/components/ui/Button';
import EmployeeSelect from '@/components/ui/EmployeeSelect';
import { PageEmptyState, PageLoadingState } from '@/components/ui/PageState';
import { FieldLabel } from '@/components/ui/FormField';
import { useAuth } from '@/contexts/AuthContext';
import { deriveDateRangeFromPreset, resolvePersistedDateRange, type DateRangePreset } from '@/lib/dateRange';
import { coercePositiveNumber, readSessionStorageJson, writeSessionStorageJson } from '@/lib/filterPersistence';
import StatusBadge from '@/components/ui/StatusBadge';
import { formatDuration } from '@/lib/formatters';
import { Activity, Camera, Users } from 'lucide-react';

const PIE_COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2'];

const polarToCartesian = (cx: number, cy: number, r: number, angle: number) => {
  const rad = (angle - 90) * Math.PI / 180;
  return {
    x: cx + r * Math.cos(rad),
    y: cy + r * Math.sin(rad),
  };
};

const arcPath = (cx: number, cy: number, r: number, startAngle: number, endAngle: number) => {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? '0' : '1';
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
};

type PersistedMonitoringFilters = {
  query: string;
  datePreset: DateRangePreset;
  startDate: string;
  endDate: string;
  selectedUserId: number | null;
};

const MONITORING_FILTER_STORAGE_KEY = 'monitoring-page-filters';
const monitoringDefaultDateRange = deriveDateRangeFromPreset('today');

const getDefaultMonitoringFilters = (): PersistedMonitoringFilters => ({
  query: '',
  datePreset: 'today',
  startDate: monitoringDefaultDateRange.startDate,
  endDate: monitoringDefaultDateRange.endDate,
  selectedUserId: null,
});

const readPersistedMonitoringFilters = (): PersistedMonitoringFilters => {
  const fallback = getDefaultMonitoringFilters();
  const parsed = readSessionStorageJson<PersistedMonitoringFilters>(MONITORING_FILTER_STORAGE_KEY);

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
    query: typeof parsed.query === 'string' ? parsed.query : fallback.query,
    datePreset,
    startDate: resolvedRange.startDate,
    endDate: resolvedRange.endDate,
    selectedUserId: coercePositiveNumber(parsed.selectedUserId),
  };
};
export default function Monitoring() {
  const { user } = useAuth();
  const canDeleteScreenshots = user?.role === 'admin';
  const [query, setQuery] = useState(() => readPersistedMonitoringFilters().query);
  const [datePreset, setDatePreset] = useState<DateRangePreset>(() => readPersistedMonitoringFilters().datePreset);
  const [startDate, setStartDate] = useState(() => readPersistedMonitoringFilters().startDate);
  const [endDate, setEndDate] = useState(() => readPersistedMonitoringFilters().endDate);
  const [selectedUserId, setSelectedUserId] = useState<number | undefined>(() => readPersistedMonitoringFilters().selectedUserId ?? undefined);
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    writeSessionStorageJson(MONITORING_FILTER_STORAGE_KEY, {
      query,
      datePreset,
      startDate,
      endDate,
      selectedUserId: selectedUserId ?? null,
    } satisfies PersistedMonitoringFilters);
  }, [datePreset, endDate, query, selectedUserId, startDate]);

  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset);
    if (preset === 'custom') {
      return;
    }

    const nextRange = deriveDateRangeFromPreset(preset);
    setStartDate(nextRange.startDate);
    setEndDate(nextRange.endDate);
  };

  const fetchData = async (overrides?: { userId?: number }) => {
    setIsLoading(true);
    try {
      const response = await reportApi.employeeInsights({
        q: query || undefined,
        user_id: overrides?.userId ?? selectedUserId,
        start_date: startDate,
        end_date: endDate,
      });
      setData(response.data);
    } catch (error) {
      console.error('Monitoring load failed:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [startDate, endDate]);

  const selectedUser = data?.selected_user;
  const stats = data?.stats;
  const screenshots = data?.recent_screenshots || [];
  const activityBreakdown = data?.activity_breakdown || [];
  const selectedTools = data?.selected_user_tools || { productive: [], unproductive: [], neutral: [] };
  const organizationTools = data?.organization_tools || { productive: [], unproductive: [] };
  const organizationSummary = data?.organization_summary || null;
  const employeeRankings = data?.employee_rankings || null;
  const teamRankings = data?.team_rankings || { by_efficiency: [], top_productive: null, least_productive: null };
  const liveMonitoring = data?.live_monitoring || { selected_user: null, working_now: [], all_users: [] };
  const selectedUserLive = liveMonitoring?.selected_user;
  const employeesActive = liveMonitoring?.employees_active || [];
  const employeesInactive = liveMonitoring?.employees_inactive || [];
  const employeesOnLeave = liveMonitoring?.employees_on_leave || [];
  const productiveEmployeeRanking = employeeRankings?.by_productive_duration || [];
  const maxProductiveDuration = Math.max(1, ...productiveEmployeeRanking.map((item: any) => Number(item?.productive_duration || 0)));
  const teamEfficiencyRanking = teamRankings?.by_efficiency || [];
  const maxTeamEfficiency = Math.max(1, ...teamEfficiencyRanking.map((item: any) => Number(item?.efficiency_score || 0)));
  const analyticsUsersCount = Number(data?.analytics_users_count || 0);
  const totalActivityDuration = activityBreakdown.reduce((sum: number, item: any) => sum + Number(item.total_duration || 0), 0);

  const handleDeleteScreenshot = async (id: number) => {
    if (!confirm('Delete this screenshot?')) return;
    try {
      await screenshotApi.delete(id);
      setData((prev: any) => ({
        ...prev,
        recent_screenshots: (prev?.recent_screenshots || []).filter((s: any) => s.id !== id),
      }));
    } catch (error) {
      console.error('Delete screenshot failed:', error);
    }
  };
  const employeeOptions = useMemo(
    () => (data?.matched_users?.length ? data.matched_users : liveMonitoring?.all_users || []),
    [data?.matched_users, liveMonitoring?.all_users]
  );
  const handleEmployeeFilterChange = (value: number | '') => {
    const nextId = value ? Number(value) : undefined;
    setSelectedUserId(nextId);
    setQuery('');
    void fetchData({ userId: nextId });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Monitoring"
        title="Employee Monitoring"
        description="Review live activity, productive vs unproductive tracking, screenshots, and team-wide efficiency signals."
      />

      <FilterPanel className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <div>
          <FieldLabel>Employee</FieldLabel>
          <EmployeeSelect employees={employeeOptions} value={selectedUserId ?? ''} onChange={handleEmployeeFilterChange} includeAllOption />
        </div>
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
          inputClassName="py-2.5"
        />
        <div className="flex items-end">
          <Button onClick={() => fetchData()} className="w-full">
            Apply
          </Button>
        </div>
      </FilterPanel>

      {isLoading ? (
        <PageLoadingState label="Loading monitoring data..." />
      ) : !selectedUser ? (
        <PageEmptyState title="No employee found" description="Adjust the search or date range to inspect another employee." />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
            <MetricCard label="Employee" value={selectedUser.name} hint={selectedUser.email} icon={Users} accent="slate" />
            <MetricCard label="Total Worked" value={formatDuration(stats?.total_duration || 0)} icon={Activity} accent="emerald" />
            <MetricCard label="Total Idle" value={formatDuration(stats?.idle_total_duration || 0)} icon={Activity} accent="amber" />
            <MetricCard label="Average Idle" value={`${Math.round(stats?.idle_avg_duration || 0)}s`} icon={Activity} accent="rose" />
            <MetricCard label="Screenshots" value={screenshots.length} icon={Camera} accent="sky" />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Org Productive Share" value={`${Number(organizationSummary?.productive_share || 0).toFixed(1)}%`} icon={Activity} accent="emerald" />
            <MetricCard label="Org Unproductive Share" value={`${Number(organizationSummary?.unproductive_share || 0).toFixed(1)}%`} icon={Activity} accent="rose" />
            <MetricCard label="Tracked Productive Time" value={formatDuration(Number(organizationSummary?.productive_duration || 0))} icon={Users} accent="sky" />
            <MetricCard label="Tracked Unproductive Time" value={formatDuration(Number(organizationSummary?.unproductive_duration || 0))} icon={Users} accent="amber" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SurfaceCard className="p-4">
              <h2 className="font-semibold text-gray-900 mb-3">Live Activity (Selected Employee)</h2>
              {!selectedUserLive ? (
                <p className="text-sm text-gray-500">No live activity found.</p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">Current Tool</p>
                    <p className="text-sm font-medium text-gray-900">{selectedUserLive.current_tool || 'Unknown'}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">Type</p>
                    <p className="text-sm font-medium text-gray-900 capitalize">{selectedUserLive.tool_type || '--'}</p>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">Classification</p>
                    <StatusBadge tone={selectedUserLive.classification === 'unproductive' ? 'danger' : selectedUserLive.classification === 'productive' ? 'success' : 'neutral'}>
                      {selectedUserLive.classification || 'neutral'}
                    </StatusBadge>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-gray-600">Working Now</p>
                    <StatusBadge tone={selectedUserLive.is_working ? 'success' : 'neutral'}>
                      {selectedUserLive.is_working ? 'Yes' : 'No'}
                    </StatusBadge>
                  </div>
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Employee Status (Live)</h2>
                <p className="text-xs text-gray-500">{employeesActive.length + employeesInactive.length + employeesOnLeave.length} employees</p>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-green-800">Active</p>
                    <StatusBadge tone="success">{employeesActive.length}</StatusBadge>
                  </div>
                  <div className="mt-2 space-y-1 max-h-44 overflow-auto">
                    {employeesActive.length === 0 ? (
                      <p className="text-xs text-green-700">No active employees.</p>
                    ) : employeesActive.map((item: any) => (
                      <p key={`active-${item.user?.id}`} className="text-xs text-green-900 truncate" title={`${item.user?.name || ''} - ${item.current_tool || 'Unknown tool'}`}>
                        {item.user?.name}: {item.current_tool || 'Unknown tool'}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-800">Inactive</p>
                    <StatusBadge>{employeesInactive.length}</StatusBadge>
                  </div>
                  <div className="mt-2 space-y-1 max-h-44 overflow-auto">
                    {employeesInactive.length === 0 ? (
                      <p className="text-xs text-gray-600">No inactive employees.</p>
                    ) : employeesInactive.map((item: any) => (
                      <p key={`inactive-${item.user?.id}`} className="text-xs text-gray-800 truncate" title={`${item.user?.name || ''} - ${item.current_tool || 'Unknown tool'}`}>
                        {item.user?.name}: {item.current_tool || 'No recent tool'}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold text-amber-800">On Leave</p>
                    <StatusBadge tone="warning">{employeesOnLeave.length}</StatusBadge>
                  </div>
                  <div className="mt-2 space-y-1 max-h-44 overflow-auto">
                    {employeesOnLeave.length === 0 ? (
                      <p className="text-xs text-amber-700">No employees on leave today.</p>
                    ) : employeesOnLeave.map((item: any) => (
                      <p key={`leave-${item.user?.id}`} className="text-xs text-amber-900 truncate">
                        {item.user?.name}
                      </p>
                    ))}
                  </div>
                </div>
              </div>
            </SurfaceCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SurfaceCard className="p-4">
              <h2 className="font-semibold text-gray-900 mb-3">Activity Breakdown</h2>
              {activityBreakdown.length === 0 || totalActivityDuration <= 0 ? (
                <p className="text-sm text-gray-500">No activity logs found.</p>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-center">
                    <svg viewBox="0 0 220 220" className="h-48 w-48" aria-label="Activity breakdown pie chart">
                      {(() => {
                        let start = 0;
                        return activityBreakdown.map((item: any, idx: number) => {
                          const duration = Number(item.total_duration || 0);
                          if (duration <= 0) return null;
                          const fraction = duration / totalActivityDuration;
                          const sweep = fraction * 360;
                          const path = arcPath(110, 110, 90, start, start + sweep);
                          start += sweep;
                          return <path key={item.type} d={path} fill={PIE_COLORS[idx % PIE_COLORS.length]} />;
                        });
                      })()}
                    </svg>
                  </div>
                  <div className="space-y-2">
                    {activityBreakdown.map((item: any, idx: number) => {
                      const duration = Number(item.total_duration || 0);
                      const pct = totalActivityDuration > 0 ? Math.round((duration / totalActivityDuration) * 100) : 0;
                      return (
                        <div key={item.type} className="flex items-center justify-between p-2 border border-gray-100 rounded-lg">
                          <p className="text-sm text-gray-700 capitalize flex items-center gap-2">
                            <span
                              className="inline-block h-3 w-3 rounded-sm"
                              style={{ backgroundColor: PIE_COLORS[idx % PIE_COLORS.length] }}
                            />
                            {item.type}
                          </p>
                          <p className="text-sm text-gray-900 font-medium">
                            {item.count} events, {formatDuration(duration)} ({pct}%)
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <h2 className="font-semibold text-gray-900 mb-3">Selected Employee Tool Usage</h2>
              <div className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-green-700 mb-2">Most Productive Websites/Software</p>
                  {selectedTools.productive.length === 0 ? (
                    <p className="text-sm text-gray-500">No productive tools found.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedTools.productive.slice(0, 8).map((item: any) => (
                        <div key={`sel-prod-${item.type}-${item.label}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                          <div>
                            <p className="text-sm text-gray-900">{item.label}</p>
                            <p className="text-xs text-gray-500 capitalize">{item.type}</p>
                          </div>
                          <p className="text-sm font-medium text-gray-900">{formatDuration(item.total_duration)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-sm font-medium text-red-700 mb-2">Most Unproductive Websites/Software</p>
                  {selectedTools.unproductive.length === 0 ? (
                    <p className="text-sm text-gray-500">No unproductive tools found.</p>
                  ) : (
                    <div className="space-y-2">
                      {selectedTools.unproductive.slice(0, 8).map((item: any) => (
                        <div key={`sel-unprod-${item.type}-${item.label}`} className="flex items-center justify-between rounded-lg border border-gray-100 px-3 py-2">
                          <div>
                            <p className="text-sm text-gray-900">{item.label}</p>
                            <p className="text-xs text-gray-500 capitalize">{item.type}</p>
                          </div>
                          <p className="text-sm font-medium text-gray-900">{formatDuration(item.total_duration)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </SurfaceCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SurfaceCard className="p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Organization Top Productive Tools</h2>
                <p className="text-xs text-gray-500">Avg across {analyticsUsersCount} employees</p>
              </div>
              {organizationTools.productive.length === 0 ? (
                <p className="text-sm text-gray-500 mt-3">No productive tool activity found.</p>
              ) : (
                <div className="mt-3 space-y-2 max-h-72 overflow-auto">
                  {organizationTools.productive.map((item: any) => (
                    <div key={`org-prod-${item.type}-${item.label}`} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900">{item.label}</p>
                        <StatusBadge tone="success" className="capitalize">{item.type}</StatusBadge>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Total: {formatDuration(item.total_duration)} | Avg/Employee: {formatDuration(Math.round(item.avg_duration_per_employee || 0))}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-gray-900">Organization Top Unproductive Tools</h2>
                <p className="text-xs text-gray-500">Avg across {analyticsUsersCount} employees</p>
              </div>
              {organizationTools.unproductive.length === 0 ? (
                <p className="text-sm text-gray-500 mt-3">No unproductive tool activity found.</p>
              ) : (
                <div className="mt-3 space-y-2 max-h-72 overflow-auto">
                  {organizationTools.unproductive.map((item: any) => (
                    <div key={`org-unprod-${item.type}-${item.label}`} className="rounded-lg border border-gray-100 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-gray-900">{item.label}</p>
                        <StatusBadge tone="danger" className="capitalize">{item.type}</StatusBadge>
                      </div>
                      <p className="text-xs text-gray-600 mt-1">
                        Total: {formatDuration(item.total_duration)} | Avg/Employee: {formatDuration(Math.round(item.avg_duration_per_employee || 0))}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </SurfaceCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SurfaceCard className="p-4">
              <h2 className="font-semibold text-gray-900 mb-1">Employee Productivity Ranking</h2>
              <p className="text-xs text-gray-500 mb-3">Employees only, ordered from most productive to least productive</p>
              {productiveEmployeeRanking.length === 0 ? (
                <p className="text-sm text-gray-500">No employee productivity data found.</p>
              ) : (
                <div className="border border-gray-100 rounded-lg p-3 space-y-2 max-h-72 overflow-auto">
                  {productiveEmployeeRanking.map((item: any) => {
                    const duration = Number(item?.productive_duration || 0);
                    const widthPercent = Math.max(6, Math.round((duration / maxProductiveDuration) * 100));
                    return (
                      <div key={`rank-${item?.user?.id}`} className="space-y-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-gray-700 truncate">{item?.user?.name || 'Unknown'}</p>
                          <p className="text-xs text-gray-600 shrink-0">{formatDuration(duration)}</p>
                        </div>
                        <div className="h-3 w-full bg-gray-100 rounded-md overflow-hidden">
                          <div
                            className="h-3 bg-green-500 rounded-md"
                            style={{ width: `${widthPercent}%` }}
                            title={`${item?.user?.name || 'Unknown'} - ${formatDuration(duration)}`}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </SurfaceCard>

            <SurfaceCard className="p-4">
              <h2 className="font-semibold text-gray-900 mb-1">Team Productivity Efficiency</h2>
              <p className="text-xs text-gray-500 mb-3">Higher score means more productive time share</p>
              {teamEfficiencyRanking.length === 0 ? (
                <p className="text-sm text-gray-500">No team/group data found.</p>
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-green-700">Top Team</p>
                      <p className="text-sm font-semibold text-gray-900 mt-1">{teamRankings?.top_productive?.group?.name || 'N/A'}</p>
                      <p className="text-xs text-green-800 mt-1">Efficiency: {Number(teamRankings?.top_productive?.efficiency_score || 0).toFixed(2)}%</p>
                    </div>
                    <div className="rounded-lg border border-red-200 bg-red-50 p-3">
                      <p className="text-xs uppercase tracking-wide text-red-700">Least Productive Team</p>
                      <p className="text-sm font-semibold text-gray-900 mt-1">{teamRankings?.least_productive?.group?.name || 'N/A'}</p>
                      <p className="text-xs text-red-800 mt-1">Efficiency: {Number(teamRankings?.least_productive?.efficiency_score || 0).toFixed(2)}%</p>
                    </div>
                  </div>

                  <div className="border border-gray-100 rounded-lg p-3 space-y-2 max-h-48 overflow-auto">
                    {teamEfficiencyRanking.map((item: any) => {
                      const score = Number(item?.efficiency_score || 0);
                      const widthPercent = Math.max(6, Math.round((score / maxTeamEfficiency) * 100));
                      return (
                        <div key={`team-eff-${item?.group?.id}`} className="space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <p className="text-xs text-gray-700 truncate">{item?.group?.name || 'Unnamed Team'}</p>
                            <p className="text-xs text-gray-600 shrink-0">{score.toFixed(2)}%</p>
                          </div>
                          <div className="h-3 w-full bg-gray-100 rounded-md overflow-hidden">
                            <div className="h-3 bg-blue-500 rounded-md" style={{ width: `${widthPercent}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </SurfaceCard>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SurfaceCard className="p-4">
              <h2 className="font-semibold text-gray-900 mb-3">Recent Screenshots</h2>
              <div className="grid grid-cols-2 gap-2 max-h-80 overflow-auto">
                {screenshots.length === 0 ? <p className="text-sm text-gray-500 col-span-2">No screenshots found.</p> : screenshots.map((s: any) => (
                  <div key={s.id} className="relative border border-gray-100 rounded-lg overflow-hidden group">
                    <a href={s.path} target="_blank" rel="noreferrer" className="block">
                      <img src={s.path} alt={`Screenshot ${s.id}`} className="w-full h-24 object-cover" />
                    </a>
                    {canDeleteScreenshots ? (
                      <button
                        onClick={() => handleDeleteScreenshot(s.id)}
                        className="absolute right-1 top-1 rounded-full bg-rose-600 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        Delete
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            </SurfaceCard>
          </div>
        </>
      )}
    </div>
  );
}
