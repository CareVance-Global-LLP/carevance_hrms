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
    // The label reads from brand.cjs now, so match whatever expression carries
    // it. What this test is about is the WIRING underneath: pinning the literal
    // made a rebrand look like a broken tray.
    /label:\s*(?:'[^']*'|`[^`]*`),\s*click:\s*\(\)\s*=>\s*{\s*openOrRevealMainWindow\(\);?\s*}/,
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

/*
 * Removing the menu bar to hide DevTools also removed Reload, which lives on
 * the same View menu. The symptom was Ctrl+R doing nothing on a stuck page —
 * the app looked frozen rather than reloadable.
 */
test('reload is reachable by keyboard even with no application menu', () => {
  assert.match(
    mainSource,
    /Menu\.setApplicationMenu\(null\)/,
    'The stock menu bar must stay off — it carries Toggle Developer Tools.'
  );

  assert.match(
    mainSource,
    /before-input-event[\s\S]{0,900}f5[\s\S]{0,200}input\.control/i,
    'Ctrl+R and F5 must be handled directly, since the menu that used to carry them is gone.'
  );
});

test('the reload shortcut escapes the offline fallback rather than reloading it', () => {
  /*
   * webContents.reload() on the offline fallback page reloads the FALLBACK —
   * the very screen somebody is pressing Ctrl+R to get out of. reloadRemoteUrl
   * clears that state and asks for the real app.
   */
  const start = mainSource.indexOf("before-input-event");
  assert.ok(start > -1, 'the before-input-event handler must exist');

  // A window of the handler body, taken by offset rather than by regex: the
  // block spans newlines and a multiline pattern here is more fragile than the
  // thing it is checking.
  const handler = mainSource.slice(start, start + 1200);

  assert.match(
    handler,
    /reloadRemoteUrl\(\)/,
    'the shortcut must call reloadRemoteUrl(), not webContents.reload().'
  );
  assert.doesNotMatch(
    handler,
    /openDevTools/,
    'restoring reload must not restore a devtools route.'
  );
});

