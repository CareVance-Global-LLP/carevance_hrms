import { describe, expect, it } from 'vitest';
import { serverRebasedFloor, shiftCountdown } from './shiftCountdown';

/**
 * Two faults reported together on 19 Aug 2026, both from the same expression:
 *
 *   remaining = worked_time.remaining_seconds - (liveDuration - active_timer.duration)
 *
 * 1. "Uneven timer". `active_timer.duration` is the session's RAW span, while
 *    `remaining_seconds` is derived from an IDLE-NETTED total. Subtracting one
 *    from the other treats seconds the server never billed as already spent.
 *    Observed: session 00:00:19, Shift Remaining 07:59:52 — eight seconds
 *    consumed against nineteen on the clock, and the eleven-second hole never
 *    closes, so a full shift can never count down to zero.
 *
 * 2. "Stop resets it to 8hr". On stop both terms collapse to zero, so the
 *    display falls back to `remaining_seconds` — a figure fetched at mount and
 *    never refreshed, because nothing re-reads worked_time while a timer runs
 *    or after it stops. Observed: 07:59:52 -> 08:00:00 on pressing stop.
 *
 * The rule both fixes share is the one already written down in
 * liveTimerDuration: both ends of a subtraction must come from the same clock,
 * and a countdown may never hand time back.
 */
describe('shiftCountdown', () => {
  const EIGHT_HOURS = 8 * 3600;

  const base = {
    shiftTargetSeconds: EIGHT_HOURS,
    serverWorkedSeconds: 0,
    capturedSessionSeconds: 0,
    liveSessionSeconds: 0,
    floorWorkedSeconds: 0,
  };

  it('consumes exactly one second per second of session', () => {
    // The reported case: the server had billed nothing when the dashboard was
    // read 11s into the session. The countdown starts from the server's figure
    // and then tracks the session clock second for second — it does not also
    // subtract the 11s the server never counted.
    const atFetch = shiftCountdown({ ...base, capturedSessionSeconds: 11, liveSessionSeconds: 11 });
    expect(atFetch.remainingSeconds).toBe(EIGHT_HOURS);

    const eightLater = shiftCountdown({ ...base, capturedSessionSeconds: 11, liveSessionSeconds: 19 });
    expect(eightLater.remainingSeconds).toBe(EIGHT_HOURS - 8);

    // Eight seconds on the session clock, eight seconds off the countdown.
    expect(atFetch.remainingSeconds - eightLater.remainingSeconds).toBe(8);
  });

  it('does not give time back when the timer stops', () => {
    // The regression. Stopping drops the live session to zero; the countdown
    // must hold what it already showed rather than snapping to the stale
    // server figure.
    const running = shiftCountdown({ ...base, capturedSessionSeconds: 11, liveSessionSeconds: 19 });
    const stopped = shiftCountdown({
      ...base,
      capturedSessionSeconds: 0,
      liveSessionSeconds: 0,
      floorWorkedSeconds: running.workedSeconds,
    });

    expect(stopped.remainingSeconds).toBe(running.remainingSeconds);
    expect(stopped.remainingSeconds).not.toBe(EIGHT_HOURS);
  });

  it('lets a fresh server figure pull worked time forward', () => {
    // The server is still the authority on the total. A higher billed figure
    // wins over the local floor.
    const result = shiftCountdown({
      ...base,
      serverWorkedSeconds: 3_600,
      floorWorkedSeconds: 900,
    });

    expect(result.workedSeconds).toBe(3_600);
    expect(result.remainingSeconds).toBe(EIGHT_HOURS - 3_600);
  });

  it('discards a local over-count once the server reports', () => {
    /*
     * The regression a review caught in the first version of this fix. The
     * local term advances on raw wall clock; `billed_seconds` is idle-netted.
     * Five minutes of sub-auto-stop idle therefore has the client 300s ahead —
     * and if the floor survived the next server read, that 300s would be
     * permanent, because the floor is a max() the server can never pull back
     * down. Over an eight-hour day of the same the countdown drifts ~40 minutes
     * ahead of the truth and never returns.
     */
    const overCounted = shiftCountdown({
      ...base,
      serverWorkedSeconds: 0,
      capturedSessionSeconds: 0,
      liveSessionSeconds: 300,
      floorWorkedSeconds: 0,
    });
    expect(overCounted.workedSeconds).toBe(300);

    // The server read that follows says only 60 of those seconds were worked.
    const corrected = shiftCountdown({
      ...base,
      serverWorkedSeconds: 60,
      capturedSessionSeconds: 300,
      liveSessionSeconds: 300,
      floorWorkedSeconds: serverRebasedFloor(60),
    });

    expect(corrected.workedSeconds).toBe(60);
    expect(corrected.remainingSeconds).toBe(EIGHT_HOURS - 60);
  });

  it('rebases the floor on the server figure alone', () => {
    // Not max(local, server) — that is exactly what makes the over-count stick.
    expect(serverRebasedFloor(60)).toBe(60);
    expect(serverRebasedFloor(-1)).toBe(0);
    expect(serverRebasedFloor(Number.NaN)).toBe(0);
  });

  it('holds the display while it waits for that server figure', () => {
    // Between a stop and the read that follows it, the floor is the only thing
    // keeping the countdown off a stale server figure. It must win there — and
    // only there.
    const result = shiftCountdown({
      ...base,
      serverWorkedSeconds: 600,
      floorWorkedSeconds: 900,
    });

    expect(result.workedSeconds).toBe(900);
    expect(result.remainingSeconds).toBe(EIGHT_HOURS - 900);
  });

  it('reports overtime once the shift is covered, and no negative remainder', () => {
    const result = shiftCountdown({
      ...base,
      serverWorkedSeconds: EIGHT_HOURS + 1_800,
    });

    expect(result.remainingSeconds).toBe(0);
    expect(result.overtimeSeconds).toBe(1_800);
  });

  it('ignores a session clock that runs behind its captured value', () => {
    // A re-anchor can briefly leave live below the captured value. That is not
    // negative work.
    const result = shiftCountdown({
      ...base,
      serverWorkedSeconds: 100,
      capturedSessionSeconds: 30,
      liveSessionSeconds: 5,
    });

    expect(result.workedSeconds).toBe(100);
  });

  it('falls back to a full shift target when the server sends nothing usable', () => {
    const result = shiftCountdown({
      ...base,
      shiftTargetSeconds: Number.NaN,
      serverWorkedSeconds: Number.NaN,
    });

    expect(result.remainingSeconds).toBe(EIGHT_HOURS);
    expect(result.workedSeconds).toBe(0);
  });
});
