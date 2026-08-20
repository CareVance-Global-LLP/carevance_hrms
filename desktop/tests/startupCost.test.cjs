const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');

/*
 * What the app does before it puts a window on screen.
 *
 * Reported 19 Aug 2026 as "the desktop app takes too much time to open". Three
 * separate things sat in front of the first painted frame, none of which the
 * frame needed, so they are pinned here individually — each one is cheap to
 * reintroduce by accident when adding the next piece of start-up work.
 */

const whenReadyIndex = mainSource.indexOf('app.whenReady()');
const startupSource = mainSource.slice(whenReadyIndex);

test('the window is created before the offline stack is initialised', () => {
  assert.ok(whenReadyIndex >= 0, 'expected an app.whenReady() block in main.cjs');

  const createWindowIndex = startupSource.indexOf('void createWindow();');
  const offlineOpenIndex = startupSource.indexOf('await offlineDb.open()');

  assert.ok(createWindowIndex >= 0, 'start-up must create the main window');
  assert.ok(offlineOpenIndex >= 0, 'start-up must still open the offline database');

  /*
   * The offline database is sql.js: instantiating its WASM runtime and reading
   * the database file off disk is slow, and it used to run — along with the
   * browser-tracking bridge binding its HTTP listener — before the
   * BrowserWindow was constructed. Neither is a prerequisite of a painted
   * frame, so all it bought was a longer stare at nothing.
   */
  assert.ok(
    createWindowIndex < offlineOpenIndex,
    'createWindow() must run before the offline database is opened, so the renderer download overlaps local initialisation instead of queueing behind it.'
  );
});

test('the login item is registered after the window, not before it', () => {
  const createWindowIndex = startupSource.indexOf('void createWindow();');
  const autoStartIndex = startupSource.indexOf('setupStrongAutoStart();');

  assert.ok(autoStartIndex >= 0, 'start-up must still register the login item');

  /*
   * setupStrongAutoStart spawns schtasks.exe and reg.exe synchronously. That
   * cost belongs to the NEXT boot's start-up, so it has no business blocking
   * this one's window.
   */
  assert.ok(
    createWindowIndex < autoStartIndex,
    'setupStrongAutoStart() spawns schtasks.exe and reg.exe synchronously and must not sit in front of createWindow().'
  );
});

test('the renderer HTTP cache is dropped per build, not per launch', () => {
  const guarded = mainSource.match(/if \(app\.isPackaged && IS_REMOTE_APP_URL\) \{[\s\S]*?\n  \}\n/);

  assert.ok(guarded, 'expected the packaged/remote cache-maintenance block to still exist');
  assert.match(
    guarded[0],
    /previousBuild !== currentBuild/,
    /*
     * This was an unconditional session.clearCache() on every packaged launch
     * against the remote APP_URL, which threw away the whole renderer bundle —
     * every chunk, stylesheet, font and image — and re-downloaded it before the
     * window could paint. It bought nothing: Vite emits content-hashed
     * filenames, so a chunk file is immutable and cannot go stale. Only
     * index.html can, and the navigation revalidates that anyway.
     */
    'clearCache() must be keyed on the build having changed, not run on every launch — an unconditional wipe re-downloads the entire renderer bundle before the window can paint.'
  );

  // `session.clearCache()` rather than bare `clearCache()`, so the phrase in the
  // comment above the guard is not counted as a second call site.
  const clearCacheCalls = mainSource.match(/session\.clearCache\(\)/g) || [];
  assert.equal(
    clearCacheCalls.length,
    1,
    'expected exactly one session.clearCache() call, inside the build-changed guard.'
  );
});
