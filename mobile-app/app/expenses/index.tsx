import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import type { ThemeColors } from '../../src/constants/theme';
import { reimbursementApi } from '../../src/api/endpoints';
import type { Reimbursement, ReimbursementSummary } from '../../src/types';

const CATEGORY_ICONS: Record<string, string> = {
  travel: 'airplane-outline',
  meals: 'restaurant-outline',
  office_supplies: 'folder-outline',
  training: 'school-outline',
  medical: 'medkit-outline',
  other: 'ellipsis-horizontal-outline',
};

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
};

export default function ExpensesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [items, setItems] = useState<Reimbursement[]>([]);
  const [summary, setSummary] = useState<ReimbursementSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [listRes, summaryRes] = await Promise.all([
        reimbursementApi.list(),
        reimbursementApi.summary(),
      ]);
      setItems(listRes.data.data);
      setSummary(summaryRes.data);
    } catch (e) { console.warn('Expenses fetch failed:', e); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.textSecondary} />}>
      <View style={s.header}>
        <Text style={s.title}>Expenses</Text>
        <TouchableOpacity style={s.addBtn} onPress={() => router.push('/expenses/create')}>
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={s.addBtnText}> Add</Text>
        </TouchableOpacity>
      </View>

      {summary && (
        <View style={s.summaryRow}>
          <View style={s.summaryCard}>
            <Text style={s.summaryVal}>{summary.total_count}</Text>
            <Text style={s.summaryLabel}>Total</Text>
          </View>
          <View style={[s.summaryCard, { borderColor: STATUS_COLORS.pending + '40' }]}>
            <Text style={[s.summaryVal, { color: STATUS_COLORS.pending }]}>{summary.pending_count}</Text>
            <Text style={s.summaryLabel}>Pending</Text>
          </View>
          <View style={[s.summaryCard, { borderColor: STATUS_COLORS.approved + '40' }]}>
            <Text style={[s.summaryVal, { color: STATUS_COLORS.approved }]}>{summary.approved_count}</Text>
            <Text style={s.summaryLabel}>Approved</Text>
          </View>
        </View>
      )}

      {items.length === 0 ? (
        <Text style={s.empty}>No expense requests</Text>
      ) : (
        items.map((item) => (
          <TouchableOpacity key={item.id} style={s.card} onPress={() => router.push(`/expenses/${item.id}`)}>
            <View style={s.cardRow}>
              <View style={s.cardLeft}>
                <Ionicons name={(CATEGORY_ICONS[item.category] || 'receipt-outline') as any} size={20} color={colors.primary} />
                <View>
                  <Text style={s.cardCategory}>{item.category.replace('_', ' ')}</Text>
                  <Text style={s.cardDate}>{item.expense_date}</Text>
                </View>
              </View>
              <View style={s.cardRight}>
                <Text style={s.cardAmount}>{item.currency === 'INR' ? '₹' : item.currency}{' '}{Number(item.amount).toLocaleString()}</Text>
                <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '20' }]}>
                  <Text style={[s.statusText, { color: STATUS_COLORS[item.status] }]}>{item.status}</Text>
                </View>
              </View>
            </View>
            {item.description && <Text style={s.cardDesc} numberOfLines={1}>{item.description}</Text>}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  addBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  addBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 20 },
  summaryCard: { flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.border, alignItems: 'center' },
  summaryVal: { fontSize: 20, fontWeight: '700', color: c.text },
  summaryLabel: { fontSize: 11, color: c.textSecondary, marginTop: 2 },
  empty: { color: c.textTertiary, fontSize: 14 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  cardCategory: { fontSize: 15, fontWeight: '600', color: c.text, textTransform: 'capitalize' },
  cardDate: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  cardRight: { alignItems: 'flex-end' },
  cardAmount: { fontSize: 16, fontWeight: '700', color: c.text },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, marginTop: 4 },
  statusText: { fontSize: 11, fontWeight: '600', textTransform: 'capitalize' },
  cardDesc: { fontSize: 13, color: c.textSecondary, marginTop: 6 },
});
