import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import type { ThemeColors } from '../../src/constants/theme';
import { compOffApi } from '../../src/api/endpoints';

export default function CompOffScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [summary, setSummary] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [summaryRes, txnRes] = await Promise.all([
        compOffApi.summary(),
        compOffApi.transactions(),
      ]);
      setSummary(summaryRes.data);
      setTransactions(Array.isArray(txnRes.data.data) ? txnRes.data.data : []);
    } catch (e) { console.warn('Comp off fetch failed:', e); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { fetchData(); }, []);

  if (loading) return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.textSecondary} />}>
      <Text style={s.title}>Comp Off</Text>

      {summary && (
        <View style={s.summaryRow}>
          <View style={s.summaryCard}>
            <Text style={s.summaryVal}>{summary.total_earned}</Text>
            <Text style={s.summaryLabel}>Earned</Text>
          </View>
          <View style={s.summaryCard}>
            <Text style={s.summaryVal}>{summary.total_used}</Text>
            <Text style={s.summaryLabel}>Used</Text>
          </View>
          <View style={[s.summaryCard, { backgroundColor: colors.primaryLight }]}>
            <Text style={[s.summaryVal, { color: colors.primary }]}>{summary.total_balance}</Text>
            <Text style={s.summaryLabel}>Balance</Text>
          </View>
        </View>
      )}

      {summary?.yearly_breakdown?.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Yearly Breakdown</Text>
          {summary.yearly_breakdown.map((b: any) => (
            <View key={b.id} style={s.card}>
              <View style={s.cardRow}>
                <Text style={s.cardYear}>{b.applicable_year}</Text>
                <Text style={s.cardBalance}>{b.balance_days} days</Text>
              </View>
              <Text style={s.cardDetail}>Earned: {b.earned_days} | Used: {b.used_days} | Expired: {b.expired_days}</Text>
              {b.expiry_date && <Text style={s.cardExpiry}>Expires: {b.expiry_date}</Text>}
            </View>
          ))}
        </>
      )}

      {transactions.length > 0 && (
        <>
          <Text style={s.sectionTitle}>Transaction History</Text>
          {transactions.map((txn: any) => (
            <View key={txn.id} style={s.card}>
              <View style={s.cardRow}>
                <Text style={s.txnType}>{txn.type}</Text>
                <Text style={s.txnDays}>{txn.days} day{txn.days > 1 ? 's' : ''}</Text>
              </View>
              <Text style={s.cardDetail}>{txn.transaction_date}</Text>
              {txn.description && <Text style={s.cardDetail} numberOfLines={1}>{txn.description}</Text>}
            </View>
          ))}
        </>
      )}

      {!loading && transactions.length === 0 && !summary?.yearly_breakdown?.length && (
        <Text style={s.empty}>No comp off data available</Text>
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 16 },
  summaryRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  summaryCard: { flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: c.border },
  summaryVal: { fontSize: 28, fontWeight: '700', color: c.text },
  summaryLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  cardRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardYear: { fontSize: 15, fontWeight: '600', color: c.text },
  cardBalance: { fontSize: 16, fontWeight: '700', color: c.primary },
  cardDetail: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  cardExpiry: { fontSize: 12, color: c.warning, marginTop: 2 },
  txnType: { fontSize: 15, fontWeight: '600', color: c.text, textTransform: 'capitalize' },
  txnDays: { fontSize: 16, fontWeight: '700', color: c.text },
  empty: { color: c.textTertiary, fontSize: 14 },
});
