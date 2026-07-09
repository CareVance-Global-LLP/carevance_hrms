import React, { useRef, useEffect } from 'react';
import { Animated } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/hooks/useAuth';
import { ThemeProvider, useTheme } from '../src/hooks/useTheme';
import { usePushNotifications } from '../src/hooks/usePushNotifications';

function NotificationRegister() {
  usePushNotifications();
  return null;
}

function RootLayoutNav() {
  const { colors, isDark, mode } = useTheme();
  const { isAuthenticated } = useAuth();
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const prevMode = useRef(mode);

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
      <Animated.View style={{ flex: 1, opacity: fadeAnim }}>
      <Stack screenOptions={{ headerShown: false }}>
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
          <RootLayoutNav />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
