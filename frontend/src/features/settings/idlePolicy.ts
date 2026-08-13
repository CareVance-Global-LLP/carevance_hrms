/**
 * Organization-level idle policy: the options an admin may choose, and the one
 * rule the server will not enforce honestly.
 *
 * The backend has accepted these three thresholds since the tracker-policy
 * block was added — `UpdateOrganizationRequest` validates them and
 * `SettingsController` persists them admin-only — but nothing ever sent them,
 * so every organization has been stuck on the system defaults.
 *
 * Durations are held as strings because that is what a `<select>` gives back
 * and what the FormData branch of the organization save can carry. `''` means
 * "no organization override", which the save path turns into null so the
 * organization falls back to the system default.
 */

export interface IdleThresholdOption {
  value: string;
  label: string;
}

/*
 * Every value here must sit inside the bounds UpdateOrganizationRequest
 * enforces (idle track 60-3600, auto stop 300-3600, lock 60-3600). A UI that
 * offers a value the API rejects is the same class of defect as one that
 * offers a value the API silently discards — idlePolicy.test.ts pins both
 * directions.
 *
 * The empty option deliberately carries no number. The server owns the system
 * defaults; the client's env copies are only a pre-hydration fallback (see
 * trackerPolicy.ts), so printing "System default (3 minutes)" here would state
 * a figure this screen cannot actually verify.
 */

/** How long without input before the tracker records the time as idle. */
export const IDLE_TRACK_OPTIONS: IdleThresholdOption[] = [
  { value: '', label: 'System default' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '180', label: '3 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
];

/**
 * How long without input before the timer stops on its own.
 *
 * The band starts at 5 minutes because that is the server's floor, and reaches
 * an hour because the comparable products are far less aggressive than this
 * product has been: Time Doctor defaults to 15 minutes over a 3-minute-to-
 * 6-hour range, and Insightful's automatic clock-out defaults to 4 hours.
 */
export const IDLE_AUTO_STOP_OPTIONS: IdleThresholdOption[] = [
  { value: '', label: 'System default' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
  { value: '900', label: '15 minutes' },
  { value: '1800', label: '30 minutes' },
  { value: '3600', label: '60 minutes' },
];

/** How long the screen may stay locked before the timer stops. */
export const LOCK_AUTO_STOP_OPTIONS: IdleThresholdOption[] = [
  { value: '', label: 'System default' },
  { value: '60', label: '1 minute' },
  { value: '120', label: '2 minutes' },
  { value: '300', label: '5 minutes' },
  { value: '600', label: '10 minutes' },
];

/**
 * Refuse a pair the server would accept and then quietly change.
 *
 * `TrackerPolicyResolver` resolves auto-stop as `max($autoStop, $idleTrack)`,
 * on the reasoning that stopping a timer before any idle span has been recorded
 * would leave the stop unjustified. That reasoning is sound, but the effect is
 * that an admin who picks "stop after 5 minutes" alongside "idle after 10
 * minutes" gets 10, is told nothing, and sees their own choice reflected back
 * in the form. Refusing the pair here keeps the screen honest.
 *
 * Only checked when both sides are explicit. With one inherited, the resolved
 * pair depends on server-side defaults this screen does not authoritatively
 * know, and guessing would produce false errors.
 *
 * @returns an error message, or null when the pair is fine.
 */
export const validateIdleThresholds = (
  idleTrackSeconds: string,
  idleAutoStopSeconds: string
): string | null => {
  if (idleTrackSeconds === '' || idleAutoStopSeconds === '') {
    return null;
  }

  const idleTrack = Number(idleTrackSeconds);
  const autoStop = Number(idleAutoStopSeconds);

  if (!Number.isFinite(idleTrack) || !Number.isFinite(autoStop)) {
    return null;
  }

  if (autoStop < idleTrack) {
    return '"Stop the timer after" cannot be shorter than "Mark as idle after" — the timer would stop before any idle time had been recorded to justify it.';
  }

  return null;
};

/**
 * What happens to an idle span when someone comes back.
 *
 * Mirrors Hubstaff's organization setting, whose default is also to ask. The
 * two automatic answers change a timesheet without the person's input, which
 * is why "Ask" leads and is what an unset or unrecognised value falls back to
 * (see readIdleResolutionPolicy in lib/trackerPolicy.ts).
 *
 * No empty option here: unlike the durations, there is no meaningful "system
 * default" to inherit — prompting IS the default, so it is a real choice
 * rather than an absence.
 */
export const IDLE_RESOLUTION_POLICY_OPTIONS: IdleThresholdOption[] = [
  { value: 'prompt', label: 'Ask the person' },
  { value: 'always_keep', label: 'Always keep' },
  { value: 'never_keep', label: 'Never keep' },
];
