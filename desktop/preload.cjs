const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopTracker', {
  captureScreenshot: () => ipcRenderer.invoke('desktop:capture-screenshot'),
  getSystemIdleSeconds: () => ipcRenderer.invoke('desktop:get-system-idle-seconds'),
  getSystemLockState: () => ipcRenderer.invoke('desktop:get-system-lock-state'),
  getActiveWindowContext: () => ipcRenderer.invoke('desktop:get-active-window-context'),
  getAllWindowContexts: () => ipcRenderer.invoke('desktop:get-all-window-contexts'),
  revealWindow: () => ipcRenderer.invoke('desktop:reveal-window'),
  showNotification: (payload) => ipcRenderer.invoke('desktop:show-notification', payload),
  getUpdateState: () => ipcRenderer.invoke('desktop:get-update-state'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  getDesktopDeviceIdentity: () => ipcRenderer.invoke('desktop:get-device-identity'),
  getBrowserTrackingState: () => ipcRenderer.invoke('desktop:get-browser-tracking-state'),
  openBrowserTrackingInstall: (payload) => ipcRenderer.invoke('desktop:open-browser-tracking-install', payload),
  openBrowserTrackingGuide: (payload) => ipcRenderer.invoke('desktop:open-browser-tracking-guide', payload),
  openBrowserTrackingOptions: (payload) => ipcRenderer.invoke('desktop:open-browser-tracking-options', payload),
  createBrowserTrackingPairingCode: (payload) =>
    ipcRenderer.invoke('desktop:create-browser-tracking-pairing-code', payload),
  onUpdateState: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop:update-state', listener);
    return () => {
      ipcRenderer.removeListener('desktop:update-state', listener);
    };
  },
  clearUpdateStateListeners: () => {
    ipcRenderer.removeAllListeners('desktop:update-state');
  },
  onNotificationClicked: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop:notification-clicked', listener);
    return () => {
      ipcRenderer.removeListener('desktop:notification-clicked', listener);
    };
  },
  clearNotificationClickListeners: () => {
    ipcRenderer.removeAllListeners('desktop:notification-clicked');
  },
  onForegroundWindowChange: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop:foreground-window-changed', listener);
    return () => {
      ipcRenderer.removeListener('desktop:foreground-window-changed', listener);
    };
  },
  clearForegroundWindowChangeListeners: () => {
    ipcRenderer.removeAllListeners('desktop:foreground-window-changed');
  },
  onSystemLockState: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop:system-lock-state', listener);
    return () => {
      ipcRenderer.removeListener('desktop:system-lock-state', listener);
    };
  },
  clearSystemLockStateListeners: () => {
    ipcRenderer.removeAllListeners('desktop:system-lock-state');
  },
  onBrowserTrackingState: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop:browser-tracking-state', listener);
    return () => {
      ipcRenderer.removeListener('desktop:browser-tracking-state', listener);
    };
  },
  clearBrowserTrackingStateListeners: () => {
    ipcRenderer.removeAllListeners('desktop:browser-tracking-state');
  },
  onBrowserTrackingEvent: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop:browser-tracking-event', listener);
    return () => {
      ipcRenderer.removeListener('desktop:browser-tracking-event', listener);
    };
  },
  clearBrowserTrackingEventListeners: () => {
    ipcRenderer.removeAllListeners('desktop:browser-tracking-event');
  },
  onPrepareForClose: (callback) => {
    ipcRenderer.removeAllListeners('desktop:prepare-close');
    ipcRenderer.on('desktop:prepare-close', () => {
      void callback();
    });
  },
  clearPrepareForCloseListeners: () => {
    ipcRenderer.removeAllListeners('desktop:prepare-close');
  },
  confirmCloseReady: () => ipcRenderer.invoke('desktop:confirm-close-ready'),

  // Offline Mode API
  isOfflineAvailable: () => ipcRenderer.invoke('desktop:offline-is-available'),
  getOfflineStatus: () => ipcRenderer.invoke('desktop:offline-get-status'),
  getOfflineSummary: () => ipcRenderer.invoke('desktop:offline-get-summary'),
  saveAttendanceOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-attendance', payload),
  saveScreenshotOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-screenshot', payload),
  saveActivityOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-activity', payload),
  saveAppUsageOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-app-usage', payload),
  saveWebsiteUsageOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-website-usage', payload),
  saveTimelineOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-timeline', payload),
  saveTimeEntryOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-time-entry', payload),
  saveAuthOffline: (payload) => ipcRenderer.invoke('desktop:offline-save-auth', payload),
  getAuthOffline: () => ipcRenderer.invoke('desktop:offline-get-auth'),
  clearAuthOffline: () => ipcRenderer.invoke('desktop:offline-clear-auth'),
  triggerSync: () => ipcRenderer.invoke('desktop:offline-trigger-sync'),
  setOfflineCredentials: (payload) => ipcRenderer.invoke('desktop:offline-set-credentials', payload),
  getPendingCountOffline: () => ipcRenderer.invoke('desktop:offline-get-pending-count'),
  getQueueDetails: () => ipcRenderer.invoke('desktop:offline-get-queue-details'),
  onOfflineStatusChange: (callback) => {
    const listener = (_event, payload) => {
      callback(payload);
    };
    ipcRenderer.on('desktop:offline-status-change', listener);
    return () => {
      ipcRenderer.removeListener('desktop:offline-status-change', listener);
    };
  },
  clearOfflineStatusListeners: () => {
    ipcRenderer.removeAllListeners('desktop:offline-status-change');
  },
});
