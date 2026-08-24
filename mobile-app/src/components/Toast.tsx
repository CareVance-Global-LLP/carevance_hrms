import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';
import type { ThemeColors } from '../constants/theme';

/**
 * Non-blocking feedback.
 *
 * The app announced its successes through Alert.alert — a modal that steals
 * focus and has to be dismissed by hand before anything else can happen. Being
 * made to tap "OK" to acknowledge that you checked in is the app's most jarring
 * moment, and it happens every single morning. Keka and Time Doctor both use a
 * transient banner for this.
 *
 * Alert is still right for a question ("Discard this request?"). It is wrong for
 * an answer.
 */
export type ToastVariant = 'success' | 'error' | 'info' | 'warning';

interface ToastState {
  message: string;
  variant: ToastVariant;
  /** Bumped per call so an identical repeat message still re-animates. */
  key: number;
}

interface ToastContextValue {
  show: (message: string, variant?: ToastVariant) => void;
  success: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue>({
  show: () => {},
  success: () => {},
  error: () => {},
});

const VISIBLE_MS = 3200;

const ICONS: Record<ToastVariant, keyof typeof Ionicons.glyphMap> = {
  success: 'checkmark-circle',
  error: 'alert-circle',
  warning: 'warning',
  info: 'information-circle',
};

const tone = (variant: ToastVariant, c: ThemeColors): string => {
  if (variant === 'success') return c.success;
  if (variant === 'error') return c.danger;
  if (variant === 'warning') return c.warning;
  return c.primary;
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [toast, setToast] = useState<ToastState | null>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counter = useRef(0);

  const show = useCallback((message: string, variant: ToastVariant = 'info') => {
    if (!message) return;
    counter.current += 1;
    setToast({ message, variant, key: counter.current });
  }, []);

  const success = useCallback((message: string) => show(message, 'success'), [show]);
  const error = useCallback((message: string) => show(message, 'error'), [show]);

  useEffect(() => {
    if (!toast) return;

    if (timer.current) clearTimeout(timer.current);
    slide.setValue(0);

    Animated.spring(slide, { toValue: 1, useNativeDriver: true, friction: 9, tension: 70 }).start();

    timer.current = setTimeout(() => {
      Animated.timing(slide, { toValue: 0, duration: 180, useNativeDriver: true })
        .start(() => setToast(null));
    }, VISIBLE_MS);

    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [toast, slide]);

  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    Animated.timing(slide, { toValue: 0, duration: 140, useNativeDriver: true })
      .start(() => setToast(null));
  }, [slide]);

  const s = styles(colors);

  return (
    <ToastContext.Provider value={{ show, success, error }}>
      {children}
      {toast && (
        <Animated.View
          // pointerEvents box-none on the wrapper: the toast is an overlay and
          // must not swallow taps meant for the screen behind it.
          pointerEvents="box-none"
          style={[
            s.wrap,
            {
              top: insets.top + 8,
              opacity: slide,
              transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] }) }],
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={dismiss}
            style={[s.toast, { borderLeftColor: tone(toast.variant, colors) }]}
            // Announced by VoiceOver/TalkBack without stealing focus, which is
            // the whole point of not using a modal.
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            accessibilityLabel={toast.message}
            accessibilityHint="Tap to dismiss"
          >
            <Ionicons name={ICONS[toast.variant]} size={20} color={tone(toast.variant, colors)} />
            <Text style={s.text} numberOfLines={3}>{toast.message}</Text>
          </TouchableOpacity>
        </Animated.View>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);

const styles = (c: ThemeColors) => StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 1000 },
  toast: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: c.card, borderRadius: 12, borderLeftWidth: 4,
    paddingVertical: 14, paddingHorizontal: 14,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  text: { flex: 1, color: c.text, fontSize: 14, fontWeight: '500', lineHeight: 19 },
});
