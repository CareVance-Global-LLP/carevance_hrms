/**
 * The running clock, in the rail, on every page.
 *
 * CareVance is a time-tracking product but the live timer only ever existed on
 * the dashboard, so anyone working in Payroll or Reports had no idea whether
 * they were still on the clock.
 *
 * The elapsed time is extrapolated locally from the entry's start time and only
 * reconciled with the server once a minute — a per-second request would be
 * absurd, and the browser can count perfectly well on its own. Polling stops
 * entirely while the tab is hidden.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Square } from 'lucide-react';
import SidebarTooltip from '@/components/navigation/SidebarTooltip';
import { timeEntryApi } from '@/services/api';
import { cn } from '@/utils/cn';

const SYNC_MS = 60_000;

const pad = (value: number) => (value < 10 ? `0${value}` : String(value));

export const formatElapsed = (totalSeconds: number): string => {
  const safe = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(safe / 3600))}:${pad(Math.floor((safe % 3600) / 60))}:${pad(safe % 60)}`;
};

interface ActiveEntry {
  id: number;
  startedAt: number;
  label: string;
}

export interface SidebarTimerProps {
  collapsed: boolean;
  /** Skipped for roles that never track time. */
  enabled?: boolean;
}

export default function SidebarTimer({ collapsed, enabled = true }: SidebarTimerProps) {
  const [entry, setEntry] = useState<ActiveEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const sync = useCallback(async () => {
    if (!enabled) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await timeEntryApi.active({ timer_slot: 'primary' });
      if (controller.signal.aborted) return;

      const data: any = response?.data;
      const startTime = data?.start_time;
      if (!data?.id || !startTime || data?.end_time) {
        setEntry(null);
        return;
      }

      const startedAt = new Date(startTime).getTime();
      if (!Number.isFinite(startedAt)) {
        setEntry(null);
        return;
      }

      setEntry({
        id: Number(data.id),
        startedAt,
        label: String(data?.task?.title || data?.project?.name || data?.description || 'Tracking').trim(),
      });
    } catch {
      // A failed poll must not blank a timer that is genuinely running; leave
      // the local clock ticking and try again on the next interval.
      if (!controller.signal.aborted && !entry) setEntry(null);
    }
  }, [enabled, entry]);

  useEffect(() => {
    if (!enabled) return;

    void sync();
    let interval = window.setInterval(() => void sync(), SYNC_MS);

    const onVisibility = () => {
      window.clearInterval(interval);
      if (document.visibilityState === 'visible') {
        void sync();
        interval = window.setInterval(() => void sync(), SYNC_MS);
      }
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      abortRef.current?.abort();
    };
    // `sync` is intentionally excluded: it changes identity whenever `entry`
    // does, which would tear down and rebuild the interval every minute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  // The local tick. One interval, independent of the network.
  useEffect(() => {
    if (!entry) {
      setElapsed(0);
      return;
    }
    const update = () => setElapsed((Date.now() - entry.startedAt) / 1000);
    update();
    const tick = window.setInterval(update, 1000);
    return () => window.clearInterval(tick);
  }, [entry]);

  const stop = async () => {
    if (!entry || stopping) return;
    setStopping(true);
    try {
      await timeEntryApi.stop({ timer_slot: 'primary' });
      setEntry(null);
    } catch {
      // Leave the chip up; the next sync settles the truth.
    } finally {
      setStopping(false);
    }
  };

  if (!enabled || !entry) return null;

  const clock = formatElapsed(elapsed);

  return (
    <SidebarTooltip label={`Clocked in — ${clock}`} detail={entry.label} enabled={collapsed}>
      {(tooltipProps) => (
        <div
          ref={tooltipProps.ref as (node: HTMLDivElement | null) => void}
          aria-describedby={tooltipProps['aria-describedby']}
          onMouseEnter={tooltipProps.onMouseEnter}
          onMouseLeave={tooltipProps.onMouseLeave}
          className={cn(
            'flex items-center gap-2 rounded-lg border border-emerald-400/30 bg-emerald-500/12 px-2 py-1.5',
            collapsed && 'justify-center px-1.5'
          )}
        >
          {/* Motion is decorative here; the number carries the meaning. */}
          <span className="relative flex h-2 w-2 shrink-0" aria-hidden="true">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-70 motion-safe:animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>

          {collapsed ? (
            // Collapsed, the dot is the whole message — but a screen reader
            // still needs the words, so they stay in the tree.
            <span className="sr-only">Clocked in, {clock}, {entry.label}</span>
          ) : (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                {/* Not a live region: announcing every second would be unusable. */}
                <span className="block font-mono text-[13px] font-bold tracking-wide text-emerald-100">{clock}</span>
                <span className="block truncate text-[10px] text-emerald-100/65">Clocked in · {entry.label}</span>
              </span>
              <button
                type="button"
                onClick={() => void stop()}
                disabled={stopping}
                aria-label="Stop timer"
                className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-emerald-400/40 text-emerald-300 transition hover:bg-emerald-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 disabled:opacity-50"
              >
                <Square className="h-2.5 w-2.5 fill-current" aria-hidden="true" />
              </button>
            </>
          )}
        </div>
      )}
    </SidebarTooltip>
  );
}
