import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { isManager } from '../../src/hooks/usePermissions';
import type { ThemeColors } from '../../src/constants/theme';
import { dashboardApi, geofenceApi, notificationApi, orgApi, approvalApi } from '../../src/api/endpoints';
import type { EmployeeDashboard, GeoPosition, GeofenceZone, AppNotification, OrgMember } from '../../src/types';
import NotificationBanner from '../../src/components/NotificationBanner';

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const quickActions = [
  { route: '/(tabs)/attendance', icon: 'time-outline', label: 'Timer', color: '#2563eb' },
  { route: '/leave/apply', icon: 'calendar-outline', label: 'Apply Leave', color: '#f59e0b' },
  { route: '/(tabs)/more', icon: 'wallet-outline', label: 'Payslips', color: '#10b981' },
] as const;

export default function DashboardScreen() {
  const { user, logout } = useAuth();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [dashboard, setDashboard] = useState<EmployeeDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [zone, setZone] = useState<GeofenceZone | null>(null);
  const [inZone, setInZone] = useState<boolean | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const appState = useRef(AppState.currentState);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [announcements, setAnnouncements] = useState<AppNotification[]>([]);
  const [todayBirthdays, setTodayBirthdays] = useState<OrgMember[]>([]);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState<OrgMember[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  const [banner, setBanner] = useState<{ title: string; message?: string; route: string; key: number } | null>(null);
  const prevAnnouncementIds = useRef<Set<number>>(new Set());
  const isManager = isManager(user);

  const s = useMemo(() => styles(colors), [colors]);

  const verifyPosition = useCallback((pos: GeoPosition, z: GeofenceZone) => {
    const dist = haversineMeters(pos.latitude, pos.longitude, z.latitude, z.longitude);
    setDistance(Math.round(dist));
    setInZone(dist <= z.radius_meters);
  }, []);

  const getBirthDate = (m: OrgMember): string | null => {
    return m.date_of_birth || m.employee_profile?.date_of_birth || null;
  };

  const fetchData = useCallback(async () => {
    try {
      const [sumRes, notifRes, teamRes] = await Promise.all([
        dashboardApi.summary(),
        notificationApi.list().catch(() => null),
        orgApi.members().catch(() => null),
      ]);
      setDashboard(sumRes.data);
      if (sumRes.data.geofence_zone) {
        setZone(sumRes.data.geofence_zone);
        if (position) verifyPosition(position, sumRes.data.geofence_zone);
      }
      if (notifRes?.data?.data) {
        const newAnnouncements = notifRes.data.data.filter((n: AppNotification) => n.type === 'announcement').slice(0, 3);
        const newIds = new Set(newAnnouncements.map((n: AppNotification) => n.id));
        if (prevAnnouncementIds.current.size > 0) {
        const added = newAnnouncements.find((n: AppNotification) => !prevAnnouncementIds.current.has(n.id));
        if (added && prevAnnouncementIds.current.size > 0) {
          setBanner({ title: added.title, message: added.message, route: '/notifications', key: Date.now() });
        }
        }
        prevAnnouncementIds.current = newIds;
        setAnnouncements(newAnnouncements);
      }
      if (isManager) {
        Promise.all([
          approvalApi.pendingLeaves().catch(() => null),
          approvalApi.pendingTimeEdits().catch(() => null),
        ]).then(([l, t]) => {
          const leaves = l?.data?.data?.length || 0;
          const edits = t?.data?.data?.length || 0;
          setPendingCount(leaves + edits);
        });
      }
      if (teamRes?.data) {
        const now = new Date();
        const today = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const members = teamRes.data;
        const todayIds = new Set<number>();
        const todayBdays = members.filter((m: OrgMember) => {
          const dob = getBirthDate(m);
          const match = dob && dob.substring(5) === today;
          if (match && m.id) todayIds.add(m.id);
          return match;
        });
        const upcoming: OrgMember[] = [];
        for (let i = 1; i <= 7; i++) {
          const d = new Date(now); d.setDate(d.getDate() + i);
          const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
          const match = members.find((m: OrgMember) => {
            const dob = getBirthDate(m);
            return dob && dob.substring(5) === md && m.id && !todayIds.has(m.id) && !upcoming.find((u) => u.id === m.id);
          });
          if (match) upcoming.push(match);
        }
        setTodayBirthdays(todayBdays);
        setUpcomingBirthdays(upcoming.slice(0, 5));
      }
    } catch (e) { console.warn('Dashboard fetch failed:', e); } finally { setLoading(false); setRefreshing(false); }
  }, [position, verifyPosition]);

  const getLocation = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced, timeout: 8000 });
    const pos: GeoPosition = { latitude: loc.coords.latitude, longitude: loc.coords.longitude, accuracy: loc.coords.accuracy ?? 0 };
    setPosition(pos);
    if (zone) verifyPosition(pos, zone);
  };

  useEffect(() => { fetchData(); getLocation(); }, []);
  useEffect(() => {
    const poll = setInterval(fetchData, 30000);
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') { fetchData(); getLocation(); }
      appState.current = nextState;
    });
    return () => { clearInterval(poll); sub.remove(); };
  }, [fetchData]);
  useEffect(() => { if (position && zone) verifyPosition(position, zone); }, [zone]);
  useEffect(() => {
    if (dashboard?.active_timer) {
      const start = new Date(dashboard.active_timer.start_time).getTime();
      setTimerSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
      const interval = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
      return () => clearInterval(interval);
    } else setTimerSeconds(0);
  }, [dashboard?.active_timer]);

  const formatTimer = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const isTiming = !!dashboard?.active_timer;

  return (
    <ScrollView
      style={[s.container, { paddingTop: insets.top + 8 }]}
      contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); getLocation(); }} tintColor={colors.textSecondary} />}
    >
      <View style={s.header}>
        <View>
          <Text style={s.greeting}>Hello, {user?.name?.split(' ')[0] || 'Employee'}</Text>
          <Text style={s.role}>{user?.employee_profile?.designation || user?.designation || ''}</Text>
        </View>
        <TouchableOpacity onPress={logout} style={s.logoutBtn}>
          <Text style={s.logoutText}>Logout</Text>
        </TouchableOpacity>
      </View>

      {banner && (
        <NotificationBanner
          key={banner.key}
          title={banner.title}
          message={banner.message}
          icon="megaphone"
          onPress={() => { setBanner(null); router.push(banner.route); }}
          onDismiss={() => setBanner(null)}
        />
      )}

      <View style={[s.timerCard, { borderColor: isTiming ? colors.success : colors.border }]}> 
        <Text style={s.timerLabel}>{isTiming ? 'Tracking active' : 'Timer stopped'}</Text>
        <Text style={s.timerDisplay}>{formatTimer(timerSeconds)}</Text>
        {isTiming && dashboard?.active_timer?.start_time && (
          <Text style={s.timerStarted}>
            Started at {new Date(dashboard.active_timer.start_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}
      </View>

      {isManager && pendingCount !== null && pendingCount > 0 && (
        <TouchableOpacity style={s.pendingCard} onPress={() => router.push('/approval-inbox')}>
          <View style={s.pendingRow}>
            <Ionicons name="checkmark-done-outline" size={18} color="#fff" />
            <Text style={s.pendingText}>{pendingCount} pending approval{pendingCount > 1 ? 's' : ''}</Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color="#fff" />
        </TouchableOpacity>
      )}

      <View style={s.quickAccessRow}>
        {quickActions.map((a) => (
          <TouchableOpacity key={a.label} style={s.quickAction} onPress={() => router.push(a.route)}>
            <View style={[s.quickIconWrap, { backgroundColor: a.color + '18' }]}>
              <Ionicons name={a.icon} size={22} color={a.color} />
            </View>
            <Text style={s.quickLabel}>{a.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {inZone !== null && zone && (
        <TouchableOpacity onPress={getLocation} style={{ marginBottom: 12 }}>
          <View style={[s.zoneBadge, inZone ? s.zoneOk : s.zoneNo]}>
            <Text style={[s.zoneText, { color: inZone ? '#065f46' : '#991b1b' }]}>
              <Ionicons name={inZone ? 'checkmark-circle' : 'alert-circle'} size={14} /> {inZone ? 'Within geofence' : 'Outside geofence'}
            </Text>
            {distance !== null && (
              <Text style={[s.zoneSubText, { color: inZone ? '#065f46' : '#991b1b' }]}>
                {distance}m from "{zone.name}" center
              </Text>
            )}
          </View>
        </TouchableOpacity>
      )}

      <View style={s.attendanceCard}>
        <Text style={s.sectionTitle}>Today's Attendance</Text>
        {dashboard?.attendance_today ? (
          <>
            <View style={s.attRow}>
              <Text style={s.attLabel}>Check in</Text>
              <Text style={s.attValue}>
                {dashboard.attendance_today.check_in_at
                  ? new Date(dashboard.attendance_today.check_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '--'}
              </Text>
            </View>
            <View style={s.attRow}>
              <Text style={s.attLabel}>Check out</Text>
              <Text style={s.attValue}>
                {dashboard.attendance_today.check_out_at
                  ? new Date(dashboard.attendance_today.check_out_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                  : '--'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={{ color: colors.textTertiary }}>No attendance data</Text>
        )}
      </View>

      {(announcements.length > 0 || todayBirthdays.length > 0 || upcomingBirthdays.length > 0) && (
        <View style={s.updatesCard}>
          <View style={s.updatesHeader}>
            <Ionicons name="notifications-outline" size={18} color={colors.text} />
            <Text style={s.updatesTitle}>Updates</Text>
          </View>

          {announcements.length > 0 && (
            <>
              <View style={s.subHeader}>
                <Ionicons name="megaphone-outline" size={14} color={colors.warning} />
                <Text style={s.subHeaderText}>Announcements</Text>
              </View>
              {announcements.map((a) => (
                <TouchableOpacity key={a.id} style={s.updatesRow} onPress={() => router.push('/notifications')}>
                  <View style={s.updatesDot} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.updatesItemTitle}>{a.title}</Text>
                    <Text style={s.updatesItemSub} numberOfLines={1}>{a.message}</Text>
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}

          {todayBirthdays.length > 0 && (
            <>
              <View style={s.subHeader}>
                <Ionicons name="gift-outline" size={14} color={colors.primary} />
                <Text style={s.subHeaderText}>Birthdays</Text>
              </View>
              {todayBirthdays.map((m) => (
                <View key={m.id} style={s.updatesRow}>
                  <View style={[s.updateAvatar, { backgroundColor: colors.primary }]}>
                    <Text style={s.updateAvatarText}>{m.name?.charAt(0)?.toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={s.updatesItemTitle}>{m.name}</Text>
                    <Text style={s.updatesItemSub}>Birthday today!</Text>
                  </View>
                  <TouchableOpacity style={s.wishBtn}><Text style={s.wishBtnText}>Wish</Text></TouchableOpacity>
                </View>
              ))}
              {upcomingBirthdays.map((m) => {
                const dob = getBirthDate(m);
                const date = dob ? new Date(dob + 'T00:00:00') : null;
                const label = date ? date.toLocaleDateString('en', { month: 'short', day: 'numeric' }) : '';
                return (
                  <View key={m.id} style={s.updatesRow}>
                    <View style={[s.updateAvatar, { backgroundColor: colors.success + '30' }]}>
                      <Text style={[s.updateAvatarText, { color: colors.success }]}>{m.name?.charAt(0)?.toUpperCase()}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.updatesItemTitle}>{m.name}</Text>
                      <Text style={s.updatesItemSub}>Upcoming — {label}</Text>
                    </View>
                  </View>
                );
              })}
            </>
          )}
        </View>
      )}

      <View style={s.summaryGrid}>
        <View style={s.summaryItem}>
          <Text style={s.summaryValue}>{dashboard?.monthly_total_hours || '0:00:00'}</Text>
          <Text style={s.summaryLabel}>Hours this month</Text>
        </View>
        <View style={s.summaryItem}>
          <Text style={s.summaryValue}>{dashboard?.monthly_days || 0}</Text>
          <Text style={s.summaryLabel}>Days this month</Text>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = (c: ThemeColors) => ({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  greeting: { fontSize: 22, fontWeight: '700', color: c.text },
  role: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  logoutBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  logoutText: { color: c.danger, fontWeight: '600', fontSize: 14 },
  timerCard: {
    backgroundColor: c.card, borderRadius: 16, borderWidth: 2, padding: 24, alignItems: 'center', marginBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  timerLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  timerDisplay: { fontSize: 48, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] as const },
  timerStarted: { fontSize: 12, color: c.textTertiary, marginTop: 4 },
  pendingCard: { backgroundColor: c.danger, borderRadius: 10, padding: 14, marginBottom: 12, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  pendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pendingText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  quickAccessRow: { flexDirection: 'row', gap: 10, marginBottom: 12, marginTop: 12 },
  quickAction: { flex: 1, alignItems: 'center', gap: 6 },
  quickIconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { fontSize: 11, fontWeight: '600', color: c.text, textAlign: 'center' },
  zoneBadge: { borderRadius: 8, padding: 10, alignItems: 'center' },
  zoneOk: { backgroundColor: '#d1fae5' },
  zoneNo: { backgroundColor: '#fee2e2' },
  zoneText: { fontSize: 13, fontWeight: '700' },
  zoneSubText: { fontSize: 11, marginTop: 2 },
  attendanceCard: {
    backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1,
  },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
  attRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: c.border },
  attLabel: { fontSize: 14, color: c.textSecondary },
  attValue: { fontSize: 14, fontWeight: '600', color: c.text },
  updatesCard: {
    backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1,
  },
  updatesHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  updatesTitle: { fontSize: 15, fontWeight: '700', color: c.text },
  subHeader: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 6, marginTop: 4 },
  subHeaderText: { fontSize: 12, fontWeight: '600', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5 },
  updatesRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  updatesDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.warning, marginTop: 0 },
  updatesItemTitle: { fontSize: 14, fontWeight: '600', color: c.text },
  updatesItemSub: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
  updateAvatar: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  updateAvatarText: { fontSize: 14, fontWeight: '700', color: '#fff' },
  wishBtn: { backgroundColor: c.primaryLight, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  wishBtnText: { color: c.primary, fontWeight: '600', fontSize: 12 },
  summaryGrid: { flexDirection: 'row', gap: 12 },
  summaryItem: {
    flex: 1, backgroundColor: c.card, borderRadius: 10, padding: 16,
    shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 4, elevation: 1,
  },
  summaryValue: { fontSize: 22, fontWeight: '700', color: c.primary },
  summaryLabel: { fontSize: 12, color: c.textSecondary, marginTop: 2 },
});
