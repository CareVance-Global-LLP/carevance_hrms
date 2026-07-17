import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Alert, Modal, TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useAuth } from '../../src/hooks/useAuth';
import { canApprove } from '../../src/hooks/usePermissions';
import type { ThemeColors } from '../../src/constants/theme';
import { approvalApi, reimbursementApi } from '../../src/api/endpoints';
import type { LeaveRequest, TimeEditRequest, Reimbursement } from '../../src/types';

type TabType = 'leave' | 'time_edit' | 'expense';

const TABS: { key: TabType; label: string; icon: string }[] = [
  { key: 'leave', label: 'Leave', icon: 'calendar-outline' },
  { key: 'time_edit', label: 'Time Edit', icon: 'time-outline' },
  { key: 'expense', label: 'Expense', icon: 'receipt-outline' },
];

export default function ApprovalInboxScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { user } = useAuth();
  const s = useMemo(() => styles(colors), [colors]);
  const canApprove = canApprove(user);
  const [activeTab, setActiveTab] = useState<TabType>('leave');
  const [leaves, setLeaves] = useState<LeaveRequest[]>([]);
  const [timeEdits, setTimeEdits] = useState<TimeEditRequest[]>([]);
  const [expenses, setExpenses] = useState<Reimbursement[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);
  const [rejectTarget, setRejectTarget] = useState<{ type: TabType; id: number } | null>(null);
  const [rejectNote, setRejectNote] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [leaveRes, timeRes, expenseRes] = await Promise.all([
        approvalApi.pendingLeaves(),
        approvalApi.pendingTimeEdits(),
        reimbursementApi.list(),
      ]);
      setLeaves(leaveRes.data.data);
      setTimeEdits(timeRes.data.data);
      const allExpenses = expenseRes.data.data || [];
      setExpenses(allExpenses.filter((r: Reimbursement) => r.status === 'pending'));
    } catch (e) { console.warn('Approval fetch failed:', e); } finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const poll = setInterval(fetchData, 30000);
    return () => clearInterval(poll);
  }, []);

  const handleApprove = async (type: TabType, id: number) => {
    setActionLoading(id);
    try {
      if (type === 'leave') { await approvalApi.approveLeave(id); }
      else if (type === 'time_edit') { await approvalApi.approveTimeEdit(id); }
      else { await approvalApi.approveReimbursement(id); }
      Alert.alert('Approved', 'Request has been approved');
      fetchData();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to approve'); }
    finally { setActionLoading(null); }
  };

  const openReject = (type: TabType, id: number) => {
    setRejectTarget({ type, id });
    setRejectNote('');
  };

  const confirmReject = async () => {
    if (!rejectTarget) return;
    if (!rejectNote.trim()) { Alert.alert('Error', 'Reason is required to reject'); return; }
    const { type, id } = rejectTarget;
    setActionLoading(id);
    setRejectTarget(null);
    setRejectNote('');
    try {
      if (type === 'leave') { await approvalApi.rejectLeave(id, rejectNote.trim()); }
      else if (type === 'time_edit') { await approvalApi.rejectTimeEdit(id, rejectNote.trim()); }
      else { await approvalApi.rejectReimbursement(id, rejectNote.trim()); }
      Alert.alert('Rejected', 'Request has been rejected');
      fetchData();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to reject'); }
    finally { setActionLoading(null); }
  };

  const pendingCount = leaves.length + timeEdits.length + expenses.length;

  if (loading) return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.textSecondary} />}>
        <View style={s.header}>
          <Text style={s.title}>Approval Inbox</Text>
          {pendingCount > 0 && <View style={s.countBadge}><Text style={s.countText}>{pendingCount}</Text></View>}
        </View>

        <View style={s.tabRow}>
          {TABS.map((tab) => (
            <TouchableOpacity key={tab.key} style={[s.tab, activeTab === tab.key && s.tabActive]} onPress={() => setActiveTab(tab.key)}>
              <Ionicons name={tab.icon as any} size={16} color={activeTab === tab.key ? colors.primary : colors.textTertiary} />
              <Text style={[s.tabText, activeTab === tab.key && s.tabTextActive]}>{tab.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

      {activeTab === 'leave' && renderList(leaves, 'leave', s, colors, handleApprove, openReject, actionLoading, canApprove)}
      {activeTab === 'time_edit' && renderTimeEditList(timeEdits, s, colors, handleApprove, openReject, actionLoading, canApprove)}
      {activeTab === 'expense' && renderExpenseList(expenses, s, colors, handleApprove, openReject, actionLoading, canApprove)}
      </ScrollView>

      <Modal visible={!!rejectTarget} transparent animationType="fade" onRequestClose={() => setRejectTarget(null)}>
        <View style={s.modalOverlay}>
          <View style={s.modal}>
            <Text style={s.modalTitle}>Reject Request</Text>
            <Text style={s.modalSubtitle}>Enter reason for rejection</Text>
            <TextInput style={s.modalInput} placeholder="Reason is required" placeholderTextColor={colors.textTertiary} value={rejectNote} onChangeText={setRejectNote} multiline numberOfLines={3} textAlignVertical="top" autoFocus />
            <View style={s.modalActions}>
              <TouchableOpacity style={s.modalCancel} onPress={() => setRejectTarget(null)}><Text style={s.modalCancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={s.modalConfirm} onPress={confirmReject}><Text style={s.modalConfirmText}>Reject</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

function renderActions(canApprove: boolean, type: string, id: number, s: any, colors: ThemeColors, onApprove: any, onReject: any, actionLoading: number | null) {
  if (!canApprove) {
    return (
      <View style={[s.pendingBadge, { backgroundColor: colors.warning + '20' }]}>
        <Text style={{ color: colors.warning, fontWeight: '600', fontSize: 12 }}>Awaiting approval</Text>
      </View>
    );
  }
  return (
    <View style={s.actionRow}>
      <TouchableOpacity style={[s.approveBtn, actionLoading === id && { opacity: 0.5 }]} onPress={() => onApprove(type, id)} disabled={actionLoading === id}>
        {actionLoading === id ? <ActivityIndicator size="small" color="#fff" /> : <><Ionicons name="checkmark" size={16} color="#fff" /><Text style={s.actionText}>Approve</Text></>}
      </TouchableOpacity>
      <TouchableOpacity style={[s.rejectBtn, actionLoading === id && { opacity: 0.5 }]} onPress={() => onReject(type, id)} disabled={actionLoading === id}>
        <Ionicons name="close" size={16} color={colors.danger} /><Text style={[s.actionText, { color: colors.danger }]}>Reject</Text>
      </TouchableOpacity>
    </View>
  );
}

function renderList(items: LeaveRequest[], type: string, s: any, colors: ThemeColors, onApprove: any, onReject: any, actionLoading: number | null, canApprove: boolean) {
  if (items.length === 0) return <Text style={s.empty}>No pending {type.replace('_', ' ')} requests</Text>;
  return items.map((item) => (
    <View key={item.id} style={s.card}>
      <View style={s.cardHeaderRow}>
        <Text style={s.cardTitle}>{item.leave_category || item.leave_type}</Text>
        <Text style={s.cardUser}>#{item.id}</Text>
      </View>
      <Text style={s.cardDates}>{item.start_date} → {item.end_date}</Text>
      {item.reason && <Text style={s.cardReason} numberOfLines={2}>{item.reason}</Text>}
      {renderActions(canApprove, type, item.id, s, colors, onApprove, onReject, actionLoading)}
    </View>
  ));
}

function renderTimeEditList(items: TimeEditRequest[], s: any, colors: ThemeColors, onApprove: any, onReject: any, actionLoading: number | null, canApprove: boolean) {
  if (items.length === 0) return <Text style={s.empty}>No pending time edit requests</Text>;
  return items.map((item) => (
    <View key={item.id} style={s.card}>
      <View style={s.cardHeaderRow}>
        <Text style={s.cardTitle}>{item.attendance_date}</Text>
        <Text style={s.cardUser}>{Math.floor(item.extra_seconds / 3600)}h {Math.floor((item.extra_seconds % 3600) / 60)}m</Text>
      </View>
      {item.message && <Text style={s.cardReason} numberOfLines={2}>{item.message}</Text>}
      {renderActions(canApprove, 'time_edit', item.id, s, colors, onApprove, onReject, actionLoading)}
    </View>
  ));
}

function renderExpenseList(items: Reimbursement[], s: any, colors: ThemeColors, onApprove: any, onReject: any, actionLoading: number | null, canApprove: boolean) {
  if (items.length === 0) return <Text style={s.empty}>No pending expense requests</Text>;
  return items.map((item) => (
    <View key={item.id} style={s.card}>
      <View style={s.cardHeaderRow}>
        <Text style={s.cardTitle}>{item.category.replace('_', ' ')}</Text>
        <Text style={s.cardUser}>{item.currency === 'INR' ? '₹' : item.currency} {Number(item.amount).toLocaleString()}</Text>
      </View>
      <Text style={s.cardDates}>by {item.employee?.name || 'Unknown'} on {item.expense_date}</Text>
      {item.description && <Text style={s.cardReason} numberOfLines={2}>{item.description}</Text>}
      {renderActions(canApprove, 'expense', item.id, s, colors, onApprove, onReject, actionLoading)}
    </View>
  ));
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  countBadge: { backgroundColor: c.danger, borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  countText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  tabRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  tab: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  tabActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
  tabText: { fontSize: 13, color: c.textTertiary, fontWeight: '500' },
  tabTextActive: { color: c.primary, fontWeight: '600' },
  empty: { color: c.textTertiary, fontSize: 14 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10, borderLeftWidth: 3, borderLeftColor: c.warning, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  cardHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: c.text },
  cardUser: { fontSize: 13, color: c.textSecondary, fontWeight: '500' },
  cardDates: { fontSize: 13, color: c.textSecondary, marginBottom: 4 },
  cardReason: { fontSize: 13, color: c.text, marginBottom: 8 },
  pendingBadge: { borderRadius: 8, paddingVertical: 8, paddingHorizontal: 12, alignSelf: 'flex-start', marginTop: 8 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 4 },
  approveBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: c.success, borderRadius: 8, paddingVertical: 10 },
  rejectBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, backgroundColor: c.danger + '15', borderRadius: 8, paddingVertical: 10, borderWidth: 1, borderColor: c.danger + '30' },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 32 },
  modal: { backgroundColor: c.surface, borderRadius: 14, padding: 24, width: '100%', maxWidth: 400 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 4 },
  modalSubtitle: { fontSize: 14, color: c.textSecondary, marginBottom: 16 },
  modalInput: { backgroundColor: c.input, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontSize: 15, color: c.text, minHeight: 80, textAlignVertical: 'top' },
  modalActions: { flexDirection: 'row', gap: 12, marginTop: 16 },
  modalCancel: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8, borderWidth: 1, borderColor: c.border },
  modalCancelText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  modalConfirm: { flex: 1, padding: 12, alignItems: 'center', borderRadius: 8, backgroundColor: c.danger },
  modalConfirmText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
