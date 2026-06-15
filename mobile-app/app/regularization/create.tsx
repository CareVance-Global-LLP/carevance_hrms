import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '../../src/hooks/useTheme';
import type { ThemeColors } from '../../src/constants/theme';
import { timeEditApi } from '../../src/api/endpoints';

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CreateRegularizationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [attendanceDate, setAttendanceDate] = useState(new Date());
  const [extraHours, setExtraHours] = useState('');
  const [extraMinutes, setExtraMinutes] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const handleDateChange = (_: DateTimePickerEvent, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) setAttendanceDate(selected);
  };

  const handleSubmit = async () => {
    const hours = parseInt(extraHours) || 0;
    const mins = parseInt(extraMinutes) || 0;
    const total = hours * 60 + mins;
    if (total < 1) { Alert.alert('Error', 'Please enter at least 1 minute'); return; }
    if (total > 600) { Alert.alert('Error', 'Maximum 600 minutes (10 hours) allowed'); return; }
    setSubmitting(true);
    try {
      await timeEditApi.create({
        attendance_date: formatDate(attendanceDate),
        extra_minutes: total,
        message: message.trim() || undefined,
      });
      Alert.alert('Success', 'Regularization request submitted');
      router.back();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.label}>Attendance Date</Text>
        <TouchableOpacity style={s.dateInput} onPress={() => setShowDatePicker(true)}>
          <Text style={s.dateText}>{formatDate(attendanceDate)}</Text>
          <Ionicons name="calendar-outline" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
        {showDatePicker && <DateTimePicker value={attendanceDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} maximumDate={new Date()} onChange={handleDateChange} />}

        <Text style={s.label}>Extra Time</Text>
        <View style={s.timeRow}>
          <View style={s.timeField}>
            <TextInput style={s.input} placeholder="0" placeholderTextColor={colors.textTertiary} value={extraHours} onChangeText={setExtraHours} keyboardType="number-pad" />
            <Text style={s.timeUnit}>hours</Text>
          </View>
          <Text style={s.timeSep}>:</Text>
          <View style={s.timeField}>
            <TextInput style={s.input} placeholder="0" placeholderTextColor={colors.textTertiary} value={extraMinutes} onChangeText={setExtraMinutes} keyboardType="number-pad" />
            <Text style={s.timeUnit}>mins</Text>
          </View>
        </View>

        <Text style={s.label}>Reason</Text>
        <TextInput style={[s.input, s.textArea]} placeholder="Explain why you need this adjustment" placeholderTextColor={colors.textTertiary} value={message} onChangeText={setMessage} multiline numberOfLines={4} textAlignVertical="top" />

        <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Submit Request</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8, marginTop: 16 },
  dateInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateText: { fontSize: 16, color: c.text },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeField: { flex: 1 },
  timeUnit: { fontSize: 12, color: c.textSecondary, marginTop: 4, textAlign: 'center' },
  timeSep: { fontSize: 20, color: c.textSecondary, marginTop: -16 },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontSize: 16, color: c.text },
  textArea: { height: 100 },
  submitBtn: { backgroundColor: c.primary, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