test('the reload shortcut is window-scoped, not a global accelerator', () => {
  // A globalShortcut for Ctrl+R would swallow refresh in every other
  // application for as long as the tracker is running.
  assert.doesNotMatch(
    mainSource,
    /globalShortcut\.register\(\s*['"`]CommandOrControl\+R/i,
    'Ctrl+R must not be registered globally.'
  );
});

/*
 * Clicking a chat notification with the app closed opened the reply box and
 * nothing else — the tracker appeared not to start. Both click paths did
 * `revealMainWindow()` and then `if (mainWindow) send(...)`; with no window the
 * first returns false and the second is skipped, so the click was dropped.
 */
test('a notification click opens the app when no window exists', () => {
  assert.match(
    mainSource,
    /const deliverNotificationClick = \(/,
    'notification clicks must go through one delivery path.'
  );

  const start = mainSource.indexOf('const deliverNotificationClick');
  const body = mainSource.slice(start, start + 900);

  assert.match(
    body,
    /openOrRevealMainWindow\(\)/,
    'delivery must CREATE a window when none exists, not merely reveal one.'
  );
  assert.match(
    body,
    /pendingNotificationClick = payload/,
    'a click that arrives before the renderer is listening must be held, not dropped.'
  );
});

test('neither click path reveals-and-hopes any more', () => {
  // The old shape: revealMainWindow() followed by a guarded send. Both callers
  // are now one line, so the pattern should not appear near either of them.
  const quickReply = mainSource.indexOf('onQuickReplyOpen');
  assert.ok(quickReply > -1, 'the quick-reply open handler must exist');

  assert.match(
    mainSource.slice(quickReply, quickReply + 300),
    /deliverNotificationClick\(/,
    'the quick-reply "Open chat" route must use the shared delivery.'
  );
});

test('a held click is flushed once the renderer is listening', () => {
  assert.match(
    mainSource,
    /flushPendingNotificationClick\(\);/,
    'the queued click must be delivered when the renderer becomes ready.'
  );

  const flush = mainSource.indexOf('const flushPendingNotificationClick');
  const body = mainSource.slice(flush, flush + 500);

  assert.match(
    body,
    /pendingNotificationClick = null;/,
    'the held click must be cleared when delivered, so it fires once and not on every load.'
  );
});

/*
 * The shell owns auxiliary windows — the quick-reply box and the idle popup —
 * and they outlive the main window. Reaching for "some window" therefore
 * reaches for one of THOSE once the tracker is closed, which is how reopening
 * the app surfaced the reply box and never built the tracker.
 */
test('revealing the app targets the main window and nothing else', () => {
  const start = mainSource.indexOf('const revealMainWindow = () => {');
  assert.ok(start > -1, 'revealMainWindow must exist');
  // A fixed window rather than scanning for a closing brace: the function is
  // well under this, and a newline-bearing search string is more fragile than
  // the thing it is checking.
  const body = mainSource.slice(start, start + 1600);

  // The assignment itself, not the prose around it — the comment above it
  // names getAllWindows() precisely because that is what went wrong.
  const assignment = body.match(/const targetWindow = .*/);
  assert.ok(assignment, 'revealMainWindow must resolve a target window');

  assert.doesNotMatch(
    assignment[0],
    /getAllWindows\(\)/,
    'a hidden reply popup would be picked up as "the app" and shown instead of the tracker.'
  );
  assert.match(
    assignment[0],
    /mainWindow && !mainWindow\.isDestroyed\(\)/,
    'it must check the main window specifically.'
  );
  assert.match(
    body,
    /return false;/,
    'with no main window it must report failure, which is what makes the caller build one.'
  );
});

test('reopening never decides the app is running by counting windows', () => {
  // `getAllWindows().length === 0` has the same flaw: a hidden popup makes the
  // count non-zero while the tracker itself is gone.
  assert.doesNotMatch(
    mainSource,
    /getAllWindows\(\)\.length === 0\)\s*createWindow\(\)/,
    'window-count checks must not stand in for "is the tracker open".'
  );
  assert.match(
    mainSource,
    /app\.on\('activate',[\s\S]{0,600}?openOrRevealMainWindow\(\)/,
    'activate must route through the helper that knows what the main window is.'
  );
});

/*
 * Quitting used to send `desktop:prepare-close` and quit in the same breath.
 * The renderer's handler is async — it flushes activity, then awaits
 * timeEntryApi.stop() — so the process was gone before either finished and the
 * running timer was never stopped. It kept running server-side with no activity
 * arriving, and the idle sweep closed it as abandoned: the person quit from the
 * tray and was later told they had been idle.
 *
 * Closing the window already waited properly. Quitting means the same thing and
 * must wait the same way.
 */
test('quitting waits for the renderer to stop the timer', () => {
  const start = mainSource.lastIndexOf("app.on('before-quit'");
  assert.ok(start > -1, 'a before-quit handler must exist');
  const body = mainSource.slice(start, start + 2600);

  assert.match(
    body,
    /event\.preventDefault\(\)/,
    'quit must be deferred until the timer has actually been stopped.'
  );
  assert.match(
    body,
    /desktop:prepare-close/,
    'the renderer still has to be asked to flush and stop.'
  );
  assert.match(
    body,
    /setTimeout\(/,
    'a hung or offline renderer must not hold the app open forever.'
  );
});

test('the quit handler actually receives the event it defers', () => {
  // `app.on('before-quit', () => {...})` with a preventDefault inside is a
  // ReferenceError at quit time — the one moment nobody is watching the console.
  const start = mainSource.lastIndexOf("app.on('before-quit'");
  const signature = mainSource.slice(start, start + 40);

  assert.match(
    signature,
    /before-quit',\s*\(event\)/,
    'the handler must declare the event parameter it calls preventDefault on.'
  );
});

test('close and quit are told apart when the renderer confirms', () => {
  // Both paths answer on the same channel. Quitting must finish the quit, not
  // merely close the window and leave the app alive in the tray.
  const start = mainSource.indexOf("desktop:confirm-close-ready");
  assert.ok(start > -1, 'the confirmation channel must exist');
  const body = mainSource.slice(start, start + 900);

  assert.match(
    body,
    /quitConfirmHandler/,
    'the confirmation must know whether a quit or a window close is waiting on it.'
  );
});
