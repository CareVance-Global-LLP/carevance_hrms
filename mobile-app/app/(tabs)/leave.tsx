import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import type { ThemeColors } from '../../src/constants/theme';
import { leaveApi } from '../../src/api/endpoints';
import type { LeaveCategory, LeaveRequest } from '../../src/types';

const STATUS_COLORS: Record<string, string> = {
  pending: '#f59e0b',
  approved: '#10b981',
  rejected: '#ef4444',
};

export default function LeaveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [balance, setBalance] = useState<LeaveCategory[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [balRes, reqRes] = await Promise.all([
        leaveApi.balance(),
        leaveApi.list(),
      ]);
      setBalance(balRes.data.self?.categories || []);
      setRequests(reqRes.data.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, []);

  return (
    <ScrollView
      style={[s.container, { paddingTop: insets.top + 8 }]}
      contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.textSecondary} />
      }
    >
      <View style={s.header}>
        <Text style={s.title}>Leave</Text>
        <TouchableOpacity
          style={s.applyBtn}
          onPress={() => router.push('/leave/apply')}
        >
          <Text style={s.applyBtnText}>
            <Ionicons name="add" size={16} color="#fff" /> Apply
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={s.sectionTitle}>Balance</Text>
      <View style={s.balanceGrid}>
        {balance.map((b) => (
          <View key={b.code} style={s.balanceCard}>
            <Text style={s.balanceVal}>
              {b.remaining}{b.total > 0 ? `/${b.total}` : ''}
            </Text>
            <Text style={s.balanceLabel}>{b.name}</Text>
          </View>
        ))}
      </View>

      <Text style={s.sectionTitle}>Recent Requests</Text>
      {requests.length === 0 ? (
        <Text style={s.empty}>No leave requests</Text>
      ) : (
        requests.slice(0, 10).map((r) => (
          <View key={r.id} style={s.reqCard}>
            <View style={s.reqRow}>
              <Text style={s.reqType}>{r.leave_category || r.leave_type}</Text>
              <View
                style={[
                  s.statusBadge,
                  { backgroundColor: STATUS_COLORS[r.status] + '20' },
                ]}
              >
                <Text
                  style={[s.statusText, { color: STATUS_COLORS[r.status] }]}
                >
                  {r.status}
                </Text>
              </View>
            </View>
            <Text style={s.reqDates}>
              {r.start_date} → {r.end_date}
            </Text>
            <Text style={s.reqReason} numberOfLines={1}>
              {r.reason}
            </Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  applyBtn: { backgroundColor: c.primary, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8, flexDirection: 'row', alignItems: 'center' },
  applyBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
  balanceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 24 },
  balanceCard: { width: '47%', backgroundColor: c.card, borderRadius: 10, padding: 14, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  balanceVal: { fontSize: 22, fontWeight: '700', color: c.primary },
  balanceLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
  empty: { color: c.textTertiary, fontSize: 14 },
  reqCard: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  reqRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  reqType: { fontSize: 15, fontWeight: '600', color: c.text },
  statusBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  statusText: { fontSize: 12, fontWeight: '600' },
  reqDates: { fontSize: 13, color: c.textSecondary, marginBottom: 2 },
  reqReason: { fontSize: 13, color: c.text },
});
