const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');

const AUTO_START_PATH = require.resolve('../auto-start.cjs');
const DESKTOP_DIR = path.resolve(__dirname, '..');

/**
 * Load auto-start.cjs against a stubbed electron `app` and a stubbed execSync,
 * so the real registry and Task Scheduler are never touched by the test.
 */
const withAutoStart = ({ isPackaged, execPath }, run) => {
  const calls = { setLoginItemSettings: [], getLoginItemSettings: [], exec: [] };

  const electronStub = {
    app: {
      isPackaged,
      setLoginItemSettings: (settings) => {
        calls.setLoginItemSettings.push(settings);
      },
      getLoginItemSettings: (query) => {
        calls.getLoginItemSettings.push(query);
        return { openAtLogin: calls.setLoginItemSettings.length > 0 };
      },
      getPath: () => path.join(DESKTOP_DIR, 'test-userdata'),
    },
  };

  const originalLoad = Module._load;
  const originalExecPath = process.execPath;

  Module._load = function (request, parent, isMain) {
    if (request === 'electron') return electronStub;
    if (request === 'child_process') {
      return {
        execSync: (command) => {
          calls.exec.push(command);
        },
      };
    }
    return originalLoad.apply(this, arguments);
  };

  // The stubs must stay installed for the CALL, not just the require:
  // auto-start reads process.execPath and app.isPackaged when it runs.
  try {
    Object.defineProperty(process, 'execPath', { value: execPath, configurable: true });
    delete require.cache[AUTO_START_PATH];
    // eslint-disable-next-line global-require
    const autoStart = require(AUTO_START_PATH);
    return run(autoStart, calls);
  } finally {
    Module._load = originalLoad;
    Object.defineProperty(process, 'execPath', { value: originalExecPath, configurable: true });
    delete require.cache[AUTO_START_PATH];
  }
};

test('unpackaged auto-start passes the app directory, so boot does not land on Electron default app', (t) => {
  if (process.platform !== 'win32') {
    t.skip('auto-start is Windows-only');
    return;
  }

  const electronExe = path.join(DESKTOP_DIR, 'node_modules', 'electron', 'dist', 'electron.exe');
  withAutoStart({ isPackaged: false, execPath: electronExe }, (autoStart, calls) => {
    autoStart.setupStrongAutoStart();

    assert.equal(calls.setLoginItemSettings.length, 1, 'the login item should be written exactly once');
    const settings = calls.setLoginItemSettings[0];
    assert.equal(settings.openAtLogin, true);
    assert.equal(settings.path, electronExe);
    assert.deepEqual(
      settings.args,
      [`"${DESKTOP_DIR}"`],
      'electron.exe with no app directory boots into Electron\'s built-in welcome window instead of CareVance'
    );
  });
});

test('packaged auto-start launches the app exe with no extra arguments', (t) => {
  if (process.platform !== 'win32') {
    t.skip('auto-start is Windows-only');
    return;
  }

  const appExe = 'C:\\Program Files\\CareVance Tracker\\CareVance Tracker.exe';
  withAutoStart({ isPackaged: true, execPath: appExe }, (autoStart, calls) => {
    autoStart.setupStrongAutoStart();

    const settings = calls.setLoginItemSettings[0];
    assert.equal(settings.path, appExe);
    assert.deepEqual(settings.args, [], 'the packaged exe IS the app and needs no app-directory argument');
  });
});

test('auto-start verifies the entry it wrote rather than assuming success', (t) => {
  if (process.platform !== 'win32') {
    t.skip('auto-start is Windows-only');
    return;
  }

  const appExe = 'C:\\Program Files\\CareVance Tracker\\CareVance Tracker.exe';
  withAutoStart({ isPackaged: true, execPath: appExe }, (autoStart, calls) => {
    autoStart.setupStrongAutoStart();

    assert.equal(calls.getLoginItemSettings.length, 1, 'setLoginItemSettings does not report failure on Windows');
    assert.deepEqual(calls.getLoginItemSettings[0], { path: appExe, args: [] });
  });
});

test('isAutoStartEnabled asks Electron, not the legacy Run value it deletes every launch', (t) => {
  if (process.platform !== 'win32') {
    t.skip('auto-start is Windows-only');
    return;
  }

  const appExe = 'C:\\Program Files\\CareVance Tracker\\CareVance Tracker.exe';
  withAutoStart({ isPackaged: true, execPath: appExe }, (autoStart, calls) => {
    assert.equal(autoStart.isAutoStartEnabled(), false, 'nothing written yet');
    autoStart.setupStrongAutoStart();
    assert.equal(autoStart.isAutoStartEnabled(), true, 'reports the state of the Electron login item');

    const registryQueries = calls.exec.filter((command) => command.startsWith('reg query'));
    assert.deepEqual(registryQueries, [], 'the legacy Run value is deleted on every launch, so querying it is meaningless');
  });
});
