import { useEffect, useRef } from 'react';
import { Platform, Alert } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useAuth } from './useAuth';
import { notificationApi } from '../api/endpoints';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowList: true,
  }),
});

Notifications.setNotificationCategoryAsync('announcement', [
  { identifier: 'view', buttonTitle: 'View', options: { opensAppToForeground: true } },
]).catch(() => {});

export function usePushNotifications() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const responseListener = useRef<Notifications.Subscription>();

  useEffect(() => {
    if (!isAuthenticated) return;

    registerForPushNotifications();

    Notifications.setNotificationCategoryAsync('announcement', [
      { identifier: 'view', buttonTitle: 'View', options: { opensAppToForeground: true } },
    ]).catch(() => {});

    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      if (data?.route) router.push(data.route);
    });

    return () => {
      responseListener.current?.remove();
    };
  }, [isAuthenticated]);
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
