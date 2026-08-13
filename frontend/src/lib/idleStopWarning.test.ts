import { describe, expect, it } from 'vitest';
import { IDLE_STOP_WARNING_SECONDS, idleStopWarningSecondsRemaining } from './idleStopWarning';

const FIVE_MINUTES = 300;
const FIFTEEN_MINUTES = 900;

describe('idleStopWarningSecondsRemaining', () => {
  it('stays silent while the stop is still far off', () => {
    expect(idleStopWarningSecondsRemaining(0, FIFTEEN_MINUTES)).toBeNull();
    expect(idleStopWarningSecondsRemaining(600, FIFTEEN_MINUTES)).toBeNull();
  });

  it('starts exactly one warning window before the stop', () => {
    // 900 - 60 = 840. One second earlier is still silent.
    expect(idleStopWarningSecondsRemaining(839, FIFTEEN_MINUTES)).toBeNull();
    expect(idleStopWarningSecondsRemaining(840, FIFTEEN_MINUTES)).toBe(IDLE_STOP_WARNING_SECONDS);
  });

  it('counts down as the idle stretch grows', () => {
    expect(idleStopWarningSecondsRemaining(870, FIFTEEN_MINUTES)).toBe(30);
    expect(idleStopWarningSecondsRemaining(899, FIFTEEN_MINUTES)).toBe(1);
  });

  it('reaches zero at the threshold rather than going negative', () => {
    // The stop fires on the same tick. A negative countdown would render as
    // "-4 seconds" in the moment the person is most likely to be looking.
    expect(idleStopWarningSecondsRemaining(900, FIFTEEN_MINUTES)).toBe(0);
    expect(idleStopWarningSecondsRemaining(964, FIFTEEN_MINUTES)).toBe(0);
  });

  it('works at the shortest threshold an organization can set', () => {
    // 300 is the server's floor, so a 60 second window always fits inside it.
    expect(idleStopWarningSecondsRemaining(239, FIVE_MINUTES)).toBeNull();
    expect(idleStopWarningSecondsRemaining(240, FIVE_MINUTES)).toBe(IDLE_STOP_WARNING_SECONDS);
    expect(idleStopWarningSecondsRemaining(300, FIVE_MINUTES)).toBe(0);
  });

  it('never warns for the whole idle stretch when the threshold is tiny', () => {
    /*
     * Below the server's floor the window would swallow the entire threshold
     * and someone would be warned from the first second of going idle. Clamp
     * to the threshold so the warning still only covers the run-up.
     */
    expect(idleStopWarningSecondsRemaining(0, 30)).toBeNull();
    expect(idleStopWarningSecondsRemaining(1, 30)).toBe(29);
  });

  it('stays silent for nonsense input rather than warning constantly', () => {
    for (const threshold of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(idleStopWarningSecondsRemaining(100, threshold)).toBeNull();
    }
    expect(idleStopWarningSecondsRemaining(Number.NaN, FIFTEEN_MINUTES)).toBeNull();
    expect(idleStopWarningSecondsRemaining(-5, FIFTEEN_MINUTES)).toBeNull();
  });
});
