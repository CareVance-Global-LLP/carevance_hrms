import React, { useRef, useEffect } from 'react';
import { Animated } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { AuthProvider, useAuth } from '../src/hooks/useAuth';
import { ThemeProvider, useTheme } from '../src/hooks/useTheme';
import { usePushNotifications } from '../src/hooks/usePushNotifications';
import { ToastProvider } from '../src/components/Toast';

/*
 * Hold the native splash until we know both who the user is and which theme to
 * paint. Without this the splash disappears the moment the JS bundle mounts,
 * revealing a bare screen while auth and the stored theme are still resolving —
 * which is the white flash on every launch.
 *
 * Both calls are guarded: a splash that refuses to co-operate must never be
 * able to stop the app from starting.
 */
SplashScreen.preventAutoHideAsync().catch(() => {});
SplashScreen.setOptions({ duration: 350, fade: true });

function NotificationRegister() {
  usePushNotifications();
  return null;
}

function RootLayoutNav() {
  const { colors, isDark, mode, isReady: isThemeReady } = useTheme();
  const { isAuthenticated, isLoading } = useAuth();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevMode = useRef(mode);

  // Auth resolves from cache now, so in practice this is a few milliseconds
  // rather than a network round trip. See hooks/useAuth bootstrap().
  const appIsReady = !isLoading && isThemeReady;

  useEffect(() => {
    if (appIsReady) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [appIsReady]);

  useEffect(() => {
    if (prevMode.current !== mode) {
      prevMode.current = mode;
      Animated.sequence([
        Animated.timing(fadeAnim, { toValue: 0.85, duration: 60, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      ]).start();
    }
  }, [mode, fadeAnim]);

  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {isAuthenticated && <NotificationRegister />}
      <Animated.View style={{ flex: 1, opacity: fadeAnim, backgroundColor: colors.background }}>
      <Stack
        screenOptions={{
          headerShown: false,
          // Without this every push paints the default white card first, which
          // reads as a flash on each navigation in dark mode.
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="attendance/selfie"
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Take Selfie',
            headerStyle: { backgroundColor: colors.headerBg },
            headerTintColor: colors.text,
          }}
        />
        <Stack.Screen
          name="leave/apply"
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Apply Leave',
            headerStyle: { backgroundColor: colors.headerBg },
            headerTintColor: colors.text,
          }}
        />
        <Stack.Screen
          name="payslip/[id]"
          options={{
            headerShown: true,
            headerTitle: 'Payslip',
            headerStyle: { backgroundColor: colors.headerBg },
            headerTintColor: colors.text,
          }}
        />
        <Stack.Screen
          name="regularization/create"
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Time Edit Request',
            headerStyle: { backgroundColor: colors.headerBg },
            headerTintColor: colors.text,
          }}
        />
        <Stack.Screen
          name="notifications/publish"
          options={{
            presentation: 'modal',
            headerShown: true,
            headerTitle: 'Publish',
            headerStyle: { backgroundColor: colors.headerBg },
            headerTintColor: colors.text,
          }}
        />
      </Stack>
      </Animated.View>
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          {/* Inside ThemeProvider so the toast is themed, and inside
              SafeAreaProvider so it clears the notch. */}
          <ToastProvider>
            <RootLayoutNav />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
