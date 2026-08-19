/**
 * Seconds to display for a running timer.
 *
 * The rule that matters: **both ends of the subtraction come from the same
 * clock.** The anchor is `Date.now()` taken on the client when it first sees
 * the timer, and it advances with `Date.now()` on that same client. The
 * server's contribution is a *duration* — a length, not a point in time — so
 * no server timestamp ever enters the arithmetic.
 *
 * The previous version anchored on the server's `start_time` and advanced with
 * the client's `Date.now()`, which put the difference between the two clocks
 * straight into the displayed value. Measured 18 Aug 2026: a laptop 3.5s
 * behind the server showed 00:00:00 for the first three seconds (the elapsed
 * value was negative and got clamped), then "started at 1"; a refresh pulled
 * the server duration, jumped to 8, and sat there until the client caught up.
 * Nothing was wrong with that machine except its clock, and nothing in the app
 * should have cared.
 *
 * @param baseSeconds  Duration the server had recorded at the moment of anchoring.
 * @param anchorMs     Client epoch (`Date.now()`) captured at that same moment.
 * @param nowMs        Client epoch now.
 */
export const liveTimerDuration = (
  baseSeconds: number,
  anchorMs: number,
  nowMs: number
): number => {
  // Floor, not round: a clock shows *completed* seconds, so 4.7s elapsed reads
  // as 4. Rounding would let the display run ahead of the time actually worked.
  const base = Number.isFinite(baseSeconds) ? Math.max(0, Math.floor(baseSeconds)) : 0;

  // No usable anchor: the server's duration is the only honest answer.
  if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs)) {
    return base;
  }

  /*
   * Clamped at zero so a backwards clock jump freezes the display instead of
   * rewinding it. An NTP correction does exactly that, and the people most
   * likely to receive one are those who have just fixed a drifting clock — so
   * this is the common case, not the exotic one.
   */
  const advancedSeconds = Math.max(0, Math.floor((nowMs - anchorMs) / 1000));

  return base + advancedSeconds;
};
