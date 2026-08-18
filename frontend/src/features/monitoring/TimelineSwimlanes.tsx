import { useMemo } from 'react';
import { formatDuration } from '@/lib/formatters';
import { CLASSIFICATION_META, normalizeClassification, type Classification } from './monitoringUi';

export interface TimelineSwimlanesProps {
  rows: any[];
  timezone: string;
  focusedUserId: number | '';
  onFocusPerson: (id: number | '') => void;
  truncated: boolean;
}

interface LaneBlock {
  startMs: number;
  endMs: number;
  label: string;
  classification: Classification;
  isIdle: boolean;
  /** Break time: entitled, and neither work nor idle. */
  isBreak: boolean;
  reason?: string;
  durationSeconds: number;
}

interface Lane {
  userId: number;
  userName: string;
  blocks: LaneBlock[];
  firstMs: number;
  lastMs: number;
  trackedSeconds: number;
  idleSeconds: number;
  breakSeconds: number;
}

const IDLE_PATTERN = 'repeating-linear-gradient(45deg, #9AA4AC 0 4px, transparent 4px 8px)';
/*
 * Breaks read as their own thing at a glance: a calmer, vertical hatch against
 * idle's diagonal one, so the two are told apart without reading the tooltip
 * and neither is mistaken for a coloured block of work.
 */
const BREAK_PATTERN = 'repeating-linear-gradient(90deg, #7DA9C7 0 3px, transparent 3px 9px)';

const timeLabel = (ms: number, timezone: string) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(ms));
  } catch {
    return new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
};

// Same precedence as the event log's formatTimelineToolLabel so both views
// name a block identically.
const blockLabelFor = (row: any): string =>
  String(row?.window_title || row?.name || row?.normalized_label || row?.software_name || row?.tool_type || 'Unknown').trim() || 'Unknown';

/**
 * One lane per person, one day, drawn to scale from the block boundaries
 * (`start_at`/`end_at`) the timeline API has always returned and the old
 * table threw away. Idle is hatched; untracked gaps stay empty — nothing
 * is invented. Hovering a block explains what it was and why it was
 * classified that way.
 */
