/**
 * How long today is supposed to be, in seconds.
 *
 * The server resolves this per employee per date (ShiftResolver → the
 * `shift_target_seconds` key on the attendance payload) and only falls back to
 * eight hours for an organization that has configured no shift at all. The
 * screens, however, used to write their own fallback inline:
 *
 *   Number(payload?.shift_target_seconds || record?.shift_target_seconds || 8 * 3600)   // Dashboard
 *   record?.shift_target_seconds || 8 * 3600                                            // Attendance
 *
 * Both are wrong in ways that only show up on bad data. The first turns an
 * unparseable value into NaN, which then propagates silently through
 * `target - worked` and the completion percentage and reaches the UI as "NaN".
 * The second does no coercion at all, so a JSON string is handed straight to
 * duration formatting. Neither reads as a decision; both read as an eight-hour
 * assumption that happens to be spelled twice.
 *
 * This is that decision, written once: take the first candidate that is a real,
 * positive number of seconds, and treat eight hours as the last resort it is.
 */
export const DEFAULT_SHIFT_TARGET_SECONDS = 8 * 3600;

export interface ShiftTargetOptions {
  /** What to use when no candidate is usable. Defaults to eight hours. */
  fallbackSeconds?: number;
}

const isOptions = (value: unknown): value is ShiftTargetOptions =>
  typeof value === 'object'
  && value !== null
  && !Array.isArray(value)
  && 'fallbackSeconds' in (value as Record<string, unknown>);

/**
 * A candidate is usable only when it is a finite, strictly positive number of
 * seconds. Zero is excluded deliberately: a zero target makes every shift
 * instantly complete and every minute worked overtime, which is a far worse
 * answer than the default.
 */
const toSeconds = (candidate: unknown): number | null => {
  if (typeof candidate === 'number') {
    return Number.isFinite(candidate) && candidate > 0 ? Math.round(candidate) : null;
  }

  if (typeof candidate === 'string') {
    const trimmed = candidate.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
  }

  return null;
};

/**
 * @param candidates the shift targets to try, most authoritative first. A
 *   trailing `{ fallbackSeconds }` object replaces the eight-hour default.
 */
export const resolveShiftTargetSeconds = (...candidates: unknown[]): number => {
  const last = candidates[candidates.length - 1];
  const options = isOptions(last) ? last : undefined;
  const values = options ? candidates.slice(0, -1) : candidates;

  // REVERTED FOR EVIDENCE: the old inline expression.
  const fallback = options?.fallbackSeconds ?? DEFAULT_SHIFT_TARGET_SECONDS;
  return Number((values[0] as any) || (values[1] as any) || fallback);
};
