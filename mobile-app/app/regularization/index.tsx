import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import EmptyState from '../../src/components/EmptyState';
import type { ThemeColors } from '../../src/constants/theme';
import { timeEditApi } from '../../src/api/endpoints';
import type { TimeEditRequest } from '../../src/types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
};

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

export default function RegularizationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [items, setItems] = useState<TimeEditRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await timeEditApi.list();
      setItems(res.data.data);
    } catch (e) { console.warn('Regularization fetch failed:', e); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.textSecondary} />}>
      <View style={s.header}>
        <Text style={s.title}>Regularization</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => router.push('/regularization/create')}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.addBtnText}> Request</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.subtitle}>Time edit requests to correct attendance records</Text>

      {items.length === 0 ? (
        <EmptyState
          icon="create-outline"
          title="No time edit requests"
          hint="Ask for a correction when a punch is missing or recorded at the wrong time."
          actionLabel="Request a correction"
          onAction={() => router.push('/regularization/create')}
        />
      ) : (
        items.map((item) => (
          <View key={item.id} style={s.card}>
            <View style={s.cardRow}>
              <View>
                <Text style={s.cardDate}>{item.attendance_date}</Text>
                <Text style={s.cardDuration}>{formatDuration(item.extra_seconds)} extra</Text>
              </View>
              <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '20' }]}>
                <Text style={{ color: STATUS_COLORS[item.status], fontWeight: '600', fontSize: 12, textTransform: 'capitalize' }}>{item.status}</Text>
              </View>
            </View>
            {item.message && <Text style={s.cardMsg} numberOfLines={1}>{item.message}</Text>}
            {item.review_note && <Text style={s.reviewNote}>Review: {item.review_note}</Text>}
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  empty: { color: c.textTertiary, fontSize: 14, marginTop: 20 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardDate: { fontSize: 15, fontWeight: '600', color: c.text },
  cardDuration: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  cardMsg: { fontSize: 13, color: c.text, marginTop: 6 },
  reviewNote: { fontSize: 12, color: c.textSecondary, marginTop: 4, fontStyle: 'italic' },
});
