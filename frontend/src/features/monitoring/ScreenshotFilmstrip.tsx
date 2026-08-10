import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, RefreshCw, Trash2, X } from 'lucide-react';
import Button from '@/components/ui/Button';
import { formatDateTime as formatDateTimeForTimezone } from '@/lib/dateTime';
import { formatDuration } from '@/lib/formatters';
import { CLASSIFICATION_META, ShareBar, normalizeClassification, type ShareSegment } from './monitoringUi';

export interface ScreenshotFilmstripProps {
  screenshots: any[];
  total: number;
  currentPage: number;
  lastPage: number;
  onPageChange: (page: number) => void;
  resolveShotUrl: (shot: any) => string;
  onShotVisible: (shot: any) => void;
  resolveShotUser: (shot: any) => any | null;
  timezone: string;
  isFetching: boolean;
  canDelete: boolean;
  selectedIds: number[];
  onToggleSelect: (id: number) => void;
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onDeleteShot: (id: number) => void;
  hasEmployeeFilter: boolean;
  onDeleteAllInRange: () => void;
  deleting: boolean;
  newCount: number;
  onRefresh: () => void;
  /** Activities in the visible range, for the per-hour productivity mix bar. Null = not loaded. */
  dayActivities: any[] | null;
  isSingleDayRange: boolean;
}

interface HourGroup {
  key: string;
  userId: number;
  userName: string;
  dayLabel: string;
  hourLabel: string;
  shots: any[];
}

const hourPartsFor = (iso: string, timeZone: string) => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
    const hour = Number(get('hour')) % 24;
    return {
      day: `${get('year')}-${get('month')}-${get('day')}`,
      hour,
    };
  } catch {
    return null;
  }
};

const hourRangeLabel = (hour: number) => {
  const to12 = (value: number) => {
    const normalized = ((value % 24) + 24) % 24;
    const suffix = normalized >= 12 ? 'pm' : 'am';
    const display = normalized % 12 === 0 ? 12 : normalized % 12;
    return `${display}${suffix}`;
  };
  return `${to12(hour)} – ${to12(hour + 1)}`;
};

const dayLabelFor = (dayISO: string) => {
  const parsed = new Date(`${dayISO}T00:00:00`);
  return Number.isNaN(parsed.getTime())
    ? dayISO
    : parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
};

