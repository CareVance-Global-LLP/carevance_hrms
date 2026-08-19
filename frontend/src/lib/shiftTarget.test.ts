import { describe, expect, it } from 'vitest';
import { DEFAULT_SHIFT_TARGET_SECONDS, resolveShiftTargetSeconds } from './shiftTarget';

describe('resolveShiftTargetSeconds', () => {
  it('prefers the resolved shift target over the eight-hour default', () => {
    expect(resolveShiftTargetSeconds(6 * 3600)).toBe(6 * 3600);
  });

  it('falls back to eight hours only when nothing is configured', () => {
    expect(resolveShiftTargetSeconds(null, undefined)).toBe(DEFAULT_SHIFT_TARGET_SECONDS);
    expect(DEFAULT_SHIFT_TARGET_SECONDS).toBe(8 * 3600);
  });

  it('takes the first usable candidate and ignores the rest', () => {
    // The payload-level figure is the one the server resolved for today; the
    // record-level copy is a snapshot and may be stale.
    expect(resolveShiftTargetSeconds(6 * 3600, 8 * 3600)).toBe(6 * 3600);
    expect(resolveShiftTargetSeconds(null, 7 * 3600)).toBe(7 * 3600);
  });

  it('accepts the numeric strings a JSON API actually returns', () => {
    // Attendance.tsx read `record.shift_target_seconds || 8 * 3600` with no
    // coercion at all, so a string went straight into duration formatting.
    expect(resolveShiftTargetSeconds('21600')).toBe(21600);
    expect(resolveShiftTargetSeconds(' 21600 ')).toBe(21600);
  });

  it('never returns NaN for a value that will not parse', () => {
    // `Number(x || fallback)` returns NaN here, and NaN propagates silently
    // through the remaining-time and percentage arithmetic into the UI.
    expect(resolveShiftTargetSeconds('not a number')).toBe(DEFAULT_SHIFT_TARGET_SECONDS);
    expect(resolveShiftTargetSeconds({})).toBe(DEFAULT_SHIFT_TARGET_SECONDS);
    expect(resolveShiftTargetSeconds(Number.NaN)).toBe(DEFAULT_SHIFT_TARGET_SECONDS);
    expect(resolveShiftTargetSeconds(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SHIFT_TARGET_SECONDS);
  });

  it('rejects zero and negatives rather than reporting an instantly complete shift', () => {
    expect(resolveShiftTargetSeconds(0)).toBe(DEFAULT_SHIFT_TARGET_SECONDS);
    expect(resolveShiftTargetSeconds(-60)).toBe(DEFAULT_SHIFT_TARGET_SECONDS);
  });

  it('rounds a fractional target to whole seconds', () => {
    expect(resolveShiftTargetSeconds(21599.6)).toBe(21600);
  });

  it('lets the caller override the default when it has a better one', () => {
    expect(resolveShiftTargetSeconds(null, { fallbackSeconds: 6 * 3600 })).toBe(6 * 3600);
  });
});
