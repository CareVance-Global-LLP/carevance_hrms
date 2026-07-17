import { useEffect, useRef } from 'react';
import { Platform, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAuth } from './useAuth';
import { notificationApi } from '../api/endpoints';

// Exported so the regression test can assert the config satisfies the current
// expo-notifications NotificationBehavior shape (shouldShowBanner/shouldShowList/
// shouldPlaySound/shouldSetBadge) without needing a physical device.
export const notificationHandlerConfig: Notifications.NotificationBehavior = {
  shouldShowBanner: true,
  shouldShowList: true,
  shouldPlaySound: true,
  shouldSetBadge: true,
};

Notifications.setNotificationHandler({
  handleNotification: async () => notificationHandlerConfig,
});

Notifications.setNotificationCategoryAsync('announcement', [
  { identifier: 'view', buttonTitle: 'View', options: { opensAppToForeground: true } },
]).catch(() => {});

export function usePushNotifications() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const responseListener = useRef<Notifications.Subscription | null>(null);

  useEffect(() => {
    if (!isAuthenticated) return;

    registerForPushNotifications();

    Notifications.setNotificationCategoryAsync('announcement', [
      { identifier: 'view', buttonTitle: 'View', options: { opensAppToForeground: true } },
    ]).catch(() => {});

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      handleNotificationResponse(response, router);
    });

    return () => {
      responseListener.current?.remove();
    };
  }, [isAuthenticated]);
}

// Extracted so the regression test pins the two other parts of the original fix:
// the required useRef<Subscription | null>(null) argument (kept in the hook) and
// the typed router.push cast for data.route.
export function handleNotificationResponse(
  response: Notifications.NotificationResponse,
  router: Pick<import('expo-router').Router, 'push'>,
) {
  const data = response.notification.request.content.data as { route?: string };
  if (data?.route) router.push(data.route as Parameters<import('expo-router').Router['push']>[0]);
}

async function registerForPushNotifications() {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;

    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      Alert.alert('Notification Permission', 'Push notifications require permission. Please enable in Settings.');
      return;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    if (token) {
      await notificationApi.registerDevice(token, Platform.OS);
      console.log('Device registered for push:', token.substring(0, 25) + '...');
    }
  } catch (e: any) {
    Alert.alert('Push Registration Failed', e?.message || String(e));
  }
}
