import { describe, expect, it } from 'vitest';
import { formatDateTime, formatTime, parseApiDate } from '@/lib/dateTime';

describe('dateTime helpers', () => {
  it('treats naive API datetimes as UTC for display formatting', () => {
    expect(formatDateTime('2026-05-05 08:42:43', 'Asia/Kolkata')).toBe('May 5, 2026, 2:12 PM');
    expect(formatTime('2026-05-05 08:42:43', 'Asia/Kolkata')).toBe('2:12 PM');
  });

  it('parses ISO timestamps without losing explicit timezone offsets', () => {
    const parsed = parseApiDate('2026-05-05T08:42:43Z');
    expect(parsed?.toISOString()).toBe('2026-05-05T08:42:43.000Z');
  });
});
