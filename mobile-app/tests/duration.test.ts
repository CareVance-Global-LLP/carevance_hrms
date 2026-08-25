import { formatClock, formatShort, spokenDuration } from '../src/lib/duration';

describe('formatClock', () => {
  it('pads every field', () => {
    expect(formatClock(0)).toBe('00:00:00');
    expect(formatClock(61)).toBe('00:01:01');
    expect(formatClock(8 * 3600 + 5 * 60 + 9)).toBe('08:05:09');
  });

  it('does not wrap past 24 hours', () => {
    // A punch left open overnight is a real state — see the attendance
    // auto-close sweeper. Wrapping to 06:00:00 would hide it.
    expect(formatClock(30 * 3600)).toBe('30:00:00');
  });

  it('treats nonsense as zero rather than rendering NaN', () => {
    expect(formatClock(-5)).toBe('00:00:00');
    expect(formatClock(NaN)).toBe('00:00:00');
    expect(formatClock(Infinity)).toBe('00:00:00');
  });
});

describe('formatShort', () => {
  it('drops empty units', () => {
    expect(formatShort(7 * 3600 + 32 * 60)).toBe('7h 32m');
    expect(formatShort(2 * 3600)).toBe('2h');
    expect(formatShort(48 * 60)).toBe('48m');
    expect(formatShort(30)).toBe('0m');
  });
});

describe('spokenDuration', () => {
  it('says it in words a screen reader can read aloud', () => {
    // "07:32:10" is announced as "zero seven colon three two colon one zero".
    expect(spokenDuration(7 * 3600 + 32 * 60 + 10)).toBe('7 hours 32 minutes');
  });

  it('gets singulars right', () => {
    expect(spokenDuration(3600 + 60)).toBe('1 hour 1 minute');
  });

  it('omits units that are zero', () => {
    expect(spokenDuration(2 * 3600)).toBe('2 hours');
    expect(spokenDuration(5 * 60)).toBe('5 minutes');
  });

  it('never announces a bare number for a fresh punch', () => {
    expect(spokenDuration(0)).toBe('less than a minute');
    expect(spokenDuration(30)).toBe('less than a minute');
  });
});
