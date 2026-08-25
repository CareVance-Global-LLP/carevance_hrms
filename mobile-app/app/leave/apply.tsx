import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '../../src/hooks/useTheme';
import { useToast } from '../../src/components/Toast';
import type { ThemeColors } from '../../src/constants/theme';
import { leaveApi } from '../../src/api/endpoints';

const REQUEST_TYPES = [
  { key: 'paid', label: 'Leave', icon: 'umbrella-outline' as const },
  { key: 'wfh', label: 'WFH', icon: 'home-outline' as const },
  { key: 'on_duty', label: 'On Duty', icon: 'briefcase-outline' as const },
  { key: 'partial_day', label: 'Partial Day', icon: 'time-outline' as const },
];

const LEAVE_CATEGORIES = ['Casual', 'Sick', 'Annual', 'Personal'];

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function ApplyLeaveScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const s = useMemo(() => styles(colors), [colors]);
  const [requestType, setRequestType] = useState('paid');
  const [leaveType, setLeaveType] = useState('');
  const [startDate, setStartDate] = useState(new Date());
  const [endDate, setEndDate] = useState(new Date());
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);

  const handleDateChange = (field: 'start' | 'end') => (_: DateTimePickerEvent, selected?: Date) => {
    if (field === 'start') { setShowStartPicker(Platform.OS === 'ios'); if (selected) setStartDate(selected); }
    else { setShowEndPicker(Platform.OS === 'ios'); if (selected) setEndDate(selected); }
  };

  const handleSubmit = async () => {
    if (requestType === 'paid' && !leaveType) { toast.error('Please select a leave type'); return; }
    if (!reason.trim()) { toast.error('Reason is required'); return; }
    if (endDate < startDate) { toast.error('End date must be after start date'); return; }
    setSubmitting(true);
    try {
      const payload: any = { reason: reason.trim(), start_date: formatDate(startDate), end_date: formatDate(endDate) };
      if (requestType === 'paid') {
        payload.leave_category = leaveType;
      } else {
        payload.leave_category = requestType;
        payload.leave_type = startDate.toDateString() === endDate.toDateString() ? 'full_day' : 'half_day';
      }
      await leaveApi.apply(payload);
      toast.success(`${REQUEST_TYPES.find((r) => r.key === requestType)?.label} request submitted`);
      router.back();
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.label}>Request Type</Text>
        <View style={s.typeRow}>
          {REQUEST_TYPES.map((rt) => (
            <TouchableOpacity key={rt.key} style={[s.requestTypeBtn, requestType === rt.key && s.requestTypeBtnActive]} onPress={() => { setRequestType(rt.key); setLeaveType(''); }}>
              <Ionicons name={rt.icon} size={18} color={requestType === rt.key ? colors.primary : colors.textTertiary} />
              <Text style={[s.requestTypeText, requestType === rt.key && s.requestTypeTextActive]}>{rt.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {requestType === 'paid' && (
          <>
            <Text style={s.label}>Leave Type</Text>
            <View style={s.typeRow}>
              {LEAVE_CATEGORIES.map((t) => (
                <TouchableOpacity key={t} style={[s.typeBtn, leaveType === t && s.typeBtnActive]} onPress={() => setLeaveType(t)}>
                  <Text style={[s.typeBtnText, leaveType === t && s.typeBtnTextActive]}>{t}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </>
        )}

        <Text style={s.label}>Start Date</Text>
        <TouchableOpacity style={s.dateInput} onPress={() => setShowStartPicker(true)}>
          <Text style={s.dateText}>{formatDate(startDate)}</Text>
          <Ionicons name="calendar-outline" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
        {showStartPicker && <DateTimePicker value={startDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} minimumDate={new Date()} onChange={handleDateChange('start')} />}

        <Text style={s.label}>End Date</Text>
        <TouchableOpacity style={s.dateInput} onPress={() => setShowEndPicker(true)}>
          <Text style={s.dateText}>{formatDate(endDate)}</Text>
          <Ionicons name="calendar-outline" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
        {showEndPicker && <DateTimePicker value={endDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} minimumDate={startDate} onChange={handleDateChange('end')} />}

        <Text style={s.label}>Reason</Text>
        <TextInput style={[s.input, s.textArea]} placeholder={requestType === 'paid' ? 'Enter reason for leave' : `Enter reason for ${requestType.replace('_', ' ')}`} placeholderTextColor={colors.textTertiary} value={reason} onChangeText={setReason} multiline numberOfLines={4} textAlignVertical="top" />

        <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Submit {REQUEST_TYPES.find((r) => r.key === requestType)?.label} Request</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8, marginTop: 16 },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  requestTypeBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1.5, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10 },
  requestTypeBtnActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
  requestTypeText: { fontSize: 13, color: c.textTertiary, fontWeight: '500' },
  requestTypeTextActive: { color: c.primary, fontWeight: '600' },
  typeBtn: { borderWidth: 1.5, borderColor: c.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  typeBtnActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
  typeBtnText: { fontSize: 14, color: c.textSecondary, fontWeight: '500' },
  typeBtnTextActive: { color: c.primary, fontWeight: '600' },
  dateInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateText: { fontSize: 16, color: c.text },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontSize: 16, color: c.text },
  textArea: { height: 100 },
  submitBtn: { backgroundColor: c.primary, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
