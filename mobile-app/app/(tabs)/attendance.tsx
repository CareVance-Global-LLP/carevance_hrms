import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  AppState, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../src/hooks/useTheme';
import { useToast } from '../../src/components/Toast';
import { haptics } from '../../src/lib/haptics';
import { formatClock, formatShort, spokenDuration } from '../../src/lib/duration';
import { usePunchSync } from '../../src/hooks/usePunchSync';
import { formatDistance, haversineMeters, isAccuracyPoor } from '../../src/lib/geo';
import type { ThemeColors } from '../../src/constants/theme';
import { dashboardApi, geofenceApi, selfieApi, holidayApi } from '../../src/api/endpoints';
import type { GeoPosition, EmployeeDashboard, GeofenceZone, Holiday } from '../../src/types';

export default function AttendanceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const toast = useToast();

  /*
   * Punches are written to storage before they are sent, so a dead network,
   * a killed app or a crash cannot lose one. A rejection is the only outcome
   * the user must be told about: it is the only case where the punch is gone
   * and will not be retried.
   */
  const { pending, syncing, punch } = usePunchSync(
    (message) => { haptics.error(); toast.error(message); },
    () => { void fetchAll(); },
  );
  const s = useMemo(() => styles(colors), [colors]);
  const [dashboard, setDashboard] = useState<EmployeeDashboard | null>(null);
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [zone, setZone] = useState<GeofenceZone | null>(null);
  const [inZone, setInZone] = useState<boolean | null>(null);
  const [distance, setDistance] = useState<number | null>(null);
  const [selfieToday, setSelfieToday] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [locError, setLocError] = useState<string | null>(null);
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [holidayMonth, setHolidayMonth] = useState(() => {
    const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  const appState = useRef(AppState.currentState);

  /*
   * Whether this person is CLOCKED IN — which is what the phone controls now.
   *
   * `active_timer` is deliberately not used for this. The timer belongs to the
   * desktop tracker, and on a phone it was always either absent or about to be
   * killed by the idle sweep. Reading it here made the screen say "Timer
   * Stopped" to somebody who was very much at work.
   */
  const isCheckedIn = !!dashboard?.attendance_today?.is_checked_in;

  const fetchAll = useCallback(async () => {
    try {
      const [sumRes, holRes] = await Promise.all([
        dashboardApi.summary(),
        holidayApi.list().catch(() => null),
      ]);
      setDashboard(sumRes.data);
      if (sumRes.data.geofence_zone) {
        setZone(sumRes.data.geofence_zone);
      }
      if (holRes?.data?.data) setHolidays(holRes.data.data);
    } catch { /* ignore */ }
  }, []);

  const checkSelfieToday = useCallback(async () => {
    try {
      const res = await selfieApi.checkToday();
      setSelfieToday(res.data.uploaded);
    } catch {
      setSelfieToday(false);
    }
  }, []);

  const verifyPosition = useCallback((pos: GeoPosition) => {
    if (!zone) return;
    const dist = haversineMeters(pos.latitude, pos.longitude, zone.latitude, zone.longitude);
    setDistance(Math.round(dist));
    setInZone(dist <= zone.radius_meters);
  }, [zone]);

  const getLocation = useCallback(async () => {
    setLocating(true);
    setLocError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocError('Location permission denied');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({
        // No `timeout` here: expo-location has no such option, so passing one
        // was silently dropped and the call had no bound at all despite
        // appearing to have a 10-second one.
        accuracy: Location.Accuracy.Balanced,
      });
      const pos: GeoPosition = {
        latitude: loc.coords.latitude,
        longitude: loc.coords.longitude,
        accuracy: loc.coords.accuracy ?? 0,
      };
      setPosition(pos);
      verifyPosition(pos);
    } catch (e: any) {
      setLocError(e?.message || 'Failed to get location');
      setInZone(false);
    } finally {
      setLocating(false);
    }
  }, [verifyPosition]);

  useEffect(() => {
    fetchAll();
    checkSelfieToday();
    getLocation();
    setLoading(false);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appState.current.match(/inactive|background/) && nextState === 'active') {
        fetchAll();
        getLocation();
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [fetchAll, getLocation]);

  useEffect(() => {
    if (position && zone) {
      verifyPosition(position);
    }
  }, [zone]);

  useEffect(() => {
    if (isCheckedIn && dashboard?.attendance_today?.check_in_at) {
      const start = new Date(dashboard.active_timer.start_time).getTime();
      const elapsed = Math.floor((Date.now() - start) / 1000);
      setTimerSeconds(Math.max(0, elapsed));
      const interval = setInterval(() => setTimerSeconds((s) => s + 1), 1000);
      return () => clearInterval(interval);
    } else {
      setTimerSeconds(0);
    }
  }, [isCheckedIn, dashboard?.attendance_today?.check_in_at]);

  /*
   * Punching in marks ATTENDANCE, not a timer.
   *
   * This used to call timeEntryApi.start(), which started a work timer. A phone
   * emits no keyboard or mouse activity, so `timers:close-idle` found the timer
   * maximally idle and closed it after five minutes with duration 0 — taking
   * the attendance punch with it. Somebody on site all day who never opened a
   * laptop recorded a full day's absence.
   *
   * The timer belongs to the desktop tracker, which can actually observe
   * whether work is happening. This says "I am here", which is the only thing a
   * phone can honestly report.
   */
  const handleCheckIn = async () => {
    // A refusal the user can act on buzzes differently from a failure, so the
    // difference is felt before the message is read.
    if (!position) { haptics.warning(); toast.error('Location not available'); return; }
    if (inZone !== true) { haptics.warning(); toast.error('You must be within the geofence zone to check in'); return; }
    if (!selfieToday) {
      haptics.tap();
      router.push({ pathname: '/attendance/selfie', params: { latitude: String(position.latitude), longitude: String(position.longitude), accuracy: String(position.accuracy) } });
      return;
    }
    haptics.press();
    setActionLoading(true);
    try {
      await punch('in', position);
      haptics.success();
      // Recorded either way — the punch carries its own timestamp, so a late
      // sync still lands at the minute the person actually arrived.
      toast.success('Checked in');
      await fetchAll();
    } finally {
      setActionLoading(false);
    }
  };

  const handleCheckOut = async () => {
    if (!position) { haptics.warning(); toast.error('Location not available'); return; }
    haptics.press();
    setActionLoading(true);
    try {
      await punch('out', position);
      haptics.success();
      toast.success('Checked out');
      await fetchAll();
    } finally {
      setActionLoading(false);
    }
  };

  const handleSelfie = () => {
    if (!position) { haptics.warning(); toast.error('Location not available'); return; }
    haptics.tap();
    router.push({ pathname: '/attendance/selfie', params: { latitude: String(position.latitude), longitude: String(position.longitude), accuracy: String(position.accuracy) } });
  };

  const canStart = inZone === true && (selfieToday || !position);

  const onRefresh = () => { setRefreshing(true); Promise.all([fetchAll(), checkSelfieToday(), getLocation()]).finally(() => setRefreshing(false)); };

  return (
    <ScrollView
      style={[s.container, { paddingTop: insets.top + 8 }]}
      contentContainerStyle={{ paddingBottom: 110 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.textSecondary} />}
    >
      <Text style={s.title}>Time Tracker</Text>

      <View style={s.zoneCard}>
        <View style={s.zoneHeader}>
          <Text style={s.zoneTitle}>Geofence Zone</Text>
          <TouchableOpacity onPress={getLocation} disabled={locating} style={s.refreshBtn}>
            <Text style={s.linkText}>{locating ? 'Locating...' : '↻ Refresh'}</Text>
          </TouchableOpacity>
        </View>
        {zone ? (
          <Text style={s.zoneName}>
            "{zone.name}" — center: {zone.latitude.toFixed(5)}, {zone.longitude.toFixed(5)} • radius: {zone.radius_meters}m
          </Text>
        ) : (
          <Text style={s.zoneName}>No geofence zone configured for your organization</Text>
        )}

        {locError && (
          <Text style={[s.zoneStatus, { color: colors.danger }]}>⚠ {locError}</Text>
        )}

        {inZone === null ? (
          locating ? (
            <ActivityIndicator size="small" color={colors.primary} style={{ marginTop: 8 }} />
          ) : (
            <Text style={s.zoneStatus}>Checking location...</Text>
          )
        ) : inZone ? (
          <Text style={[s.zoneStatus, { color: colors.success, fontWeight: '700' }]}>
            <Ionicons name="checkmark-circle" size={14} /> You're at {zone?.name || 'your work location'}
          </Text>
        ) : (
          <>
            <Text style={[s.zoneStatus, { color: colors.danger, fontWeight: '700' }]}>
              <Ionicons name="alert-circle" size={14} /> Too far to check in
            </Text>
            {distance !== null && zone && (
              // "Distance from center: 320m (max allowed: 100m)" described the
              // geometry. This says how far to walk, which is the only thing
              // the person can act on.
              <Text style={s.zoneDebug}>
                You're {formatDistance(distance)} away. Move within {formatDistance(zone.radius_meters)} of {zone.name} to check in.
              </Text>
            )}
          </>
        )}

        {/*
          Coordinates to six decimal places were developer output. The one
          genuinely useful signal is a fix too vague to trust — it explains why
          the zone check can disagree with where somebody is plainly standing.
        */}
        {position && isAccuracyPoor(position.accuracy) && (
          <Text style={s.coordsText}>
            Weak GPS signal (±{Math.round(position.accuracy)} m). Step outside or near a window for a better fix.
          </Text>
        )}
      </View>

      {zone && inZone === true && !selfieToday && !isCheckedIn && (
        <View style={s.selfiePrompt}>
          <Text style={s.selfiePromptText}>
            <Ionicons name="camera-outline" size={14} /> Take your daily selfie before checking in
          </Text>
          <TouchableOpacity style={s.selfieBtn} onPress={handleSelfie}>
            <Text style={s.selfieBtnText}>Take Selfie</Text>
          </TouchableOpacity>
        </View>
      )}

      {pending.length > 0 && (
        <View
          style={s.pendingSync}
          accessibilityRole="alert"
          accessibilityLabel={
            pending.length + ' punch' + (pending.length > 1 ? 'es' : '') +
            ' saved on this phone, waiting to reach the server'
          }
        >
          {syncing
            ? <ActivityIndicator size="small" color={colors.warning} />
            : <Ionicons name="cloud-offline-outline" size={16} color={colors.warning} />}
          {/*
            Says "saved", not "failed". The punch is recorded with its real
            time and will sync itself — telling somebody their attendance
            failed when it did not is how you get a duplicate punch.
          */}
          <Text style={s.pendingSyncText}>
            {pending.length} punch{pending.length > 1 ? 'es' : ''} saved — syncing when you're back online
          </Text>
        </View>
      )}

      <View style={s.timerCard}>
        {loading ? (
          <ActivityIndicator size="large" color={colors.primary} />
        ) : (
          <>
            <Text style={s.timerLabel}>{isCheckedIn ? 'Checked In' : 'Not Checked In'}</Text>
            <Text
              style={s.timerDisplay}
              // "07:32:10" is read out as "zero seven colon three two colon one
              // zero". The spoken form drops seconds so VoiceOver is not
              // re-announcing the figure every tick.
              accessibilityLabel={`${isCheckedIn ? 'Present for' : 'Today'} ${spokenDuration(timerSeconds)}`}
            >
              {formatClock(timerSeconds)}
            </Text>
            {isCheckedIn ? (
              <>
                {dashboard?.attendance_today?.check_in_at && (
                  <Text style={s.timerSub}>
                    Since {new Date(dashboard.attendance_today.check_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                )}
                {/*
                  Desk time is shown separately and only when there is some. It
                  comes from the desktop tracker, so on a phone-only day it is
                  zero — which is correct, not a fault, and saying "0h 00m
                  tracked" unprompted invites somebody to read it as slacking.
                */}
                {typeof dashboard?.today_work_time === 'number' && dashboard.today_work_time > 0 && (
                  <Text
                    style={s.timerSub}
                    // Compact here: this is a supporting line, and a full
                    // HH:MM:SS beside the headline figure reads as a second
                    // clock competing with it.
                    accessibilityLabel={`${spokenDuration(dashboard.today_work_time)} tracked at a desk`}
                  >
                    {formatShort(dashboard.today_work_time)} tracked at a desk
                  </Text>
                )}
                <TouchableOpacity
                  style={[s.mainBtn, s.stopBtn]}
                  onPress={handleCheckOut}
                  disabled={actionLoading}
                  accessibilityRole="button"
                  accessibilityLabel="Check out"
                  accessibilityHint="Ends your attendance for today"
                  accessibilityState={{ disabled: actionLoading, busy: actionLoading }}
                >
                  {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.mainBtnText}>Check Out</Text>}
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.timerSub}>Check in to mark yourself present</Text>
                <TouchableOpacity
                  style={[s.mainBtn, (!canStart || !zone || inZone !== true) && s.mainBtnDisabled]}
                  accessibilityRole="button"
                  accessibilityLabel="Check in"
                  // The button dims when blocked but the reason is only in the
                  // hint text below it, which a screen reader reaches last.
                  accessibilityHint={
                    inZone === false
                      ? 'Unavailable. Move inside the geofence zone first'
                      : !selfieToday
                        ? 'Unavailable. Take your daily selfie first'
                        : 'Marks you present for today'
                  }
                  accessibilityState={{ disabled: !canStart || actionLoading, busy: actionLoading }}
                  onPress={handleCheckIn}
                  disabled={!canStart || actionLoading}
                >
                  {actionLoading ? <ActivityIndicator color="#fff" /> : <Text style={s.mainBtnText}>Check In</Text>}
                </TouchableOpacity>
                {!selfieToday && inZone === true && <Text style={s.hintText}>Take a selfie first to check in</Text>}
                {inZone === false && <Text style={s.hintText}>Move inside the geofence zone</Text>}
              </>
            )}
          </>
        )}
      </View>

      <View style={s.attCard}>
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
            <View style={s.attRow}>
              <Text style={s.attLabel}>Status</Text>
              <Text style={[s.attValue, { color: dashboard.attendance_today.is_checked_in ? colors.success : colors.textTertiary }]}>
                {dashboard.attendance_today.is_checked_in ? 'Present' : 'Not checked in'}
              </Text>
            </View>
          </>
        ) : (
          <Text style={{ color: colors.textTertiary }}>No data</Text>
        )}
      </View>

      <View style={s.holidayCard}>
        <View style={s.holidayNav}>
          <TouchableOpacity onPress={() => {
            const d = new Date(holidayMonth + '-01');
            d.setMonth(d.getMonth() - 1);
            const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            setHolidayMonth(m);
            holidayApi.list(m).then((r) => setHolidays(r.data.data)).catch(() => {});
          }} style={s.navBtn}>
            <Ionicons name="chevron-back" size={18} color={colors.primary} />
          </TouchableOpacity>
          <Text style={s.holidayNavMonth}>
            {new Date(holidayMonth + '-01').toLocaleDateString('en', { month: 'long', year: 'numeric' })}
          </Text>
          <TouchableOpacity onPress={() => {
            const d = new Date(holidayMonth + '-01');
            d.setMonth(d.getMonth() + 1);
            const m = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            setHolidayMonth(m);
            holidayApi.list(m).then((r) => setHolidays(r.data.data)).catch(() => {});
          }} style={s.navBtn}>
            <Ionicons name="chevron-forward" size={18} color={colors.primary} />
          </TouchableOpacity>
        </View>
        {holidays.length === 0 ? (
          <Text style={{ color: colors.textTertiary, fontSize: 13, textAlign: 'center', marginVertical: 8 }}>
            No holidays this month
          </Text>
        ) : (
          <>
            {renderCalendar(holidays, holidayMonth, colors, s)}
            <View style={s.holidayDivider} />
            {holidays.map((h) => (
              <View key={h.id} style={s.holidayRow}>
                <View style={s.holidayDot} />
                <View style={{ flex: 1 }}>
                  <Text style={s.holidayTitle}>{h.title}</Text>
                  <Text style={s.holidayDate}>{h.holiday_date}</Text>
                </View>
                {h.details && <Text style={s.holidayDetails} numberOfLines={1}>{h.details}</Text>}
              </View>
            ))}
          </>
        )}
      </View>
    </ScrollView>
  );
}

