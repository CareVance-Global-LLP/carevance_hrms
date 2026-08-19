import { describe, expect, it } from 'vitest';
import { zoneCityLabel, foreignZoneNotice } from './timelineZoneLabel';

/**
 * Measured on a real two-office org, 19 Aug 2026. Both employees started at
 * 09:00 in their own city. The Timeline drew the Manila employee's day at
 * 05:30 because every lane is rendered in the VIEWER's zone, and said nothing
 * about it. An HR manager reading that screen concludes somebody started
 * before dawn.
 *
 * The data was never wrong — the label was missing. So: only say something
 * when the employee's zone actually differs from the viewer's, because a
 * badge on every row is noise that gets ignored.
 */
describe('zoneCityLabel', () => {
  it('reduces an IANA zone to the city people recognise', () => {
    expect(zoneCityLabel('Asia/Manila')).toBe('Manila');
    expect(zoneCityLabel('Asia/Kolkata')).toBe('Kolkata');
    expect(zoneCityLabel('America/New_York')).toBe('New York');
    expect(zoneCityLabel('Europe/London')).toBe('London');
  });

  it('keeps a three-part zone readable', () => {
    expect(zoneCityLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires');
  });

  it('passes through anything that is not a region/city zone', () => {
    expect(zoneCityLabel('UTC')).toBe('UTC');
  });

  it('survives empty input rather than rendering "undefined"', () => {
    expect(zoneCityLabel('')).toBe('');
    expect(zoneCityLabel(null)).toBe('');
    expect(zoneCityLabel(undefined)).toBe('');
  });
});

describe('foreignZoneNotice', () => {
  it('says nothing when the employee shares the viewer timezone', () => {
    expect(foreignZoneNotice('Asia/Kolkata', 'Asia/Kolkata')).toBeNull();
  });

  it('treats the Calcutta and Kolkata spellings as the same place', () => {
    // The viewer's browser reports Asia/Calcutta while the server says
    // Asia/Kolkata. Badging that as foreign would put a notice on every row.
    expect(foreignZoneNotice('Asia/Kolkata', 'Asia/Calcutta')).toBeNull();
    expect(foreignZoneNotice('Asia/Calcutta', 'Asia/Kolkata')).toBeNull();
  });

  it('names the employee city when the zones genuinely differ', () => {
    expect(foreignZoneNotice('Asia/Manila', 'Asia/Kolkata')).toBe('Manila time');
  });

  it('says nothing when either zone is unknown', () => {
    expect(foreignZoneNotice(null, 'Asia/Kolkata')).toBeNull();
    expect(foreignZoneNotice('Asia/Manila', '')).toBeNull();
  });
});
