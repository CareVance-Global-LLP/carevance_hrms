const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', 'package.json'), 'utf8'));

test('desktop tracker keeps renderer timers active while the window is in the background', () => {
  assert.match(
    mainSource,
    /webPreferences:\s*{[\s\S]*backgroundThrottling:\s*false/,
    'BrowserWindow webPreferences must disable backgroundThrottling so screenshot intervals keep firing when minimized or unfocused.'
  );
});

test('desktop tracker enforces one bridge-owning app instance', () => {
  assert.match(
    mainSource,
    /app\.requestSingleInstanceLock\(\)/,
    'The desktop app must prevent duplicate instances from competing for the browser tracking bridge port.'
  );
  /*
   * Focusing used to be written inline here as `mainWindow.focus()`. It now
   * lives in revealMainWindow, which every reopen path shares, so assert the
   * route and the focus separately rather than pinning to the old shape.
   */
  assert.match(
    mainSource,
    /app\.on\('second-instance'[\s\S]*openOrRevealMainWindow\(\)/,
    'A second launch should reopen the existing window instead of starting another bridge owner.'
  );
  assert.match(
    mainSource,
    /const revealMainWindow[\s\S]*targetWindow\.focus\(\)/,
    'Revealing a window has to actually focus it, or a second launch leaves it behind other windows.'
  );
});

test('browser tracking pairing codes are created only after the bridge is ready', () => {
  assert.match(
    mainSource,
    /ensureBrowserTrackingBridgeReady/,
    'Pairing code creation should verify that the loopback bridge is listening.'
  );
  assert.match(
    mainSource,
    /Browser tracking bridge is unavailable/,
    'The desktop app should surface bridge startup failures instead of showing unusable pairing codes.'
  );
});

test('desktop foreground app tracking has its active-window dependency installed', () => {
  assert.equal(
    packageJson.dependencies?.['get-windows'],
    '^9.3.0',
    'The desktop app imports get-windows to recognize focused apps like Codex and WhatsApp.'
  );
  assert.match(
    mainSource,
    /import\('get-windows'\)/,
    'Foreground app tracking should use the installed get-windows package.'
  );
});

/*
 * Closing the window does not quit the app — `window-all-closed` keeps it alive
 * in the tray on Windows. That left the tray as the only way back, and both of
 * its handlers were written as `if (mainWindow && !mainWindow.isDestroyed())`
 * with no else, so once the window was actually closed they did nothing at all:
 * the icon stayed in the notification area and every click on it was a no-op.
 * `second-instance` already knew to build a window when none was left; the tray
 * never learned. Every "bring the app back" path has to go through one helper
 * that can create as well as reveal.
 */
/*
 * The tray's menu is built in applyTrayState now, not createTray.
 *
 * The menu became state-dependent when the tray gained a timer status - it is
 * rebuilt on every start and stop so the first row can report whether a timer
 * is running. createTray now only constructs the Tray and delegates. Both
 * functions are read here so the assertions below still cover the whole
 * surface rather than whichever half the item happens to sit in.
 */
const trayBody = (() => {
  const slice = (from, to) => {
    const start = mainSource.indexOf(from);
    if (start === -1) return '';
    const end = mainSource.indexOf(to, start);
    return end === -1 ? mainSource.slice(start) : mainSource.slice(start, end);
  };

  return slice('const applyTrayState = () => {', 'const setTrayTimerState')
    + slice('const createTray = () => {', 'const checkForDesktopUpdates');
})();

test('the tray can reopen the window after it has been closed', () => {
  assert.notEqual(trayBody, '', 'createTray must be findable in main.cjs for this test to mean anything.');

  assert.match(
    trayBody,
    /label:\s*'Open CareVance Tracker',\s*click:\s*\(\)\s*=>\s*{\s*openOrRevealMainWindow\(\);?\s*}/,
    'The tray menu item must route through openOrRevealMainWindow, which builds a window when none is left.'
  );
  assert.match(
    trayBody,
    /tray\.on\('double-click',\s*\(\)\s*=>\s*{\s*openOrRevealMainWindow\(\);?\s*}\)/,
    'Double-clicking the tray icon must route through openOrRevealMainWindow too.'
  );
  assert.doesNotMatch(
    trayBody,
    /mainWindow\s*&&\s*!mainWindow\.isDestroyed\(\)/,
    'A bare isDestroyed guard in the tray is the bug: with the window closed it silently does nothing.'
  );
});

test('reopening falls back to building a window when every window is gone', () => {
  const helper = (() => {
    const start = mainSource.indexOf('const openOrRevealMainWindow = () => {');
    if (start === -1) return '';
    return mainSource.slice(start, mainSource.indexOf('\n};', start));
  })();

  assert.notEqual(helper, '', 'main.cjs must define openOrRevealMainWindow.');
  assert.match(
    helper,
    /revealMainWindow\(\)/,
    'Reveal the existing window first when there is one.'
  );
  assert.match(
    helper,
    /createWindow\(\)/,
    'With no window left, revealing is impossible — build one instead.'
  );
});

test('a second launch reuses the same reopen path as the tray', () => {
  assert.match(
    mainSource,
    /app\.on\('second-instance',\s*\(\)\s*=>\s*{[\s\S]{0,900}?openOrRevealMainWindow\(\)/,
    'second-instance must share the tray reopen helper rather than reimplementing reveal-then-create.'
  );
});

/*
 * Packaging allowlist vs what main.cjs actually loads.
 *
 * `build.files` is an ALLOWLIST: anything not matched by a pattern is left out
 * of the asar. `browser-url/` was added to the source tree and required at the
 * top of main.cjs, but never added to that list — so the packaged app died on
 * launch with MODULE_NOT_FOUND before a window ever appeared, while `npm start`
 * (which runs from the source tree, no allowlist involved) stayed perfectly
 * fine. Nothing in the suite could see the difference. This closes that gap.
 */
const filesAllowlist = packageJson.build?.files || [];

/**
 * Does an electron-builder files pattern cover this repo-relative path?
 *
 * Only the pattern shapes the manifest actually uses are handled: an exact
 * name, a recursive directory glob, and a single-level directory glob.
 * Deliberately not a general glob engine — a permissive-but-wrong matcher
 * would report coverage electron-builder does not actually give, which is
 * precisely the failure this test exists to catch.
 */
const allowlistCovers = (pattern, filePath) => {
  if (pattern === filePath) return true;

  if (pattern.endsWith('/**/*')) {
    return filePath.startsWith(pattern.slice(0, -4));
  }

  if (pattern.endsWith('/*')) {
    const dir = pattern.slice(0, -1);
    return filePath.startsWith(dir) && !filePath.slice(dir.length).includes('/');
  }

  return false;
};

test('every local module main.cjs requires is actually packaged', () => {
  const required = [...mainSource.matchAll(/require\('(\.\/[^']+)'\)/g)]
    .map((match) => match[1].replace(/^\.\//, ''));

  assert.ok(required.length > 0, 'expected main.cjs to require local modules');

  const missing = required.filter(
    (filePath) => !filesAllowlist.some((pattern) => allowlistCovers(pattern, filePath))
  );

  assert.deepEqual(
    missing,
    [],
    'these modules are required at runtime but excluded from build.files, so the '
      + 'packaged app crashes on launch: ' + missing.join(', ')
  );
});

test('a runtime asset loaded beside its module is packaged with it', () => {
  // browser-url-reader.cjs resolves read-foreground-url.ps1 via __dirname, so
  // shipping the .cjs without the .ps1 yields a reader that cannot read.
  assert.ok(
    filesAllowlist.some((pattern) => allowlistCovers(pattern, 'browser-url/read-foreground-url.ps1')),
    'the PowerShell foreground-URL helper must ship alongside its reader.'
  );
});

test('no packaging script can bake a loopback app URL', () => {
  const scripts = packageJson.scripts || {};
  const packaging = Object.keys(scripts).filter((name) => /^(pack|dist)/.test(name));

  assert.ok(packaging.length > 0, 'expected packaging scripts to exist');

  const unguarded = packaging.filter((name) => !scripts[name].includes('--require-remote'));

  assert.deepEqual(
    unguarded,
    [],
    'these scripts package without --require-remote, so they silently ship an '
      + 'installer pointing at localhost: ' + unguarded.join(', ')
  );
});

test('the PowerShell helper is unpacked, not sealed inside the asar', () => {
  /*
   * powershell.exe is a separate process. app.asar is one archive file, so a
   * path inside it exists only to Node's patched fs — an external process is
   * handed a path that is not on disk, the helper never starts, and every read
   * returns null.
   *
   * That failure is silent: "no url" is indistinguishable from "not on a
   * browser". Every packaged install therefore had no URL for any tab, so the
   * tracker keyed sessions on the churning window title — one row per title
   * flicker, each named after the browser rather than the site. Reproduced on
   * installed builds only; `npm start` runs unpacked and looks fine.
   */
  const unpack = (packageJson.build || {}).asarUnpack || [];

  assert.ok(
    unpack.some((pattern) => allowlistCovers(pattern, 'browser-url/read-foreground-url.ps1')),
    'read-foreground-url.ps1 must be in asarUnpack: powershell.exe cannot read a path inside app.asar.'
  );
});

test('the reader resolves the helper to the unpacked path', () => {
  // Unpacking alone is not enough: __dirname still points inside app.asar, so
  // the path has to be rewritten or it names a file that is not there.
  const source = fs.readFileSync(path.join(__dirname, '..', 'browser-url', 'browser-url-reader.cjs'), 'utf8');

  assert.match(
    source,
    /app\.asar\.unpacked/,
    'browser-url-reader.cjs must rewrite app.asar -> app.asar.unpacked when resolving the helper.'
  );
});
