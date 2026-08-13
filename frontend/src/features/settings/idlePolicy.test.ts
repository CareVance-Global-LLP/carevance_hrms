import { describe, expect, it } from 'vitest';
import {
  IDLE_AUTO_STOP_OPTIONS,
  IDLE_TRACK_OPTIONS,
  LOCK_AUTO_STOP_OPTIONS,
  validateIdleThresholds,
} from './idlePolicy';

/*
 * The server's bounds, copied from UpdateOrganizationRequest so drift shows up
 * here as a failing test rather than as a 422 an admin sees after saving.
 * Anything the UI offers must be something the API will accept.
 */
const SERVER_BOUNDS = {
  idleTrack: { min: 60, max: 3600 },
  idleAutoStop: { min: 300, max: 3600 },
  lockAutoStop: { min: 60, max: 3600 },
};

describe('idle threshold options', () => {
  it('offers only values the API will accept', () => {
    const cases = [
      ['idle track', IDLE_TRACK_OPTIONS, SERVER_BOUNDS.idleTrack],
      ['idle auto stop', IDLE_AUTO_STOP_OPTIONS, SERVER_BOUNDS.idleAutoStop],
      ['lock auto stop', LOCK_AUTO_STOP_OPTIONS, SERVER_BOUNDS.lockAutoStop],
    ] as const;

    for (const [name, options, bounds] of cases) {
      for (const option of options) {
        if (option.value === '') continue;

        const seconds = Number(option.value);
        expect(Number.isInteger(seconds), `${name} "${option.label}" is not a whole number`).toBe(true);
        expect(seconds, `${name} "${option.label}" is below the API minimum`).toBeGreaterThanOrEqual(bounds.min);
        expect(seconds, `${name} "${option.label}" is above the API maximum`).toBeLessThanOrEqual(bounds.max);
      }
    }
  });

  it('leads every list with an option that clears the override', () => {
    // '' is what the save path turns into null, which is how an organization
    // falls back to the system default. Without it there is no way to undo a
    // setting once made.
    for (const options of [IDLE_TRACK_OPTIONS, IDLE_AUTO_STOP_OPTIONS, LOCK_AUTO_STOP_OPTIONS]) {
      expect(options[0].value).toBe('');
    }
  });

  it('does not claim a specific duration for the system default', () => {
    // The server owns these numbers; the client's env copies are only a
    // pre-hydration fallback (see trackerPolicy.ts). Printing one here would
    // state a value we cannot verify.
    for (const options of [IDLE_TRACK_OPTIONS, IDLE_AUTO_STOP_OPTIONS, LOCK_AUTO_STOP_OPTIONS]) {
      expect(options[0].label).not.toMatch(/\d/);
    }
  });
});

describe('validateIdleThresholds', () => {
  it('rejects stopping the timer sooner than idle is even recorded', () => {
    /*
     * TrackerPolicyResolver does max($autoStop, $idleTrack), so this pair is
     * accepted and then silently raised — the admin's choice is overridden
     * with no indication. Refusing it up front is the whole point of this
     * function.
     */
    expect(validateIdleThresholds('600', '300')).toMatch(/idle/i);
  });

  it('accepts an equal pair', () => {
    expect(validateIdleThresholds('300', '300')).toBeNull();
  });

  it('accepts a stop threshold longer than the idle threshold', () => {
    expect(validateIdleThresholds('180', '900')).toBeNull();
  });

  it('stays silent when either side inherits the system default', () => {
    // With one side inherited the client cannot know the resolved pair — the
    // server owns those numbers — so asserting a conflict would be guessing.
    expect(validateIdleThresholds('', '300')).toBeNull();
    expect(validateIdleThresholds('600', '')).toBeNull();
    expect(validateIdleThresholds('', '')).toBeNull();
  });

  it('names both fields so the admin knows which one to change', () => {
    const message = validateIdleThresholds('600', '300');

    expect(message).toContain('Mark as idle after');
    expect(message).toContain('Stop the timer after');
  });
});
