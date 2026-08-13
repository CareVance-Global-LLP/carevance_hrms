export interface PendingSession {
  time_entry_id: number;
  source: string;
  activity_kind: string;
  tool_type: string;
  display_name: string;
  app_name?: string | null;
  window_title?: string | null;
  url?: string | null;
  started_at: string;
  // Without this a drained row inserts open, and the server's
  // closeConflictingOpenSessions then closes it against whatever session
  // starts next — fabricating a duration that double-counts real time.
  // ensureDesktopSessionStarted seeds this to started_at (zero-length) and
  // stamps the real value in when the session is actually closed.
  ended_at?: string | null;
  confidence?: number;
  local_id: string;
  device_id: string | null;
}

// Why a session was thrown away without reaching the server. Reported rather
// than counted only: lost tracked time is indistinguishable from time never
// worked once it is gone, and this data feeds payroll.
export type PendingSessionDropReason = 'no_device_id' | 'retry_window_exceeded' | 'overflow';

export type PendingSessionDropCounts = Record<PendingSessionDropReason, number>;

export interface PendingSessionQueue {
  enqueue: (payload: PendingSession) => void;
  /**
   * `nowMs` is passed in rather than read off the clock so the retry window
   * below is deterministic in tests and drivable from the caller's own tick.
   */
  drain: (send: (payload: PendingSession) => Promise<unknown>, nowMs: number) => Promise<void>;
  size: () => number;
  droppedCount: () => number;
  droppedReasons: () => PendingSessionDropCounts;
}

// A head that fails forever (a 422 for a time entry the user no longer has,
// a 401 after logout) must not block everything queued behind it forever —
// it would pile up until maxSize evicted the whole backlog uncounted. Give up
// on a single item once it has been failing for this long and let the rest
// keep draining.
//
// Deliberately measured in elapsed time, not attempts. drain() runs off the
// tracker's 1-second tick, so an attempt cap of N is really an N-second cap:
// at 5 attempts a head was evicted ~6 seconds after its first failure, and the
// next head then burned its own 6 seconds, so a one-minute outage shed most of
// the backlog. "A network blip costs a retry rather than a hole in the
// timeline" only holds if the window is longer than a plausible blip.
const MAX_RETRY_WINDOW_MS = 10 * 60 * 1000;

interface QueueEntry {
  payload: PendingSession;
  // When this entry first failed to send; null while it has never failed.
  firstFailedAtMs: number | null;
}

/**
 * Holds desktop sessions whose create failed, so a network blip costs a retry
 * rather than a hole in the timeline.
 *
 * Retrying is only safe because every session carries (local_id, device_id) and
 * the server resolves a replay against its unique index instead of inserting
 * again — see desktopSessionIdentity.ts.
 *
 * In memory on purpose. The offline SQLite store rewrites its whole file on
 * every write (offline-db.cjs `_persist`), which is too expensive per app
 * switch, and its existing app-usage table targets the retired `activities`
 * model. Persisting across a process restart is a separate piece of work.
 */
export const createPendingSessionQueue = ({ maxSize }: { maxSize: number }): PendingSessionQueue => {
  const items: QueueEntry[] = [];
  const dropped: PendingSessionDropCounts = {
    no_device_id: 0,
    retry_window_exceeded: 0,
    overflow: 0,
  };
  let draining = false;

  const drop = (reason: PendingSessionDropReason) => {
    dropped[reason] += 1;
  };

  return {
    enqueue: (payload) => {
      // A null device_id means the server cannot recognise a replay
      // (ActivitySessionController::store guards its idempotency branch on
      // !empty($device_id)), so retrying this session would insert a second
      // row for the same stretch of time. Losing one segment beats
      // double-counting time that feeds payroll.
      if (!payload.device_id) {
        drop('no_device_id');
        return;
      }

      items.push({ payload, firstFailedAtMs: null });
      while (items.length > maxSize) {
        items.shift();
        drop('overflow');
      }
    },

    drain: async (send, nowMs) => {
      // A second concurrent drain would send the same head twice and reorder
      // the tail. The tick that calls this can overlap with a reconnect.
      if (draining) return;
      draining = true;

      try {
        while (items.length > 0) {
          const entry = items[0];
          try {
            await send(entry.payload);
          } catch {
            if (items[0] !== entry) {
              // enqueue's overflow eviction removed this entry while its send
              // was in flight; it is already counted. Stop here rather than
              // skipping ahead — the new head is retried on the next drain.
              return;
            }

            if (entry.firstFailedAtMs === null) {
              entry.firstFailedAtMs = nowMs;
            }

            if (nowMs - entry.firstFailedAtMs > MAX_RETRY_WINDOW_MS) {
              // Given up on this one specifically. Move on rather than
              // stopping here, so a permanently-failing head does not block
              // everything sent after it.
              items.shift();
              drop('retry_window_exceeded');
              continue;
            }

            // Still inside the retry window: stop at this failure. Skipping
            // ahead would deliver a later session before an earlier one, and
            // the next drain retries this same head.
            return;
          }

          // Only shift what was actually sent. enqueue's overflow eviction can
          // fire while the send above is awaiting, and shifting blindly would
          // discard a different, never-sent session without counting it.
          if (items[0] === entry) {
            items.shift();
          }
        }
      } finally {
        draining = false;
      }
    },

    size: () => items.length,
    droppedCount: () => dropped.no_device_id + dropped.retry_window_exceeded + dropped.overflow,
    droppedReasons: () => ({ ...dropped }),
  };
};
