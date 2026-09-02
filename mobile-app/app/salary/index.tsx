import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, ActivityIndicator, RefreshControl, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../src/hooks/useTheme';
import EmptyState from '../../src/components/EmptyState';
import type { ThemeColors } from '../../src/constants/theme';
import { payslipApi } from '../../src/api/endpoints';
import type { CtcBreakdown } from '../../src/types';

const rupees = (v: unknown): string =>
  '₹' + Number(v ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

/**
 * `basic_salary` -> `Basic salary`.
 *
 * The component map is keyed by whatever the organisation configured, so the
 * labels are derived rather than listed — a fixed list here would silently drop
 * any allowance this app had not been told about.
 */
const humanise = (key: string): string => {
  const spaced = key.replace(/_/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Order is not meaningful in the map, so show the largest components first. */
const sortedEntries = (map?: Record<string, number>): Array<[string, number]> =>
  Object.entries(map ?? {})
    .map(([k, v]) => [k, Number(v)] as [string, number])
    .filter(([, v]) => Number.isFinite(v) && v !== 0)
    .sort((a, b) => b[1] - a[1]);

export default function SalaryStructureScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);

  const [ctc, setCtc] = useState<CtcBreakdown | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await payslipApi.ctcBreakdown();
      if (res.data?.success && res.data.ctc_breakdown) {
        setCtc(res.data.ctc_breakdown);
        setMessage(null);
      } else {
        // A 400 here means "no CTC configured", which is a real state and not
        // an error to hide behind a spinner.
        setCtc(null);
        setMessage(res.data?.message ?? 'Your salary structure has not been set up yet.');
      }
    } catch (e: any) {
      setCtc(null);
      setMessage(
        e?.response?.data?.message ?? 'Could not load your salary structure. Pull down to try again.',
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <View style={[s.center, { paddingTop: insets.top }]}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (!ctc) {
    return (
      <View style={[s.container, { paddingTop: insets.top + 8 }]}>
        <Text style={s.title}>Salary structure</Text>
        <EmptyState
          icon="document-text-outline"
          title="Nothing to show yet"
          hint={message ?? ''}
        />
      </View>
    );
  }

  const Group = ({ title, rows, negative }: { title: string; rows: Array<[string, number]>; negative?: boolean }) => {
    if (rows.length === 0) return null;
    return (
      <View style={s.card}>
        <Text style={s.cardTitle}>{title}</Text>
        {rows.map(([key, value]) => (
          <View key={key} style={s.line}>
            <Text style={s.lineLabel}>{humanise(key)}</Text>
            <Text style={[s.lineValue, negative ? { color: colors.danger } : null]}>{rupees(value)}</Text>
          </View>
        ))}
      </View>
    );
  };

  const earnings = sortedEntries(ctc.components?.earnings);
  const deductions = sortedEntries(ctc.components?.deductions);
  const employer = sortedEntries(ctc.components?.employer_contributions);
  const notes = ctc.breakdown;

  return (
    <ScrollView
      style={[s.container, { paddingTop: insets.top + 8 }]}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
    >
      <Text style={s.title}>Salary structure</Text>

      <View style={s.heroCard}>
        <Text style={s.heroLabel}>Annual CTC</Text>
        <Text style={s.heroValue}>{rupees(ctc.annual_ctc)}</Text>
        <Text style={s.heroSub}>{rupees(ctc.monthly_ctc)} per month</Text>
      </View>

      {/* Cost to company is not take-home, and conflating the two is the single
          most common payslip misunderstanding. Say it once, plainly. */}
      <Text style={s.note}>
        Cost to company includes what your employer contributes on your behalf, so it is higher
        than the amount that reaches your account.
      </Text>

      <Group title="Monthly earnings" rows={earnings} />
      <Group title="Monthly deductions" rows={deductions} negative />
      <Group title="Employer contributions (part of CTC, not deducted from you)" rows={employer} />

      {/* Why the numbers are what they are. A capped PF or an inapplicable ESI
          is the first thing people query, and the answer is already computed. */}
      {!!notes && (
        <View style={s.card}>
          <Text style={s.cardTitle}>How this is calculated</Text>
          {notes.pf_wages != null && (
            <View style={s.line}>
              <Text style={s.lineLabel}>PF is calculated on</Text>
              <Text style={s.lineValue}>
                {rupees(notes.pf_wages)}{notes.pf_cap_applied ? ' (capped)' : ''}
              </Text>
            </View>
          )}
          {notes.esi_applicable != null && (
            <View style={s.line}>
              <Text style={s.lineLabel}>ESI</Text>
              <Text style={s.lineValue}>{notes.esi_applicable ? 'Applicable' : 'Not applicable'}</Text>
            </View>
          )}
          {!!notes.tax_regime && (
            <View style={s.line}>
              <Text style={s.lineLabel}>Tax regime</Text>
              <Text style={s.lineValue}>{humanise(notes.tax_regime)}</Text>
            </View>
          )}
          {!!notes.state_code && (
            <View style={s.line}>
              <Text style={s.lineLabel}>Professional tax state</Text>
              <Text style={s.lineValue}>{humanise(notes.state_code)}</Text>
            </View>
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 16 },
  heroCard: { backgroundColor: c.primaryLight, borderRadius: 14, padding: 24, alignItems: 'center', marginBottom: 12 },
  heroLabel: { fontSize: 14, color: c.textSecondary },
  heroValue: { fontSize: 34, fontWeight: '700', color: c.primary, marginTop: 4 },
  heroSub: { fontSize: 14, color: c.textSecondary, marginTop: 6 },
  note: { fontSize: 13, color: c.textTertiary, lineHeight: 19, marginBottom: 16 },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  line: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7 },
  lineLabel: { fontSize: 15, color: c.text, flexShrink: 1 },
  lineValue: { fontSize: 15, fontWeight: '600', color: c.text, marginLeft: 12 },
});
