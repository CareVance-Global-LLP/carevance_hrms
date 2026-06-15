import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import type { ThemeColors } from '../../src/constants/theme';
import { reimbursementApi } from '../../src/api/endpoints';
import type { Reimbursement } from '../../src/types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
};

const CATEGORY_ICONS: Record<string, string> = {
  travel: 'airplane-outline',
  meals: 'restaurant-outline',
  office_supplies: 'folder-outline',
  training: 'school-outline',
  medical: 'medkit-outline',
  other: 'ellipsis-horizontal-outline',
};

export default function ExpenseDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [item, setItem] = useState<Reimbursement | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const res = await reimbursementApi.list();
      const items = res.data.data;
      setItem(items.find((r: Reimbursement) => r.id === Number(id)) || null);
    } catch (e) { console.warn('Expense detail fetch failed:', e); } finally { setLoading(false); }
  };

  if (loading) return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (!item) return <View style={[s.center, { paddingTop: insets.top }]}><Text style={s.notFound}>Expense not found</Text></View>;

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.header}>
        <Ionicons name={(CATEGORY_ICONS[item.category] || 'receipt-outline') as any} size={28} color={colors.primary} />
        <Text style={s.title}>{item.category.replace('_', ' ')}</Text>
      </View>

      <View style={[s.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '20', alignSelf: 'flex-start', marginBottom: 16 }]}>
        <Text style={{ color: STATUS_COLORS[item.status], fontWeight: '600', fontSize: 13, textTransform: 'capitalize' }}>{item.status}</Text>
      </View>

      <View style={s.summaryCard}>
        <Text style={s.summaryLabel}>Amount</Text>
        <Text style={s.summaryValue}>{item.currency === 'INR' ? '₹' : item.currency} {Number(item.amount).toLocaleString()}</Text>
      </View>

      <View style={s.detailCard}>
        <DetailRow icon="calendar-outline" label="Expense Date" value={item.expense_date} colors={colors} />
        {item.merchant_name && <DetailRow icon="storefront-outline" label="Merchant" value={item.merchant_name} colors={colors} />}
        {item.location && <DetailRow icon="location-outline" label="Location" value={item.location} colors={colors} />}
        <DetailRow icon="person-outline" label="Submitted by" value={item.employee?.name || 'You'} colors={colors} />
        {item.approver && <DetailRow icon="checkmark-circle-outline" label="Approved by" value={item.approver.name} colors={colors} />}
        {item.approved_at && <DetailRow icon="time-outline" label="Reviewed on" value={item.approved_at} colors={colors} />}
      </View>

      <Text style={s.sectionTitle}>Description</Text>
      <Text style={s.description}>{item.description}</Text>

      {item.notes && (
        <>
          <Text style={s.sectionTitle}>Review Notes</Text>
          <Text style={s.description}>{item.notes}</Text>
        </>
      )}
    </ScrollView>
  );
}

function DetailRow({ icon, label, value, colors }: { icon: string; label: string; value: string; colors: ThemeColors }) {
  const s = useMemo(() => styles(colors), [colors]);
  return (
    <View style={s.detailRow}>
      <View style={s.detailRowLeft}>
        <Ionicons name={icon as any} size={16} color={colors.textSecondary} />
        <Text style={s.detailLabel}>{label}</Text>
      </View>
      <Text style={s.detailValue}>{value}</Text>
    </View>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  notFound: { fontSize: 16, color: c.textTertiary },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: '700', color: c.text, textTransform: 'capitalize' },
  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  summaryCard: { backgroundColor: c.primaryLight, borderRadius: 14, padding: 24, alignItems: 'center', marginBottom: 16 },
  summaryLabel: { fontSize: 14, color: c.textSecondary },
  summaryValue: { fontSize: 32, fontWeight: '700', color: c.primary, marginTop: 4 },
  detailCard: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 16, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.border },
  detailRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailLabel: { fontSize: 14, color: c.textSecondary },
  detailValue: { fontSize: 14, color: c.text, fontWeight: '500', flexShrink: 1, textAlign: 'right' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 8 },
  description: { fontSize: 14, color: c.text, lineHeight: 20, marginBottom: 16 },
});
