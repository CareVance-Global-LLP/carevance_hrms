const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');

/**
 * Replying without opening the app.
 *
 * Windows cannot put a text box inside a toast. Electron's `hasReply` is
 * `@platform darwin` and there is no equivalent for win32 short of a native
 * WinRT module, so the literal "type into the notification" feature is not
 * available on the platform most of these users are on.
 *
 * This is the same trade the idle popup already makes: when the operating
 * system cannot show what we need inside its own surface, we bring our own
 * small window and put it in front. Clicking Reply on a chat notification opens
 * this, you type, press Enter, and it is gone — the main window is never
 * raised, nothing is navigated, and whatever you were doing stays where it was.
 *
 * It owns no chat rules and holds no session. It collects a string and reports
 * it; the renderer sends the message with the credentials it already has. A
 * second copy of the send path living in the main process is exactly what this
 * must not become.
 */

const POPUP_WIDTH = 380;
const POPUP_HEIGHT = 176;
const POPUP_MARGIN = 24;

const STATE_CHANNEL = 'quick-reply:state';
const SUBMIT_CHANNEL = 'quick-reply:submit';
const RESULT_CHANNEL = 'quick-reply:result';
const CANCEL_CHANNEL = 'quick-reply:cancel';
const OPEN_CHANNEL = 'quick-reply:open';
const READY_CHANNEL = 'quick-reply:ready';

const POPUP_PAGE = path.join(__dirname, 'quick-reply', 'quick-reply.html');

let popupWindow = null;
let submitHandler = null;
let cancelHandler = null;
let openHandler = null;
/**
 * Replayed when the page reports itself ready.
 *
 * The first state is sent in the same breath as the window is created, and
 * Electron drops a send to a renderer that has not loaded — without the
 * handshake the box would open with nobody's name on it.
 */
let lastState = null;

/**
 * Bottom-right of the screen the person is actually looking at.
 *
 * Keyed off the cursor rather than the primary display, for the same reason
 * the idle popup is: on a two-monitor desk the app is routinely on one screen
 * and the person on the other. Measured against `workArea` so it never lands
 * under the taskbar.
 */
const resolvePopupBounds = () => {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;

  const width = Math.min(POPUP_WIDTH, area.width);
  const height = Math.min(POPUP_HEIGHT, area.height);

  return {
    x: Math.round(Math.max(area.x, area.x + area.width - width - POPUP_MARGIN)),
    y: Math.round(Math.max(area.y, area.y + area.height - height - POPUP_MARGIN)),
    width,
    height,
  };
};

const createPopupWindow = () => {
  const window = new BrowserWindow({
    width: POPUP_WIDTH,
    height: POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'quick-reply-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.on('closed', () => {
    popupWindow = null;
    lastState = null;
  });

  /*
   * Dismiss on blur.
   *
   * Unlike the idle popup, this one TAKES focus — it exists to be typed into.
   * That makes losing focus an unambiguous signal that the person moved on, and
   * an always-on-top box sitting over their work with a half-typed reply in it
   * would be worse than no feature at all.
   */
  window.on('blur', () => {
    if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) {
      popupWindow.hide();
      if (cancelHandler) cancelHandler();
    }
  });

  void window.loadFile(POPUP_PAGE);

  return window;
};

/**
 * Put the box in front AND give it the keyboard.
 *
 * The deliberate opposite of the idle popup, which uses showInactive so it
 * cannot eat keystrokes. Here the person has just clicked Reply: focus is what
 * they asked for, and a reply box you have to click before typing has thrown
 * away the convenience it exists to provide.
 */
const revealPopup = (window) => {
  window.setBounds(resolvePopupBounds());
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  window.show();
  window.focus();
  window.webContents.focus();
};

/**
 * Open the reply box for one conversation.
 *
 * @param {{threadType: 'direct'|'group', threadId: number, title: string,
 *   preview?: string|null}} state
 */
const showQuickReply = (state) => {
  if (!state || !state.threadId || !state.threadType) {
    return null;
  }

  if (!popupWindow || popupWindow.isDestroyed()) {
    popupWindow = createPopupWindow();
  }

  lastState = state;
  popupWindow.webContents.send(STATE_CHANNEL, state);
  revealPopup(popupWindow);

  return popupWindow;
};

/** Report the outcome of a send so the box can close or show the failure. */
const reportQuickReplyResult = (result) => {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  popupWindow.webContents.send(RESULT_CHANNEL, result);

  // Only a success closes it. A failure keeps the window — and the text the
  // person typed — so the message is not silently lost to a dropped request.
  if (result && result.ok) {
    popupWindow.hide();
  }
};

const hideQuickReply = () => {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  popupWindow.hide();
};

/** Release the window. A live one would keep the app alive after quit. */
const destroyQuickReply = () => {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }
  popupWindow = null;
  lastState = null;
};

/**
 * Register the single handler that receives a typed reply.
 *
 * Replaces rather than appends, like the idle popup's: a stale handler left by
 * a renderer reload would send every reply twice.
 */
const onQuickReplySubmit = (handler) => {
  submitHandler = typeof handler === 'function' ? handler : null;
};

const onQuickReplyCancel = (handler) => {
  cancelHandler = typeof handler === 'function' ? handler : null;
};

/** Register the handler for "open the full conversation instead". */
const onQuickReplyOpen = (handler) => {
  openHandler = typeof handler === 'function' ? handler : null;
};

ipcMain.on(SUBMIT_CHANNEL, (_event, payload) => {
  const text = String((payload && payload.text) || '').trim();
  if (!text || !lastState) return;

  if (submitHandler) {
    submitHandler({
      threadType: lastState.threadType,
      threadId: lastState.threadId,
      text,
    });
  }
});

ipcMain.on(CANCEL_CHANNEL, () => {
  hideQuickReply();
  if (cancelHandler) cancelHandler();
});

ipcMain.on(OPEN_CHANNEL, () => {
  const state = lastState;
  hideQuickReply();
  if (openHandler && state) openHandler(state);
});

ipcMain.on(READY_CHANNEL, () => {
  if (popupWindow && !popupWindow.isDestroyed() && lastState) {
    popupWindow.webContents.send(STATE_CHANNEL, lastState);
  }
});

module.exports = {
  showQuickReply,
  hideQuickReply,
  destroyQuickReply,
  reportQuickReplyResult,
  onQuickReplySubmit,
  onQuickReplyCancel,
  onQuickReplyOpen,
  resolvePopupBounds,
  STATE_CHANNEL,
  SUBMIT_CHANNEL,
  RESULT_CHANNEL,
  CANCEL_CHANNEL,
  OPEN_CHANNEL,
  READY_CHANNEL,
  POPUP_PAGE,
  POPUP_WIDTH,
  POPUP_HEIGHT,
};
