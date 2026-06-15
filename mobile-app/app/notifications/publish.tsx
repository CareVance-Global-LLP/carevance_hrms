import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert, ActivityIndicator, Platform, KeyboardAvoidingView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import type { ThemeColors } from '../../src/constants/theme';
import { notificationApi } from '../../src/api/endpoints';

export default function PublishAnnouncementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [type, setType] = useState<'announcement' | 'news'>('announcement');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!title.trim()) { Alert.alert('Error', 'Title is required'); return; }
    if (!message.trim()) { Alert.alert('Error', 'Message is required'); return; }
    setSubmitting(true);
    try {
      await notificationApi.publish({ type, title: title.trim(), message: message.trim(), priority });
      Alert.alert('Success', 'Announcement published');
      router.back();
    } catch (err: any) { Alert.alert('Error', err?.response?.data?.message || 'Failed to publish'); }
    finally { setSubmitting(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.heading}>Publish Announcement</Text>

        <Text style={s.label}>Type</Text>
        <View style={s.row}>
          <TouchableOpacity style={[s.chip, type === 'announcement' && s.chipActive]} onPress={() => setType('announcement')}><Text style={[s.chipText, type === 'announcement' && s.chipTextActive]}>Announcement</Text></TouchableOpacity>
          <TouchableOpacity style={[s.chip, type === 'news' && s.chipActive]} onPress={() => setType('news')}><Text style={[s.chipText, type === 'news' && s.chipTextActive]}>News</Text></TouchableOpacity>
        </View>

        <Text style={s.label}>Priority</Text>
        <View style={s.row}>
          {(['low', 'medium', 'high'] as const).map((p) => (
            <TouchableOpacity key={p} style={[s.chip, priority === p && s.chipActive]} onPress={() => setPriority(p)}>
              <Text style={[s.chipText, priority === p && s.chipTextActive, { textTransform: 'capitalize' }]}>{p}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={s.label}>Title</Text>
        <TextInput style={s.input} placeholder="Announcement title" placeholderTextColor={colors.textTertiary} value={title} onChangeText={setTitle} maxLength={150} />

        <Text style={s.label}>Message</Text>
        <TextInput style={[s.input, s.textArea]} placeholder="Write your announcement message..." placeholderTextColor={colors.textTertiary} value={message} onChangeText={setMessage} multiline numberOfLines={6} textAlignVertical="top" maxLength={3000} />

        <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={16} color="#fff" /><Text style={s.submitBtnText}>  Publish</Text></>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  heading: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8, marginTop: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1.5, borderColor: c.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chipActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
  chipText: { fontSize: 14, color: c.textSecondary, fontWeight: '500' },
  chipTextActive: { color: c.primary, fontWeight: '600' },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontSize: 16, color: c.text },
  textArea: { height: 140 },
  submitBtn: { backgroundColor: c.primary, borderRadius: 10, padding: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
