export const ACTIVE_TIMER_KEY = 'active_timer_snapshot';
const AUTO_START_SUPPRESSED_KEY = 'desktop_timer_auto_start_suppressed';
const AUTO_START_ARMED_KEY = 'desktop_timer_auto_start_armed';
const DESKTOP_LAUNCH_AUTO_START_KEY = 'desktop_timer_launch_auto_start_seeded';
const IDLE_AUTO_STOP_NOTICE_KEY = 'desktop_timer_idle_auto_stop_notice';
const WORKED_BASELINE_KEY = 'desktop_timer_worked_baseline';
export const DESKTOP_TIMER_IDLE_STOP_EVENT = 'desktop-timer:idle-auto-stop';
export const DESKTOP_TIMER_STARTED_EVENT = 'desktop-timer:started';
export const DESKTOP_TIMER_STOPPED_EVENT = 'desktop-timer:stopped';

export type DesktopTimerIdleStopDetail = {
  userId: number;
  message: string;
};

export type DesktopTimerSessionDetail = {
  userId: number;
  entryId?: number | null;
};

export const canUseDesktopAutoStart = () =>
  typeof window !== 'undefined' && Boolean(window.desktopTracker);

const getStorageScopedKey = (baseKey: string, userId?: number | null) => `${baseKey}:${userId ?? 'guest'}`;

export const getAutoStartSuppressionKey = (userId?: number | null) =>
  getStorageScopedKey(AUTO_START_SUPPRESSED_KEY, userId);

export const suppressAutoStart = (userId?: number | null) => {
  if (!userId) return;
  sessionStorage.setItem(getAutoStartSuppressionKey(userId), '1');
};

export const clearAutoStartSuppression = (userId?: number | null) => {
  if (!userId) return;
  sessionStorage.removeItem(getAutoStartSuppressionKey(userId));
};

// Global suppression using localStorage (persists across refresh)
const AUTO_START_SUPPRESSED_GLOBAL_KEY = 'desktop_timer_auto_start_suppressed_global';
const getAutoStartSuppressedGlobalKey = (userId?: number | null) =>
  getStorageScopedKey(AUTO_START_SUPPRESSED_GLOBAL_KEY, userId);

export const suppressAutoStartGlobally = (userId?: number | null) => {
  if (!userId) return;
  localStorage.setItem(getAutoStartSuppressedGlobalKey(userId), '1');
};

export const clearAutoStartSuppressionGlobal = (userId?: number | null) => {
  if (!userId) return;
  localStorage.removeItem(getAutoStartSuppressedGlobalKey(userId));
};

export const isAutoStartSuppressedGlobally = (userId?: number | null) => {
  if (!userId) return false;
  return localStorage.getItem(getAutoStartSuppressedGlobalKey(userId)) === '1';
};

export const isAutoStartSuppressed = (userId?: number | null) => {
  if (!userId) return false;
  return sessionStorage.getItem(getAutoStartSuppressionKey(userId)) === '1' || 
         localStorage.getItem(getAutoStartSuppressedGlobalKey(userId)) === '1';
};

const getAutoStartArmedKey = (userId?: number | null) => getStorageScopedKey(AUTO_START_ARMED_KEY, userId);

export const armAutoStart = (userId?: number | null) => {
  if (!userId) return;
  sessionStorage.setItem(getAutoStartArmedKey(userId), '1');
};

export const clearAutoStartArm = (userId?: number | null) => {
  if (!userId) return;
  sessionStorage.removeItem(getAutoStartArmedKey(userId));
};

export const isAutoStartArmed = (userId?: number | null) => {
  if (!userId) return false;
  return sessionStorage.getItem(getAutoStartArmedKey(userId)) === '1';
};

const getDesktopLaunchAutoStartKey = (userId?: number | null) =>
  getStorageScopedKey(DESKTOP_LAUNCH_AUTO_START_KEY, userId);

export const seedDesktopLaunchAutoStart = (userId?: number | null) => {
  if (!userId || !canUseDesktopAutoStart()) {
    return;
  }

  const seededKey = getDesktopLaunchAutoStartKey(userId);
  if (sessionStorage.getItem(seededKey) === '1') {
    return;
  }

  sessionStorage.setItem(seededKey, '1');
  armAutoStart(userId);
};

const getIdleAutoStopNoticeKey = (userId?: number | null) => getStorageScopedKey(IDLE_AUTO_STOP_NOTICE_KEY, userId);

export const setIdleAutoStopNotice = (userId: number | null | undefined, message: string) => {
  if (!userId) return;
  sessionStorage.setItem(getIdleAutoStopNoticeKey(userId), message);
};

export const consumeIdleAutoStopNotice = (userId?: number | null) => {
  if (!userId) return '';

  const key = getIdleAutoStopNoticeKey(userId);
  const message = sessionStorage.getItem(key) || '';
  sessionStorage.removeItem(key);

  return message;
};

