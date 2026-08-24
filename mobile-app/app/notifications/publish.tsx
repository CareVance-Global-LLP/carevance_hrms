import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, ActivityIndicator, Platform, KeyboardAvoidingView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useToast } from '../../src/components/Toast';
import type { ThemeColors } from '../../src/constants/theme';
import { notificationApi } from '../../src/api/endpoints';

export default function PublishAnnouncementScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();
  const s = useMemo(() => styles(colors), [colors]);
  const [type, setType] = useState<'announcement' | 'news' | 'poll'>('announcement');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'urgent'>('medium');
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptions, setPollOptions] = useState<string[]>(['', '']);
  const [isMultipleChoice, setIsMultipleChoice] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const addOption = () => {
    if (pollOptions.length < 12) {
      setPollOptions([...pollOptions, '']);
    }
  };

  const removeOption = (index: number) => {
    if (pollOptions.length > 2) {
      setPollOptions(pollOptions.filter((_, i) => i !== index));
    }
  };

  const updateOption = (index: number, value: string) => {
    setPollOptions(pollOptions.map((opt, i) => i === index ? value : opt));
  };

  const handleSubmit = async () => {
    if (type === 'poll') {
      if (!pollQuestion.trim()) { toast.error('Question is required for polls'); return; }
      const validOptions = pollOptions.filter(opt => opt.trim() !== '');
      if (validOptions.length < 2) { toast.error('Poll must have at least 2 options'); return; }
    } else {
      if (!title.trim()) { toast.error('Title is required'); return; }
      if (!message.trim()) { toast.error('Message is required'); return; }
    }

    setSubmitting(true);
    try {
      if (type === 'poll') {
        await notificationApi.publish({
          type,
          title: '',
          message: '',
          question: pollQuestion.trim(),
          options: pollOptions.filter(opt => opt.trim()),
          is_multiple_choice: isMultipleChoice,
        });
      } else {
        await notificationApi.publish({ type, title: title.trim(), message: message.trim(), priority: type === 'announcement' ? priority : undefined });
      }
      toast.success('Notification published');
      router.back();
    } catch (err: any) { toast.error(err?.response?.data?.message || 'Failed to publish'); }
    finally { setSubmitting(false); }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <Text style={s.heading}>Publish Update</Text>

        <Text style={s.label}>Type</Text>
        <View style={s.row}>
          <TouchableOpacity style={[s.chip, type === 'announcement' && s.chipActive]} onPress={() => setType('announcement')}><Text style={[s.chipText, type === 'announcement' && s.chipTextActive]}>Announcement</Text></TouchableOpacity>
          <TouchableOpacity style={[s.chip, type === 'news' && s.chipActive]} onPress={() => setType('news')}><Text style={[s.chipText, type === 'news' && s.chipTextActive]}>News</Text></TouchableOpacity>
          <TouchableOpacity style={[s.chip, type === 'poll' && s.chipActive]} onPress={() => setType('poll')}><Text style={[s.chipText, type === 'poll' && s.chipTextActive]}>Poll</Text></TouchableOpacity>
        </View>

        {type === 'poll' ? (
          <>
            <Text style={s.label}>Question</Text>
            <TextInput style={s.input} placeholder="What would you like to ask?" placeholderTextColor={colors.textTertiary} value={pollQuestion} onChangeText={setPollQuestion} maxLength={255} />

            <View style={s.rowBetween}>
              <Text style={s.label}>Options</Text>
              {pollOptions.length < 12 && (
                <TouchableOpacity onPress={addOption}><Text style={{ color: colors.primary, fontSize: 14 }}>+ Add Option</Text></TouchableOpacity>
              )}
            </View>

            {pollOptions.map((opt, index) => (
              <View key={index} style={s.optionRow}>
                <TextInput
                  style={[s.input, s.optionInput]}
                  placeholder={`Option ${index + 1}`}
                  placeholderTextColor={colors.textTertiary}
                  value={opt}
                  onChangeText={(value) => updateOption(index, value)}
                  maxLength={255}
                />
                {pollOptions.length > 2 && (
                  <TouchableOpacity
                    onPress={() => removeOption(index)}
                    style={s.removeOptionBtn}
                    accessibilityRole="button"
                    // Icon-only, so without this a screen reader announces
                    // nothing at all — just "button".
                    accessibilityLabel={`Remove poll option ${index + 1}`}
                  >
                    <Ionicons name="close-circle" size={24} color={colors.danger} />
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <TouchableOpacity style={[s.row, { alignItems: 'center', marginTop: 8 }]} onPress={() => setIsMultipleChoice(!isMultipleChoice)}>
              <Ionicons name={isMultipleChoice ? 'checkbox' : 'square-outline'} size={20} color={colors.primary} />
              <Text style={{ marginLeft: 8, color: colors.text, fontSize: 14 }}>Allow multiple selections</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
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
          </>
        )}

        <TouchableOpacity style={[s.submitBtn, submitting && { opacity: 0.6 }]} onPress={handleSubmit} disabled={submitting}>
          {submitting ? <ActivityIndicator color="#fff" /> : <><Ionicons name="send" size={16} color="#fff" /><Text style={s.submitBtnText}>  Publish</Text></>}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  heading: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8, marginTop: 16 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, marginBottom: 8 },
  chip: { borderWidth: 1.5, borderColor: c.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chipActive: { borderColor: c.primary, backgroundColor: c.primaryLight },
  chipText: { fontSize: 14, color: c.textSecondary, fontWeight: '500' },
  chipTextActive: { color: c.primary, fontWeight: '600' },
  input: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 10, padding: 14, fontSize: 16, color: c.text },
  textArea: { height: 140 },
  optionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  optionInput: { flex: 1, marginTop: 0, marginBottom: 0 },
  removeOptionBtn: { padding: 4 },
  submitBtn: { backgroundColor: c.primary, borderRadius: 10, padding: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', marginTop: 24 },
  submitBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