function renderCalendar(holidays: Holiday[], month: string, colors: ThemeColors, s: any) {
  const [yearStr, monthStr] = month.split('-');
  const year = parseInt(yearStr);
  const monthNum = parseInt(monthStr) - 1;
  const firstDay = new Date(year, monthNum, 1).getDay();
  const daysInMonth = new Date(year, monthNum + 1, 0).getDate();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const holidayDates = new Set(holidays.map((h) => h.holiday_date));
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  const monthName = new Date(year, monthNum).toLocaleDateString('en', { month: 'long', year: 'numeric' });

  return (
    <View style={s.calendar}>
      <Text style={s.calMonthName}>{monthName}</Text>
      <View style={s.calDayHeaders}>
        {dayNames.map((d) => <Text key={d} style={s.calDayHeader}>{d}</Text>)}
      </View>
      <View style={s.calGrid}>
        {Array.from({ length: firstDay }, (_, i) => <View key={`e-${i}`} style={s.calDay} />)}
        {Array.from({ length: daysInMonth }, (_, i) => {
          const day = i + 1;
          const dateStr = `${yearStr}-${String(monthNum + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const isHoliday = holidayDates.has(dateStr);
          const isToday = dateStr === today;
          return (
            <View key={day} style={[s.calDay, isHoliday && s.calDayHoliday, isToday && s.calDayToday]}>
              <Text style={[s.calDayText, isHoliday && s.calDayTextHoliday, isToday && s.calDayTextToday]}>{day}</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = (c: ThemeColors) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.background, paddingHorizontal: 20 },
  title: { fontSize: 24, fontWeight: '700', color: c.text, marginBottom: 20 },
  zoneCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  zoneHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  zoneTitle: { fontSize: 14, fontWeight: '600', color: c.text },
  refreshBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  linkText: { color: c.primary, fontSize: 13, fontWeight: '600' },
  zoneName: { fontSize: 11, color: c.textTertiary, marginBottom: 6 },
  zoneStatus: { fontSize: 14, marginTop: 4, color: c.textSecondary },
  zoneDebug: { fontSize: 13, color: c.text, marginTop: 2, fontWeight: '600' },
  coordsText: { fontSize: 10, color: c.textTertiary, marginTop: 2 },
  selfiePrompt: { backgroundColor: c.warning + '20', borderRadius: 10, padding: 14, marginBottom: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selfiePromptText: { fontSize: 13, fontWeight: '500', color: c.text, flex: 1 },
  selfieBtn: { backgroundColor: c.primary, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 16, marginLeft: 12 },
  selfieBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  timerCard: { backgroundColor: c.card, borderRadius: 16, padding: 28, alignItems: 'center', marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10, elevation: 3 },
  timerLabel: { fontSize: 14, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  timerDisplay: { fontSize: 52, fontWeight: '700', color: c.text, fontVariant: ['tabular-nums'] as const, marginBottom: 8 },
  timerSub: { fontSize: 13, color: c.textTertiary, marginBottom: 24 },
  mainBtn: { backgroundColor: c.primary, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 60, alignItems: 'center', minWidth: 200 },
  mainBtnDisabled: { opacity: 0.4 },
  pendingSync: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: c.warning + '18', borderRadius: 10,
    paddingVertical: 10, paddingHorizontal: 12, marginBottom: 10,
  },
  pendingSyncText: { flex: 1, color: c.warning, fontSize: 12, fontWeight: '600' },
  stopBtn: { backgroundColor: c.danger },
  mainBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  hintText: { color: c.textTertiary, fontSize: 12, marginTop: 8 },
  attCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: c.text },
  holidayNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  holidayNavMonth: { fontSize: 16, fontWeight: '700', color: c.text },
  navBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  attRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: c.border },
  attLabel: { fontSize: 14, color: c.textSecondary },
  attValue: { fontSize: 14, fontWeight: '600', color: c.text },
  holidayCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginTop: 12, shadowColor: '#000', shadowOpacity: 0.03, shadowRadius: 6, elevation: 1 },
  calendar: { marginBottom: 12 },
  calMonthName: { fontSize: 15, fontWeight: '700', color: c.text, textAlign: 'center', marginBottom: 8 },
  calDayHeaders: { flexDirection: 'row' },
  calDayHeader: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600', color: c.textSecondary, paddingVertical: 4 },
  calGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  calDay: { width: '14.28%', aspectRatio: 1, justifyContent: 'center', alignItems: 'center' },
  calDayHoliday: { backgroundColor: c.primaryLight, borderRadius: 8 },
  calDayToday: { borderWidth: 1.5, borderColor: c.primary, borderRadius: 8 },
  calDayText: { fontSize: 13, color: c.text, fontWeight: '500' },
  calDayTextHoliday: { color: c.primary, fontWeight: '700' },
  calDayTextToday: { color: c.primary, fontWeight: '700' },
  holidayDivider: { height: 1, backgroundColor: c.border, marginVertical: 8 },
  holidayRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  holidayDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.warning },
  holidayTitle: { fontSize: 14, fontWeight: '600', color: c.text },
  holidayDate: { fontSize: 12, color: c.textSecondary },
  holidayDetails: { fontSize: 12, color: c.textTertiary, maxWidth: '30%' },
});
