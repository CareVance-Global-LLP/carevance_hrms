import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Physical feedback for actions that commit something.
 *
 * Punching in is the app's most important action and it used to give no
 * confirmation at all beyond a screen repaint — which, on a phone held at arm's
 * length at an office door, is easy to miss and leads to double punches. Keka
 * and Time Doctor both buzz on punch for exactly this reason.
 *
 * Every call is fire-and-forget and swallowed. Haptics are a courtesy: a device
 * without a taptic engine, a user who has switched them off in system settings,
 * or the web build must never be able to fail an action that already succeeded.
 */
const supported = Platform.OS === 'ios' || Platform.OS === 'android';

const fire = (run: () => Promise<void>): void => {
  if (!supported) return;
  void run().catch(() => {});
};

export const haptics = {
  /** Selection changed — tabs, chips, list rows. */
  tap: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** A primary button was pressed, before the request goes out. */
  press: () => fire(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  /** The server confirmed it. Checked in, approved, submitted. */
  success: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Refused for a reason the user can fix — outside the geofence, no selfie. */
  warning: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  /** It failed. */
  error: () => fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
