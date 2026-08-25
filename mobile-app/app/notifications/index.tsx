import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import EmptyState from '../../src/components/EmptyState';
import type { ThemeColors } from '../../src/constants/theme';
import { notificationApi } from '../../src/api/endpoints';
import type { AppNotification } from '../../src/types';

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const s = useMemo(() => styles(colors), [colors]);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const res = await notificationApi.list();
      setItems(res.data.data);
      setUnreadCount(res.data.unread_count);
    } catch (e) { console.warn('Failed to fetch notifications:', e); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    fetchData();
    const poll = setInterval(fetchData, 30000);
    return () => clearInterval(poll);
  }, []);

  const handleMarkRead = async (id: number) => {
    try {
      await notificationApi.markRead(id);
      setItems((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (e) { console.warn('Failed to mark read:', e); }
  };

  const handleVote = async (pollId: number, optionIds: number[]) => {
    try {
      await notificationApi.votePoll(pollId, optionIds);
      setItems((prev) => prev.map((n) => {
        if (n.poll?.id === pollId && n.poll.options) {
          return {
            ...n,
            poll: {
              ...n.poll,
              options: n.poll.options.map((opt) => ({
                ...opt,
                has_voted: optionIds.includes(opt.id),
                vote_count: optionIds.includes(opt.id) ? opt.vote_count + 1 : opt.vote_count,
              })),
            },
          };
        }
        return n;
      }));
    } catch (e) { console.warn('Failed to vote:', e); }
  };

  const handleMarkAllRead = async () => {
    try {
      await notificationApi.markAllRead();
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch (e) { console.warn('Failed to mark all read:', e); }
  };

  if (loading) return <View style={[s.center, { paddingTop: insets.top }]}><ActivityIndicator size="large" color={colors.primary} /></View>;

  return (
    <ScrollView style={[s.container, { paddingTop: insets.top + 8 }]} contentContainerStyle={{ paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={colors.textSecondary} />}>
      <View style={s.header}>
        <Text style={s.title}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity style={s.markAllBtn} onPress={handleMarkAllRead}>
            <Ionicons name="checkmark-done-outline" size={16} color={colors.primary} />
            <Text style={s.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {items.length === 0 ? (
        <EmptyState
          icon="notifications-outline"
          title="You're all caught up"
          hint="Announcements and updates from your organisation land here."
        />
      ) : (
        items.map((n) => (
          <TouchableOpacity key={n.id} style={[s.card, !n.is_read && s.unreadCard]} onPress={() => !n.is_read && handleMarkRead(n.id)} activeOpacity={n.is_read ? 1 : 0.7}>
            <View style={s.cardContent}>
              <View style={s.cardHeader}>
                <Text style={[s.cardTitle, !n.is_read && s.unreadTitle]}>{n.title}</Text>
                {n.type === 'announcement' && <View style={s.announcementBadge}><Text style={s.announcementBadgeText}>ANNOUNCEMENT</Text></View>}
                {n.type === 'poll' && <View style={s.pollBadge}><Text style={s.pollBadgeText}>POLL</Text></View>}
              </View>
              {n.type !== 'poll' && <Text style={s.cardMsg} numberOfLines={2}>{n.message}</Text>}
              {n.type === 'poll' && n.poll && (
                <View style={s.pollOptionsContainer}>
                  {n.poll.options?.map((opt) => (
                    <TouchableOpacity
                      key={opt.id}
                      style={[s.pollOption, opt.has_voted && s.pollOptionVoted]}
                      onPress={() => handleVote(n.poll!.id, n.poll!.is_multiple_choice ? [opt.id] : [opt.id])}
                    >
                      <Text style={[s.pollOptionText, opt.has_voted && s.pollOptionTextVoted]}>{opt.option_text}</Text>
                      {opt.vote_count > 0 && <Text style={s.pollVoteCount}>{opt.vote_count}</Text>}
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <Text style={s.cardTime}>{n.created_at}</Text>
            </View>
            {!n.is_read && <View style={[s.dot, { backgroundColor: colors.primary }]} />}
          </TouchableOpacity>
        ))
      )}
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  title: { fontSize: 24, fontWeight: '700', color: c.text },
  markAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  markAllText: { fontSize: 13, color: c.primary, fontWeight: '600' },
  empty: { color: c.textTertiary, fontSize: 14 },
  card: { backgroundColor: c.card, borderRadius: 10, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  unreadCard: { borderLeftWidth: 3, borderLeftColor: c.primary },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  cardContent: { flex: 1 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: c.text, flex: 1 },
  unreadTitle: { fontWeight: '700' },
  announcementBadge: { backgroundColor: c.primaryLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  announcementBadgeText: { fontSize: 9, fontWeight: '700', color: c.primary },
  pollBadge: { backgroundColor: c.primaryLight, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  pollBadgeText: { fontSize: 9, fontWeight: '700', color: c.primary },
  cardMsg: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
  cardTime: { fontSize: 11, color: c.textTertiary, marginTop: 6 },
  pollOptionsContainer: { marginTop: 8, gap: 6 },
  pollOption: { backgroundColor: c.card, borderWidth: 1, borderColor: c.border, borderRadius: 6, padding: 10, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pollOptionVoted: { backgroundColor: c.primaryLight, borderColor: c.primary },
  pollOptionText: { fontSize: 13, color: c.text, flex: 1 },
  pollOptionTextVoted: { color: c.primary, fontWeight: '600' },
  pollVoteCount: { fontSize: 12, color: c.textSecondary, marginLeft: 8 },
});
