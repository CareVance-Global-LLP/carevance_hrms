import React, { useEffect, useState, useMemo } from 'react';
import { View, Text, ScrollView, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import EmptyState from '../../src/components/EmptyState';
import type { ThemeColors } from '../../src/constants/theme';
import { orgApi } from '../../src/api/endpoints';
import type { OrgMember } from '../../src/types';

/**
 * Role chips, resolved from the theme so they invert in dark mode.
 *
 * Employee was stock blue, which is the one colour CareVance does not use —
 * the brand is teal with a gold accent (src/constants/theme.ts).
 */
const roleColor = (role: string | undefined, c: ThemeColors): string => {
  if (role === 'admin' || role === 'super_admin') return c.danger;
  if (role === 'manager' || role === 'hr') return c.accent;
  if (role === 'employee') return c.primary;
  return c.textSecondary;
};

function memberRole(m: OrgMember): string { return m.role_name || (m.role ? m.role.charAt(0).toUpperCase() + m.role.slice(1) : 'Member'); }
function memberDept(m: OrgMember): string { return m.department || m.employee_work_info?.department?.name || m.groups?.length ? m.groups[0].name : '—'; }
function memberPhone(m: OrgMember): string { return m.phone || m.employee_profile?.phone || '—'; }
function memberDesignation(m: OrgMember): string { return m.designation || m.employee_work_info?.designation || '—'; }

export default function TeamScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMembers = async () => {
    setError(null);
    try {
      const res = await orgApi.members();
      const data = Array.isArray(res.data) ? res.data : [];
      setMembers(data);
      if (data.length === 0) setError('No members found in your organization');
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 403) setError('You do not have permission to view team members');
      else if (status === 404) setError('Organization not found');
      else setError('Failed to load members. Check backend connection.');
    } finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { fetchMembers(); }, []);

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMembers(); }} tintColor={colors.textSecondary} />}>
      <Text style={s.title}>Team Members</Text>
      <Text style={s.subtitle}>{members.length} member{members.length !== 1 ? 's' : ''}</Text>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: 40 }} />
      ) : error ? (
        <View style={s.errorBox}><Text style={s.errorText}>{error}</Text></View>
      ) : members.length === 0 ? (
        <EmptyState
          icon="people-outline"
          title="No members found"
          hint="Nobody matches this search. Try a different name or department."
        />
      ) : (
        members.map((m) => (
          <View key={m.id} style={s.card}>
            <View style={s.cardHeader}>
              <View style={s.avatar}><Text style={s.avatarText}>{m.name.charAt(0).toUpperCase()}</Text></View>
              <View style={s.headerInfo}>
                <Text style={s.memberName}>{m.name}</Text>
                <Text style={s.memberEmail}>{m.email}</Text>
              </View>
              <View style={[s.roleBadge, { backgroundColor: roleColor(m.role, colors) + '18' }]}>
                <Text style={[s.roleText, { color: roleColor(m.role, colors) }]}>{memberRole(m)}</Text>
              </View>
            </View>
            <View style={s.detailRow}>
              <View style={s.detailItem}><Text style={s.detailLabel}>Designation</Text><Text style={s.detailValue}>{memberDesignation(m)}</Text></View>
              <View style={s.detailItem}><Text style={s.detailLabel}>Department</Text><Text style={s.detailValue}>{memberDept(m)}</Text></View>
            </View>
            <View style={s.detailRow}>
              <View style={s.detailItem}><Text style={s.detailLabel}>Phone</Text><Text style={s.detailValue}>{memberPhone(m)}</Text></View>
              <View style={s.detailItem}>
                <Text style={s.detailLabel}>Status</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: m.is_online ? colors.success : colors.textTertiary }} />
                  <Text style={[s.detailValue, { color: m.is_online ? colors.success : colors.textTertiary }]}>{m.is_online ? 'Online' : 'Offline'}</Text>
                </View>
              </View>
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 16 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 4 },
  subtitle: { fontSize: 13, color: c.textSecondary, marginBottom: 20 },
  empty: { textAlign: 'center', color: c.textTertiary, fontSize: 15, marginTop: 40 },
  errorBox: { backgroundColor: c.danger + '18', borderRadius: 10, padding: 16, marginTop: 20 },
  errorText: { color: c.danger, fontSize: 14, textAlign: 'center' },
  card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: c.primary, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  avatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  headerInfo: { flex: 1 },
  memberName: { fontSize: 15, fontWeight: '700', color: c.text },
  memberEmail: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  roleBadge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { fontSize: 11, fontWeight: '700' },
  detailRow: { flexDirection: 'row', gap: 12, marginBottom: 8 },
  detailItem: { flex: 1 },
  detailLabel: { fontSize: 11, color: c.textTertiary, marginBottom: 2 },
  detailValue: { fontSize: 14, fontWeight: '500', color: c.text },
});
