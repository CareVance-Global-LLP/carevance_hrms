const { contextBridge, ipcRenderer } = require('electron');

/**
 * The popup's only bridge to the main process.
 *
 * Deliberately three functions wide. This page renders an idle notice and
 * reports a button press; it has no session, no API client and no idea what a
 * time entry is, and every one of those absences is a thing that cannot break
 * while somebody is away from their desk.
 */
contextBridge.exposeInMainWorld('idlePopup', {
  /** Receive state pushed by the tracker: mode, countdown, idle duration. */
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('idle-popup:state', listener);
    return () => ipcRenderer.removeListener('idle-popup:state', listener);
  },

  /** Report a button press. The tracker decides what it means. */
  send: (action) => ipcRenderer.send('idle-popup:action', { action }),

  /**
   * Announce that the page can receive state.
   *
   * The first state is sent in the same breath as the window is created, before
   * this page has loaded, and Electron drops sends to a renderer that is not up
   * yet. Without this handshake the popup would open blank and stay blank until
   * the next tracker tick — and in the `stopped` and `return` modes there is no
   * next tick, so it would stay blank for good.
   */
  ready: () => ipcRenderer.send('idle-popup:ready'),
});
