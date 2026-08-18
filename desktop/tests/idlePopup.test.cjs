const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const IDLE_POPUP_PATH = require.resolve('../idle-popup.cjs');
const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8')
);

/**
 * A BrowserWindow that records what was done to it instead of opening one.
 *
 * Every method the popup calls has to exist here, because a missing one throws
 * inside the module under test and surfaces as an unrelated failure.
 */
class FakeBrowserWindow {
  constructor(options) {
    this.options = options;
    this.destroyed = false;
    this.visible = false;
    this.alwaysOnTop = null;
    this.workspaces = null;
    this.bounds = null;
    this.loadedFile = null;
    this.shownWithFocus = 0;
    this.shownWithoutFocus = 0;
    this.handlers = new Map();
    this.sent = [];
    this.webContents = {
      send: (channel, payload) => {
        this.sent.push({ channel, payload });
      },
      on: () => {},
      setWindowOpenHandler: () => {},
    };
    FakeBrowserWindow.created.push(this);
  }

  static created = [];

  loadFile(file) {
    this.loadedFile = file;
    return Promise.resolve();
  }

  on(event, handler) {
    this.handlers.set(event, handler);
  }

  once(event, handler) {
    this.handlers.set(event, handler);
  }

  emit(event, ...args) {
    const handler = this.handlers.get(event);
    if (handler) handler(...args);
  }

  show() {
    this.shownWithFocus += 1;
    this.visible = true;
  }

  showInactive() {
    this.shownWithoutFocus += 1;
    this.visible = true;
  }

  hide() {
    this.visible = false;
  }

  isVisible() {
    return this.visible;
  }

  destroy() {
    this.destroyed = true;
    this.visible = false;
  }

  isDestroyed() {
    return this.destroyed;
  }

  setAlwaysOnTop(flag, level) {
    this.alwaysOnTop = { flag, level };
  }

  setVisibleOnAllWorkspaces(flag, options) {
    this.workspaces = { flag, options };
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  getBounds() {
    return this.bounds ?? { x: 0, y: 0, width: 0, height: 0 };
  }
}

const display = (workArea) => ({ workArea, bounds: workArea, scaleFactor: 1 });

/**
 * Load idle-popup.cjs against a stubbed electron.
 *
 * `cursorPoint` and `displays` drive the placement assertions: the popup has to
 * land on the screen the person is actually looking at, which on a multi-monitor
 * desk is routinely not the primary one.
 */
const withIdlePopup = ({ cursorPoint, nearestDisplay } = {}, run) => {
  FakeBrowserWindow.created = [];

  const ipcListeners = new Map();
  const electronStub = {
    BrowserWindow: FakeBrowserWindow,
    ipcMain: {
      on: (channel, handler) => {
        ipcListeners.set(channel, handler);
      },
      removeAllListeners: (channel) => {
        ipcListeners.delete(channel);
      },
    },
    screen: {
      getCursorScreenPoint: () => cursorPoint ?? { x: 0, y: 0 },
      getDisplayNearestPoint: () =>
        nearestDisplay ?? display({ x: 0, y: 0, width: 1920, height: 1040 }),
      getPrimaryDisplay: () => display({ x: 0, y: 0, width: 1920, height: 1040 }),
    },
  };

  const originalLoad = Module._load;
  Module._load = function (request) {
    if (request === 'electron') return electronStub;
    return originalLoad.apply(this, arguments);
  };

  try {
    delete require.cache[IDLE_POPUP_PATH];
    // eslint-disable-next-line global-require
    const idlePopup = require(IDLE_POPUP_PATH);
    return run(idlePopup, FakeBrowserWindow.created, ipcListeners);
  } finally {
    Module._load = originalLoad;
    delete require.cache[IDLE_POPUP_PATH];
  }
};

test('the popup opens on the display holding the cursor, not the primary one', () => {
  // A second monitor to the right of a 1920-wide primary.
  const secondMonitor = display({ x: 1920, y: 0, width: 1280, height: 960 });

  withIdlePopup(
    { cursorPoint: { x: 2400, y: 400 }, nearestDisplay: secondMonitor },
    (idlePopup, created) => {
      idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });

      assert.equal(created.length, 1, 'one popup window should have been created');
      const bounds = created[0].bounds;
      assert.ok(bounds, 'the popup must be positioned explicitly');
      assert.ok(
        bounds.x >= secondMonitor.workArea.x,
        `popup x ${bounds.x} should sit on the second monitor starting at ${secondMonitor.workArea.x}`
      );
      assert.ok(
        bounds.x + bounds.width <= secondMonitor.workArea.x + secondMonitor.workArea.width,
        'the popup must fit inside the second monitor horizontally'
      );
      assert.ok(
        bounds.y + bounds.height <= secondMonitor.workArea.y + secondMonitor.workArea.height,
        'the popup must sit inside the work area, not under the taskbar'
      );
    }
  );
});

