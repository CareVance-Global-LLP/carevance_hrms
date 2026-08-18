const path = require('path');
const { BrowserWindow, ipcMain, screen } = require('electron');

/**
 * The idle warning, as a window the operating system puts in front of things.
 *
 * The countdown used to be a React component inside the app window
 * (frontend/src/components/desktop/IdleStopWarning.tsx, mounted in Layout).
 * That made it invisible in exactly the situation it exists for: somebody
 * stepped away, so the CareVance window is behind a browser, minimised, or on
 * another monitor. The first they knew of the stop was that their timer was
 * gone.
 *
 * This owns none of the idle rules. It renders what the tracker tells it and
 * reports which button was pressed; the thresholds, the stop call and the
 * keep/discard resolution all stay where they already live. A second copy of
 * those rules that could drift out of step with the tracker is precisely what
 * this must not become.
 */

const POPUP_WIDTH = 360;
const POPUP_HEIGHT = 208;
// Clear of the taskbar/dock without looking detached from the corner.
const POPUP_MARGIN = 24;

const STATE_CHANNEL = 'idle-popup:state';
const ACTION_CHANNEL = 'idle-popup:action';
const READY_CHANNEL = 'idle-popup:ready';

const POPUP_PAGE = path.join(__dirname, 'idle-popup', 'idle-popup.html');

let popupWindow = null;
let actionHandler = null;
/**
 * The most recent state, replayed when the page reports itself ready.
 *
 * `webContents.send` before the renderer has loaded is dropped on the floor,
 * and the first state is sent in the same breath as the window is created — so
 * without this the popup would open blank and stay blank until the next tick.
 */
let lastState = null;

/**
 * Bottom-right of the screen the person is actually looking at.
 *
 * Keyed off the cursor rather than the primary display: on a two-monitor desk
 * the main window is routinely on one screen and the person on the other, and a
 * warning that opens where nobody is looking is the failure this whole popup
 * exists to fix.
 *
 * Measured against `workArea`, not `bounds`, so it never lands under the
 * taskbar — where it would be exactly as invisible as the in-app toast was.
 */
const resolvePopupBounds = () => {
  const cursor = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cursor);
  const area = display.workArea;

  // Clamped rather than assumed to fit: a small or scaled display can be
  // narrower than the popup, and a negative origin would push it off-screen.
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
    // The tracker ticks this popup every second while a countdown is running.
    // Throttled timers would freeze the countdown the moment the popup lost
    // focus, which — since it never takes focus — is always.
    webPreferences: {
      preload: path.join(__dirname, 'idle-popup-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  window.on('closed', () => {
    popupWindow = null;
  });

  void window.loadFile(POPUP_PAGE);

  return window;
};

/** Put the popup in front, and keep it there. */
const revealPopup = (window) => {
  window.setBounds(resolvePopupBounds());
  // Re-asserted on every reveal, not just at creation: another application
  // raising itself to the top can displace an always-on-top window, and the
  // reveal is the moment that matters.
  window.setAlwaysOnTop(true, 'screen-saver');
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // showInactive, never show: the person may be typing in another application,
  // and a window that grabs focus would eat those keystrokes. It also cannot
  // help — the popup is read, not typed into.
  window.showInactive();
};

/**
 * Show the popup, or update the one already open.
 *
 * @param {{mode: 'warning'|'stopped'|'return', secondsRemaining?: number|null,
 *   idleSeconds?: number, activityId?: number|null, canKeep?: boolean}} state
 */
const showIdlePopup = (state) => {
  if (!popupWindow || popupWindow.isDestroyed()) {
    popupWindow = createPopupWindow();
  }

  lastState = state;
  popupWindow.webContents.send(STATE_CHANNEL, state);

  // Only when it is not already up. Re-revealing every second would re-run the
  // window-manager raise once per tick, which flickers on Windows and fights
  // whatever the person alt-tabbed to.
  if (!popupWindow.isVisible()) {
    revealPopup(popupWindow);
  }

  return popupWindow;
};

/**
 * Take the popup off screen, keeping the window for the next idle stretch.
 *
 * Hiding rather than destroying because idle is a recurring event and window
 * creation is the expensive part — a destroy/create cycle per idle stretch
 * would show a visible blank frame while the page reloaded.
 */
const hideIdlePopup = () => {
  if (!popupWindow || popupWindow.isDestroyed()) return;
  lastState = null;
  popupWindow.hide();
};

/** Release the window. Called on quit; a live window would keep the app alive. */
const destroyIdlePopup = () => {
  if (popupWindow && !popupWindow.isDestroyed()) {
    popupWindow.destroy();
  }
  popupWindow = null;
  lastState = null;
};

/**
 * Register the one handler that receives popup button presses.
 *
 * Replaces any previous handler rather than adding to a list — there is exactly
 * one tracker to route these to, and a stale second handler from a renderer
 * reload would double-report every click.
 */
const onIdlePopupAction = (handler) => {
  actionHandler = typeof handler === 'function' ? handler : null;
};

ipcMain.on(ACTION_CHANNEL, (_event, payload) => {
  if (actionHandler) actionHandler(payload);
});

ipcMain.on(READY_CHANNEL, () => {
  if (popupWindow && !popupWindow.isDestroyed() && lastState) {
    popupWindow.webContents.send(STATE_CHANNEL, lastState);
  }
});

module.exports = {
  showIdlePopup,
  hideIdlePopup,
  destroyIdlePopup,
  onIdlePopupAction,
  resolvePopupBounds,
  STATE_CHANNEL,
  ACTION_CHANNEL,
  READY_CHANNEL,
  POPUP_PAGE,
  POPUP_WIDTH,
  POPUP_HEIGHT,
};