/** One thumbnail that only asks for its bytes once it scrolls into view. */
function LazyShot({ shot, url, onVisible, timeLabel, selected, selectable, onToggleSelect, onOpen }: {
  shot: any;
  url: string;
  onVisible: (shot: any) => void;
  timeLabel: string;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: () => void;
  onOpen: () => void;
}) {
  const tileRef = useRef<HTMLDivElement | null>(null);
  const requestedRef = useRef(false);

  useEffect(() => {
    const node = tileRef.current;
    if (!node || requestedRef.current) return undefined;

    // Environments without real layout (test DOMs report all-zero rects and
    // their IntersectionObserver never fires) load eagerly — a rendered tile
    // in a browser always has dimensions.
    const rect = node.getBoundingClientRect();
    const hasLayout = rect.width > 0 || rect.height > 0;

    if (typeof IntersectionObserver === 'undefined' || !hasLayout) {
      requestedRef.current = true;
      onVisible(shot);
      return undefined;
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting) && !requestedRef.current) {
        requestedRef.current = true;
        onVisible(shot);
        observer.disconnect();
      }
    }, { rootMargin: '200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible, shot]);

  return (
    <div ref={tileRef} className={`group relative overflow-hidden rounded-lg border ${selected ? 'border-blue-500 ring-2 ring-blue-300' : 'border-slate-200'}`}>
      {selectable && (
        <label className="absolute left-1.5 top-1.5 z-10 flex cursor-pointer items-center rounded-md bg-white/95 p-1 shadow-sm">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select screenshot ${timeLabel}`}
            className="h-3.5 w-3.5 accent-blue-600"
          />
        </label>
      )}
      <button type="button" onClick={onOpen} className="block w-full" aria-label={`Open screenshot ${timeLabel}`}>
        {url ? (
          <img src={url} alt={`Screenshot at ${timeLabel}`} loading="lazy" className="aspect-video w-full object-cover transition group-hover:opacity-90" />
        ) : (
          <div className="aspect-video w-full animate-pulse bg-slate-100" aria-label="Loading screenshot" />
        )}
      </button>
      <span className="absolute bottom-1.5 left-1.5 rounded bg-white/95 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-slate-600 shadow-sm">
        {timeLabel}
      </span>
    </div>
  );
}

/**
 * Screenshots as evidence with a signal: grouped person → hour, each hour
 * headed by that hour's productivity mix from real activity classifications,
 * with a keyboard lightbox instead of "open a raw blob in a new tab".
 */
export default function ScreenshotFilmstrip({
  screenshots,
  total,
  currentPage,
  lastPage,
  onPageChange,
  resolveShotUrl,
  onShotVisible,
  resolveShotUser,
  timezone,
  isFetching,
  canDelete,
  selectedIds,
  onToggleSelect,
  onClearSelection,
  onDeleteSelected,
  onDeleteShot,
  hasEmployeeFilter,
  onDeleteAllInRange,
  deleting,
  newCount,
  onRefresh,
  dayActivities,
  isSingleDayRange,
}: ScreenshotFilmstripProps) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const orderedShots = useMemo(
    () => [...screenshots].sort((a, b) => +new Date(a?.recorded_at || 0) - +new Date(b?.recorded_at || 0)),
    [screenshots]
  );

  const groups: HourGroup[] = useMemo(() => {
    const map = new Map<string, HourGroup>();
    orderedShots.forEach((shot) => {
      const user = resolveShotUser(shot);
      const userId = Number(user?.id || shot?.user_id || 0);
      const parts = hourPartsFor(String(shot?.recorded_at || ''), timezone);
      if (!parts) return;
      const key = `${userId}|${parts.day}|${parts.hour}`;
      if (!map.has(key)) {
        map.set(key, {
          key,
          userId,
          userName: user?.name || 'Unknown employee',
          dayLabel: dayLabelFor(parts.day),
          hourLabel: hourRangeLabel(parts.hour),
          shots: [],
        });
      }
      map.get(key)!.shots.push(shot);
    });
    return Array.from(map.values());
  }, [orderedShots, resolveShotUser, timezone]);

  // Per-hour productivity mix from the server's own classification field —
  // the honest stand-in for input-activity bars we do not collect.
  const hourMixFor = (group: HourGroup): { segments: ShareSegment[]; topTool: string | null } => {
    if (!Array.isArray(dayActivities) || dayActivities.length === 0) {
      return { segments: [], topTool: null };
    }
    const durations: Record<string, number> = {};
    const toolDurations = new Map<string, number>();
    dayActivities.forEach((activity: any) => {
      if (Number(activity?.user_id) !== group.userId) return;
      const parts = hourPartsFor(String(activity?.recorded_at || ''), timezone);
      if (!parts) return;
      const groupParts = hourPartsFor(String(group.shots[0]?.recorded_at || ''), timezone);
      if (!groupParts || parts.day !== groupParts.day || parts.hour !== groupParts.hour) return;
      if (String(activity?.type) === 'idle') return;
      const classification = normalizeClassification(activity?.classification);
      const duration = Math.max(0, Number(activity?.duration || 0));
      durations[classification] = (durations[classification] || 0) + duration;
      const label = String(activity?.normalized_label || activity?.software_name || activity?.name || '').trim();
      if (label) toolDurations.set(label, (toolDurations.get(label) || 0) + duration);
    });
    const segments = (Object.keys(CLASSIFICATION_META) as Array<keyof typeof CLASSIFICATION_META>)
      .filter((classification) => (durations[classification] || 0) > 0)
      .map((classification) => ({
        key: classification,
        label: CLASSIFICATION_META[classification].label,
        value: durations[classification] || 0,
        barClass: CLASSIFICATION_META[classification].barClass,
      }));
    const topTool = [...toolDurations.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return { segments, topTool };
  };

  const openLightbox = (shot: any) => {
    const index = orderedShots.findIndex((candidate) => Number(candidate?.id) === Number(shot?.id));
    if (index >= 0) setLightboxIndex(index);
  };

  useEffect(() => {
    if (lightboxIndex === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLightboxIndex(null);
      if (event.key === 'ArrowRight') setLightboxIndex((current) => (current === null ? null : Math.min(orderedShots.length - 1, current + 1)));
      if (event.key === 'ArrowLeft') setLightboxIndex((current) => (current === null ? null : Math.max(0, current - 1)));
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [lightboxIndex, orderedShots.length]);

  // Keep the lightbox valid when a delete shrinks the list under it.
  useEffect(() => {
    if (lightboxIndex !== null && lightboxIndex > orderedShots.length - 1) {
      setLightboxIndex(orderedShots.length === 0 ? null : orderedShots.length - 1);
    }
  }, [lightboxIndex, orderedShots.length]);

  const lightboxShot = lightboxIndex !== null ? orderedShots[lightboxIndex] : null;
  const lightboxUser = lightboxShot ? resolveShotUser(lightboxShot) : null;
  const lightboxUrl = lightboxShot ? resolveShotUrl(lightboxShot) : '';

  return (
    <div className={`space-y-4 ${isFetching ? 'opacity-75 transition-opacity' : ''}`} aria-busy={isFetching}>
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-slate-600">
          <span className="font-semibold text-slate-900">{total}</span> screenshot{total === 1 ? '' : 's'} in range
          {' · '}showing {screenshots.length} on this page
        </p>
        {newCount > 0 && (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex items-center gap-1.5 rounded-full bg-accent-100 px-3 py-1 text-xs font-semibold text-accent-700 hover:bg-accent-200"
          >
            <RefreshCw className="h-3 w-3" />
            {newCount} new — refresh
          </button>
        )}
        <span className="ml-auto flex items-center gap-2">
          {canDelete && !selectionMode && screenshots.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelectionMode(true)}>
              Select
            </Button>
          )}
          {canDelete && selectionMode && (
            <>
              <span className="text-xs text-slate-500">{selectedIds.length} selected</span>
              <Button
                variant="danger"
                size="sm"
                disabled={selectedIds.length === 0 || deleting}
                onClick={onDeleteSelected}
                iconLeft={<Trash2 className="h-4 w-4" />}
              >
                Delete selected
              </Button>
              {hasEmployeeFilter && (
                <Button variant="ghost" size="sm" disabled={deleting || total === 0} onClick={onDeleteAllInRange}>
                  Delete all in range
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectionMode(false);
                  onClearSelection();
                }}
              >
                Cancel
              </Button>
            </>
          )}
        </span>
      </div>

      {groups.map((group) => {
        const { segments, topTool } = hourMixFor(group);
        return (
          <section key={group.key} className="rounded-xl border border-slate-200 bg-white p-4">
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="text-sm font-semibold text-slate-900">{group.userName}</span>
              <span className="font-mono text-xs text-slate-500">
                {isSingleDayRange ? group.hourLabel : `${group.dayLabel} · ${group.hourLabel}`}
              </span>
              <span className="text-xs text-slate-400">{group.shots.length} shot{group.shots.length === 1 ? '' : 's'}</span>
              {segments.length > 0 && (
                <span className="flex min-w-[120px] max-w-[200px] flex-1 items-center gap-2">
                  <ShareBar segments={segments} size="sm" className="flex-1" />
                </span>
              )}
              {topTool && <span className="truncate text-xs text-slate-500" title={topTool}>mostly {topTool}</span>}
            </header>
            <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
              {group.shots.map((shot: any) => {
                const shotId = Number(shot?.id || 0);
                const timeLabel = formatDateTimeForTimezone(shot?.recorded_at, timezone, 'en-US', '—')
                  .split(',')
                  .pop()
                  ?.trim() || '—';
                return (
                  <LazyShot
                    key={shotId}
                    shot={shot}
                    url={resolveShotUrl(shot)}
                    onVisible={onShotVisible}
                    timeLabel={timeLabel}
                    selectable={canDelete && selectionMode}
                    selected={selectedIds.includes(shotId)}
                    onToggleSelect={() => onToggleSelect(shotId)}
                    onOpen={() => openLightbox(shot)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {lastPage > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-500">
            Page {currentPage} of {lastPage} · {total} total screenshots
          </p>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage <= 1 || isFetching}
              onClick={() => onPageChange(currentPage - 1)}
              iconLeft={<ChevronLeft className="h-4 w-4" />}
            >
              Previous
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={currentPage >= lastPage || isFetching}
              onClick={() => onPageChange(currentPage + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {lightboxShot && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Screenshot viewer"
          onClick={() => setLightboxIndex(null)}
        >
          <div className="relative w-full max-w-5xl" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setLightboxIndex(null)}
              aria-label="Close viewer"
              className="absolute -top-10 right-0 flex h-9 w-9 items-center justify-center rounded-full text-white hover:bg-white/10"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Previous screenshot"
                disabled={lightboxIndex === 0}
                onClick={() => setLightboxIndex((current) => Math.max(0, (current ?? 0) - 1))}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronLeft className="h-6 w-6" />
              </button>
              <div className="min-h-[200px] flex-1">
                {lightboxUrl ? (
                  <img src={lightboxUrl} alt="Screenshot enlarged" className="max-h-[74vh] w-full rounded-lg object-contain" />
                ) : (
                  <div className="flex h-[50vh] items-center justify-center rounded-lg bg-slate-800 text-sm text-slate-400">
                    Loading image…
                  </div>
                )}
              </div>
              <button
                type="button"
                aria-label="Next screenshot"
                disabled={lightboxIndex === orderedShots.length - 1}
                onClick={() => setLightboxIndex((current) => Math.min(orderedShots.length - 1, (current ?? 0) + 1))}
                className="flex h-10 w-10 flex-none items-center justify-center rounded-full text-white transition hover:bg-white/10 disabled:opacity-30"
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-12 text-sm text-slate-300">
              <span className="font-medium text-white">{lightboxUser?.name || 'Unknown employee'}</span>
              <span className="font-mono text-xs">{formatDateTimeForTimezone(lightboxShot.recorded_at, timezone, 'en-US', '—')}</span>
              {lightboxShot?.time_entry?.description && (
                <span className="text-xs">while tracking: {lightboxShot.time_entry.description}</span>
              )}
              {typeof lightboxShot?.time_entry?.duration === 'number' && lightboxShot.time_entry.duration > 0 && (
                <span className="text-xs">session {formatDuration(lightboxShot.time_entry.duration)}</span>
              )}
              <span className="ml-auto flex items-center gap-3">
                {lightboxUrl && (
                  <a
                    href={lightboxUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-slate-300 underline-offset-2 hover:text-white hover:underline"
                  >
                    <ExternalLink className="h-3.5 w-3.5" /> Open original
                  </a>
                )}
                {canDelete && (
                  <button
                    type="button"
                    onClick={() => onDeleteShot(Number(lightboxShot.id))}
                    disabled={deleting}
                    className="inline-flex items-center gap-1 text-xs text-rose-300 underline-offset-2 hover:text-rose-200 hover:underline disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </span>
            </div>
            <p className="mt-1 px-12 text-center font-mono text-[11px] text-slate-500">
              {lightboxIndex !== null ? lightboxIndex + 1 : 0} / {orderedShots.length} · ← → to move · Esc to close
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
