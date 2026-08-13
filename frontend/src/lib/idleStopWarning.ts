/**
 * The run-up to an automatic idle stop.
 *
 * The timer used to stop with no warning at all: the first someone knew was
 * that it was gone, and under an organization set to discard idle time, so were
 * the minutes. Time Doctor shows a 60-second countdown before it times out;
 * this is the same idea.
 *
 * Fixed at 60 seconds rather than made configurable. There are already four
 * organization-level idle settings, and a fifth controlling how long the
 * warning lasts would earn nothing — the number that matters is when the timer
 * stops, which is already theirs to set.
 */
export const IDLE_STOP_WARNING_SECONDS = 60;

/**
 * How many seconds remain before the timer stops, or null when it is too early
 * to say anything.
 *
 * Driven purely by how close the idle stretch is to the threshold, not by
 * whether the stop attempt will actually succeed. `attemptIdleAutoStop` has
 * back-off and per-entry attempt caps, so keying the warning off it would
 * sometimes warn and then not stop. That is mildly confusing; stopping without
 * warning is the thing being fixed, so proximity is the safer signal.
 *
 * @param idleSeconds how long the person has been idle
 * @param autoStopThresholdSeconds the resolved organization threshold
 */
export const idleStopWarningSecondsRemaining = (
  idleSeconds: number,
  autoStopThresholdSeconds: number
): number | null => {
  if (!Number.isFinite(idleSeconds) || idleSeconds < 0) return null;
  if (!Number.isFinite(autoStopThresholdSeconds) || autoStopThresholdSeconds <= 0) return null;

  /*
   * The window can never cover the whole threshold. The server floor is 300
   * seconds so this cannot happen in practice, but an unclamped window would
   * mean a short threshold warned from the first idle second — a countdown
   * showing before the person has even stepped away.
   */
  const window = Math.min(IDLE_STOP_WARNING_SECONDS, autoStopThresholdSeconds - 1);
  const warnFrom = autoStopThresholdSeconds - window;

  if (idleSeconds < warnFrom) return null;

  // Clamped at zero: the stop fires on this same tick, and a negative
  // countdown would render as "-4 seconds" at the moment someone is most
  // likely to be reading it.
  return Math.max(0, Math.round(autoStopThresholdSeconds - idleSeconds));
};
