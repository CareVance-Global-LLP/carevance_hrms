import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, ActivityIndicator, Linking, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useToast } from '../../src/components/Toast';
import type { ThemeColors } from '../../src/constants/theme';
import { payslipApi } from '../../src/api/endpoints';
import type { Payslip, PayslipYtd } from '../../src/types';

/** Blank rather than ₹0 — a component that does not apply should not be a line. */
const money = (v: unknown): string | null => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n === 0) return null;
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
};

const monthLabel = (monthYear?: string): string => {
  if (!monthYear) return 'Payslip';
  const [y, m] = monthYear.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const name = names[Number(m) - 1];
  return name ? `${name} ${y}` : monthYear;
};

export default function PayslipDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const s = useMemo(() => styles(colors), [colors]);
  const [payslip, setPayslip] = useState<Payslip | null>(null);
  const [ytd, setYtd] = useState<PayslipYtd | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadPayslip(); }, []);

  const loadPayslip = async () => {
    try {
      const res = await payslipApi.list();
      // The endpoint returns { payslips, ytd, employee }. Reading `res.data`
      // as an array is what made this screen report "Payslip not found" for
      // every employee, every month.
      const items = res.data?.payslips ?? [];
      setPayslip(items.find((p) => p.id === Number(id)) ?? null);
      setYtd(res.data?.ytd ?? null);
    } catch (e) {
      console.warn('Payslip fetch failed:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPdf = async () => {
    if (!payslip?.pdf_url) { toast.show('PDF not available', 'warning'); return; }
    try { await Linking.openURL(payslip.pdf_url); } catch { toast.error('Could not open PDF'); }
  };

  if (loading) {
    return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;
  }
  if (!payslip) {
    return <View style={[s.center, { paddingTop: insets.top }]}><Text style={s.notFound}>Payslip not found</Text></View>;
  }

  const earnings: Array<[string, unknown]> = [
    ['Basic', payslip.basic],
    ['House rent allowance', payslip.hra],
    ['Conveyance', payslip.conveyance],
    ['Special allowance', payslip.special_allowance],
  ];

  const statutory: Array<[string, unknown]> = [
    ['Provident fund', payslip.pf_employee],
    ['ESI', payslip.esi_employee],
    ['Professional tax', payslip.pt],
    ['Income tax (TDS)', payslip.tds],
    ['Labour welfare fund', payslip.lwf],
  ];

  const employer: Array<[string, unknown]> = [
    ['Provident fund (employer)', payslip.employer_contributions?.pf_employer],
    ['ESI (employer)', payslip.employer_contributions?.esi_employer],
  ];

  const lop = Number(payslip.lop_deduction ?? 0);
  const grossBeforeLop = Number(payslip.gross_salary ?? 0) + lop;
  const deductionsWithLop = Number(payslip.total_deductions ?? 0) + lop;

  const Row = ({ label, value, negative }: { label: string; value: unknown; negative?: boolean }) => {
    const shown = money(value);
    if (!shown) return null;
    return (
      <View style={s.line}>
        <Text style={s.lineLabel}>{label}</Text>
        <Text style={[s.lineValue, negative ? { color: colors.danger } : null]}>{shown}</Text>
      </View>
    );
  };

  const Section = ({ title, rows, negative }: { title: string; rows: Array<[string, unknown]>; negative?: boolean }) => {
    if (!rows.some(([, v]) => money(v))) return null;
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>{title}</Text>
        {rows.map(([label, value]) => <Row key={label} label={label} value={value} negative={negative} />)}
      </View>
    );
  };

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.header}>
        <Text style={s.title} numberOfLines={1}>{monthLabel(payslip.month_year)}</Text>
        {!!payslip.payment_status && (
          <View style={s.statusBadge}>
            <Text style={s.statusText}>{String(payslip.payment_status).toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={s.summaryCard}>
        <Text style={s.summaryLabel}>Net Pay</Text>
        {/* A lakh-plus net at 36pt is wider than the card on a 360dp screen,
            and RN clips rather than wraps it. Shrink to fit instead. */}
        <Text style={s.summaryValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5}>
          {money(payslip.net_pay) ?? '₹0'}
        </Text>
      </View>

      {/*
        Loss of pay sits on BOTH sides, so this screen and the PDF tell the same
        story. `gross_salary` is what was earned after loss of pay and
        `total_deductions` deliberately excludes it, so showing the stored pair
        put loss of pay in a card of its own that belonged to neither total — an
        employee adding the deduction sections up got more than the Total
        Deductions card claimed. Adding it to both leaves net pay untouched and
        makes each figure the sum of the lines shown under it.
      */}
      <View style={s.row}>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Gross Earnings</Text>
          <Text style={s.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
            {money(grossBeforeLop) ?? '₹0'}
          </Text>
        </View>
        <View style={s.statCard}>
          <Text style={s.statLabel}>Total Deductions</Text>
          <Text
            style={[s.statValue, { color: colors.danger }]}
            numberOfLines={1}
            adjustsFontSizeToFit
            minimumFontScale={0.7}
          >
            {money(deductionsWithLop) ?? '₹0'}
          </Text>
        </View>
      </View>

      {/* Attendance the pay was computed from — the link between the tracker
          and this figure, which is the whole point of the two being one app. */}
      {payslip.working_days != null && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Attendance this month</Text>
          <View style={s.line}>
            <Text style={s.lineLabel}>Working days</Text>
            <Text style={s.lineValue}>{Number(payslip.working_days)}</Text>
          </View>
          <View style={s.line}>
            <Text style={s.lineLabel}>Days present</Text>
            <Text style={s.lineValue}>{Number(payslip.days_present ?? 0)}</Text>
          </View>
          {Number(payslip.lOP_days ?? 0) > 0 && (
            <View style={s.line}>
              <Text style={s.lineLabel}>Loss of pay days</Text>
              <Text style={[s.lineValue, { color: colors.danger }]}>{Number(payslip.lOP_days)}</Text>
            </View>
          )}
        </View>
      )}

      <Section title="Earnings" rows={earnings} />
      <Section title="Deductions" rows={[...statutory, ['Loss of pay', payslip.lop_deduction]]} negative />

      {/* Loan and advance recoveries, one line each. A combined total cannot be
          decomposed later, which is why the server sends the lines. */}
      {!!payslip.deduction_lines?.length && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Recoveries</Text>
          {payslip.deduction_lines.map((line, i) => (
            <View key={`${line.label}-${i}`} style={s.line}>
              <View style={{ flex: 1 }}>
                <Text style={s.lineLabel}>{line.label}</Text>
                {line.remaining != null && (
                  <Text style={s.lineNote}>{money(line.remaining)} remaining</Text>
                )}
              </View>
              <Text style={[s.lineValue, { color: colors.danger }]}>{money(line.amount)}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Part of CTC, but never paid to the employee — labelled as such so the
          two figures are not mistaken for one another. */}
      <Section title="Employer contributions (not deducted from you)" rows={employer} />

      {!!ytd && (
        <View style={s.card}>
          <Text style={s.cardTitle}>Year to date · {ytd.months_count} month{ytd.months_count === 1 ? '' : 's'}</Text>
          <Row label="Gross" value={ytd.gross} />
          <Row label="Deductions" value={ytd.deductions} negative />
          <Row label="Take-home" value={ytd.net_pay} />
        </View>
      )}

      {!!payslip.pdf_url && (
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
  // flexShrink so a long month cannot push the status badge past the edge.
  title: { fontSize: 22, fontWeight: '700', color: c.text, flexShrink: 1, marginRight: 8 },
  statusBadge: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: c.primaryLight, flexShrink: 0 },
  statusText: { color: c.primary, fontWeight: '600', fontSize: 12 },
  summaryCard: { backgroundColor: c.primaryLight, borderRadius: 14, padding: 24, alignItems: 'center', marginBottom: 16 },
  summaryLabel: { fontSize: 14, color: c.textSecondary },
  summaryValue: { fontSize: 36, fontWeight: '700', color: c.primary, marginTop: 4 },
  row: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 16, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  statLabel: { fontSize: 12, color: c.textSecondary, marginBottom: 4 },
  statValue: { fontSize: 18, fontWeight: '700', color: c.text },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  lineLabel: { fontSize: 15, color: c.text, flexShrink: 1 },
  lineNote: { fontSize: 12, color: c.textTertiary, marginTop: 2 },
  lineValue: { fontSize: 15, fontWeight: '600', color: c.text, marginLeft: 12, flexShrink: 0 },
  downloadBtn: { backgroundColor: c.primary, borderRadius: 10, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  downloadBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
