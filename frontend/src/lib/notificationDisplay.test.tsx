import { describe, expect, it } from 'vitest';
import { getNotificationDisplay, resolveNotificationRoute } from '@/lib/notificationDisplay';

describe('getNotificationDisplay', () => {
  it('returns a display object for announcement type', () => {
    const display = getNotificationDisplay('announcement');
    expect(display).toBeDefined();
    expect(display.label).toBeTruthy();
    expect(display.icon).toBeDefined();
  });
  /*
   * A server-stopped timer is the one notification people go LOOKING for.
   * Falling through to the generic bell labelled 'Notification' put it in
   * the pile it needed to stand out from - the whole complaint was that
   * nobody could tell when their tracker had stopped.
   */
  it('labels an automatic timer stop as a timer, not a generic notification', () => {
    const display = getNotificationDisplay('timer_auto_stopped');
    expect(display.label).toBe('Timer');
    expect(display.tone).toBe('warning');
  });

  it('matches the type case-insensitively, as every other arm does', () => {
    expect(getNotificationDisplay('TIMER_AUTO_STOPPED').label).toBe('Timer');
  });


  it('returns a display object for unknown types', () => {
    const display = getNotificationDisplay('mystery_type');
    expect(display).toBeDefined();
    expect(display.icon).toBeDefined();
    expect(display.label).toBeTruthy();
  });

  it('returns a display object for empty type', () => {
    const display = getNotificationDisplay('');
    expect(display).toBeDefined();
    expect(display.icon).toBeDefined();
  });
});

describe('resolveNotificationRoute', () => {
  it('routes leave approval notifications to the leave approval section', () => {
    expect(resolveNotificationRoute({
      id: 1,
      title: 'Leave Request Submitted',
      message: 'A leave request needs review.',
      type: 'leave_request',
      is_read: false,
      created_at: '2026-05-11T00:00:00.000Z',
      meta: {},
    } as any, { role: 'admin' } as any)).toBe('/approval-inbox?section=leave&view=pending');
  });

  it('routes time edit approval notifications to the time edit section', () => {
    expect(resolveNotificationRoute({
      id: 2,
      title: 'Time Edit Request Submitted',
      message: 'A time edit request needs review.',
      type: 'time_edit',
      is_read: false,
      created_at: '2026-05-11T00:00:00.000Z',
      meta: {},
    } as any, { role: 'manager' } as any)).toBe('/approval-inbox?section=time-edit&view=pending');
  });
});
