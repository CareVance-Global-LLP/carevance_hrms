import { getStoredAuthValue } from '@/lib/authStorage';

export type OfflineStatus = 'online' | 'offline' | 'syncing';

export interface OfflineState {
  status: OfflineStatus;
  pendingRecords: number;
  lastSyncAt: string | null;
  isDesktopApp: boolean;
  queueSize: number;
}

const getDesktopApi = () => {
  if (typeof window !== 'undefined' && window.desktopTracker) {
    return window.desktopTracker;
  }
  return null;
};

const api = getDesktopApi();

export const isDesktopApp = (): boolean => {
  return typeof window !== 'undefined' && Boolean(window.desktopTracker);
};

export const isOfflineAvailable = async (): Promise<boolean> => {
  try {
    if (api?.isOfflineAvailable) {
      return api.isOfflineAvailable();
    }
  } catch {}
  return false;
};

export const getOfflineStatus = async (): Promise<OfflineState> => {
  const defaultState: OfflineState = {
    status: 'online',
    pendingRecords: 0,
    lastSyncAt: null,
    isDesktopApp: isDesktopApp(),
    queueSize: 0,
  };

  if (!api?.getOfflineStatus) return defaultState;

  try {
    const status = await api.getOfflineStatus();
    return {
      status: status.isSyncing ? 'syncing' : (status.online ? 'online' : 'offline'),
      pendingRecords: status.pendingRecords,
      lastSyncAt: status.lastSyncAt,
      isDesktopApp: true,
      queueSize: status.queueSize,
    };
  } catch {
    return defaultState;
  }
};

export const isOnline = async (): Promise<boolean> => {
  const status = await getOfflineStatus();
  return status.status === 'online' || status.status === 'syncing';
};

export const trySaveOffline = async <T>(
  saveFn: () => Promise<T>,
  offlineFn: () => Promise<{ saved: boolean; error?: string }>,
  context: string,
): Promise<{ success: boolean; data?: T; offline?: boolean; error?: string }> => {
  try {
    if (api?.getOfflineStatus) {
      const status = await api.getOfflineStatus();
      if (!status.online) {
        const result = await offlineFn();
        if (result.saved) {
          return { success: true, offline: true };
        }
        return { success: false, error: result.error || 'Offline save failed' };
      }
    }
    const data = await saveFn();
    return { success: true, data };
  } catch (err: any) {
    if (err?.message?.includes('No internet connection') || err?.code === 'ERR_NETWORK') {
      try {
        const result = await offlineFn();
        if (result.saved) {
          return { success: true, offline: true };
        }
      } catch (offlineErr: any) {
        return { success: false, error: offlineErr?.message || 'Offline fallback failed' };
      }
    }
    return { success: false, error: err?.message || 'Request failed' };
  }
};

export const saveAttendanceOffline = async (
  userId: number,
  punchType: 'in' | 'out',
  punchAt?: string,
  options?: { sessionId?: string; latitude?: number; longitude?: number },
): Promise<{ saved: boolean; local_id?: string; error?: string }> => {
  if (!api?.saveAttendanceOffline) {
    return { saved: false, error: 'Desktop API not available' };
  }
  return api.saveAttendanceOffline({
    user_id: userId,
    punch_type: punchType,
    punch_at: punchAt || new Date().toISOString(),
    session_id: options?.sessionId,
    latitude: options?.latitude,
    longitude: options?.longitude,
  });
};

export const saveScreenshotOffline = async (
  userId: number,
  imageData: string,
  capturedAt: string,
  timeEntryId?: number,
): Promise<{ saved: boolean; local_id?: string; error?: string }> => {
  if (!api?.saveScreenshotOffline) {
    return { saved: false, error: 'Desktop API not available' };
  }
  return api.saveScreenshotOffline({ user_id: userId, image_data: imageData, captured_at: capturedAt, time_entry_id: timeEntryId });
};

