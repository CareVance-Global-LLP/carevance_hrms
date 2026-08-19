/** "15 minutes 34 seconds", "1 minute", "45 seconds". */
export const formatIdleDurationLabel = (seconds: number) => {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes <= 0) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }

  if (remainingSeconds === 0) {
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }

  return `${minutes} minute${minutes === 1 ? '' : 's'} ${remainingSeconds} second${remainingSeconds === 1 ? '' : 's'}`;
};

/**
 * What to tell someone whose timer was stopped for inactivity.
 *
 * The message used to be built once, from the configured threshold, and reused
 * everywhere: "You were idle for 15 minutes 34 seconds." That sentence asserts
 * a measurement, and it was not one — it was the threshold, identical on every
 * stop no matter how long the person had actually been away. Reported 18 Aug
 * 2026 by a user who read it as a measurement of them, and reasonably
 * concluded the tracker was miscounting their time.
 *
 * Two honest sentences instead of one dishonest one. Where the stop is being
 * handled we have the measured idle, so we report it. Where we are only
 * telling someone on their return that a stop happened earlier, the number is
 * out of scope — so we describe the rule that fired rather than inventing an
 * observation.
 */
export const idleAutoStopMessage = (
  measuredIdleSeconds: number | null | undefined,
  thresholdSeconds: number
): string => {
  const measured = Number(measuredIdleSeconds);

  if (Number.isFinite(measured) && measured > 0) {
    return `You were idle for ${formatIdleDurationLabel(Math.floor(measured))}, so your timer was stopped.`;
  }

  return `No activity for ${formatIdleDurationLabel(thresholdSeconds)}, so your timer was stopped.`;
};
