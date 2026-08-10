import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowUpDown, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import { formatDuration } from '@/lib/formatters';

export type AttendanceSort = 'name' | 'attendance_asc' | 'worked_desc' | 'idle_desc';
export type AttendanceTile = 'all' | 'working' | 'low' | 'leave';

export interface AttendanceRow {
  user: {
    id: number;
    name: string;
    email?: string | null;
    department?: string | null;
    employee_work_info?: { department?: { name?: string | null } | null } | null;
  };
  department?: string | null;
  days_present: number;
  leave_days: number;
  attendance_rate: number;
  calendar_days_in_range?: number;
  working_days_in_range?: number;
  worked_seconds?: number;
  total_break_seconds?: number;
  is_working?: boolean;
  present_dates?: string[];
  leave_dates?: string[];
  work_time_breakdown?: {
    track_time?: number;
    work_time?: number;
    idle_time?: number;
  };
}

const TILE_STORAGE_KEY = 'attendance.tile';
const GROUPS_STORAGE_KEY = 'attendance.groups';
const LOW_ATTENDANCE_THRESHOLD = 75;

const workedOf = (row: AttendanceRow) => row.work_time_breakdown?.work_time ?? row.worked_seconds ?? 0;
const idleOf = (row: AttendanceRow) => row.work_time_breakdown?.idle_time ?? 0;

/**
 * Department off the row itself. The attendance payload already carries it in
 * one of these shapes; anyone carrying none lands in an explicit group rather
 * than silently disappearing from a grouped view.
 */
const departmentOf = (row: AttendanceRow): string =>
  String(
    row.department
      || row.user?.department
      || row.user?.employee_work_info?.department?.name
      || ''
  ).trim() || 'No department';

const initialsOf = (value: string): string => {
  const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

/** Banded, not continuous: the column answers fine / slipping / problem. */
export function RateBar({ rate }: { rate: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(rate)));
  const tone = clamped >= 90 ? '#10B981' : clamped >= LOW_ATTENDANCE_THRESHOLD ? '#5D969D' : '#C8923A';

  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
        <span className="block h-full rounded-full" style={{ width: `${clamped}%`, backgroundColor: tone }} />
      </span>
      <span
        className="text-xs font-bold tabular-nums"
        style={{ color: clamped >= LOW_ATTENDANCE_THRESHOLD ? '#3A4147' : '#7A560E' }}
      >
        {clamped}%
      </span>
    </span>
  );
}

/** Worked / idle / break as one proportional bar — the split is the story. */
export function TimeSplit({ row }: { row: AttendanceRow }) {
  const work = Math.max(0, workedOf(row));
  const idle = Math.max(0, idleOf(row));
  const brk = Math.max(0, row.total_break_seconds ?? 0);
  const total = work + idle + brk;

  if (total === 0) return <span className="text-xs text-slate-300">—</span>;

  const segments = [
    { key: 'work', value: work, color: '#5D969D', label: 'Worked' },
    { key: 'idle', value: idle, color: '#C8923A', label: 'Idle' },
    { key: 'break', value: brk, color: '#D2D8DD', label: 'Break' },
  ].filter((segment) => segment.value > 0);

  return (
    <span className="block">
      <span className="mb-1 block text-xs font-bold tabular-nums text-slate-800">{formatDuration(work)}</span>
      <span className="flex h-1.5 w-24 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <span
            key={segment.key}
            style={{ flex: segment.value, backgroundColor: segment.color }}
            title={`${segment.label} ${formatDuration(segment.value)}`}
          />
        ))}
      </span>
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────
   Tiles — the summary IS the filter
   ──────────────────────────────────────────────────────────────── */

const TILES: Array<{
  key: AttendanceTile;
  label: string;
  warn?: boolean;
  match: (row: AttendanceRow) => boolean;
}> = [
  { key: 'all', label: 'Everyone', match: () => true },
  { key: 'working', label: 'On the clock', match: (row) => Boolean(row.is_working) },
  { key: 'low', label: `Below ${LOW_ATTENDANCE_THRESHOLD}%`, warn: true, match: (row) => row.attendance_rate < LOW_ATTENDANCE_THRESHOLD },
  { key: 'leave', label: 'On leave', match: (row) => (row.leave_days ?? 0) > 0 },
];

const SORTS: Array<{ key: AttendanceSort; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'attendance_asc', label: 'Lowest attendance' },
  { key: 'worked_desc', label: 'Most worked' },
  { key: 'idle_desc', label: 'Most idle' },
];

const sortRows = (rows: AttendanceRow[], sort: AttendanceSort): AttendanceRow[] => {
  const copy = [...rows];
  switch (sort) {
    case 'attendance_asc':
      return copy.sort((a, b) => a.attendance_rate - b.attendance_rate);
    case 'worked_desc':
      return copy.sort((a, b) => workedOf(b) - workedOf(a));
    case 'idle_desc':
      return copy.sort((a, b) => idleOf(b) - idleOf(a));
    default:
      return copy.sort((a, b) => String(a.user.name).localeCompare(String(b.user.name)));
  }
};

