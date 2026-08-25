import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../hooks/useTheme';
import type { ThemeColors } from '../constants/theme';

/**
 * What a list says when it has nothing in it.
 *
 * Every one of these was a line of grey text — "No leave requests" — which
 * looks identical to a screen that failed to load. An empty state has to answer
 * three things: that nothing is wrong, why it is empty, and what to do next if
 * anything. The third is what turns a dead end into a starting point.
 */
interface EmptyStateProps {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  /** One line. Why it is empty, in plain words. */
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export default function EmptyState({
  icon = 'file-tray-outline',
  title,
  hint,
  actionLabel,
  onAction,
}: EmptyStateProps) {
  const { colors } = useTheme();
  const s = styles(colors);

  return (
    <View
      style={s.wrap}
      // Grouped so a screen reader reads it as one statement rather than three
      // disconnected fragments.
      accessible
      accessibilityLabel={hint ? title + '. ' + hint : title}
    >
      <View style={s.iconWrap}>
        <Ionicons name={icon} size={26} color={colors.textTertiary} />
      </View>
      <Text style={s.title}>{title}</Text>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity
          style={s.action}
          onPress={onAction}
          accessibilityRole="button"
          accessibilityLabel={actionLabel}
        >
          <Text style={s.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  wrap: { alignItems: 'center', paddingVertical: 34, paddingHorizontal: 24 },
  iconWrap: {
    width: 56, height: 56, borderRadius: 28, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center', backgroundColor: c.input,
  },
  title: { fontSize: 15, fontWeight: '600', color: c.text, textAlign: 'center' },
  hint: { fontSize: 13, color: c.textTertiary, textAlign: 'center', marginTop: 5, lineHeight: 18 },
  action: {
    marginTop: 16, paddingVertical: 10, paddingHorizontal: 18,
    borderRadius: 10, backgroundColor: c.primary,
  },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
