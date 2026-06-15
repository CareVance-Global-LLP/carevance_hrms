import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useTheme } from '../../src/hooks/useTheme';
import type { ThemeColors } from '../../src/constants/theme';
import { reimbursementApi } from '../../src/api/endpoints';

const CATEGORIES = ['travel', 'meals', 'office_supplies', 'training', 'medical', 'other'];
const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP'];

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function CreateExpenseScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('INR');
  const [expenseDate, setExpenseDate] = useState(new Date());
  const [description, setDescription] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const handleDateChange = (_: DateTimePickerEvent, selected?: Date) => {
    setShowDatePicker(Platform.OS === 'ios');
    if (selected) setExpenseDate(selected);
  };

  const handleSubmit = async () => {
    if (!category) { Alert.alert('Error', 'Please select a category'); return; }
    if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) { Alert.alert('Error', 'Please enter a valid amount'); return; }
    if (!description.trim()) { Alert.alert('Error', 'Description is required'); return; }
    setSubmitting(true);
    try {
      await reimbursementApi.create({
        category,
        amount: Number(amount),
        currency,
        expense_date: formatDate(expenseDate),
        description: description.trim(),
        merchant_name: merchantName.trim() || undefined,
        location: location.trim() || undefined,
      });
      Alert.alert('Success', 'Expense submitted for approval');
      router.back();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to submit'); }
    finally { setSubmitting(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.label}>Category</Text>
        <View style={s.chipRow}>
          {CATEGORIES.map((c) => (
            <TouchableOpacity key={c} style={[s.chip, category === c && s.chipActive]} onPress={() => setCategory(c)}>
              <Text style={[s.chipText, category === c && s.chipTextActive]}>{c.replace('_', ' ')}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>Amount</Text>
        <View style={s.amountRow}>
          <TouchableOpacity style={s.currencyBtn} onPress={() => setCurrency(CURRENCIES[(CURRENCIES.indexOf(currency) + 1) % CURRENCIES.length])}>
            <Text style={s.currencyText}>{currency}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.textSecondary} />
          </TouchableOpacity>
          <TextInput style={[s.input, s.amountInput]} placeholder="0.00" placeholderTextColor={colors.textTertiary} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        </View>

        <Text style={s.label}>Expense Date</Text>
        <TouchableOpacity style={s.dateInput} onPress={() => setShowDatePicker(true)}>
          <Text style={s.dateText}>{formatDate(expenseDate)}</Text>
          <Ionicons name="calendar-outline" size={20} color={colors.textTertiary} />
        </TouchableOpacity>
        {showDatePicker && <DateTimePicker value={expenseDate} mode="date" display={Platform.OS === 'ios' ? 'spinner' : 'default'} onChange={handleDateChange} />}

        <Text style={s.label}>Description</Text>
        <TextInput style={[s.input, s.textArea]} placeholder="Describe the expense" placeholderTextColor={colors.textTertiary} value={description} onChangeText={setDescription} multiline numberOfLines={3} textAlignVertical="top" />

        <Text style={s.label}>Merchant (optional)</Text>
        <TextInput style={s.input} placeholder="Merchant name" placeholderTextColor={colors.textTertiary} value={merchantName} onChangeText={setMerchantName} />

        <Text style={s.label}>Location (optional)</Text>
        <TextInput style={s.input} placeholder="City or venue" placeholderTextColor={colors.textTertiary} value={location} onChangeText={setLocation} />

        <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <Text style={s.submitBtnText}>Submit Expense</Text>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8, marginTop: 16 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 8 },
  chipActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
  chipText: { fontSize: 13, color: c.textSecondary, fontWeight: '500', textTransform: 'capitalize' },
  chipTextActive: { color: c.primary, fontWeight: '600' },
  amountRow: { flexDirection: 'row', gap: 10 },
  currencyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 14 },
  currencyText: { fontSize: 16, fontWeight: '600', color: c.text },
  amountInput: { flex: 1 },
  dateInput: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  dateText: { fontSize: 16, color: c.text },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontSize: 16, color: c.text },
  textArea: { height: 80 },
  submitBtn: { backgroundColor: c.primary, borderRadius: 10, padding: 16, alignItems: 'center', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
