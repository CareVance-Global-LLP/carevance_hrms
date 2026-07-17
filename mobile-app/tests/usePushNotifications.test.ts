import * as Notifications from 'expo-notifications';
import {
  notificationHandlerConfig,
  handleNotificationResponse,
} from '../src/hooks/usePushNotifications';

// Import the REAL module so the deprecated NotificationBehavior shape (the
// original bug: shouldShowAlert/shouldPlaySound/shouldSetBadge/shouldShowList)
// would be caught at compile time by ts-jest type-checking this file against
// expo-notifications@0.32's actual required shape.

type PushRoute = Parameters<import('expo-router').Router['push']>[0];

describe('usePushNotifications regression guard', () => {
  it('notificationHandlerConfig satisfies the current NotificationBehavior type', () => {
    // Compile-time check (no implicit any / no missing required props). If the
    // deprecated shape were reintroduced this assignment would fail to typecheck.
    const config: Notifications.NotificationBehavior = notificationHandlerConfig;
    expect(config).toBeDefined();
  });

  it('notificationHandlerConfig uses exactly the current required keys (not the deprecated shape)', () => {
    const keys = Object.keys(notificationHandlerConfig).sort();
    expect(keys).toEqual(
      ['shouldPlaySound', 'shouldSetBadge', 'shouldShowBanner', 'shouldShowList'].sort(),
    );
    // Explicitly assert the deprecated keys are absent.
    expect('shouldShowAlert' in notificationHandlerConfig).toBe(false);
    // Assert the new required keys are present and truthy.
    expect(notificationHandlerConfig.shouldShowBanner).toBe(true);
    expect(notificationHandlerConfig.shouldShowList).toBe(true);
    expect(notificationHandlerConfig.shouldPlaySound).toBe(true);
    expect(notificationHandlerConfig.shouldSetBadge).toBe(true);
  });

  it('handleNotificationResponse routes a notification with a data.route to router.push', () => {
    const pushed: string[] = [];
    const fakeRouter = {
      push: (route: PushRoute) => {
        pushed.push(route as string);
      },
    };

    const response = {
      notification: {
        request: {
          content: { data: { route: '/approval-inbox' } },
        },
      },
    } as unknown as Notifications.NotificationResponse;

    handleNotificationResponse(response, fakeRouter);
    expect(pushed).toEqual(['/approval-inbox']);
  });

  it('handleNotificationResponse ignores notifications without a data.route', () => {
    const pushed: string[] = [];
    const fakeRouter = {
      push: (route: PushRoute) => {
        pushed.push(route as string);
      },
    };

    const response = {
      notification: {
        request: { content: { data: {} } },
      },
    } as unknown as Notifications.NotificationResponse;

    handleNotificationResponse(response, fakeRouter);
    expect(pushed).toEqual([]);
  });
});
