import { describe, expect, it } from 'vitest';
import { formatIdleDurationLabel, idleAutoStopMessage } from './idleAutoStopMessage';

/**
 * The wording bug, reported 18 Aug 2026.
 *
 * The notification read "You were idle for 15 minutes 34 seconds" — a sentence
 * that states a measurement. It was not one. It printed the configured
 * `idle_auto_stop_threshold_seconds`, so every auto-stop claimed the same
 * oddly precise figure regardless of how long the person had actually been
 * away. A user reasonably read it as a measurement of them and concluded the
 * tracker was miscounting.
 *
 * Say what we know. When the measured idle is in hand, report it. When it is
 * not, describe the threshold AS a threshold rather than dressing it up as an
 * observation.
 */
describe('idleAutoStopMessage', () => {
  const THRESHOLD = 934; // 15m 34s — the real value behind the reported bug

  it('reports the measured idle when it is known', () => {
    expect(idleAutoStopMessage(1_200, THRESHOLD)).toBe(
      'You were idle for 20 minutes, so your timer was stopped.'
    );
  });

  it('never presents the threshold as a measurement', () => {
    const message = idleAutoStopMessage(null, THRESHOLD);

    expect(message).not.toContain('You were idle for');
    expect(message).toBe('No activity for 15 minutes 34 seconds, so your timer was stopped.');
  });

  it('falls back for a missing, zero or nonsense measurement', () => {
    const fallback = 'No activity for 15 minutes 34 seconds, so your timer was stopped.';

    expect(idleAutoStopMessage(undefined, THRESHOLD)).toBe(fallback);
    expect(idleAutoStopMessage(0, THRESHOLD)).toBe(fallback);
    expect(idleAutoStopMessage(-30, THRESHOLD)).toBe(fallback);
    expect(idleAutoStopMessage(Number.NaN, THRESHOLD)).toBe(fallback);
  });
});

describe('formatIdleDurationLabel', () => {
  it('renders whole minutes without a trailing zero seconds', () => {
    expect(formatIdleDurationLabel(900)).toBe('15 minutes');
    expect(formatIdleDurationLabel(60)).toBe('1 minute');
  });

  it('renders minutes and seconds together', () => {
    expect(formatIdleDurationLabel(934)).toBe('15 minutes 34 seconds');
    expect(formatIdleDurationLabel(61)).toBe('1 minute 1 second');
  });

  it('renders sub-minute durations in seconds', () => {
    expect(formatIdleDurationLabel(45)).toBe('45 seconds');
    expect(formatIdleDurationLabel(1)).toBe('1 second');
  });
});
