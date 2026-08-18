import { describe, expect, it, vi } from 'vitest';
import { createPendingSessionQueue } from './pendingSessionQueue';

const session = (localId: string) => ({
  time_entry_id: 1,
  source: 'desktop',
  activity_kind: 'desktop_app',
  tool_type: 'software',
  display_name: 'Code',
  started_at: '2026-08-13T10:00:00.000Z',
  local_id: localId,
  device_id: 'device-1',
});

// drain() takes the current time rather than reading the clock, so the retry
// window is deterministic here instead of depending on how long a test ran.
const NOW = Date.parse('2026-08-13T10:00:00.000Z');
const MINUTE = 60 * 1000;

describe('pendingSessionQueue', () => {
  it('drains in the order sessions happened', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    await queue.drain(async (p) => { sent.push(p.local_id); }, NOW);

    // Out-of-order replay would interleave one app's segments with another's.
    expect(sent).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('keeps a session that failed to send', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('a'));

    await queue.drain(async () => { throw new Error('offline'); }, NOW);

    expect(queue.size()).toBe(1);
  });

  it('stops draining at the first failure so order is preserved', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    await queue.drain(async (p) => {
      if (p.local_id === 'a') throw new Error('offline');
      sent.push(p.local_id);
    }, NOW);

    // 'b' must not jump ahead of 'a'.
    expect(sent).toEqual([]);
    expect(queue.size()).toBe(2);
  });

  it('drops the oldest when full and counts the loss', () => {
    const queue = createPendingSessionQueue({ maxSize: 2 });
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));
    queue.enqueue(session('c'));

    // Unbounded growth during a long outage would exhaust renderer memory.
    // Dropping the oldest is the least-bad option, and it is counted so the
    // loss is reportable rather than silent.
    expect(queue.size()).toBe(2);
    expect(queue.droppedCount()).toBe(1);
  });

  it('does not run two drains concurrently', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('a'));
    let inFlight = 0;
    let maxConcurrent = 0;

    const send = async () => {
      inFlight += 1;
      maxConcurrent = Math.max(maxConcurrent, inFlight);
      await new Promise((resolve) => { setTimeout(resolve, 10); });
      inFlight -= 1;
    };

    await Promise.all([queue.drain(send, NOW), queue.drain(send, NOW)]);

    expect(maxConcurrent).toBe(1);
  });

  it('reports nothing to drain as a no-op', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const send = vi.fn();

    await queue.drain(send, NOW);

    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a session the server could not de-duplicate', () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });

    queue.enqueue({ ...session('a'), device_id: null });

    expect(queue.size()).toBe(0);
    expect(queue.droppedCount()).toBe(1);
  });

  it('survives an outage far longer than a handful of ticks', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    const offline = async () => { throw new Error('offline'); };
    const online = async (p: { local_id: string }) => { sent.push(p.local_id); };

    // The tracker drains off a 1-second tick, so an attempt-count cap is
    // really a seconds cap: at 5 attempts the head was evicted ~6 seconds in
    // and the next head then burned its own 6 seconds, so a one-minute outage
    // shed the whole backlog. Nothing here is dropped — a minute offline is a
    // blip, not a reason to throw away tracked time that feeds payroll.
    for (let elapsed = 0; elapsed <= 60 * 1000; elapsed += 1000) {
      // eslint-disable-next-line no-await-in-loop
      await queue.drain(offline, NOW + elapsed);
    }

    expect(queue.size()).toBe(2);
    expect(queue.droppedCount()).toBe(0);

    await queue.drain(online, NOW + 61 * 1000);

    expect(sent).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('gives up on a head that has been failing past the retry window so it does not block everything behind it forever', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    // Shaped like a real rejection: the server answered, and said no. Only a
    // reply starts the give-up clock — silence means unreachable, and that is
    // the case the queue is supposed to wait out.
    const send = async (p: { local_id: string }) => {
      if (p.local_id === 'a') {
        throw Object.assign(new Error('a permanent 422, e.g. a deleted time entry'), {
          response: { status: 422 },
        });
      }
      sent.push(p.local_id);
    };

    // Inside the window: 'a' fails and drain stops there each time, same as
    // the ordinary transient-failure case — 'b' is not touched yet.
    await queue.drain(send, NOW);
    await queue.drain(send, NOW + 9 * MINUTE);
    expect(sent).toEqual([]);
    expect(queue.size()).toBe(2);
    expect(queue.droppedCount()).toBe(0);

    // Ten minutes of failing is no longer a blip: 'a' is evicted and counted,
    // and 'b' — which was never the problem — sends right behind it.
    await queue.drain(send, NOW + 10 * MINUTE + 1000);

    expect(sent).toEqual(['b']);
    expect(queue.size()).toBe(0);
    expect(queue.droppedCount()).toBe(1);
    expect(queue.droppedReasons().retry_window_exceeded).toBe(1);
  });

  it('does not discard an unsent session when overflow evicts the entry being sent', async () => {
    const queue = createPendingSessionQueue({ maxSize: 2 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    const send = async (p: { local_id: string }) => {
      sent.push(p.local_id);
      if (p.local_id === 'a') {
        // A new app switch lands while 'a' is still in flight and overflows
        // the queue, evicting the very entry being sent. Shifting blindly on
        // success would then remove 'b' — a session that was never sent and
        // never counted as dropped.
        queue.enqueue(session('c'));
      }
    };

    await queue.drain(send, NOW);

    expect(sent).toEqual(['a', 'b', 'c']);
    expect(queue.size()).toBe(0);
  });

  it('waits out an unreachable server instead of discarding the timeline', async () => {
    /*
     * The gap this closes. The retry window exists to shed a head the server
     * keeps REJECTING, but it was also counting failures where the server
     * never answered — so an outage longer than ten minutes threw away real
     * tracked time rather than waiting, which is the one thing offline
     * tracking is supposed to guarantee.
     */
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    // No `response`: the request never completed. Axios reports a dropped
    // network exactly this way.
    let apiDown = true;
    const send = async (p: { local_id: string }) => {
      if (apiDown) throw new Error('Network Error');
      sent.push(p.local_id);
    };

    await queue.drain(send, NOW);
    await queue.drain(send, NOW + 30 * MINUTE);
    await queue.drain(send, NOW + 90 * MINUTE);

    expect(queue.size()).toBe(2);
    expect(queue.droppedCount()).toBe(0);
    expect(queue.droppedReasons().retry_window_exceeded).toBe(0);

    // Hours later the server returns, and nothing was lost.
    apiDown = false;
    await queue.drain(send, NOW + 200 * MINUTE);
    expect(sent).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('still gives up on a head the server keeps rejecting with a 5xx-free refusal', async () => {
    // A 500 is the server admitting it is broken, not a verdict on the record,
    // so it must be treated as unreachable rather than as a rejection.
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('a'));

    const send = async () => {
      throw Object.assign(new Error('Server error'), { response: { status: 503 } });
    };

    await queue.drain(send, NOW);
    await queue.drain(send, NOW + 60 * MINUTE);

    expect(queue.size()).toBe(1, 'a 503 must not discard the session');
    expect(queue.droppedCount()).toBe(0);
  });

  it('round-trips through snapshot and restore so a restart keeps the timeline', async () => {
    /*
     * The queue is mirrored to disk between runs. snapshot() is what gets
     * written and restore() is what comes back, so the pair has to preserve
     * both the payloads and their order — replaying out of order would
     * interleave one application's segments with another's.
     */
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    const persisted = queue.snapshot();
    expect(persisted.map((p) => p.local_id)).toEqual(['a', 'b']);

    // A fresh queue stands in for the next launch of the app.
    const revived = createPendingSessionQueue({ maxSize: 10 });
    revived.restore(persisted);

    const sent: string[] = [];
    await revived.drain(async (p) => { sent.push(p.local_id); }, NOW);

    expect(sent).toEqual(['a', 'b']);
    expect(revived.size()).toBe(0);
  });

  it('restoring keeps the guards that applied when the session was recorded', () => {
    // A restored session without device_id is as un-replayable as a fresh one:
    // the server cannot recognise the duplicate, so it would double-count time.
    const queue = createPendingSessionQueue({ maxSize: 10 });

    queue.restore([session('a'), { ...session('b'), device_id: null }]);

    expect(queue.size()).toBe(1);
    expect(queue.droppedReasons().no_device_id).toBe(1);
  });

  it('restoring appends rather than replacing what is already queued', () => {
    // The restore lands asynchronously at startup, so a session recorded in
    // the meantime must not be thrown away by it.
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('live'));

    queue.restore([session('from-disk')]);

    expect(queue.snapshot().map((p) => p.local_id)).toEqual(['live', 'from-disk']);
  });
});
