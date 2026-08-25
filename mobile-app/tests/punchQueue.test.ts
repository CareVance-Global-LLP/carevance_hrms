import {
  MAX_QUEUE, bumpAttempt, classifyFailure, enqueue, makeLocalId, next, punchSyncBody, remove,
} from '../src/lib/punchQueue';
import type { QueuedPunch } from '../src/lib/punchQueue';

const punch = (localId: string, kind: 'in' | 'out' = 'in'): QueuedPunch => ({
  localId, deviceId: 'device-1', kind, punchAt: '2026-08-21T10:00:00.000Z', attempts: 0,
});

describe('the queue keeps punches in the order they were made', () => {
  it('sends the oldest first', () => {
    /*
     * Not cosmetic. A check-out reaching the server before its own check-in is
     * refused, and would record the day backwards if it were not.
     */
    const q = enqueue(enqueue([], punch('a', 'in')), punch('b', 'out'));
    expect(next(q)?.localId).toBe('a');
  });

  it('returns null when nothing is waiting', () => {
    expect(next([])).toBeNull();
  });
});

describe('enqueue', () => {
  it('refuses to hold the same punch twice', () => {
    // localId is the idempotency key: queuing it twice sends it twice.
    const q = enqueue(enqueue([], punch('a')), punch('a'));
    expect(q).toHaveLength(1);
  });

  it('drops the oldest rather than growing without bound', () => {
    let q: QueuedPunch[] = [];
    for (let i = 0; i < MAX_QUEUE + 5; i++) q = enqueue(q, punch('p' + i));
    expect(q).toHaveLength(MAX_QUEUE);
    expect(q[0].localId).toBe('p5');
  });
});

describe('remove and bumpAttempt', () => {
  it('takes exactly one punch off', () => {
    const q = enqueue(enqueue([], punch('a')), punch('b'));
    expect(remove(q, 'a').map((p) => p.localId)).toEqual(['b']);
  });

  it('counts attempts without disturbing the others', () => {
    const q = bumpAttempt(enqueue(enqueue([], punch('a')), punch('b')), 'a');
    expect(q[0].attempts).toBe(1);
    expect(q[1].attempts).toBe(0);
  });
});

describe('classifyFailure — silence is not an answer', () => {
  it('defers when the request never reached anyone', () => {
    // No `response` at all: offline, DNS failure, connection refused. Dropping
    // these would silently lose a day's attendance.
    expect(classifyFailure({ message: 'Network Error' })).toEqual({ kind: 'deferred' });
    expect(classifyFailure({ code: 'ECONNABORTED' })).toEqual({ kind: 'deferred' });
    expect(classifyFailure(undefined)).toEqual({ kind: 'deferred' });
  });

  it('defers while the API is unwell', () => {
    expect(classifyFailure({ response: { status: 500 } })).toEqual({ kind: 'deferred' });
    expect(classifyFailure({ response: { status: 503 } })).toEqual({ kind: 'deferred' });
  });

  it('defers when the server explicitly asks to be asked again', () => {
    expect(classifyFailure({ response: { status: 408 } })).toEqual({ kind: 'deferred' });
    expect(classifyFailure({ response: { status: 429 } })).toEqual({ kind: 'deferred' });
  });

  it('drops a punch the server has actually refused', () => {
    /*
     * A 422 is an answer — already checked in, outside the geofence. Keeping it
     * would block every punch behind it forever, because retrying cannot change
     * a decision the server has already made.
     */
    const out = classifyFailure({ response: { status: 422, data: { message: 'Already checked in' } } });
    expect(out).toEqual({ kind: 'rejected', message: 'Already checked in' });
  });

  it('always carries a message a person can read', () => {
    const out = classifyFailure({ response: { status: 403 } });
    expect(out.kind).toBe('rejected');
    expect(out.kind === 'rejected' && out.message.length).toBeGreaterThan(0);
  });
});

describe('makeLocalId', () => {
  it('differs per punch so two never collapse into one', () => {
    expect(makeLocalId('in', 1, 0.5)).not.toBe(makeLocalId('in', 2, 0.5));
    expect(makeLocalId('in', 1, 0.5)).not.toBe(makeLocalId('out', 1, 0.5));
  });
});

describe('punchSyncBody — the two endpoints disagree on the timestamp field', () => {
  const base = { punchAt: '2026-08-21T22:00:00.000Z', localId: 'abc', deviceId: 'dev-1' };

  it('sends punch_at for a check-in', () => {
    expect(punchSyncBody({ ...base, kind: 'in' })).toEqual({
      punch_at: base.punchAt, local_id: 'abc', device_id: 'dev-1',
    });
  });

  it('sends punch_out_at for a check-out', () => {
    /*
     * AttendanceController validates `punch_out_at` on check-out and `punch_at`
     * on check-in. Sending the wrong key fails silently — Laravel ignores it and
     * the punch is stamped at sync time, which defeats the entire queue.
     */
    expect(punchSyncBody({ ...base, kind: 'out' })).toEqual({
      punch_out_at: base.punchAt, local_id: 'abc', device_id: 'dev-1',
    });
  });

  it('never sends the check-in key on a check-out', () => {
    expect(punchSyncBody({ ...base, kind: 'out' })).not.toHaveProperty('punch_at');
    expect(punchSyncBody({ ...base, kind: 'in' })).not.toHaveProperty('punch_out_at');
  });

  it('always carries both idempotency keys, or a replay would double-punch', () => {
    for (const kind of ['in', 'out'] as const) {
      const body = punchSyncBody({ ...base, kind });
      expect(body.local_id).toBe('abc');
      expect(body.device_id).toBe('dev-1');
    }
  });
});