/* ────────────────────────────────────────────────────────────────
   Roster
   ──────────────────────────────────────────────────────────────── */

export interface AttendanceRosterProps {
  rows: AttendanceRow[];
  isLoading: boolean;
  selectedUserId: number | null;
  onOpenPerson: (userId: number) => void;
}

/**
 * The anti-scroll design: the daily job is "who needs attention?", not "read
 * everyone". Tiles narrow to the people that match; departments collapse to a
 * one-line summary until opened, so scroll is proportional to what you opened
 * rather than to headcount.
 */
export default function AttendanceRoster({
  rows,
  isLoading,
  selectedUserId,
  onOpenPerson,
}: AttendanceRosterProps) {
  const [tile, setTile] = useState<AttendanceTile>(() => {
    if (typeof window === 'undefined') return 'all';
    const stored = window.localStorage.getItem(TILE_STORAGE_KEY);
    return TILES.some((candidate) => candidate.key === stored) ? (stored as AttendanceTile) : 'all';
  });
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const stored = JSON.parse(window.localStorage.getItem(GROUPS_STORAGE_KEY) || '[]');
      return new Set(Array.isArray(stored) ? stored.filter((v) => typeof v === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [sort, setSort] = useState<AttendanceSort>('name');
  const [query, setQuery] = useState('');

  useEffect(() => {
    window.localStorage.setItem(TILE_STORAGE_KEY, tile);
  }, [tile]);
  useEffect(() => {
    window.localStorage.setItem(GROUPS_STORAGE_KEY, JSON.stringify(Array.from(expanded)));
  }, [expanded]);

  const needle = query.trim().toLowerCase();
  const activeTile = TILES.find((candidate) => candidate.key === tile) ?? TILES[0];
  // A filter or search means the user asked a question — show the answers
  // directly instead of making them open each group to find out.
  const forceOpen = tile !== 'all' || needle !== '';

  const matches = (row: AttendanceRow): boolean => {
    if (!activeTile.match(row)) return false;
    if (!needle) return true;
    return [row.user.name, row.user.email].filter(Boolean).join(' ').toLowerCase().includes(needle);
  };

  const searched = useMemo(
    () =>
      needle
        ? rows.filter((row) =>
            [row.user.name, row.user.email].filter(Boolean).join(' ').toLowerCase().includes(needle)
          )
        : rows,
    [rows, needle]
  );

  const groups = useMemo(() => {
    const byDept = new Map<string, AttendanceRow[]>();
    rows.forEach((row) => {
      const dept = departmentOf(row);
      byDept.set(dept, [...(byDept.get(dept) ?? []), row]);
    });

    return Array.from(byDept.entries())
      .sort(([a], [b]) => (a === 'No department' ? 1 : b === 'No department' ? -1 : a.localeCompare(b)))
      .map(([name, members]) => {
        const visible = sortRows(members.filter(matches), sort);
        return {
          name,
          total: members.length,
          visible,
          live: members.filter((row) => row.is_working).length,
          low: members.filter((row) => row.attendance_rate < LOW_ATTENDANCE_THRESHOLD).length,
          avgRate: Math.round(members.reduce((sum, row) => sum + row.attendance_rate, 0) / members.length),
        };
      })
      // Under a filter, a group with no matches is noise, not information.
      .filter((group) => group.visible.length > 0 || (tile === 'all' && !needle));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, tile, needle, sort]);

  const toggleGroup = (name: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center text-sm text-slate-400">
        Loading attendance…
      </div>
    );
  }

  const avgRate = rows.length
    ? Math.round(rows.reduce((sum, row) => sum + row.attendance_rate, 0) / rows.length)
    : 0;

  return (
    <div className="space-y-3">
      {/* Tiles: each one is a filter, and the count is the summary. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {TILES.map((candidate) => {
          const count = searched.filter(candidate.match).length;
          const active = tile === candidate.key;
          return (
            <button
              key={candidate.key}
              type="button"
              aria-pressed={active}
              onClick={() => setTile(active && candidate.key !== 'all' ? 'all' : candidate.key)}
              className={`rounded-xl border px-4 py-3 text-left transition ${
                active
                  ? candidate.warn
                    ? 'border-accent-400 bg-accent-50'
                    : 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 bg-white hover:border-slate-300'
              }`}
            >
              <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">
                {candidate.label}
              </p>
              <p
                className={`mt-1 text-xl font-bold tabular-nums tracking-[-0.02em] ${
                  candidate.warn && count > 0 ? 'text-warning-800' : 'text-slate-950'
                }`}
              >
                {count}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-slate-500">
                {candidate.key === 'all'
                  ? `avg ${avgRate}% attendance`
                  : active
                    ? 'showing only these'
                    : 'click to filter'}
              </p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search people"
            aria-label="Search attendance"
            className="w-56 rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-8 text-xs text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <ArrowUpDown className="h-3 w-3 text-slate-400" />
          {SORTS.map((option) => (
            <button
              key={option.key}
              type="button"
              aria-pressed={sort === option.key}
              onClick={() => setSort(option.key)}
              className={`rounded-full px-2 py-1 text-[10px] font-bold transition ${
                sort === option.key ? 'bg-blue-50 text-blue-800' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200 bg-white px-6 py-14 text-center">
          <p className="text-sm font-semibold text-slate-900">Nobody matches</p>
          <p className="mt-1 text-sm text-slate-500">Clear the search or the active tile above.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const open = forceOpen || expanded.has(group.name);
            return (
              <section key={group.name} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggleGroup(group.name)}
                  className="flex w-full items-center gap-2.5 px-4 py-3 text-left transition hover:bg-slate-50"
                >
                  {open ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                  )}
                  <span className="text-[13px] font-bold tracking-[-0.015em] text-slate-950">{group.name}</span>
                  <span className="text-[10px] font-semibold tabular-nums text-slate-400">
                    {forceOpen ? `${group.visible.length} of ${group.total}` : group.total}
                  </span>

                  <span className="ml-auto flex items-center gap-3 text-[10px] font-semibold text-slate-500">
                    <span className="hidden items-center gap-1.5 sm:flex">
                      <span className="h-2 w-2 rounded-full bg-success-500" />
                      {group.live} live
                    </span>
                    {group.low > 0 ? (
                      <span className="flex items-center gap-1 text-warning-800">
                        <AlertTriangle className="h-3 w-3" />
                        {group.low} low
                      </span>
                    ) : null}
                    <span className="hidden h-1.5 w-20 overflow-hidden rounded-full bg-slate-100 sm:block">
                      <span
                        className="block h-full rounded-full bg-blue-400"
                        style={{ width: `${group.avgRate}%` }}
                      />
                    </span>
                    <span className="tabular-nums">{group.avgRate}%</span>
                  </span>
                </button>

                {open ? (
                  <div className="border-t border-slate-100">
                    {group.visible.length === 0 ? (
                      <p className="px-4 py-5 text-center text-xs text-slate-400">
                        Nobody in {group.name} matches the current filter.
                      </p>
                    ) : (
                      group.visible.map((row) => {
                        const denominator = row.calendar_days_in_range || row.working_days_in_range || 0;
                        const low = row.attendance_rate < LOW_ATTENDANCE_THRESHOLD;
                        return (
                          <button
                            key={row.user.id}
                            type="button"
                            onClick={() => onOpenPerson(row.user.id)}
                            className={`grid w-full grid-cols-[minmax(150px,1.5fr)_70px_130px_minmax(110px,1fr)_60px] items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition last:border-b-0 ${
                              selectedUserId === row.user.id ? 'bg-blue-50' : 'hover:bg-blue-50/60'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-3">
                              <span className="relative shrink-0">
                                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-600">
                                  {initialsOf(row.user.name)}
                                </span>
                                <span
                                  className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${
                                    row.is_working ? 'bg-success-500' : 'bg-slate-300'
                                  }`}
                                  title={row.is_working ? 'Working now' : 'Not tracking'}
                                />
                              </span>
                              <span className="min-w-0">
                                <span className="flex items-center gap-1.5">
                                  <span className="truncate text-[13px] font-semibold text-slate-950">
                                    {row.user.name}
                                  </span>
                                  {low ? (
                                    <span title={`Attendance below ${LOW_ATTENDANCE_THRESHOLD}%`}>
                                      <AlertTriangle className="h-3 w-3 shrink-0 text-accent-500" />
                                    </span>
                                  ) : null}
                                </span>
                                <span className="block truncate text-[11px] text-slate-400">{row.user.email}</span>
                              </span>
                            </span>

                            <span className="text-xs tabular-nums text-slate-600">
                              <b className="font-bold text-slate-800">{row.days_present}</b>
                              {denominator > 0 ? <span className="text-slate-400"> / {denominator}</span> : null}
                            </span>

                            <RateBar rate={row.attendance_rate} />

                            <TimeSplit row={row} />

                            <span
                              className={`inline-flex items-center justify-self-start rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] ${
                                row.is_working
                                  ? 'border-success-100 bg-success-50 text-success-800'
                                  : 'border-slate-200 text-slate-500'
                              }`}
                            >
                              {row.is_working ? 'Live' : 'Off'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                ) : null}
              </section>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-4 px-1 text-[10px] font-semibold text-slate-400">
        {[
          { color: '#5D969D', label: 'Worked' },
          { color: '#C8923A', label: 'Idle' },
          { color: '#D2D8DD', label: 'Break' },
        ].map((legend) => (
          <span key={legend.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: legend.color }} />
            {legend.label}
          </span>
        ))}
        <span className="ml-auto">Click a person for their dates and summary</span>
      </div>
    </div>
  );
}
