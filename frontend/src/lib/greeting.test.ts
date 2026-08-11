import { describe, expect, it } from 'vitest';
import { greetingFor, greetUser } from './greeting';

const at = (hour: number) => new Date(2026, 7, 11, hour, 0, 0);

describe('greetingFor', () => {
  it('greets the morning from 05:00 to 11:59', () => {
    expect(greetingFor(at(5))).toBe('Good morning');
    expect(greetingFor(at(9))).toBe('Good morning');
    expect(greetingFor(at(11))).toBe('Good morning');
  });

  it('greets the afternoon from 12:00 to 16:59', () => {
    expect(greetingFor(at(12))).toBe('Good afternoon');
    expect(greetingFor(at(16))).toBe('Good afternoon');
  });

  it('greets the evening from 17:00 onward', () => {
    expect(greetingFor(at(17))).toBe('Good evening');
    expect(greetingFor(at(21))).toBe('Good evening');
  });

  // The case that prompted this: the dashboards said "Good morning" at 23:30.
  it('does not say "Good morning" late at night or in the small hours', () => {
    expect(greetingFor(at(23))).toBe('Good evening');
    expect(greetingFor(at(0))).toBe('Good evening');
    expect(greetingFor(at(4))).toBe('Good evening');
  });
});

describe('greetUser', () => {
  it('uses only the first name', () => {
    expect(greetUser('Priya Sharma', at(9))).toBe('Good morning, Priya');
  });

  it('falls back to "there" when the name is missing or blank', () => {
    expect(greetUser(undefined, at(14))).toBe('Good afternoon, there');
    expect(greetUser('   ', at(14))).toBe('Good afternoon, there');
  });
});
