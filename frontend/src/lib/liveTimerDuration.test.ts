import { describe, expect, it } from 'vitest';
import { liveTimerDuration } from './liveTimerDuration';

/**
 * The bug this covers, measured on a real machine 18 Aug 2026:
 *
 * The dashboard anchored on the SERVER's start_time and advanced with
 * `Date.now()` — the CLIENT clock. Subtracting one clock from the other put
 * the difference between them straight into the displayed time. On a laptop
 * 3.5s behind the server the elapsed value was negative for the first three
 * seconds, clamped to zero, so the timer sat on 00:00:00 and then "started at
 * 1". A refresh pulled the server's duration and jumped to 8, where it stuck
 * until the client extrapolation caught up.
 *
 * Both ends of the subtraction must come from the same clock. Then a machine
 * can be an hour wrong and still count seconds correctly.
 */
describe('liveTimerDuration', () => {
  const ANCHOR = 1_700_000_000_000;

  it('advances one second per second from the anchor', () => {
    expect(liveTimerDuration(0, ANCHOR, ANCHOR)).toBe(0);
    expect(liveTimerDuration(0, ANCHOR, ANCHOR + 1_000)).toBe(1);
    expect(liveTimerDuration(0, ANCHOR, ANCHOR + 42_000)).toBe(42);
  });

  it('starts counting immediately when the client clock is behind the server', () => {
    // The regression. The anchor is taken from the client's own clock at the
    // moment it first sees the timer, so the server being 3.5s ahead is
    // irrelevant — one second after anchoring, the display reads 1.
    const clientBehindByMs = 3_500;
    const anchor = ANCHOR - clientBehindByMs;

    expect(liveTimerDuration(0, anchor, anchor + 1_000)).toBe(1);
    expect(liveTimerDuration(0, anchor, anchor + 2_000)).toBe(2);
  });

  it('counts on from the duration the server already recorded', () => {
    // Re-anchoring after a refresh: server says 8s elapsed, and the display
    // continues from there rather than restarting or stalling.
    expect(liveTimerDuration(8, ANCHOR, ANCHOR)).toBe(8);
    expect(liveTimerDuration(8, ANCHOR, ANCHOR + 3_000)).toBe(11);
  });

  it('does not rewind when the clock jumps backwards', () => {
    // Exactly what an NTP correction does mid-session — and the users most
    // likely to get one are the ones who just fixed a drifting clock. Freezing
    // briefly is acceptable; a timer that counts down is not.
    expect(liveTimerDuration(10, ANCHOR, ANCHOR - 5_000)).toBe(10);
  });

  it('never returns a negative duration', () => {
    expect(liveTimerDuration(0, ANCHOR, ANCHOR - 60_000)).toBe(0);
    expect(liveTimerDuration(-5, ANCHOR, ANCHOR)).toBe(0);
  });

  it('falls back to the server duration when there is no usable anchor', () => {
    expect(liveTimerDuration(7, Number.NaN, ANCHOR)).toBe(7);
    expect(liveTimerDuration(7, Number.POSITIVE_INFINITY, ANCHOR)).toBe(7);
  });

  it('ignores sub-second precision rather than flickering', () => {
    expect(liveTimerDuration(0, ANCHOR, ANCHOR + 999)).toBe(0);
    expect(liveTimerDuration(0, ANCHOR, ANCHOR + 1_999)).toBe(1);
    expect(liveTimerDuration(3.7, ANCHOR, ANCHOR + 1_000)).toBe(4);
  });
});
