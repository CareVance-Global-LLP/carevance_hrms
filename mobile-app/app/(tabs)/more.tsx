import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import EmptyState from '../../src/components/EmptyState';
import { isManager } from '../../src/hooks/usePermissions';
import type { ThemeColors } from '../../src/constants/theme';
import { payslipApi, notificationApi } from '../../src/api/endpoints';
import type { Payslip } from '../../src/types';

/**
 * 'YYYY-MM' as a person reads it. The API sends `month_year`; the app used to
 * read `month` and `year`, which do not exist on the response and rendered as
 * two blanks.
 */
const payslipMonthLabel = (monthYear?: string): string => {
  if (!monthYear) return 'Payslip';
  const [y, m] = monthYear.split('-');
  const names = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const name = names[Number(m) - 1];
  return name ? `${name} ${y}` : monthYear;
};

export default function MoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user, logout } = useAuth();
  const { colors, isDark, toggleTheme } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [unreadNotifs, setUnreadNotifs] = useState(0);
  const [switchValue, setSwitchValue] = useState(isDark);
  // Renamed: a local `userIsManager` shadowed the imported helper and called it in
  // its own initialiser, which throws a ReferenceError before this screen
  // can render at all.
  const userIsManager = isManager(user);

  useEffect(() => { setSwitchValue(isDark); }, [isDark]);

  useEffect(() => {
    loadPayslips(); loadUnreadCount();
    const poll = setInterval(loadUnreadCount, 30000);
    return () => clearInterval(poll);
  }, []);

  const loadPayslips = async () => {
    try {
      const res = await payslipApi.list();
      // { payslips, ytd, employee } — neither a bare array nor a `data`
      // envelope, so both of the old readings produced an empty list.
      setPayslips(res.data?.payslips ?? []);
    } catch (e) { console.warn('Failed to load payslips:', e); }
  };

  const loadUnreadCount = async () => {
    try {
      const res = await notificationApi.list();
      setUnreadNotifs(res.data.unread_count);
    } catch (e) { console.warn('Failed to load unread count:', e); }
  };

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 110 }}>
      <Text style={s.title}>More</Text>

      <View style={s.profileCard}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>{user?.name?.charAt(0)?.toUpperCase() || 'E'}</Text>
        </View>
        <View>
          <Text style={s.profileName}>{user?.name}</Text>
          <Text style={s.profileDetail}>{user?.employee_profile?.employee_code || user?.employee_code}</Text>
          <Text style={s.profileDetail}>{user?.email}</Text>
        </View>
      </View>

      <View style={s.settingsCard}>
        <View style={s.settingsRow}>
          <Ionicons name={isDark ? 'moon' : 'sunny'} size={20} color={colors.text} />
          <Text style={s.settingsLabel}>Dark Mode</Text>
        </View>
        <Switch value={switchValue} onValueChange={(val) => { setSwitchValue(val); toggleTheme(); }} trackColor={{ false: '#ccc', true: '#bbdefb' }} thumbColor={switchValue ? '#1976d2' : '#888'} />
      </View>

      <Text style={s.sectionTitle}>Features</Text>

      <TouchableOpacity style={s.menuCard} onPress={() => router.push('/notifications')}>
        <View style={s.menuRow}>
          <Ionicons name="notifications-outline" size={20} color={colors.primary} />
          <Text style={s.menuLabel}>Notifications</Text>
        </View>
        <View style={s.menuRight}>
          {unreadNotifs > 0 && <View style={s.notifBadge}><Text style={s.notifBadgeText}>{unreadNotifs > 9 ? '9+' : unreadNotifs}</Text></View>}
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </View>
      </TouchableOpacity>

      <TouchableOpacity style={s.menuCard} onPress={() => router.push('/regularization')}>
        <View style={s.menuRow}>
          <Ionicons name="time-outline" size={20} color={colors.primary} />
          <Text style={s.menuLabel}>Regularization</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      <TouchableOpacity style={s.menuCard} onPress={() => router.push('/salary')}>
        <View style={s.menuRow}>
          <Ionicons name="wallet-outline" size={20} color={colors.primary} />
          <Text style={s.menuLabel}>Salary structure</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      <TouchableOpacity style={s.menuCard} onPress={() => router.push('/comp-off')}>
        <View style={s.menuRow}>
          <Ionicons name="calendar-outline" size={20} color={colors.success} />
          <Text style={s.menuLabel}>Comp Off</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
      </TouchableOpacity>

      {userIsManager && (
        <TouchableOpacity style={s.menuCard} onPress={() => router.push('/approval-inbox')}>
          <View style={s.menuRow}>
            <Ionicons name="checkmark-done-outline" size={20} color={colors.warning} />
            <Text style={s.menuLabel}>Approval Inbox</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      )}

      {userIsManager && (
        <TouchableOpacity style={s.menuCard} onPress={() => router.push('/notifications/publish')}>
          <View style={s.menuRow}>
            <Ionicons name="megaphone-outline" size={20} color={colors.warning} />
            <Text style={s.menuLabel}>Publish Announcement</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textTertiary} />
        </TouchableOpacity>
      )}

      <Text style={s.sectionTitle}>Payslips</Text>
      {payslips.length === 0 ? (
        <EmptyState
          icon="wallet-outline"
          title="No payslips yet"
          hint="Payslips appear here once payroll has been released for a month you worked."
        />
      ) : (
        payslips.map((p) => (
          <TouchableOpacity key={p.id} style={s.payslipCard} onPress={() => router.push(`/payslip/${p.id}`)}>
            <View>
              <Text style={s.payslipMonth}>{payslipMonthLabel(p.month_year)}</Text>
              <Text style={s.payslipNet}>₹{Number(p.net_pay ?? 0).toLocaleString('en-IN')}</Text>
            </View>
            {!!p.payment_status && (
              <View style={[s.payslipStatus, { backgroundColor: p.payment_status === 'paid' ? '#d1fae5' : '#fef3c7' }]}>
                <Text style={{ fontSize: 11, fontWeight: '600', color: p.payment_status === 'paid' ? '#065f46' : '#92400e' }}>{p.payment_status}</Text>
              </View>
            )}
          </TouchableOpacity>
        ))
      )}

      <TouchableOpacity style={s.logoutCard} onPress={logout}>
        <Ionicons name="log-out-outline" size={18} color={colors.danger} />
        <Text style={s.logoutText}>Logout</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 20 },
  profileCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12, gap: 14, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 20, fontWeight: '700', color: '#fff' },
  profileName: { fontSize: 16, fontWeight: '700', color: c.text },
  profileDetail: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  settingsCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.card, borderRadius: 10, padding: 16, marginBottom: 24, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  settingsLabel: { fontSize: 15, fontWeight: '600', color: c.text },
  settingsValue: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
  menuCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.card, borderRadius: 10, padding: 16, marginBottom: 8, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuLabel: { fontSize: 15, fontWeight: '600', color: c.text },
  menuRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  notifBadge: { backgroundColor: c.danger, borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  notifBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  empty: { color: c.textTertiary, fontSize: 14 },
  payslipCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  payslipMonth: { fontSize: 14, fontWeight: '600', color: c.text },
  payslipNet: { fontSize: 16, fontWeight: '700', color: c.primary, marginTop: 2 },
  payslipStatus: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  logoutCard: { marginTop: 24, backgroundColor: c.danger + '12', borderRadius: 10, padding: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: c.danger + '30' },
  logoutText: { color: c.danger, fontSize: 16, fontWeight: '600' },
});
