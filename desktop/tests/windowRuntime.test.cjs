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
  assert.match(
    mainSource,
    /app\.on\('second-instance'[\s\S]*mainWindow\.focus\(\)/,
    'A second launch should focus the existing window instead of starting another bridge owner.'
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
