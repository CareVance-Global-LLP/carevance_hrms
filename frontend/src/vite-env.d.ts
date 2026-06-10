/// <reference types="vite/client" />
import type { BrowserTrackingEvent, BrowserTrackingPairingCode, BrowserTrackingState, DesktopDeviceIdentity } from '@/types';

declare global {
  interface DesktopUpdateState {
    enabled: boolean;
    status: 'disabled' | 'idle' | 'checking' | 'available' | 'current' | 'downloading' | 'downloaded' | 'error';
    currentVersion: string;
    message: string;
    releaseNotes: string;
    releaseDate: string | null;
    availableVersion: string | null;
    downloadedVersion: string | null;
    progressPercent: number;
  }

  interface DesktopForegroundWindowPayload {
    app: string | null;
    title: string | null;
    url: string | null;
    description?: string | null;
    captured_at?: string;
  }

  interface DesktopSystemLockState {
    state: 'locked' | 'unlocked' | 'suspended' | 'resumed';
    locked: boolean;
    locked_at: string | null;
    recorded_at: string;
  }

  interface DesktopOfflineStatus {
    enabled: boolean;
    online: boolean;
    pendingRecords: number;
    queueSize: number;
    lastSyncAt: string | null;
    isSyncing: boolean;
    mode: 'offline-first' | 'online-only';
    lastCheckAt?: string | null;
    syncCounts?: {
      pending: number;
      syncing: number;
      synced: number;
      failed: number;
    };
  }

  interface DesktopOfflineQueueDetails {
    total: number;
    counts: Record<string, number>;
    syncCounts: {
      pending: number;
      syncing: number;
      synced: number;
      failed: number;
    };
  }

  interface DesktopTrackerBridge {
    captureScreenshot: () => Promise<string | null>;
    getSystemIdleSeconds: () => Promise<number>;
    getSystemLockState?: () => Promise<DesktopSystemLockState>;
    getActiveWindowContext: () => Promise<{
      app: string | null;
      title: string | null;
      url: string | null;
      description?: string | null;
      captured_at?: string;
    } | null>;
    getAllWindowContexts?: () => Promise<Array<{
      Name: string;
      Description: string | null;
      Product: string | null;
      Company: string | null;
      MainWindowTitle: string;
      Id: number;
    }>>;
    revealWindow: () => Promise<boolean>;
    showNotification?: (payload: {
      id?: number;
      title: string;
      body?: string;
      route?: string;
      type?: string;
    }) => Promise<boolean>;
    getUpdateState?: () => Promise<DesktopUpdateState>;
    checkForUpdates?: () => Promise<DesktopUpdateState>;
    downloadUpdate?: () => Promise<DesktopUpdateState>;
    installUpdate?: () => Promise<boolean>;
    getDesktopDeviceIdentity?: () => Promise<DesktopDeviceIdentity | null>;
    getBrowserTrackingState?: () => Promise<BrowserTrackingState | null>;
    openBrowserTrackingInstall?: (payload: { browser_name: string }) => Promise<boolean>;
    openBrowserTrackingGuide?: (payload: { browser_name: string }) => Promise<boolean>;
    openBrowserTrackingOptions?: (payload: { extension_origin: string }) => Promise<boolean>;
    createBrowserTrackingPairingCode?: (payload: { browser_name: string; user_id: number }) => Promise<BrowserTrackingPairingCode | null>;
    onUpdateState?: (callback: (state: DesktopUpdateState) => void) => (() => void) | void;
    clearUpdateStateListeners?: () => void;
    onNotificationClicked?: (callback: (payload: { id?: number; route?: string; type?: string }) => void) => (() => void) | void;
    clearNotificationClickListeners?: () => void;
    onForegroundWindowChange?: (callback: (payload: DesktopForegroundWindowPayload) => void | Promise<void>) => (() => void) | void;
    clearForegroundWindowChangeListeners?: () => void;
    onSystemLockState?: (callback: (payload: DesktopSystemLockState) => void | Promise<void>) => (() => void) | void;
    clearSystemLockStateListeners?: () => void;
    onBrowserTrackingState?: (callback: (state: BrowserTrackingState) => void | Promise<void>) => (() => void) | void;
    clearBrowserTrackingStateListeners?: () => void;
    onBrowserTrackingEvent?: (callback: (payload: BrowserTrackingEvent) => void | Promise<void>) => (() => void) | void;
    clearBrowserTrackingEventListeners?: () => void;
    onPrepareForClose?: (callback: () => void | Promise<void>) => void;
    clearPrepareForCloseListeners?: () => void;
    confirmCloseReady?: () => Promise<boolean>;

    // Offline Mode API
    isOfflineAvailable?: () => Promise<boolean>;
    getOfflineStatus?: () => Promise<DesktopOfflineStatus>;
    getOfflineSummary?: () => Promise<Record<string, unknown>>;
    saveAttendanceOffline?: (payload: {
      user_id: number;
      punch_type: 'in' | 'out';
      punch_at: string;
      session_id?: string;
      latitude?: number;
      longitude?: number;
    }) => Promise<{ saved: boolean; local_id?: string; error?: string }>;
    saveScreenshotOffline?: (payload: {
      user_id: number;
      image_data: string;
      captured_at: string;
      time_entry_id?: number;
    }) => Promise<{ saved: boolean; local_id?: string; error?: string }>;
    saveActivityOffline?: (payload: {
      user_id: number;
      type: string;
      name?: string;
      title?: string;
      url?: string;
      duration?: number;
      recorded_at: string;
      metadata?: Record<string, unknown>;
    }) => Promise<{ saved: boolean; local_id?: string; error?: string }>;
    saveAppUsageOffline?: (payload: {
      user_id: number;
      app_name: string;
      duration: number;
      timestamp: string;
      title?: string;
    }) => Promise<{ saved: boolean; local_id?: string; error?: string }>;
    saveWebsiteUsageOffline?: (payload: {
      user_id: number;
      url: string;
      title?: string;
      duration: number;
      timestamp: string;
    }) => Promise<{ saved: boolean; local_id?: string; error?: string }>;
    saveTimelineOffline?: (payload: {
      user_id: number;
      start_time: string;
      end_time?: string;
      activity_data?: Record<string, unknown>;
    }) => Promise<{ saved: boolean; local_id?: string; error?: string }>;
    saveTimeEntryOffline?: (payload: {
      user_id: number;
      action: 'start' | 'stop';
      project_id?: number;
      task_id?: number;
      timer_slot?: string;
      latitude?: number;
      longitude?: number;
    }) => Promise<{ saved: boolean; local_id?: string; error?: string }>;
    saveAuthOffline?: (payload: {
      user_id: number;
      token: string;
      organization_id?: number;
      user_data?: Record<string, unknown>;
    }) => Promise<{ saved: boolean }>;
    getAuthOffline?: () => Promise<{
      user_id: number;
      token: string;
      organization_id?: number;
      user_data?: Record<string, unknown>;
    } | null>;
    clearAuthOffline?: () => Promise<boolean>;
    triggerSync?: () => Promise<{ triggered: boolean; error?: string }>;
    setOfflineCredentials?: (payload: {
      auth_token: string;
      user_id: number;
      api_url?: string;
    }) => Promise<boolean>;
    getPendingCountOffline?: () => Promise<number>;
    getQueueDetails?: () => Promise<DesktopOfflineQueueDetails>;
    onOfflineStatusChange?: (callback: (status: DesktopOfflineStatus) => void) => (() => void) | void;
    clearOfflineStatusListeners?: () => void;
  }

  interface AppRuntimeConfig {
    VITE_API_URL?: string;
    VITE_WEB_APP_URL?: string;
    VITE_DESKTOP_DOWNLOAD_URL?: string;
    VITE_DESKTOP_DOWNLOAD_LABEL?: string;
    VITE_SALES_EMAIL?: string;
    VITE_SUPPORT_EMAIL?: string;
    VITE_GA_MEASUREMENT_ID?: string;
    VITE_PLAUSIBLE_DOMAIN?: string;
    VITE_POSTHOG_KEY?: string;
    VITE_POSTHOG_HOST?: string;
    VITE_GOOGLE_OAUTH_ENABLED?: string;
    VITE_IDLE_TRACK_THRESHOLD_SECONDS?: string;
    VITE_IDLE_AUTO_STOP_THRESHOLD_SECONDS?: string;
    VITE_LOCK_SCREEN_AUTO_STOP_THRESHOLD_SECONDS?: string;
    VITE_IDLE_GUARD_INTERVAL_MS?: string;
  }

  interface Window {
    desktopTracker?: DesktopTrackerBridge;
    __APP_CONFIG__?: AppRuntimeConfig;
    __CAREVANCE_DESKTOP_TRACKER_COMPAT__?: readonly string[];
    gtag?: (...args: unknown[]) => void;
    plausible?: (eventName: string, options?: { props?: Record<string, unknown> }) => void;
    posthog?: {
      capture: (eventName: string, properties?: Record<string, unknown>) => void;
    };
  }
}

export {};
