import { describe, expect, it } from 'vitest';
import { isCaptureBlockedContext, readIdleResolutionPolicy, resolveTrackerPolicy } from './trackerPolicy';

const basePolicy = {
  idle_track_threshold_seconds: 300,
  idle_auto_stop_threshold_seconds: 1200,
  lock_auto_stop_threshold_seconds: 300,
  capture_interval_minutes: 10,
  screenshot_retention_days: 90,
  privacy: { blocked_apps: [], skip_on_private_browsing: true },
};

describe('resolveTrackerPolicy', () => {
  it('takes the served policy over any local default', () => {
    const policy = resolveTrackerPolicy({ tracker_policy: basePolicy });

    expect(policy.idle_auto_stop_threshold_seconds).toBe(1200);
    expect(policy.capture_interval_minutes).toBe(10);
    expect(policy.screenshot_retention_days).toBe(90);
  });

  it('never lets auto-stop fall below the idle record threshold', () => {
    // A payload that stops the timer before idle has even been recorded would
    // close a session with nothing on record to justify the stop.
    const policy = resolveTrackerPolicy({
      tracker_policy: {
        ...basePolicy,
        idle_track_threshold_seconds: 900,
        idle_auto_stop_threshold_seconds: 600,
      },
    });

    expect(policy.idle_auto_stop_threshold_seconds).toBeGreaterThanOrEqual(
      policy.idle_track_threshold_seconds
    );
  });

  it('ignores an implausibly aggressive threshold rather than obeying it', () => {
    // This value decides how fast someone's timer is taken away. A truncated
    // or hostile payload must not be able to make that aggressive.
    const policy = resolveTrackerPolicy({
      tracker_policy: { ...basePolicy, idle_auto_stop_threshold_seconds: 5 },
    });

    expect(policy.idle_auto_stop_threshold_seconds).toBeGreaterThanOrEqual(300);
  });

  it('stays usable when the payload predates the policy field', () => {
    // AuthContext hydrates `user` from localStorage and the offline store
    // before /auth/me returns, so cached payloads legitimately lack it.
    const policy = resolveTrackerPolicy({
      effective_monitoring_interval_minutes: 15,
      settings: { monitoring_interval_minutes: 30 },
    });

    expect(policy.capture_interval_minutes).toBe(15);
    expect(policy.idle_auto_stop_threshold_seconds).toBeGreaterThanOrEqual(300);
    expect(policy.screenshot_retention_days).toBeGreaterThan(0);
  });

  it('falls back through to the legacy user setting, then to a default', () => {
    expect(
      resolveTrackerPolicy({ settings: { monitoring_interval_minutes: 30 } })
        .capture_interval_minutes
    ).toBe(30);

    expect(resolveTrackerPolicy(null).capture_interval_minutes).toBe(10);
  });

  it('keeps private-browsing skip on when the field is missing or malformed', () => {
    // A privacy control that fails open is not a privacy control.
    expect(resolveTrackerPolicy(null).privacy.skip_on_private_browsing).toBe(true);
    expect(
      resolveTrackerPolicy({ tracker_policy: { ...basePolicy, privacy: undefined } })
        .privacy.skip_on_private_browsing
    ).toBe(true);
  });
});

describe('isCaptureBlockedContext', () => {
  const policy = resolveTrackerPolicy({
    tracker_policy: {
      ...basePolicy,
      privacy: { blocked_apps: ['1password', 'bitwarden'], skip_on_private_browsing: true },
    },
  });

  it('blocks a listed app regardless of version suffix or casing', () => {
    expect(isCaptureBlockedContext(policy, { app: '1Password 8', title: 'Vault' })).toBe(true);
    expect(isCaptureBlockedContext(policy, { app: 'BITWARDEN', title: '' })).toBe(true);
  });

  it('blocks when the app is ordinary but the window is a password vault', () => {
    // A browser-based vault is the common case and the app name alone misses it.
    expect(
      isCaptureBlockedContext(policy, { app: 'Google Chrome', title: '1Password — My Vault' })
    ).toBe(true);
  });

  it('blocks private browsing windows', () => {
    expect(
      isCaptureBlockedContext(policy, { app: 'Google Chrome', title: 'Search - Incognito' })
    ).toBe(true);
    expect(
      isCaptureBlockedContext(policy, { app: 'Microsoft Edge', title: 'News [InPrivate]' })
    ).toBe(true);
  });

  it('allows ordinary work windows', () => {
    expect(
      isCaptureBlockedContext(policy, { app: 'Visual Studio Code', title: 'payroll.ts' })
    ).toBe(false);
    expect(isCaptureBlockedContext(policy, null)).toBe(false);
    expect(isCaptureBlockedContext(policy, { app: '', title: '' })).toBe(false);
  });

  it('permits private browsing when the organisation turns that rule off', () => {
    const permissive = resolveTrackerPolicy({
      tracker_policy: {
        ...basePolicy,
        privacy: { blocked_apps: [], skip_on_private_browsing: false },
      },
    });

    expect(
      isCaptureBlockedContext(permissive, { app: 'Chrome', title: 'Search - Incognito' })
    ).toBe(false);
  });
});

describe('readIdleResolutionPolicy', () => {
  it('accepts the three real policies', () => {
    expect(readIdleResolutionPolicy('prompt')).toBe('prompt');
    expect(readIdleResolutionPolicy('always_keep')).toBe('always_keep');
    expect(readIdleResolutionPolicy('never_keep')).toBe('never_keep');
  });

  it('falls back to prompting for anything else', () => {
    /*
     * The fail-safe. Either automatic answer changes someone's timesheet
     * without asking, so a missing, misspelled or wrongly-typed value must
     * never resolve to one — including the 0 that SettingsController's
     * int-cast used to produce for this key.
     */
    for (const junk of [undefined, null, '', 0, 'discard', 'always', true, {}]) {
      expect(readIdleResolutionPolicy(junk)).toBe('prompt');
    }
  });

  it('defaults the resolved policy to prompt when the server sends none', () => {
    expect(resolveTrackerPolicy({}).idle_resolution_policy).toBe('prompt');
  });

  it('carries a served policy through', () => {
    expect(
      resolveTrackerPolicy({ tracker_policy: { idle_resolution_policy: 'never_keep' } } as any)
        .idle_resolution_policy
    ).toBe('never_keep');
  });
});
