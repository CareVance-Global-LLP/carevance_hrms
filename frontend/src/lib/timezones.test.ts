import { describe, it, expect } from 'vitest';
import { canonicalTimeZone, DEFAULT_APP_TIMEZONE } from './timezones';

describe('canonicalTimeZone', () => {
  it('maps the legacy Indian zone Chrome reports onto the one pickers list', () => {
    // Chrome resolves IST as Asia/Calcutta; every timezone select in the app
    // offers Asia/Kolkata. Unmapped, the auto-detected value matched no option
    // and the Add User wizard rendered its required timezone field empty.
    expect(canonicalTimeZone('Asia/Calcutta')).toBe('Asia/Kolkata');
  });

  it('leaves an already-canonical zone alone', () => {
    expect(canonicalTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(canonicalTimeZone('Europe/Berlin')).toBe('Europe/Berlin');
  });

  it('maps the other legacy aliases browsers still emit', () => {
    expect(canonicalTimeZone('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(canonicalTimeZone('Asia/Saigon')).toBe('Asia/Ho_Chi_Minh');
    expect(canonicalTimeZone('America/Buenos_Aires')).toBe('America/Argentina/Buenos_Aires');
  });

  it('falls back to the app default for an empty value', () => {
    expect(canonicalTimeZone('')).toBe(DEFAULT_APP_TIMEZONE);
    expect(canonicalTimeZone(null)).toBe(DEFAULT_APP_TIMEZONE);
    expect(canonicalTimeZone(undefined)).toBe(DEFAULT_APP_TIMEZONE);
  });

  it('passes through an unknown zone rather than silently reassigning it', () => {
    // Substituting a default here would quietly file someone under the wrong
    // timezone; the caller shows the raw id as an option instead.
    expect(canonicalTimeZone('Asia/Karachi')).toBe('Asia/Karachi');
  });
});
