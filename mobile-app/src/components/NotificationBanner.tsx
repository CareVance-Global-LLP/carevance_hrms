import React, { useEffect, useRef } from 'react';
import { Animated, Text, TouchableOpacity, StyleSheet, Platform, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import type { ThemeColors } from '../constants/theme';

const BANNER_HEIGHT = 80;

interface Props {
  title: string;
  message?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  onDismiss?: () => void;
  duration?: number;
}

export default function NotificationBanner({ title, message, icon = 'megaphone', onPress, onDismiss, duration = 5000 }: Props) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(-BANNER_HEIGHT - insets.top)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 15,
        stiffness: 200,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 250,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -BANNER_HEIGHT - insets.top,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => onDismiss?.());
    }, duration);

    return () => clearTimeout(timer);
  }, []);

  const s = StyleSheet.create({
    container: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 9999,
      paddingTop: insets.top + 4,
      backgroundColor: 'rgba(0,0,0,0.25)',
      paddingBottom: 4,
    },
    inner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      marginHorizontal: 10,
      borderRadius: 14,
      padding: 12,
      gap: 10,
      ...Platform.select({
        ios: {
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 6 },
        },
        default: { elevation: 10 },
      }),
    },
    iconWrap: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: { flex: 1 },
    appLabel: {
      fontSize: 11,
      fontWeight: '600',
      color: colors.textTertiary,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    title: { fontSize: 14, fontWeight: '700', color: colors.text, marginTop: 1 },
    message: { fontSize: 12, color: colors.textSecondary, marginTop: 1 },
  });

  return (
    <Animated.View style={[s.container, { transform: [{ translateY }], opacity }]}>
      <TouchableOpacity style={s.inner} onPress={onPress} activeOpacity={0.85}>
        <View style={s.iconWrap}>
          <Ionicons name={icon} size={18} color="#fff" />
        </View>
        <View style={s.content}>
          <Text style={s.appLabel}>CareVance HRMS</Text>
          <Text style={s.title} numberOfLines={1}>{title}</Text>
          {message ? <Text style={s.message} numberOfLines={1}>{message}</Text> : null}
        </View>
      </TouchableOpacity>
    </Animated.View>
  );
}
