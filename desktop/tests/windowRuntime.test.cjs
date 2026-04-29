const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const mainSource = fs.readFileSync(path.resolve(__dirname, '..', 'main.cjs'), 'utf8');

test('desktop tracker keeps renderer timers active while the window is in the background', () => {
  assert.match(
    mainSource,
    /webPreferences:\s*{[\s\S]*backgroundThrottling:\s*false/,
    'BrowserWindow webPreferences must disable backgroundThrottling so screenshot intervals keep firing when minimized or unfocused.'
  );
});
