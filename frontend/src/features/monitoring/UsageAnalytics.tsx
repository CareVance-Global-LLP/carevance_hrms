import { useMemo, useState } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { formatDuration } from '@/lib/formatters';
import {
  CLASSIFICATION_META,
  CLASSIFICATION_ORDER,
  IDLE_HEX,
  Panel,
  ShareBar,
  ShareLegend,
  classificationSegments,
  normalizeClassification,
  type Classification,
} from './monitoringUi';

export interface UsageAnalyticsProps {
  data: any;
  hasSelectedEmployee: boolean;
  scopeLabel: string;
  isFetching: boolean;
  canReclassify: boolean;
  onReclassify: (targetType: 'app' | 'domain', targetValue: string, classification: Classification) => Promise<boolean>;
}

type ClassFilter = 'all' | Classification;
type TypeFilter = 'all' | 'software' | 'website';

interface ToolRow {
  label: string;
  type: string;
  classification: Classification;
  total_duration: number;
  total_events?: number;
  users_count?: number;
}

const BREAKDOWN_META: Record<string, { label: string; hex: string }> = {
  app: { label: 'Applications', hex: '#5D969D' },
  url: { label: 'Websites', hex: '#3D656B' },
  idle: { label: 'Idle', hex: IDLE_HEX },
};

/**
 * The single usage surface: org share bar + app/web/idle donut up top, one
 * ranked tool list filtered by chips (instead of four parallel tables in
 * nested scrollboxes), then people and departments. Every number names its
 * scope; the server's top-25-per-class cap is disclosed, not hidden.
 */
