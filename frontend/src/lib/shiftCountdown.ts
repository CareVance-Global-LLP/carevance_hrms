/**
 * The shift countdown: how much of today's shift is left, and how much of it
 * has been worked.
 *
 * Two rules, both learned from bugs:
 *
 * **Both ends of a subtraction come from the same clock.** The server's
 * contribution is a total (`serverWorkedSeconds`), and the only thing added to
 * it locally is `liveSessionSeconds - capturedSessionSeconds` — a client
 * elapsed measured against the client value captured at the same instant the
 * server total was read. The previous version subtracted `active_timer.duration`
 * — the session's RAW span — from the live clock and applied the result to an
 * IDLE-NETTED total. Seconds the server had classified as idle were therefore
 * treated as already spent, and the gap never closed: measured 19 Aug 2026, a
 * session reading 00:00:19 had consumed only 8 seconds of an 8-hour shift, so
 * the countdown could not have reached zero in a full day's work.
 *
 * **A countdown never hands time back — but only until the server speaks.**
 * `floorWorkedSeconds` holds the display steady for the one request it takes to
 * re-read worked time after a timer stops, which is what the "stop resets it to
 * 8hr" report was about. It is deliberately NOT a running high-water mark for
 * the day: the local term advances on raw wall clock while `billed_seconds` is
 * idle-netted, so a floor that survived a server reading would preserve every
 * idle second the client counted and the server excluded. Sub-threshold idle
 * would then accumulate all day and the countdown would run permanently ahead.
 *
 * Callers must rebase the floor with `serverRebasedFloor()` on every successful
 * read. Nothing is lost by doing so: `billed_seconds` is already monotonic —
 * WorkedTimeService keeps a per-day high-water mark server-side — so the server
 * is incapable of rewinding the countdown on its own, and a second floor on the
 * client only protects the client's own guesses from being corrected.
 *
 * @see liveTimerDuration — the same same-clock rule, applied to the session timer.
 */

export const DEFAULT_SHIFT_SECONDS = 8 * 3600;

export type ShiftCountdownInput = {
  /** Shift length for the day, from the server. */
  shiftTargetSeconds: number;
  /** The server's billed worked seconds, from the last successful read. */
  serverWorkedSeconds: number;
  /**
   * The running session's displayed seconds at the moment `serverWorkedSeconds`
   * was read. Zero when no timer was running then.
   *
   * Deliberately the CLIENT's session clock and not `active_timer.duration`:
   * the server's raw span is not the amount of the session that made it into
   * the billed total, so it cannot mark where local counting should resume.
   */
  capturedSessionSeconds: number;
  /** The running session's displayed seconds now. Zero when stopped. */
  liveSessionSeconds: number;
  /**
   * Highest worked figure shown *since the last server read*. Rebase it with
   * `serverRebasedFloor()` whenever a fresh block arrives — see the note above
   * on why this must not persist across reads.
   */
  floorWorkedSeconds: number;
};

export type ShiftCountdown = {
  workedSeconds: number;
  remainingSeconds: number;
  overtimeSeconds: number;
};

const seconds = (value: number, fallback = 0): number =>
  Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback;

export const shiftCountdown = ({
  shiftTargetSeconds,
  serverWorkedSeconds,
  capturedSessionSeconds,
  liveSessionSeconds,
  floorWorkedSeconds,
}: ShiftCountdownInput): ShiftCountdown => {
  const target = Number.isFinite(shiftTargetSeconds) && shiftTargetSeconds > 0
    ? Math.floor(shiftTargetSeconds)
    : DEFAULT_SHIFT_SECONDS;

  const serverWorked = seconds(serverWorkedSeconds);
  const captured = seconds(capturedSessionSeconds);
  const live = seconds(liveSessionSeconds);

  // Clamped at zero: a re-anchor can briefly leave the live clock below the
  // captured value, and that is not negative work.
  const sinceCapture = Math.max(0, live - captured);

  const workedSeconds = Math.max(seconds(floorWorkedSeconds), serverWorked + sinceCapture);

  return {
    workedSeconds,
    remainingSeconds: Math.max(0, target - workedSeconds),
    overtimeSeconds: Math.max(0, workedSeconds - target),
  };
};

/**
 * The floor to carry forward after applying a freshly read worked-time block.
 *
 * It is the server's own figure and nothing else — any local extrapolation
 * that ran ahead of it is discarded here, deliberately. Keeping the higher of
 * the two would make every second of idle the client counted permanent, since
 * the floor is a max() the server can then never pull back down.
 */
export const serverRebasedFloor = (billedSeconds: number): number => seconds(billedSeconds);
