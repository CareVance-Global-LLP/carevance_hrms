import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Camera } from 'lucide-react';
import Button from '@/components/ui/Button';
import SlideOver from '@/features/employees/SlideOver';
import { formatDuration } from '@/lib/formatters';
import { formatDateTime as formatDateTimeForTimezone } from '@/lib/dateTime';
import { DEFAULT_APP_TIMEZONE } from '@/lib/timezones';
import {
  CLASSIFICATION_META,
  CLASSIFICATION_ORDER,
  IDLE_HEX,
  Panel,
  PresenceBar,
  PRESENCE_META,
  ShareBar,
  ShareLegend,
  classificationSegments,
  type PresenceStatus,
} from './monitoringUi';

const IDLE_ATTENTION_SHARE = 0.2;

export interface MonitoringOverviewProps {
  insights: any;
  users: any[];
  trend: any[] | null;
  trendLoading: boolean;
  focus: 'productive' | 'unproductive';
  selectedUserId: number | '';
  onSelectUser: (id: number | '') => void;
  onOpenScreenshots: (userId: number) => void;
  timezone: string;
  isFetching: boolean;
}

const formatDateTime = (value?: string | null, timezone = DEFAULT_APP_TIMEZONE) =>
  formatDateTimeForTimezone(value, timezone, 'en-US', 'No recent activity');

const resolveLiveToolLabel = (liveRow?: any | null) => {
  const resolved = [liveRow?.current_tool, liveRow?.tool_label, liveRow?.normalized_label, liveRow?.name]
    .map((candidate) => String(candidate || '').trim())
    .find(Boolean);
  return resolved || 'No active tool detected';
};


