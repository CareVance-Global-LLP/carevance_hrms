import { formatDistance, haversineMeters, isAccuracyPoor, POOR_ACCURACY_M } from '../src/lib/geo';

describe('haversineMeters', () => {
  it('is zero for the same point', () => {
    expect(haversineMeters(23.0225, 72.5714, 23.0225, 72.5714)).toBe(0);
  });

  it('measures a known short hop', () => {
    // 0.001 degrees of latitude is about 111 m anywhere on Earth.
    expect(haversineMeters(23.0225, 72.5714, 23.0235, 72.5714)).toBeCloseTo(111, -1);
  });

  it('is symmetric', () => {
    const a = haversineMeters(23.0225, 72.5714, 19.076, 72.8777);
    const b = haversineMeters(19.076, 72.8777, 23.0225, 72.5714);
    expect(a).toBeCloseTo(b, 6);
  });

  it('gets a long real distance right', () => {
    // Ahmedabad to Mumbai is about 440 km.
    const km = haversineMeters(23.0225, 72.5714, 19.076, 72.8777) / 1000;
    expect(km).toBeGreaterThan(430);
    expect(km).toBeLessThan(450);
  });
});

describe('formatDistance — something a person standing there can use', () => {
  it('uses whole metres up close', () => {
    expect(formatDistance(0)).toBe('0 m');
    expect(formatDistance(87.4)).toBe('87 m');
    expect(formatDistance(999)).toBe('999 m');
  });

  it('switches to kilometres once metres stop meaning anything', () => {
    expect(formatDistance(1000)).toBe('1.0 km');
    expect(formatDistance(4560)).toBe('4.6 km');
  });

  it('drops the decimal when it is noise', () => {
    expect(formatDistance(44000)).toBe('44 km');
  });

  it('refuses to render nonsense as a real distance', () => {
    expect(formatDistance(NaN)).toBe('—');
    expect(formatDistance(-1)).toBe('—');
    expect(formatDistance(Infinity)).toBe('—');
  });
});

describe('isAccuracyPoor', () => {
  it('accepts a normal satellite fix', () => {
    expect(isAccuracyPoor(12)).toBe(false);
    expect(isAccuracyPoor(POOR_ACCURACY_M)).toBe(false);
  });

  it('flags a fix too vague to judge a geofence by', () => {
    expect(isAccuracyPoor(120)).toBe(true);
  });

  it('says nothing when there is no reading', () => {
    // Absent accuracy must not be reported as poor — the user would be told
    // their signal is bad when nothing has been measured at all.
    expect(isAccuracyPoor(undefined)).toBe(false);
  });
});