test('the popup appears without taking focus from whatever is in front', () => {
  withIdlePopup({}, (idlePopup, created) => {
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });

    const popup = created[0];
    assert.equal(
      popup.shownWithoutFocus,
      1,
      'the popup must use showInactive(); stealing focus would swallow keystrokes aimed at another app'
    );
    assert.equal(popup.shownWithFocus, 0, 'show() steals focus and must not be used');
  });
});

test('the popup draws over full-screen apps, including a presentation', () => {
  withIdlePopup({}, (idlePopup, created) => {
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });

    const popup = created[0];
    assert.deepEqual(
      popup.alwaysOnTop,
      { flag: true, level: 'screen-saver' },
      'a lower always-on-top level is painted over by full-screen windows, which is where this warning matters most'
    );
    assert.equal(
      popup.workspaces?.options?.visibleOnFullScreen,
      true,
      'on macOS the popup must survive a Space switch into a full-screen app'
    );
  });
});

test('repeated ticks update the one popup instead of stacking new windows', () => {
  withIdlePopup({}, (idlePopup, created) => {
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 44, idleSeconds: 256 });
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 43, idleSeconds: 257 });

    assert.equal(
      created.length,
      1,
      'the tracker ticks every second; creating a window per tick would carpet the screen'
    );
  });
});

test('each tick sends the new countdown to the popup so it does not freeze', () => {
  withIdlePopup({}, (idlePopup, created) => {
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 44, idleSeconds: 256 });

    const states = created[0].sent
      .filter((message) => message.channel === 'idle-popup:state')
      .map((message) => message.payload.secondsRemaining);

    assert.deepEqual(states, [45, 44], 'every tick must reach the popup, or the countdown stalls');
  });
});

test('hiding the popup keeps the window, so the next idle stretch reuses it', () => {
  withIdlePopup({}, (idlePopup, created) => {
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });
    idlePopup.hideIdlePopup();

    assert.equal(created[0].isVisible(), false, 'the popup should be hidden when the person returns');
    assert.equal(created[0].isDestroyed(), false, 'hiding must not destroy the reusable window');

    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 30, idleSeconds: 270 });
    assert.equal(created.length, 1, 'showing again should revive the hidden window');
  });
});

test('destroying the popup releases the window, so quitting is not blocked', () => {
  withIdlePopup({}, (idlePopup, created) => {
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });
    idlePopup.destroyIdlePopup();

    assert.equal(created[0].isDestroyed(), true, 'a surviving popup window keeps the app alive after quit');
  });
});

test('a button press in the popup reaches the registered handler', () => {
  withIdlePopup({}, (idlePopup, created, ipcListeners) => {
    const actions = [];
    idlePopup.onIdlePopupAction((action) => actions.push(action));

    idlePopup.showIdlePopup({ mode: 'return', idleSeconds: 720, activityId: 91 });

    const listener = ipcListeners.get('idle-popup:action');
    assert.ok(listener, 'the popup must register an action channel, or its buttons do nothing');
    listener({}, { action: 'keep' });

    assert.deepEqual(actions, [{ action: 'keep' }]);
  });
});

test('the popup loads its own page rather than the app renderer', () => {
  withIdlePopup({}, (idlePopup, created) => {
    idlePopup.showIdlePopup({ mode: 'warning', secondsRemaining: 45, idleSeconds: 255 });

    assert.match(
      String(created[0].loadedFile).replace(/\\/g, '/'),
      /idle-popup\/idle-popup\.html$/,
      'the popup must load a bundled local page, so it still works while the renderer is offline or reloading'
    );
  });
});

test('the installer ships the popup, so it is not a dev-only feature', () => {
  const files = packageJson.build?.files ?? [];

  for (const required of ['idle-popup.cjs', 'idle-popup-preload.cjs', 'idle-popup/**/*']) {
    assert.ok(
      files.includes(required),
      `electron-builder must package ${required}; omitting it leaves the packaged app calling loadFile on a path that does not exist, which fails only in the installed build`
    );
  }
});
