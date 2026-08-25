/// <reference types="vite/client" />
import type { DesktopDeviceIdentity } from '@/types';

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
    /**
     * URL read from the browser's own UI via Windows UI Automation, for when
     * the extension is not installed. `url` above stays null on Windows —
     * get-windows only fills it on macOS.
     *
     * 'document' is Chrome's real page URL and is exact. 'address_bar' is a
     * host-only hint from Edge/Brave, where typed-but-unsent text lingers, so
     * it must never be treated as a confirmed visit.
     */
    inferred_url?: string | null;
    inferred_url_source?: 'document' | 'address_bar' | null;
    inferred_url_confidence?: number | null;
    /** True when the Electron tracker window itself holds focus. */
    is_self_window?: boolean | null;
    description?: string | null;
    captured_at?: string;
  }

  interface DesktopSystemLockState {
    state: 'locked' | 'unlocked' | 'suspended' | 'resumed';
    locked: boolean;
    locked_at: string | null;
    recorded_at: string;
  }

  // Structured result from desktop:capture-screenshot. Replaces the previous
  // bare `null` so the renderer can tell "permission denied" apart from
  // "permission ok but no usable source" and react differently.
  type DesktopScreenshotCaptureResult =
    | { ok: true; dataUrl: string }
    | {
        ok: false;
        reason: 'screen_permission_denied' | 'no_usable_source';
        platform: string;
        guidance?: string;
      };

  interface DesktopScreenCapturePermission {
    supported: boolean;
    status: string | null;
    granted?: boolean;
  }

  interface DesktopOfflineStatus {
    enabled: boolean;
    online: boolean;
    pendingRecords: number;
    /** Subset of pendingRecords the sync engine has stopped retrying. */
    stuckRecords?: number;
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
    captureScreenshot: () => Promise<DesktopScreenshotCaptureResult>;
    getScreenCapturePermission: () => Promise<DesktopScreenCapturePermission>;
    getSystemIdleSeconds: () => Promise<number>;
    getSystemLockState?: () => Promise<DesktopSystemLockState>;
    getActiveWindowContext: () => Promise<{
      app: string | null;
      title: string | null;
      url: string | null;
      inferred_url?: string | null;
      inferred_url_source?: 'document' | 'address_bar' | null;
      inferred_url_confidence?: number | null;
    /** True when the Electron tracker window itself holds focus. */
    is_self_window?: boolean | null;
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
    /** Optional: added in the build that gave the tray a timer status. */
    setTimerState?: (state: { running: boolean; startedAt?: string | null; label?: string | null }) => Promise<boolean>;
    showNotification?: (payload: {
      id?: number;
      title: string;
      body?: string;
      route?: string;
      type?: string;
      /**
       * A data: URL preview of an image attachment, shown on the toast itself.
       *
       * A data URL rather than an https one because the shell renders this
       * outside the page, where a bearer token cannot be attached and a blob:
       * URL has no meaning. Optional in both directions: an older installed
       * shell simply ignores it, so a renderer that sends one never breaks.
       */
      image?: string;
      /**
       * Where a reply to this notification would go.
       *
       * Present only for chat notifications. Its presence is what makes the
       * shell open its quick-reply box on click instead of raising the window —
       * a leave approval has nothing to reply to.
       */
      reply?: {
        threadType: 'direct' | 'group';
        threadId: number;
        title?: string;
      };
    }) => Promise<boolean>;

    /**
     * A reply typed into the shell's quick-reply box, handed to the renderer
     * to send. The shell has no session; this side does.
     *
     * Optional because an older installed shell does not have it — the
     * renderer updates itself, the shell does not.
     */
    onQuickReplySend?: (
      callback: (payload: { requestId: number; threadType: 'direct' | 'group'; threadId: number; text: string }) => void
    ) => () => void;

    /** Report whether that send worked. */
    sendQuickReplyResult?: (result: { requestId?: number; ok: boolean; error?: string | null }) => void;
    /**
     * The native idle popup. Optional because the renderer updates itself while
     * the installed shell does not — an older build has this bridge without
     * these methods, and lib/idlePopupBridge.ts checks for them by name.
     */
    showIdlePopup?: (state: {
      mode: 'warning' | 'stopped' | 'return';
      secondsRemaining?: number;
      idleSeconds?: number;
      activityId?: number;
    }) => Promise<boolean>;
    hideIdlePopup?: () => Promise<boolean>;
    onIdlePopupAction?: (
      callback: (payload: { action: string }) => void
    ) => (() => void) | void;
    clearIdlePopupActionListeners?: () => void;
    getUpdateState?: () => Promise<DesktopUpdateState>;
    checkForUpdates?: () => Promise<DesktopUpdateState>;
    downloadUpdate?: () => Promise<DesktopUpdateState>;
    installUpdate?: () => Promise<boolean>;
    getDesktopDeviceIdentity?: () => Promise<DesktopDeviceIdentity | null>;
    setTheme?: (payload: { theme: 'light' | 'dark' | 'system' }) => Promise<{
      theme: 'light' | 'dark' | 'system';
      dark: boolean;
    }>;
    onUpdateState?: (callback: (state: DesktopUpdateState) => void) => (() => void) | void;
    clearUpdateStateListeners?: () => void;
    onNotificationClicked?: (callback: (payload: { id?: number; route?: string; type?: string }) => void) => (() => void) | void;
    clearNotificationClickListeners?: () => void;
    onForegroundWindowChange?: (callback: (payload: DesktopForegroundWindowPayload) => void | Promise<void>) => (() => void) | void;
    clearForegroundWindowChangeListeners?: () => void;
    onSystemLockState?: (callback: (payload: DesktopSystemLockState) => void | Promise<void>) => (() => void) | void;
    clearSystemLockStateListeners?: () => void;
    onPrepareForClose?: (callback: () => void | Promise<void>) => void;
    clearPrepareForCloseListeners?: () => void;
    confirmCloseReady?: () => Promise<boolean>;

    // Offline Mode API
    isOfflineAvailable?: () => Promise<boolean>;
    getOfflineStatus?: () => Promise<DesktopOfflineStatus>;
    /** Disk backing for the pending activity-session queue. */
    loadPendingSessions?: () => Promise<unknown[]>;
    savePendingSessions?: (sessions: unknown[]) => Promise<boolean>;
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
