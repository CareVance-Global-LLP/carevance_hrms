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

describe('pendingSessionQueue', () => {
  it('drains in the order sessions happened', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const sent: string[] = [];
    queue.enqueue(session('a'));
    queue.enqueue(session('b'));

    await queue.drain(async (p) => { sent.push(p.local_id); });

    // Out-of-order replay would interleave one app's segments with another's.
    expect(sent).toEqual(['a', 'b']);
    expect(queue.size()).toBe(0);
  });

  it('keeps a session that failed to send', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    queue.enqueue(session('a'));

    await queue.drain(async () => { throw new Error('offline'); });

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
    });

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

    await Promise.all([queue.drain(send), queue.drain(send)]);

    expect(maxConcurrent).toBe(1);
  });

  it('reports nothing to drain as a no-op', async () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });
    const send = vi.fn();

    await queue.drain(send);

    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a session the server could not de-duplicate', () => {
    const queue = createPendingSessionQueue({ maxSize: 10 });

    queue.enqueue({ ...session('a'), device_id: null });

    expect(queue.size()).toBe(0);
    expect(queue.droppedCount()).toBe(1);
  });
});