export default function UsageAnalytics({
  data,
  hasSelectedEmployee,
  scopeLabel,
  isFetching,
  canReclassify,
  onReclassify,
}: UsageAnalyticsProps) {
  const [classFilter, setClassFilter] = useState<ClassFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [reclassifyNote, setReclassifyNote] = useState<{ key: string; ok: boolean } | null>(null);

  const orgSummary = data?.organization_summary || {};
  const stats = data?.stats || {};
  const activityBreakdown: any[] = Array.isArray(data?.activity_breakdown) ? data.activity_breakdown : [];
  const employeeRankings: any[] = data?.employee_rankings?.by_productive_duration || [];
  const teamRankings: any[] = data?.team_rankings?.by_efficiency || [];

  const toolSource = hasSelectedEmployee
    ? data?.selected_user_tools || {}
    : data?.organization_tools || {};

  const toolRows: ToolRow[] = useMemo(() => {
    const merged: ToolRow[] = CLASSIFICATION_ORDER.flatMap((classification) =>
      ((toolSource?.[classification] as any[]) || []).map((tool: any) => ({
        label: String(tool?.label || 'Unknown'),
        type: String(tool?.type || ''),
        classification,
        total_duration: Number(tool?.total_duration || 0),
        total_events: Number(tool?.total_events || 0),
        users_count: Number(tool?.users_count || 0) || undefined,
      })));
    return merged.sort((a, b) => b.total_duration - a.total_duration);
  }, [toolSource]);

  const filteredTools = toolRows.filter((tool) => {
    if (classFilter !== 'all' && tool.classification !== classFilter) return false;
    if (typeFilter !== 'all' && tool.type !== typeFilter) return false;
    return true;
  });
  const maxToolDuration = Math.max(1, ...filteredTools.map((tool) => tool.total_duration));

  const shareSegments = classificationSegments(hasSelectedEmployee ? stats : orgSummary);
  const donutData = activityBreakdown
    .map((entry: any) => ({
      key: String(entry?.type || ''),
      name: BREAKDOWN_META[String(entry?.type || '')]?.label || String(entry?.type || 'Other'),
      value: Math.max(0, Number(entry?.total_duration || 0)),
      hex: BREAKDOWN_META[String(entry?.type || '')]?.hex || IDLE_HEX,
    }))
    .filter((entry) => entry.value > 0);

  const summarySource = hasSelectedEmployee ? stats : orgSummary;

  const classChips: Array<{ key: ClassFilter; label: string }> = [
    { key: 'all', label: 'All' },
    ...CLASSIFICATION_ORDER.map((classification) => ({
      key: classification as ClassFilter,
      label: CLASSIFICATION_META[classification].label,
    })),
  ];

  const handleReclassify = async (tool: ToolRow, next: Classification) => {
    if (next === tool.classification) return;
    const key = `${tool.type}:${tool.label}`;
    setSavingKey(key);
    setReclassifyNote(null);
    const targetType: 'app' | 'domain' = tool.type === 'website' ? 'domain' : 'app';
    const ok = await onReclassify(targetType, tool.label, next);
    setSavingKey(null);
    setReclassifyNote({ key, ok });
  };

  return (
    <div className={`space-y-5 ${isFetching ? 'opacity-75 transition-opacity' : ''}`} aria-busy={isFetching}>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Panel title={`Productivity · ${scopeLabel}`}>
          <p className="mb-2 text-2xl font-bold text-slate-900">
            {Number(orgSummary.productive_share || 0).toFixed(1)}%
            <span className="ml-2 text-sm font-medium text-slate-500">productive share</span>
          </p>
          <ShareBar segments={shareSegments} size="lg" />
          <ShareLegend segments={shareSegments} />
          <p className="mt-3 text-xs text-slate-500">
            Tracked {formatDuration(Number(summarySource.tracked_duration || summarySource.total_duration || 0))}
            {' · '}Work {formatDuration(Number(summarySource.working_duration || 0))}
            {' · '}Idle {formatDuration(Number(summarySource.idle_duration ?? summarySource.idle_total_duration ?? 0))}
            {' · '}Break {formatDuration(Number(summarySource.break_seconds || 0))}
          </p>
        </Panel>

        <Panel title="Time by activity kind">
          {donutData.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No recorded activity in this range yet.</p>
          ) : (
            <div className="flex items-center gap-5">
              <div className="h-36 w-36 flex-none">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={donutData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="55%"
                      outerRadius="95%"
                      strokeWidth={2}
                    >
                      {donutData.map((entry) => (
                        <Cell key={entry.key} fill={entry.hex} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value: any, name: any) => [formatDuration(Number(value || 0)), name]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="space-y-2 text-sm">
                {donutData.map((entry) => (
                  <li key={entry.key} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: entry.hex }} aria-hidden />
                    <span className="text-slate-700">{entry.name}</span>
                    <span className="font-mono text-xs tabular-nums text-slate-500">{formatDuration(entry.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel
        title={`Top tools · ${scopeLabel}`}
        action={<span className="text-xs text-slate-500">{filteredTools.length} shown</span>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {classChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={classFilter === chip.key}
              onClick={() => setClassFilter(chip.key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                classFilter === chip.key
                  ? 'bg-blue-700 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300'
              }`}
            >
              {chip.label}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
          {([['all', 'All types'], ['software', 'Apps'], ['website', 'Websites']] as Array<[TypeFilter, string]>).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={typeFilter === key}
              onClick={() => setTypeFilter(key)}
              className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                typeFilter === key
                  ? 'bg-blue-700 text-white'
                  : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {filteredTools.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-500">No tool usage matches these filters in this range.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {filteredTools.map((tool) => {
              const key = `${tool.type}:${tool.label}`;
              return (
                <li key={`${key}:${tool.classification}`} className="grid grid-cols-[minmax(160px,1.4fr)_minmax(120px,1fr)_auto] items-center gap-3 py-2.5">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md bg-slate-100 font-mono text-[10px] font-bold uppercase text-slate-500">
                      {tool.label.slice(0, 2)}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-slate-800" title={tool.label}>{tool.label}</span>
                      <span className="block text-[11px] text-slate-500">
                        {tool.type === 'website' ? 'website' : 'application'}
                        {tool.total_events ? ` · ${tool.total_events} events` : ''}
                        {tool.users_count ? ` · ${tool.users_count} ${tool.users_count === 1 ? 'person' : 'people'}` : ''}
                      </span>
                    </span>
                  </span>
                  <span className="hidden sm:block">
                    <span className="block h-2 overflow-hidden rounded-full bg-slate-100">
                      <span
                        className={`block h-full rounded-full ${CLASSIFICATION_META[tool.classification].barClass}`}
                        style={{ width: `${Math.max(2, (tool.total_duration / maxToolDuration) * 100)}%` }}
                      />
                    </span>
                  </span>
                  <span className="flex items-center gap-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${CLASSIFICATION_META[tool.classification].pillClass}`}>
                      {CLASSIFICATION_META[tool.classification].label}
                    </span>
                    <span className="w-16 text-right font-mono text-xs tabular-nums text-slate-600">
                      {formatDuration(tool.total_duration)}
                    </span>
                    {canReclassify && (
                      <span className="flex items-center gap-1">
                        <label className="sr-only" htmlFor={`reclassify-${key}`}>Reclassify {tool.label}</label>
                        <select
                          id={`reclassify-${key}`}
                          value={tool.classification}
                          disabled={savingKey === key}
                          onChange={(event) => void handleReclassify(tool, event.target.value as Classification)}
                          className="rounded-md border border-slate-200 bg-white px-1.5 py-1 text-[11px] text-slate-600"
                        >
                          {CLASSIFICATION_ORDER.map((classification) => (
                            <option key={classification} value={classification}>
                              {CLASSIFICATION_META[classification].label}
                            </option>
                          ))}
                        </select>
                        {reclassifyNote?.key === key && (
                          <span className={`text-[11px] font-semibold ${reclassifyNote.ok ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {reclassifyNote.ok ? 'Saved' : 'Failed'}
                          </span>
                        )}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-slate-500">
          Top 25 per classification by duration — ranked from tracked activity in the selected range.
          {canReclassify ? ' Reclassifying applies org-wide from the next processing run.' : ''}
        </p>
      </Panel>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Panel title="People · productive time">
          {employeeRankings.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No tracked activity in this range yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {employeeRankings.slice(0, 15).map((row: any) => (
                <li key={Number(row?.user?.id || 0)} className="grid grid-cols-[minmax(130px,200px)_1fr_64px] items-center gap-3 py-2">
                  <span className="truncate text-sm font-medium text-slate-800">{row?.user?.name || 'Unknown'}</span>
                  <ShareBar segments={classificationSegments(row || {})} size="sm" />
                  <span className="text-right font-mono text-xs tabular-nums text-slate-600">
                    {formatDuration(Number(row?.total_duration || 0))}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {employeeRankings.length > 15 && (
            <p className="mt-2 text-xs text-slate-500">Showing 15 of {employeeRankings.length} tracked people.</p>
          )}
        </Panel>

        <Panel title="Departments · efficiency">
          {teamRankings.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">No department groups configured yet.</p>
          ) : (
            <div className="space-y-2.5">
              {teamRankings.slice(0, 8).map((team: any) => {
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
    </div>
  );
}

export { normalizeClassification };
