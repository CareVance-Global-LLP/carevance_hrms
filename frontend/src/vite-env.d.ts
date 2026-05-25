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
