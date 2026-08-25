import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  AppState, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../src/hooks/useAuth';
import { useTheme } from '../../src/hooks/useTheme';
import { isManager } from '../../src/hooks/usePermissions';
import { formatClock, formatShort, spokenDuration } from '../../src/lib/duration';
import { haversineMeters } from '../../src/lib/geo';
import type { ThemeColors } from '../../src/constants/theme';
import { dashboardApi, geofenceApi, notificationApi, orgApi, approvalApi } from '../../src/api/endpoints';
import type { EmployeeDashboard, GeoPosition, GeofenceZone, AppNotification, OrgMember } from '../../src/types';
import NotificationBanner from '../../src/components/NotificationBanner';

/*
 * `tone` is a theme key rather than a hex, so these follow the brand and invert
 * in dark mode. The first was labelled "Timer" and pointed at the attendance
 * tab — leftover from when punching in started a timer. It marks attendance.
 */
const quickActions = [
  { route: '/(tabs)/attendance', icon: 'today-outline', label: 'Attendance', tone: 'primary' },
  { route: '/leave/apply', icon: 'calendar-outline', label: 'Apply Leave', tone: 'accent' },
  { route: '/(tabs)/more', icon: 'wallet-outline', label: 'Payslips', tone: 'success' },
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
  const [presentSeconds, setPresentSeconds] = useState(0);
  const [announcements, setAnnouncements] = useState<AppNotification[]>([]);
  const [todayBirthdays, setTodayBirthdays] = useState<OrgMember[]>([]);
  const [upcomingBirthdays, setUpcomingBirthdays] = useState<OrgMember[]>([]);
  const [pendingCount, setPendingCount] = useState<number | null>(null);
  // `route` is an Href, not a string: typedRoutes is on, so router.push only
  // accepts a route the app actually declares.
  const [banner, setBanner] = useState<{ title: string; message?: string; route: Href; key: number } | null>(null);
  const prevAnnouncementIds = useRef<Set<number>>(new Set());
  // Renamed: a local `userIsManager` shadowed the imported helper and called it in
  // its own initialiser, which throws a ReferenceError before this screen
  // can render at all.
  const userIsManager = isManager(user);

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
        // Typed explicitly: `newAnnouncements` is any[] after the filter, so
        // map() yields unknown[] and the Set would not match the ref's Set<number>.
        const newIds = new Set<number>(newAnnouncements.map((n: AppNotification) => n.id));
        if (prevAnnouncementIds.current.size > 0) {
        const added = newAnnouncements.find((n: AppNotification) => !prevAnnouncementIds.current.has(n.id));
        if (added && prevAnnouncementIds.current.size > 0) {
          setBanner({ title: added.title, message: added.message, route: '/notifications', key: Date.now() });
        }
        }
        prevAnnouncementIds.current = newIds;
        setAnnouncements(newAnnouncements);
      }
      if (userIsManager) {
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
    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
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
  /*
   * The headline number is PRESENCE, not the timer.
   *
   * Attendance is what payroll, late marking and loss-of-pay are computed from
   * — DayOutcomeService reads AttendanceRecord and never touches time_entries —
   * so the big figure has to be the attendance span. The timer answers a
   * different question, "how much of that was at a monitored computer", and
   * belongs underneath, labelled as such.
   *
   * Leading with the timer is why a phone punch looked like nothing had
   * happened: somebody present and working all day saw "Timer stopped
   * 00:00:00", because a phone cannot start a desktop timer and no longer
   * pretends to.
   */
  useEffect(() => {
    const checkInAt = dashboard?.attendance_today?.check_in_at;
    if (!checkInAt) {
      setPresentSeconds(0);
      return;
    }

    const start = new Date(checkInAt).getTime();
    const checkOutAt = dashboard?.attendance_today?.check_out_at;

    // A finished day is a fixed span. Only an open one ticks.
    if (checkOutAt) {
      setPresentSeconds(Math.max(0, Math.floor((new Date(checkOutAt).getTime() - start) / 1000)));
      return;
    }

    // Recomputed from the clock each tick rather than incremented, so the
    // figure is still right after the app has been backgrounded.
    const tick = () => setPresentSeconds(Math.max(0, Math.floor((Date.now() - start) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [dashboard?.attendance_today?.check_in_at, dashboard?.attendance_today?.check_out_at]);

  const attendanceToday = dashboard?.attendance_today ?? null;
  const isCheckedIn = !!attendanceToday?.is_checked_in;
  const hasAttendance = !!attendanceToday?.check_in_at;
  const isTracking = !!dashboard?.active_timer;
  // Legitimately 0 on a phone-only day — the person worked, just not at a desk.
  const deskSeconds = dashboard?.today_work_time ?? 0;

  const atTime = (iso?: string) =>
    iso ? new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

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

      <View style={[s.timerCard, { borderColor: isCheckedIn ? colors.success : colors.border }]}>
        <Text style={s.timerLabel}>
          {isCheckedIn ? 'Present' : hasAttendance ? 'Checked out' : 'Not checked in'}
        </Text>
        <Text
          style={s.timerDisplay}
          accessibilityLabel={`${isCheckedIn ? 'Present for' : 'Today'} ${spokenDuration(presentSeconds)}`}
        >
          {formatClock(presentSeconds)}
        </Text>
        {hasAttendance && (
          <Text style={s.timerStarted}>
            {attendanceToday?.check_out_at
              ? `${atTime(attendanceToday?.check_in_at)} — ${atTime(attendanceToday?.check_out_at)}`
              : `Since ${atTime(attendanceToday?.check_in_at)}`}
          </Text>
        )}

        <View style={s.deskRow}>
          <Ionicons
            name="desktop-outline"
            size={14}
            color={isTracking ? colors.success : colors.textTertiary}
          />
          <Text style={s.deskLabel}>Tracked at desk</Text>
          <Text
            style={s.deskValue}
            accessibilityLabel={`${spokenDuration(deskSeconds)} tracked at a desk`}
          >
            {formatShort(deskSeconds)}
          </Text>
        </View>
        {/*
          Stated plainly on purpose. The gap between these two numbers is
          meetings, travel and work done away from a computer — a manager
          reading it as idleness is a grievance the wording can prevent.
        */}
        <Text style={s.deskHint}>
          Desk time from the tracker. Attendance above is what payroll uses.
        </Text>
      </View>

      {userIsManager && pendingCount !== null && pendingCount > 0 && (
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
            <View style={[s.quickIconWrap, { backgroundColor: colors[a.tone] + '18' }]}>
              <Ionicons name={a.icon} size={22} color={colors[a.tone]} />
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

const styles = (c: ThemeColors) => StyleSheet.create({
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
  deskRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'stretch',
    marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: c.border,
  },
  deskLabel: { fontSize: 13, color: c.textSecondary, flex: 1 },
  deskValue: { fontSize: 15, fontWeight: '600', color: c.text, fontVariant: ['tabular-nums'] as const },
  deskHint: { fontSize: 11, color: c.textTertiary, marginTop: 6, textAlign: 'center' },
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
