import { describe, expect, it } from 'vitest';
import { nextCaptureDelayMs } from './useDesktopTracker';

const MINUTE = 60_000;

describe('nextCaptureDelayMs', () => {
  it('waits exactly one interval when scheduling from the anchor', () => {
    expect(nextCaptureDelayMs(1_000_000, 1_000_000, MINUTE)).toBe(MINUTE);
  });

  it('subtracts the time a capture took so periods do not accumulate it', () => {
    /*
     * The regression this exists for. The old chain re-armed a fresh full
     * interval after the capture resolved, so a 2.4s screenshot-and-upload made
     * every period 62.4s and the gap grew further from the configured value the
     * longer a timer ran. Scheduling against the anchor absorbs it instead.
     */
    const anchor = 1_000_000;
    const captureTookMs = 2_400;

    expect(nextCaptureDelayMs(anchor, anchor + captureTookMs, MINUTE)).toBe(MINUTE - captureTookMs);
  });

  it('holds the schedule across many periods without drifting', () => {
    const anchor = 1_000_000;
    let now = anchor;
    const firedAt: number[] = [];

    // Each capture costs a different, realistic amount of time.
    for (const cost of [2_400, 900, 5_100, 3_300, 700, 4_800, 1_200, 2_000, 6_400, 1_500]) {
      now += nextCaptureDelayMs(anchor, now, MINUTE);
      firedAt.push(now);
      now += cost;
    }

    // Every capture lands on an exact minute boundary from the anchor.
    expect(firedAt).toEqual(
      Array.from({ length: 10 }, (_unused, index) => anchor + (index + 1) * MINUTE)
    );
  });

  it('skips missed slots instead of firing them back to back', () => {
    // The machine slept through two and a half periods. Catching up would burst
    // three screenshots at once, well above the configured rate.
    const anchor = 1_000_000;

    expect(nextCaptureDelayMs(anchor, anchor + 2.5 * MINUTE, MINUTE)).toBe(0.5 * MINUTE);
  });

  it('never returns a slot in the past, even exactly on a boundary', () => {
    const anchor = 1_000_000;

    // Landing precisely on a boundary must schedule the NEXT one, not zero.
    expect(nextCaptureDelayMs(anchor, anchor + 3 * MINUTE, MINUTE)).toBe(MINUTE);
  });

  it('re-anchors when the clock moves backwards instead of opening a long gap', () => {
    /*
     * A resynced system clock must not produce a negative delay (setTimeout
     * would fire immediately, repeatedly) nor a delay LONGER than the interval.
     * Honouring the old schedule after an hour's correction would leave an
     * hour with no captures at all.
     */
    const anchor = 1_000_000;

    expect(nextCaptureDelayMs(anchor, anchor - 30_000, MINUTE)).toBe(MINUTE);
    expect(nextCaptureDelayMs(anchor, anchor - 60 * MINUTE, MINUTE)).toBe(MINUTE);
  });

  it('never exceeds the configured interval, whatever the clock does', () => {
    const anchor = 1_000_000;
    const probes = [-90 * MINUTE, -MINUTE, -1, 0, 1, 999, MINUTE, 3.7 * MINUTE, 500 * MINUTE];

    for (const offset of probes) {
      const delay = nextCaptureDelayMs(anchor, anchor + offset, MINUTE);

      expect(delay).toBeGreaterThan(0);
      expect(delay).toBeLessThanOrEqual(MINUTE);
    }
  });

  it('honours intervals other than a minute', () => {
    const anchor = 1_000_000;

    expect(nextCaptureDelayMs(anchor, anchor, 5 * MINUTE)).toBe(5 * MINUTE);
    expect(nextCaptureDelayMs(anchor, anchor + 7 * MINUTE, 5 * MINUTE)).toBe(3 * MINUTE);
  });

  it('returns 0 rather than NaN for a nonsensical interval', () => {
    expect(nextCaptureDelayMs(1_000_000, 1_000_000, 0)).toBe(0);
    expect(nextCaptureDelayMs(1_000_000, 1_000_000, Number.NaN)).toBe(0);
  });
});
