const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopTracker', {
  captureScreenshot: () => ipcRenderer.invoke('desktop:capture-screenshot'),
  getSystemIdleSeconds: () => ipcRenderer.invoke('desktop:get-system-idle-seconds'),
  getActiveWindowContext: () => ipcRenderer.invoke('desktop:get-active-window-context'),
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
});
