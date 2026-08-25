import type { ReactNode } from 'react';

/**
 * Shared visual grammar for the monitoring suite.
 *
 * One place owns the classification → color mapping so the share bars,
 * person rows, pills, and charts across Monitoring, Web & App Usage,
 * Timeline, and Screenshots can never drift apart. `blue-*` here renders
 * as brand teal (tailwind re-points it), so context-dependent reads as
 * "brand-colored: it depends", while gold stays reserved for attention.
 */
export type Classification = 'productive' | 'unproductive' | 'neutral' | 'context_dependent';

export const CLASSIFICATION_ORDER: Classification[] = ['productive', 'neutral', 'context_dependent', 'unproductive'];

export const CLASSIFICATION_META: Record<Classification, {
  label: string;
  barClass: string;
  pillClass: string;
  dotClass: string;
  hex: string;
}> = {
  productive: {
    label: 'Productive',
    barClass: 'bg-emerald-500',
    pillClass: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
    dotClass: 'bg-emerald-500',
    hex: '#10B981',
  },
  neutral: {
    label: 'Neutral',
    barClass: 'bg-slate-300',
    pillClass: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
    dotClass: 'bg-slate-300',
    hex: '#D2D8DD',
  },
  context_dependent: {
    label: 'Context',
    barClass: 'bg-blue-500',
    pillClass: 'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
    dotClass: 'bg-blue-500',
    hex: '#5D969D',
  },
  unproductive: {
    label: 'Unproductive',
    barClass: 'bg-rose-500',
    pillClass: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
    dotClass: 'bg-rose-500',
    hex: '#F43F5E',
  },
};

export const IDLE_HEX = '#9AA4AC';

export const normalizeClassification = (value?: string | null): Classification => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'productive' || normalized === 'unproductive' || normalized === 'context_dependent'
    ? (normalized as Classification)
    : 'neutral';
};

export interface ShareSegment {
  key: string;
  label: string;
  value: number;
  barClass: string;
}

export const classificationSegments = (source: Record<string, unknown>, prefix = '', suffix = '_duration'): ShareSegment[] =>
  CLASSIFICATION_ORDER
    .map((classification) => ({
      key: classification,
      label: CLASSIFICATION_META[classification].label,
      value: Math.max(0, Number(source?.[`${prefix}${classification}${suffix}`] ?? 0)),
      barClass: CLASSIFICATION_META[classification].barClass,
    }))
    .filter((segment) => segment.value > 0);

/**
 * A 100%-stacked horizontal bar. Segments with zero value are skipped;
 * when everything is zero it renders a quiet empty track so layouts hold.
 */
export function ShareBar({ segments, size = 'md', className = '' }: {
  segments: ShareSegment[];
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);
  const height = size === 'lg' ? 'h-5' : size === 'md' ? 'h-3.5' : 'h-2';

  return (
    <div
      className={`flex w-full overflow-hidden rounded-full bg-slate-100 ${height} ${className}`}
      role="img"
      aria-label={
        total > 0
          ? segments.map((segment) => `${segment.label} ${Math.round((segment.value / total) * 100)}%`).join(', ')
          : 'No data'
      }
    >
      {total > 0 && segments.map((segment) => (
        <div
          key={segment.key}
          className={segment.barClass}
          style={{ width: `${(segment.value / total) * 100}%` }}
          title={`${segment.label} · ${Math.round((segment.value / total) * 100)}%`}
        />
      ))}
    </div>
  );
}

export function ShareLegend({ segments, formatValue }: {
  segments: ShareSegment[];
  formatValue?: (value: number, total: number) => string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.value, 0);

  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
      {segments.map((segment) => (
        <span key={segment.key} className="inline-flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-sm ${segment.barClass}`} aria-hidden />
          {segment.label}{' '}
          {formatValue
            ? formatValue(segment.value, total)
            : `${total > 0 ? Math.round((segment.value / total) * 100) : 0}%`}
        </span>
      ))}
    </div>
  );
}

export type PresenceStatus = 'active' | 'idle' | 'on_break' | 'on_leave' | 'inactive';

export const PRESENCE_META: Record<PresenceStatus, { label: string; barClass: string; textClass: string }> = {
  active: { label: 'Active', barClass: 'bg-emerald-500', textClass: 'text-emerald-700' },
  idle: { label: 'Idle', barClass: 'bg-slate-400', textClass: 'text-slate-600' },
  on_break: { label: 'On break', barClass: 'bg-blue-500', textClass: 'text-blue-700' },
  on_leave: { label: 'On leave', barClass: 'bg-accent-500', textClass: 'text-accent-700' },
  inactive: { label: 'Offline', barClass: 'bg-slate-200', textClass: 'text-slate-500' },
};

export const PRESENCE_ORDER: PresenceStatus[] = ['active', 'idle', 'on_break', 'on_leave', 'inactive'];

/**
 * The right-now strip: one segment per live status, each segment a filter.
 * Counts come from the server's true totals (`live_monitoring.counts`),
 * never from the capped row arrays.
 */
export function PresenceBar({ counts, selected, onSelect }: {
  counts: Partial<Record<PresenceStatus, number>>;
  selected: PresenceStatus | 'all';
  onSelect: (status: PresenceStatus | 'all') => void;
}) {
  const entries = PRESENCE_ORDER
    .map((status) => ({ status, count: Math.max(0, Number(counts[status] ?? 0)) }))
    .filter((entry) => entry.count > 0);
  const total = entries.reduce((sum, entry) => sum + entry.count, 0);

  if (total === 0) {
    return <p className="text-sm text-slate-500">No live presence data for this organization yet.</p>;
  }

  return (
    <div>
      <div className="flex h-10 w-full overflow-hidden rounded-xl border border-slate-200">
        {entries.map(({ status, count }) => {
          const meta = PRESENCE_META[status];
          const isSelected = selected === status;
          const isMuted = status === 'inactive' || status === 'idle';
          return (
            <button
              key={status}
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(isSelected ? 'all' : status)}
              className={`flex items-center justify-center gap-1.5 px-1 text-xs font-semibold transition
                ${meta.barClass} ${isMuted ? 'text-slate-700' : 'text-white'}
                ${isSelected ? 'ring-2 ring-inset ring-slate-900/40' : 'hover:brightness-105'}`}
              style={{ flexGrow: count, flexBasis: 0, minWidth: '3.5rem' }}
              title={`${meta.label} · ${count} — click to filter the people list`}
            >
              <span className="truncate">{meta.label}</span>
              <span className="font-mono text-[11px] opacity-90">{count}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        Live right now · each segment filters the people list{selected !== 'all' ? ' · click again to clear' : ''}
      </p>
    </div>
  );
}

/** Small titled panel used inside monitoring surfaces (single border level). */
export function Panel({ title, action, children, className = '' }: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? (
            <h3 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">{title}</h3>
          ) : <span />}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
