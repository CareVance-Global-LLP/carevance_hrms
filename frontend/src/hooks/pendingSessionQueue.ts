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
  confidence?: number;
  local_id: string;
  device_id: string | null;
}

export interface PendingSessionQueue {
  enqueue: (payload: PendingSession) => void;
  drain: (send: (payload: PendingSession) => Promise<unknown>) => Promise<void>;
  size: () => number;
  droppedCount: () => number;
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
  const items: PendingSession[] = [];
  let dropped = 0;
  let draining = false;

  return {
    enqueue: (payload) => {
      // A null device_id means the server cannot recognise a replay
      // (ActivitySessionController::store guards its idempotency branch on
      // !empty($device_id)), so retrying this session would insert a second
      // row for the same stretch of time. Losing one segment beats
      // double-counting time that feeds payroll.
      if (!payload.device_id) {
        dropped += 1;
        return;
      }

      items.push(payload);
      while (items.length > maxSize) {
        items.shift();
        dropped += 1;
      }
    },

    drain: async (send) => {
      // A second concurrent drain would send the same head twice and reorder
      // the tail. The tick that calls this can overlap with a reconnect.
      if (draining) return;
      draining = true;

      try {
        while (items.length > 0) {
          try {
            await send(items[0]);
          } catch {
            // Stop at the first failure. Skipping ahead would deliver a later
            // session before an earlier one, and the next drain retries this
            // same head.
            return;
          }
          items.shift();
        }
      } finally {
        draining = false;
      }
    },

    size: () => items.length,
    droppedCount: () => dropped,
  };
};