export const clearIdleAutoStopNotice = (userId?: number | null) => {
  if (!userId) return;
  sessionStorage.removeItem(getIdleAutoStopNoticeKey(userId));
};

const getWorkedBaselineKey = (userId?: number | null) => getStorageScopedKey(WORKED_BASELINE_KEY, userId);

const getLocalDateString = () => {
  const now = new Date();
  const timezoneOffsetMs = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffsetMs).toISOString().split('T')[0];
};

const resolveSnapshotDate = (date?: string) => {
  if (typeof date === 'string') {
    const extractedDate = date.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    if (extractedDate) {
      return extractedDate;
    }
  }

  return getLocalDateString();
};

export const setWorkedBaselineSnapshot = (userId: number | null | undefined, seconds: number, date?: string) => {
  if (!userId) return;

  const safeSeconds = Number.isFinite(Number(seconds))
    ? Math.max(0, Math.floor(Number(seconds)))
    : 0;

  localStorage.setItem(
    getWorkedBaselineKey(userId),
    JSON.stringify({
      seconds: safeSeconds,
      date: resolveSnapshotDate(date),
    })
  );
  sessionStorage.removeItem(getWorkedBaselineKey(userId));
};

export const getWorkedBaselineSnapshot = (userId?: number | null, date?: string) => {
  if (!userId) return 0;

  const key = getWorkedBaselineKey(userId);
  const localSnapshot = localStorage.getItem(key);
  const legacySessionSnapshot = sessionStorage.getItem(key);
  const raw = localSnapshot ?? legacySessionSnapshot;

  if (!raw) {
    return 0;
  }

  try {
    const parsed = JSON.parse(raw) as { seconds?: number; date?: string };
    const expectedDate = resolveSnapshotDate(date);
    const snapshotDate = typeof parsed.date === 'string' ? parsed.date : '';

    if (snapshotDate && snapshotDate !== expectedDate) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      return 0;
    }

    const safeSeconds = Number(parsed.seconds);
    if (!Number.isFinite(safeSeconds) || safeSeconds < 0) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
      return 0;
    }

    if (!localSnapshot && legacySessionSnapshot) {
      localStorage.setItem(
        key,
        JSON.stringify({
          seconds: Math.floor(safeSeconds),
          date: snapshotDate || expectedDate,
        })
      );
      sessionStorage.removeItem(key);
    }

    return Math.floor(safeSeconds);
  } catch {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    return 0;
  }
};

export const clearWorkedBaselineSnapshot = (userId?: number | null) => {
  if (!userId) return;
  localStorage.removeItem(getWorkedBaselineKey(userId));
  sessionStorage.removeItem(getWorkedBaselineKey(userId));
};

export const emitDesktopTimerIdleStop = (detail: DesktopTimerIdleStopDetail) => {
  window.dispatchEvent(new CustomEvent<DesktopTimerIdleStopDetail>(DESKTOP_TIMER_IDLE_STOP_EVENT, { detail }));
};

export const emitDesktopTimerStarted = (detail: DesktopTimerSessionDetail) => {
  window.dispatchEvent(new CustomEvent<DesktopTimerSessionDetail>(DESKTOP_TIMER_STARTED_EVENT, { detail }));
};

export const emitDesktopTimerStopped = (detail: DesktopTimerSessionDetail) => {
  window.dispatchEvent(new CustomEvent<DesktopTimerSessionDetail>(DESKTOP_TIMER_STOPPED_EVENT, { detail }));
};

export const clearDesktopTimerSession = () => {
  localStorage.removeItem(ACTIVE_TIMER_KEY);

  const storageKeys = Array.from({ length: sessionStorage.length }, (_, index) => sessionStorage.key(index))
    .filter((key): key is string => Boolean(key))
    .filter((key) =>
      key === AUTO_START_SUPPRESSED_KEY
      || key.startsWith(`${AUTO_START_SUPPRESSED_KEY}:`)
      || key === AUTO_START_ARMED_KEY
      || key.startsWith(`${AUTO_START_ARMED_KEY}:`)
      || key === DESKTOP_LAUNCH_AUTO_START_KEY
      || key.startsWith(`${DESKTOP_LAUNCH_AUTO_START_KEY}:`)
      || key === IDLE_AUTO_STOP_NOTICE_KEY
      || key.startsWith(`${IDLE_AUTO_STOP_NOTICE_KEY}:`)
      || key === WORKED_BASELINE_KEY
      || key.startsWith(`${WORKED_BASELINE_KEY}:`)
    );

  storageKeys.forEach((key) => sessionStorage.removeItem(key));

  const workedBaselineKeys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => Boolean(key))
    .filter((key) => key === WORKED_BASELINE_KEY || key.startsWith(`${WORKED_BASELINE_KEY}:`));

  workedBaselineKeys.forEach((key) => localStorage.removeItem(key));
};
