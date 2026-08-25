import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Linking, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useToast } from '../../src/components/Toast';
import type { ThemeColors } from '../../src/constants/theme';
import { payslipApi } from '../../src/api/endpoints';
import type { Payslip } from '../../src/types';

export default function PayslipDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const s = useMemo(() => styles(colors), [colors]);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadPayslip(); }, []);

  const loadPayslip = async () => {
    try {
      const res = await payslipApi.list();
      const items = Array.isArray(res.data) ? res.data : (res.data as any)?.data || [];
      setPayslip(items.find((p: Payslip) => p.id === Number(id)) || null);
    } catch (e) { console.warn('Payslip fetch failed:', e); } finally { setLoading(false); }
  };

  const handleOpenPdf = async () => {
    if (!payslip?.pdf_url) { toast.show('PDF not available', 'warning'); return; }
    try { await Linking.openURL(payslip.pdf_url); } catch { toast.error('Could not open PDF'); }
  };

  if (loading) return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  if (!payslip) return <View style={[s.center, { paddingTop: insets.top }]}><Text style={s.notFound}>Payslip not found</Text></View>;

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.header}>
        <Text style={s.title}>{payslip.month} {payslip.year}</Text>
        <View style={[s.statusBadge, { backgroundColor: payslip.status === 'locked' ? '#d1fae5' : '#fef3c7' }]}>
          <Text style={{ color: payslip.status === 'locked' ? '#065f46' : '#92400e', fontWeight: '600', fontSize: 12 }}>{payslip.status.toUpperCase()}</Text>
        </View>
      </View>
      <View style={s.summaryCard}>
        <Text style={s.summaryLabel}>Net Pay</Text>
        <Text style={s.summaryValue}>₹{Number(payslip.net_pay).toLocaleString()}</Text>
      </View>
      <View style={s.row}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Gross Earnings</Text>
          <Text style={s.statValue}>₹{Number(payslip.gross_earnings).toLocaleString()}</Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Total Deductions</Text>
          <Text style={[s.statValue, { color: colors.danger }]}>₹{Number(payslip.total_deductions).toLocaleString()}</Text>
        </View>
      </View>
      {payslip?.pdf_url && (
        <TouchableOpacity style={s.downloadBtn} onPress={handleOpenPdf}>
          <Ionicons name="document-outline" size={18} color="#fff" />
          <Text style={s.downloadBtnText}> Open PDF</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  notFound: { fontSize: 16, color: c.textTertiary },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  title: { fontSize: 22, fontWeight: '700', color: c.text },
  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  summaryCard: { backgroundColor: c.primaryLight, borderRadius: 14, padding: 24, alignItems: 'center', marginBottom: 16 },
  summaryLabel: { fontSize: 14, color: c.textSecondary },
  summaryValue: { fontSize: 36, fontWeight: '700', color: c.primary, marginTop: 4 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  statCard: { flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 16, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  statLabel: { fontSize: 12, color: c.textSecondary, marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '700', color: c.text },
  downloadBtn: { backgroundColor: c.primary, borderRadius: 10, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  downloadBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
