const { contextBridge, ipcRenderer } = require('electron');

/**
 * The reply box's only bridge to the main process.
 *
 * Deliberately four functions wide, for the same reason the idle popup's is
 * three: this page renders a name and a text field and reports a string. It
 * has no session, no API client, and no idea what a conversation is — every
 * one of those absences is something that cannot go wrong in a window that
 * floats over whatever the person was doing.
 */
contextBridge.exposeInMainWorld('quickReply', {
  /** Receive the conversation this reply is for. */
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('quick-reply:state', listener);
    return () => ipcRenderer.removeListener('quick-reply:state', listener);
  },

  /** Receive the outcome of a send: closed on success, shown on failure. */
  onResult: (callback) => {
    const listener = (_event, result) => callback(result);
    ipcRenderer.on('quick-reply:result', listener);
    return () => ipcRenderer.removeListener('quick-reply:result', listener);
  },

  /** Hand the typed reply over. The renderer sends it; this page does not. */
  submit: (text) => ipcRenderer.send('quick-reply:submit', { text }),

  /** Give up on this reply — Escape, or the close button. */
  cancel: () => ipcRenderer.send('quick-reply:cancel'),

  /**
   * Open the full conversation instead.
   *
   * On Windows a toast has no buttons of its own (Electron's `actions` are
   * darwin-only), so clicking the notification opens this box rather than the
   * app. This is how somebody still gets to the thread when a one-line reply
   * is not what they wanted.
   */
  openChat: () => ipcRenderer.send('quick-reply:open'),

  /**
   * Announce that the page can receive state.
   *
   * The first state is sent as the window is created, before this page exists,
   * and Electron drops sends to a renderer that is not up yet. Without the
   * handshake the box would open with nobody's name on it and no way to learn
   * one — there is no second tick here, unlike the idle countdown.
   */
  ready: () => ipcRenderer.send('quick-reply:ready'),
});