export const saveActivityOffline = async (
  userId: number,
  type: string,
  recordedAt: string,
  options?: { name?: string; title?: string; url?: string; duration?: number; metadata?: Record<string, unknown> },
): Promise<{ saved: boolean; local_id?: string; error?: string }> => {
  if (!api?.saveActivityOffline) {
    return { saved: false, error: 'Desktop API not available' };
  }
  return api.saveActivityOffline({
    user_id: userId,
    type,
    recorded_at: recordedAt,
    ...options,
  });
};

export const saveAppUsageOffline = async (
  userId: number,
  appName: string,
  duration: number,
  timestamp: string,
  title?: string,
): Promise<{ saved: boolean; local_id?: string; error?: string }> => {
  if (!api?.saveAppUsageOffline) {
    return { saved: false, error: 'Desktop API not available' };
  }
  return api.saveAppUsageOffline({ user_id: userId, app_name: appName, duration, timestamp, title });
};

export const saveWebsiteUsageOffline = async (
  userId: number,
  url: string,
  duration: number,
  timestamp: string,
  title?: string,
): Promise<{ saved: boolean; local_id?: string; error?: string }> => {
  if (!api?.saveWebsiteUsageOffline) {
    return { saved: false, error: 'Desktop API not available' };
  }
  return api.saveWebsiteUsageOffline({ user_id: userId, url, duration, timestamp, title });
};

export const saveTimeEntryOffline = async (
  userId: number,
  action: 'start' | 'stop',
  options?: { projectId?: number; taskId?: number; timerSlot?: string; latitude?: number; longitude?: number },
): Promise<{ saved: boolean; local_id?: string; error?: string }> => {
  if (!api?.saveTimeEntryOffline) {
    return { saved: false, error: 'Desktop API not available' };
  }
  return api.saveTimeEntryOffline({
    user_id: userId,
    action,
    project_id: options?.projectId,
    task_id: options?.taskId,
    timer_slot: options?.timerSlot,
    latitude: options?.latitude,
    longitude: options?.longitude,
  });
};

export const saveAuthOffline = async (
  userId: number,
  token: string,
  userData?: Record<string, unknown>,
  organizationId?: number,
  organizationData?: Record<string, unknown>,
): Promise<boolean> => {
  if (!api?.saveAuthOffline) {
    return false;
  }
  try {
    const result = await api.saveAuthOffline({
      user_id: userId,
      token,
      organization_id: organizationId,
      user_data: organizationData ? { ...userData, _organization: organizationData } : userData,
    });
    return result.saved;
  } catch {
    return false;
  }
};

export const getAuthOffline = async (): Promise<{
  user_id: number;
  token: string;
  organization_id?: number;
  user_data?: Record<string, unknown>;
} | null> => {
  if (!api?.getAuthOffline) return null;
  try {
    return api.getAuthOffline();
  } catch {
    return null;
  }
};

export const clearAuthOffline = async (): Promise<boolean> => {
  if (!api?.clearAuthOffline) return false;
  try {
    return api.clearAuthOffline();
  } catch {
    return false;
  }
};

export const triggerSync = async (): Promise<void> => {
  if (api?.triggerSync) {
    try {
      await api.triggerSync();
    } catch {}
  }
};

export const setOfflineCredentials = async (authToken: string, userId: number, apiUrl?: string): Promise<boolean> => {
  if (api?.setOfflineCredentials) {
    try {
      return api.setOfflineCredentials({ auth_token: authToken, user_id: userId, api_url: apiUrl });
    } catch {}
  }
  return false;
};

export const getPendingCount = async (): Promise<number> => {
  if (api?.getPendingCountOffline) {
    try {
      return api.getPendingCountOffline();
    } catch {}
  }
  return 0;
};

export const onOfflineStatusChange = (
  callback: (status: OfflineState) => void,
): (() => void) | undefined => {
  if (api?.onOfflineStatusChange) {
    const unsubscribe = api.onOfflineStatusChange((status: any) => {
      callback({
        status: status.isSyncing ? 'syncing' : (status.online ? 'online' : 'offline'),
        pendingRecords: status.pendingRecords,
        lastSyncAt: status.lastSyncAt,
        isDesktopApp: true,
        queueSize: status.queueSize,
      });
    });
    return typeof unsubscribe === 'function' ? unsubscribe : undefined;
  }
  return undefined;
};