export default function TimelineSwimlanes({ rows, timezone, focusedUserId, onFocusPerson, truncated }: TimelineSwimlanesProps) {
  const lanes: Lane[] = useMemo(() => {
    const byUser = new Map<number, Lane>();

    rows.forEach((row: any) => {
      const userId = Number(row?.user?.id ?? row?.user_id ?? 0);
      if (userId <= 0) return;

      const startRaw = row?.start_at || row?.recorded_at;
      const startMs = startRaw ? +new Date(startRaw) : NaN;
      if (!Number.isFinite(startMs)) return;
      const durationSeconds = Math.max(0, Number(row?.duration || 0));
      const endRaw = row?.end_at;
      const endParsed = endRaw ? +new Date(endRaw) : NaN;
      const endMs = Number.isFinite(endParsed) && endParsed > startMs
        ? endParsed
        : startMs + Math.max(durationSeconds, 30) * 1000;

      const isIdle = String(row?.type) === 'idle' || String(row?.tool_type) === 'idle';
      /*
       * Break time is neither work nor idle, and must not be drawn as either.
       *
       * Anything that was not `idle` fell through to the classified-activity
       * branch, so a break rendered as a coloured block indistinguishable from
       * real work — 158 hours of it on this database, every row carrying a NULL
       * classification. Idle is the person being away from a running timer; a
       * break is time they are entitled to and which the Break figure elsewhere
       * already counts separately.
       */
      const isBreak = !isIdle && (String(row?.type) === 'breaks' || String(row?.type) === 'break');

      if (!byUser.has(userId)) {
        byUser.set(userId, {
          userId,
          userName: row?.user?.name || 'Unknown',
          blocks: [],
          firstMs: startMs,
          lastMs: endMs,
          trackedSeconds: 0,
          idleSeconds: 0,
          breakSeconds: 0,
        });
      }

      const lane = byUser.get(userId)!;
      lane.blocks.push({
        startMs,
        endMs,
        label: isIdle ? 'Idle' : isBreak ? 'Break' : blockLabelFor(row),
        classification: normalizeClassification(row?.classification),
        isIdle,
        isBreak,
        reason: row?.classification_reason ? String(row.classification_reason) : undefined,
        durationSeconds,
      });
      lane.firstMs = Math.min(lane.firstMs, startMs);
      lane.lastMs = Math.max(lane.lastMs, endMs);
      if (isIdle) {
        lane.idleSeconds += durationSeconds;
      } else if (isBreak) {
        // Counted on its own so the lane's tracked total stays "time worked".
        lane.breakSeconds += durationSeconds;
      } else {
        lane.trackedSeconds += durationSeconds;
      }
    });

    return Array.from(byUser.values())
      .map((lane) => ({ ...lane, blocks: lane.blocks.sort((a, b) => a.startMs - b.startMs) }))
      .sort((a, b) => b.trackedSeconds - a.trackedSeconds);
  }, [rows]);

  const visibleLanes = focusedUserId === '' ? lanes : lanes.filter((lane) => lane.userId === Number(focusedUserId));

  const window = useMemo(() => {
    const source = visibleLanes.length > 0 ? visibleLanes : lanes;
    if (source.length === 0) return null;
    const HOUR = 3_600_000;
    const min = Math.min(...source.map((lane) => lane.firstMs));
    const max = Math.max(...source.map((lane) => lane.lastMs));
    const start = Math.floor(min / HOUR) * HOUR;
    const end = Math.max(Math.ceil(max / HOUR) * HOUR, start + HOUR);
    return { start, end, span: end - start };
  }, [visibleLanes, lanes]);

  const ticks = useMemo(() => {
    if (!window) return [];
    const count = 6;
    return Array.from({ length: count + 1 }, (_, index) => window.start + (window.span * index) / count);
  }, [window]);

  const focusedLane = focusedUserId !== '' ? lanes.find((lane) => lane.userId === Number(focusedUserId)) || null : null;

  const hourGroups = useMemo(() => {
    if (!focusedLane) return [];
    const map = new Map<number, LaneBlock[]>();
    focusedLane.blocks.forEach((block) => {
      const hour = Math.floor(block.startMs / 3_600_000) * 3_600_000;
      if (!map.has(hour)) map.set(hour, []);
      map.get(hour)!.push(block);
    });
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [focusedLane]);

  if (lanes.length === 0 || !window) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
        <p className="text-sm font-medium text-slate-700">No tracked blocks on this day.</p>
        <p className="mt-1 text-sm text-slate-500">Pick another day, or check that timers were running.</p>
      </div>
    );
  }

  const positionFor = (block: LaneBlock) => {
    const left = ((block.startMs - window.start) / window.span) * 100;
    const width = ((block.endMs - block.startMs) / window.span) * 100;
    return {
      left: `${Math.max(0, Math.min(100, left))}%`,
      width: `${Math.max(0.35, Math.min(100 - Math.max(0, left), width))}%`,
    };
  };

  return (
    <div className="space-y-4">
      {truncated && (
        <p className="rounded-lg bg-accent-100 px-3 py-2 text-xs font-semibold text-accent-700">
          This day has more blocks than one load carries (first 1,000 shown) — narrow to a department or person for the complete picture.
        </p>
      )}

      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="space-y-3">
          {visibleLanes.map((lane) => (
            <div key={lane.userId} className="grid grid-cols-[minmax(150px,190px)_1fr] items-center gap-3">
              <button
                type="button"
                onClick={() => onFocusPerson(focusedUserId === lane.userId ? '' : lane.userId)}
                className="min-w-0 rounded-lg px-1.5 py-1 text-left transition hover:bg-slate-50"
                title={focusedUserId === lane.userId ? 'Clear focus' : `Focus on ${lane.userName}'s day`}
              >
                <span className="block truncate text-sm font-medium text-slate-800">{lane.userName}</span>
                <span className="block font-mono text-[11px] text-slate-500">
                  {timeLabel(lane.firstMs, timezone)} – {timeLabel(lane.lastMs, timezone)}
                  {' · '}{formatDuration(lane.trackedSeconds)}
                  {lane.breakSeconds > 0 ? ` · ${formatDuration(lane.breakSeconds)} break` : ''}
                </span>
              </button>
              <div className="relative h-6 overflow-hidden rounded-md bg-slate-100" role="img" aria-label={`${lane.userName}'s day timeline`}>
                {lane.blocks.map((block, index) => (
                  <span
                    key={index}
                    className={`absolute inset-y-0 ${block.isIdle || block.isBreak ? '' : CLASSIFICATION_META[block.classification].barClass}`}
                    style={{
                      ...positionFor(block),
                      ...(block.isIdle ? { backgroundImage: IDLE_PATTERN, opacity: 0.7 } : {}),
                      ...(block.isBreak ? { backgroundImage: BREAK_PATTERN, opacity: 0.85 } : {}),
                    }}
                    title={`${timeLabel(block.startMs, timezone)} – ${timeLabel(block.endMs, timezone)} · ${block.label} · ${block.isIdle ? 'idle' : block.isBreak ? 'break' : CLASSIFICATION_META[block.classification].label.toLowerCase()}${block.reason ? ` — ${block.reason}` : ''}`}
                  />
                ))}
              </div>
            </div>
          ))}
          <div className="grid grid-cols-[minmax(150px,190px)_1fr] gap-3">
            <span />
            <div className="flex justify-between font-mono text-[10px] text-slate-400">
              {ticks.map((tick) => (
                <span key={tick}>{timeLabel(tick, timezone)}</span>
              ))}
            </div>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-400">
          Colored blocks are classified activity, diagonal hatch is recorded idle, vertical hatch is
          break time, empty is untracked. Hover a block for the tool and the classification reason. Click a name to zoom into their day.
        </p>
      </div>

      {focusedLane && (
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
              {focusedLane.userName} · blocks by hour
            </h3>
            <button
              type="button"
              onClick={() => onFocusPerson('')}
              className="text-xs font-semibold text-blue-700 hover:underline"
            >
              Show everyone
            </button>
          </div>
          <div className="space-y-4">
            {hourGroups.map(([hourMs, blocks]) => (
              <div key={hourMs}>
                <p className="mb-1.5 font-mono text-xs font-semibold text-slate-500">{timeLabel(hourMs, timezone)}</p>
                <ul className="space-y-1">
                  {blocks.map((block, index) => (
                    <li key={index} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                      <span className="w-28 flex-none font-mono text-[11px] tabular-nums text-slate-500">
                        {timeLabel(block.startMs, timezone)} – {timeLabel(block.endMs, timezone)}
                      </span>
                      <span
                        className={`h-2.5 w-2.5 flex-none rounded-sm ${block.isIdle ? '' : CLASSIFICATION_META[block.classification].dotClass}`}
                        style={block.isIdle ? { backgroundImage: IDLE_PATTERN } : undefined}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1 truncate text-slate-700" title={block.reason || block.label}>
                        {block.label}
                      </span>
                      <span className="font-mono text-xs tabular-nums text-slate-500">{formatDuration(block.durationSeconds)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
