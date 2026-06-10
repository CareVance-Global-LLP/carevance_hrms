import { attendanceApi, timeEntryApi } from './api';
import {
  saveAttendanceOffline,
  saveActivityOffline,
  saveScreenshotOffline,
  saveTimeEntryOffline,
  isDesktopApp,
} from './offlineService';

const isNetworkError = (error: any): boolean => {
  if (!error) return false;
  const msg = String(error?.message || '').toLowerCase();
  return (
    msg.includes('no internet connection') ||
    msg.includes('network error') ||
    msg.includes('econnaborted') ||
    msg.includes('enotfound') ||
    msg.includes('etimedout') ||
    error?.code === 'ERR_NETWORK' ||
    error?.code === 'ECONNABORTED'
  );
};

const getUserId = (): number => {
  try {
    const userStr = localStorage.getItem('user') || sessionStorage.getItem('user');
    if (userStr) {
      const user = JSON.parse(userStr);
      return user.id || 0;
    }
  } catch {}
  return 0;
};

export async function checkInOfflineAware(): Promise<{ success: boolean; data?: any; offline?: boolean; error?: string }> {
  try {
    const response = await attendanceApi.checkIn();
    return { success: true, data: response.data };
  } catch (error: any) {
    if ((!navigator.onLine || isNetworkError(error)) && isDesktopApp()) {
      const result = await saveAttendanceOffline(getUserId(), 'in');
      if (result.saved) {
        return { success: true, offline: true };
      }
      return { success: false, error: result.error || 'Offline check-in failed' };
    }
    throw error;
  }
}

export async function checkOutOfflineAware(): Promise<{ success: boolean; data?: any; offline?: boolean; error?: string }> {
  try {
    const response = await attendanceApi.checkOut();
    return { success: true, data: response.data };
  } catch (error: any) {
    if ((!navigator.onLine || isNetworkError(error)) && isDesktopApp()) {
      const result = await saveAttendanceOffline(getUserId(), 'out');
      if (result.saved) {
        return { success: true, offline: true };
      }
      return { success: false, error: result.error || 'Offline check-out failed' };
    }
    throw error;
  }
}

export async function startTimerOfflineAware(options?: {
  project_id?: number;
  task_id?: number;
  timer_slot?: 'primary' | 'secondary';
  latitude?: number;
  longitude?: number;
}): Promise<{ success: boolean; data?: any; offline?: boolean; error?: string }> {
  try {
    const response = await timeEntryApi.start({
      project_id: options?.project_id,
      task_id: options?.task_id,
      timer_slot: options?.timer_slot || 'primary',
      latitude: options?.latitude,
      longitude: options?.longitude,
    });
    return { success: true, data: response.data };
  } catch (error: any) {
    if ((!navigator.onLine || isNetworkError(error)) && isDesktopApp()) {
      const result = await saveTimeEntryOffline(getUserId(), 'start', {
        projectId: options?.project_id,
        taskId: options?.task_id,
        timerSlot: options?.timer_slot,
        latitude: options?.latitude,
        longitude: options?.longitude,
      });
      if (result.saved) {
        return { success: true, offline: true };
      }
      return { success: false, error: result.error || 'Offline timer start failed' };
    }
    throw error;
  }
}

export async function stopTimerOfflineAware(options?: {
  timer_slot?: 'primary' | 'secondary';
}): Promise<{ success: boolean; data?: any; offline?: boolean; error?: string }> {
  try {
    const response = await timeEntryApi.stop({ timer_slot: options?.timer_slot || 'primary' });
    return { success: true, data: response.data };
  } catch (error: any) {
    if ((!navigator.onLine || isNetworkError(error)) && isDesktopApp()) {
      const result = await saveTimeEntryOffline(getUserId(), 'stop', {
        timerSlot: options?.timer_slot,
      });
      if (result.saved) {
        return { success: true, offline: true };
      }
      return { success: false, error: result.error || 'Offline timer stop failed' };
    }
    throw error;
  }
}

export { saveScreenshotOffline, saveActivityOffline, isDesktopApp, isNetworkError };