const shortDayLabel = (dateISO: string) => {
  const parsed = new Date(`${dateISO}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? dateISO
    : parsed.toLocaleDateString('en-US', { weekday: 'short' });
};

/**
 * The Monitoring command view: who is working right now → where the time
 * went → who needs a look. Replaces the metric-tile wall and the three
 * tables of the old productive/unproductive pages with one presence bar,
 * three analytics panels, and a ranked people list whose rows open a
 * detail drawer.
 */
export default function MonitoringOverview({
  insights,
  users,
  trend,
  trendLoading,
  focus,
  selectedUserId,
  onSelectUser,
  onOpenScreenshots,
  timezone,
  isFetching,
}: MonitoringOverviewProps) {
  const [presenceFilter, setPresenceFilter] = useState<PresenceStatus | 'all'>('all');
  const [drawerUserId, setDrawerUserId] = useState<number | null>(null);

  const organizationSummary = insights?.organization_summary || {};
  const liveMonitoring = insights?.live_monitoring || {};
  const presenceCounts = liveMonitoring.counts || {};
  const statusByUser: Record<string, PresenceStatus> = liveMonitoring.status_by_user || {};
  const teamRankings: any[] = insights?.team_rankings?.by_efficiency || [];

  const rankingRows: any[] = useMemo(() => {
    const rows = focus === 'unproductive'
      ? insights?.employee_rankings?.by_unproductive_duration || []
      : insights?.employee_rankings?.by_productive_duration || [];
    return Array.isArray(rows) ? rows : [];
  }, [insights, focus]);

  const rankingByUserId = useMemo(() => {
    const map = new Map<number, any>();
    rankingRows.forEach((row) => {
      const id = Number(row?.user?.id || 0);
      if (id > 0) map.set(id, row);
    });
    return map;
  }, [rankingRows]);

  const usersById = useMemo(() => {
    const map = new Map<number, any>();
    users.forEach((employee: any) => map.set(Number(employee.id), employee));
    return map;
  }, [users]);

  // The people list: ranked rows first; when a presence filter is active,
  // people matching the status but absent from the rankings (nothing tracked
  // in range) still appear as plain rows — a filter must never hide people.
  const peopleRows = useMemo(() => {
    const ranked = rankingRows.filter((row) => {
      if (presenceFilter === 'all') return true;
      const status = statusByUser[String(row?.user?.id ?? '')];
      return status === presenceFilter;
    });

    if (presenceFilter === 'all') {
      return ranked.map((row) => ({ row, user: row.user, untracked: false }));
    }

    const rankedIds = new Set(ranked.map((row) => Number(row?.user?.id || 0)));
    const untracked = Object.entries(statusByUser)
      .filter(([id, status]) => status === presenceFilter && !rankedIds.has(Number(id)))
      .map(([id]) => usersById.get(Number(id)))
      .filter(Boolean)
      .map((employee: any) => ({ row: null, user: employee, untracked: true }));

    return [...ranked.map((row) => ({ row, user: row.user, untracked: false })), ...untracked];
  }, [rankingRows, presenceFilter, statusByUser, usersById]);

  /*
   * Each duration also as a share of tracked time.
   *
   * "Idle 0h 16m" only means something once you know whether it sits inside
   * twenty minutes or eight hours, and reading that off the neighbouring
   * figure is arithmetic the page can just do. Tracked itself carries no
   * percentage — it is the denominator.
   */
  const shareOfTracked = (seconds: unknown) => {
    const total = Number(organizationSummary.tracked_duration || 0);
    const value = Number(seconds || 0);
    if (total <= 0 || value <= 0) return '';
    return ` (${Math.round((value / total) * 100)}%)`;
  };

  const shareSegments = classificationSegments(organizationSummary);
  const focusShare = Number(
    focus === 'unproductive'
      ? organizationSummary.unproductive_share || 0
      : organizationSummary.productive_share || 0
  );

  const trendData = useMemo(
    () => (Array.isArray(trend) ? trend : []).map((day: any) => ({
      day: shortDayLabel(String(day?.date || '')),
      date: String(day?.date || ''),
      worked: Math.max(0, Number(day?.working_duration ?? day?.total_duration ?? 0)),
      idle: Math.max(0, Number(day?.idle_duration ?? 0)),
    })),
    [trend]
  );

  const drawerUser = drawerUserId ? usersById.get(drawerUserId) : null;
  const drawerRanking = drawerUserId ? rankingByUserId.get(drawerUserId) : null;
  const drawerStatus: PresenceStatus | undefined = drawerUserId ? statusByUser[String(drawerUserId)] : undefined;
  // Live detail and top tools only exist once the insights payload has been
  // refetched scoped to this person — guard on the id so a stale payload
  // from the previous selection never renders under the wrong name.
  const drawerScoped = drawerUserId !== null
    && Number(insights?.selected_user?.id || 0) === drawerUserId;
  const drawerLive = drawerScoped ? liveMonitoring.selected_user || null : null;
  const drawerTools = drawerScoped ? insights?.selected_user_tools || null : null;

  const openPerson = (userId: number) => {
    setDrawerUserId(userId);
    if (selectedUserId !== userId) {
      onSelectUser(userId);
    }
  };

  const closeDrawer = () => {
    setDrawerUserId(null);
    if (selectedUserId !== '') {
      onSelectUser('');
    }
  };

  const renderPersonBar = (row: any) => {
    const segments = classificationSegments(row || {});
    return <ShareBar segments={segments} size="sm" />;
  };

  return (
    <div className={`space-y-5 ${isFetching ? 'opacity-75 transition-opacity' : ''}`} aria-busy={isFetching}>
      <PresenceBar
        counts={presenceCounts}
        selected={presenceFilter}
        onSelect={setPresenceFilter}
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Panel title="Where the time went">
          <p className="mb-2 text-2xl font-bold text-slate-900">
            {focusShare.toFixed(1)}%
            <span className="ml-2 text-sm font-medium text-slate-500">
              {focus === 'unproductive' ? 'unproductive share' : 'productive share'}
            </span>
          </p>
          <ShareBar segments={shareSegments} size="lg" />
          <ShareLegend segments={shareSegments} />
          <p className="mt-3 text-xs text-slate-500">
            Tracked {formatDuration(Number(organizationSummary.tracked_duration || 0))}
            {' · '}Work {formatDuration(Number(organizationSummary.working_duration || 0))}{shareOfTracked(organizationSummary.working_duration)}
            {' · '}Idle {formatDuration(Number(organizationSummary.idle_duration || 0))}{shareOfTracked(organizationSummary.idle_duration)}
            {' · '}Break {formatDuration(Number(organizationSummary.break_seconds || 0))}{shareOfTracked(organizationSummary.break_seconds)}
          </p>
        </Panel>

        <Panel title="Daily trend · worked vs idle">
          {trendLoading ? (
            <div className="h-36 animate-pulse rounded-lg bg-slate-100" aria-label="Loading trend" />
          ) : trendData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No tracked days in this range yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={150}>
              <BarChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E4E8EB" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value: number) => `${Math.round(value / 3600)}h`}
                />
                <Tooltip
                  formatter={(value: any, name: any) => [formatDuration(Number(value || 0)), name === 'worked' ? 'Worked' : 'Idle']}
                  labelFormatter={(_, payload: any) => String(payload?.[0]?.payload?.date || '')}
                />
                <Bar dataKey="worked" stackId="day" fill="#5D969D" radius={[0, 0, 0, 0]} />
                <Bar dataKey="idle" stackId="day" fill={IDLE_HEX} radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Panel>

        <Panel title="Departments · efficiency">
          {teamRankings.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">No department groups configured yet.</p>
          ) : (
            <div className="space-y-2.5">
              {teamRankings.slice(0, 6).map((team: any) => {
                const score = Math.max(0, Math.min(100, Number(team?.efficiency_score || 0)));
                return (
                  <div key={String(team?.group?.id ?? team?.group?.name)} className="grid grid-cols-[110px_1fr_44px] items-center gap-2 text-sm">
                    <span className="truncate text-slate-700" title={team?.group?.name}>{team?.group?.name || 'Unknown'}</span>
                    <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: `${score}%` }} />
                    </div>
                    <span className="text-right font-mono text-xs text-slate-500">{score.toFixed(0)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={`People · ranked by ${focus === 'unproductive' ? 'unproductive' : 'productive'} time`}
        action={
          <span className="text-xs text-slate-400">
            {peopleRows.length} shown{presenceFilter !== 'all' ? ` · ${PRESENCE_META[presenceFilter].label.toLowerCase()} only` : ''}
          </span>
        }
      >
        {peopleRows.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">
            {presenceFilter === 'all'
              ? 'No tracked activity in this range yet.'
              : `Nobody is ${PRESENCE_META[presenceFilter].label.toLowerCase()} right now.`}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {peopleRows.map(({ row, user: person, untracked }) => {
              const personId = Number(person?.id || 0);
              const status = statusByUser[String(personId)];
              const total = Number(row?.total_duration || row?.tracked_duration || 0);
              const idle = Number(row?.idle_duration || 0);
              const idleShare = total > 0 ? idle / total : 0;
              return (
                <li key={personId}>
                  <button
                    type="button"
                    onClick={() => openPerson(personId)}
                    className="grid w-full grid-cols-[minmax(150px,220px)_1fr_auto] items-center gap-3 rounded-lg px-2 py-2.5 text-left transition hover:bg-slate-50"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-blue-500 text-[11px] font-bold text-white">
                        {String(person?.name || '?').slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-slate-800">{person?.name || 'Unknown'}</span>
                        {status && (
                          <span className={`block text-[11px] ${PRESENCE_META[status].textClass}`}>
                            {PRESENCE_META[status].label}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="min-w-0">
                      {untracked ? (
                        <span className="text-xs text-slate-400">No tracked time in this range</span>
                      ) : (
                        renderPersonBar(row)
                      )}
                    </span>
                    <span className="flex items-center gap-2">
                      {idleShare > IDLE_ATTENTION_SHARE && (
                        <span className="rounded-full bg-accent-100 px-2 py-0.5 text-[11px] font-semibold text-accent-700">
                          idle {(idleShare * 100).toFixed(0)}%
                        </span>
                      )}
                      <span className="font-mono text-xs tabular-nums text-slate-600">
                        {untracked ? '—' : formatDuration(total)}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-400">
          Ranked from tracked activity in the selected range · top 100 by duration.
        </p>
      </Panel>

      <SlideOver
        open={drawerUserId !== null}
        title={drawerUser?.name || 'Employee'}
        subtitle={drawerUser?.email || undefined}
        onClose={closeDrawer}
      >
        {drawerUserId !== null && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              {drawerStatus && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-slate-200 ${PRESENCE_META[drawerStatus].textClass} bg-slate-50`}>
                  {PRESENCE_META[drawerStatus].label}
                </span>
              )}
              {drawerLive?.classification && (
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold capitalize ${CLASSIFICATION_META[drawerLive.classification as keyof typeof CLASSIFICATION_META]?.pillClass || CLASSIFICATION_META.neutral.pillClass}`}>
                  {String(drawerLive.classification).replace('_', ' ')}
                </span>
              )}
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              {drawerScoped && drawerLive ? (
                <>
                  <p className="font-medium text-slate-800">{resolveLiveToolLabel(drawerLive)}</p>
                  <p className="mt-1 text-slate-500">Last activity {formatDateTime(drawerLive.last_activity_at, timezone)}</p>
                </>
              ) : (
                <div className="space-y-2" aria-label="Loading live detail">
                  <div className="h-4 w-2/3 animate-pulse rounded bg-slate-200" />
                  <div className="h-3 w-1/2 animate-pulse rounded bg-slate-200" />
                </div>
              )}
            </div>

            {drawerRanking && (
              <div>
                <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Time in range</h4>
                <ShareBar segments={classificationSegments(drawerRanking)} size="md" />
                <ShareLegend
                  segments={classificationSegments(drawerRanking)}
                  formatValue={(value) => formatDuration(value)}
                />
                <p className="mt-2 text-xs text-slate-500">
                  Tracked {formatDuration(Number(drawerRanking.total_duration || 0))}
                  {' · '}Idle {formatDuration(Number(drawerRanking.idle_duration || 0))}
                  {' · '}Break {formatDuration(Number(drawerRanking.break_seconds || 0))}
                </p>
              </div>
            )}

            <div>
              <h4 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Top tools</h4>
              {!drawerScoped ? (
                <div className="h-16 animate-pulse rounded-lg bg-slate-100" aria-label="Loading tools" />
              ) : (
                (() => {
                  const toolRows = CLASSIFICATION_ORDER
                    .flatMap((classification) => ((drawerTools?.[classification] as any[]) || []).slice(0, 3)
                      .map((tool: any) => ({ ...tool, classification })))
                    .sort((a, b) => Number(b.total_duration || 0) - Number(a.total_duration || 0))
                    .slice(0, 6);
                  return toolRows.length === 0 ? (
                    <p className="text-sm text-slate-400">No classified tool usage in this range.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {toolRows.map((tool: any) => (
                        <li key={`${tool.classification}:${tool.label}`} className="flex items-center justify-between gap-2 text-sm">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className={`h-2 w-2 flex-none rounded-full ${CLASSIFICATION_META[tool.classification as keyof typeof CLASSIFICATION_META].dotClass}`} aria-hidden />
                            <span className="truncate text-slate-700" title={tool.label}>{tool.label}</span>
                          </span>
                          <span className="font-mono text-xs tabular-nums text-slate-500">{formatDuration(Number(tool.total_duration || 0))}</span>
                        </li>
                      ))}
                    </ul>
                  );
                })()
              )}
            </div>

            <Button
              variant="secondary"
              onClick={() => onOpenScreenshots(drawerUserId)}
              iconLeft={<Camera className="h-4 w-4" />}
            >
              View screenshots
            </Button>
          </div>
        )}
      </SlideOver>
    </div>
  );
}
