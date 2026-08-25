/**
 * Punches made while the phone had no usable connection.
 *
 * Attendance is the one thing here that cannot simply be redone later: a punch
 * is a claim about a moment, and a lift, a basement car park or a site with no
 * signal is exactly where people punch. Losing one costs a day's pay; recording
 * it by hand costs a manager approving a regularisation for something that
 * genuinely happened.
 *
 * The server already accepts everything needed to make this honest — `punch_at`
 * for the real time, plus `local_id` and `device_id`, which IdempotentSync uses
 * to collapse a replay onto the original record. A double send is therefore
 * harmless, and that is what makes retrying safe.
 */

export type PunchKind = 'in' | 'out';

export interface QueuedPunch {
  localId: string;
  deviceId: string;
  kind: PunchKind;
  /** When the person actually punched — not when it eventually syncs. */
  punchAt: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  attempts: number;
}

/**
 * A queue this long means something is badly wrong. Past it the oldest are
 * dropped rather than growing without bound; two punches a day for a month is
 * about sixty, so this is generous.
 */
export const MAX_QUEUE = 100;

export function enqueue(queue: QueuedPunch[], punch: QueuedPunch): QueuedPunch[] {
  // localId is the server's idempotency key. Holding one twice would send the
  // same punch twice and show a phantom pending item.
  if (queue.some((p) => p.localId === punch.localId)) return queue;
  const nextQueue = [...queue, punch];
  return nextQueue.length > MAX_QUEUE ? nextQueue.slice(nextQueue.length - MAX_QUEUE) : nextQueue;
}

export function remove(queue: QueuedPunch[], localId: string): QueuedPunch[] {
  return queue.filter((p) => p.localId !== localId);
}

export function bumpAttempt(queue: QueuedPunch[], localId: string): QueuedPunch[] {
  return queue.map((p) => (p.localId === localId ? { ...p, attempts: p.attempts + 1 } : p));
}

/**
 * Oldest first, always.
 *
 * Order is not a nicety: a check-out arriving before its own check-in is
 * refused by the server, and would record the day backwards if it were not.
 */
export function next(queue: QueuedPunch[]): QueuedPunch | null {
  return queue.length ? queue[0] : null;
}

export type FlushOutcome =
  /** Accepted, or already known to the server. Take it off the queue. */
  | { kind: 'sent' }
  /**
   * The server understood and refused — already checked in, outside the
   * geofence, no open shift. Retrying cannot change that answer, so it is
   * dropped and reported rather than blocking everything behind it.
   */
  | { kind: 'rejected'; message: string }
  /**
   * Undeliverable. Keep it, keep its place, and stop flushing so nothing
   * overtakes it.
   */
  | { kind: 'deferred' };

/**
 * What a failed send means for the queue.
 *
 * This split is the whole design. A 4xx is an answer; a timeout is silence.
 * Treating silence as an answer loses attendance, and treating an answer as
 * silence blocks the queue behind a punch the server will never accept.
 */
export function classifyFailure(error: unknown): FlushOutcome {
  const response = (error as { response?: { status?: number; data?: { message?: string } } } | undefined)?.response;
  const status = response?.status;

  if (typeof status !== 'number') return { kind: 'deferred' };

  // 408 and 429 are the server asking to be asked again later.
  if (status === 408 || status === 429) return { kind: 'deferred' };
  if (status >= 500) return { kind: 'deferred' };

  if (status >= 400) {
    return { kind: 'rejected', message: response?.data?.message || 'The server refused this punch.' };
  }

  return { kind: 'deferred' };
}

/** Unique enough to key an idempotent replay. Not a security token. */
export function makeLocalId(kind: PunchKind, at: number, salt: number): string {
  return kind + '-' + at.toString(36) + '-' + Math.floor(salt * 1e9).toString(36);
}

/**
 * The wire body for a queued punch.
 *
 * The two endpoints do not agree on the name of the timestamp: check-in reads
 * `punch_at` and check-out reads `punch_out_at` (see AttendanceController).
 * Sending the wrong one is silent — the field is simply ignored and the punch
 * lands at sync time instead of the moment it was made, which is the whole
 * thing the queue exists to prevent. Mapping it here, once, keyed off the punch
 * kind, is why that cannot happen per call site.
 */
export function punchSyncBody(punch: {
  kind: PunchKind;
  punchAt: string;
  localId: string;
  deviceId: string;
}): Record<string, string> {
  const timeField = punch.kind === 'in' ? 'punch_at' : 'punch_out_at';
  return {
    [timeField]: punch.punchAt,
    local_id: punch.localId,
    device_id: punch.deviceId,
  };
}
