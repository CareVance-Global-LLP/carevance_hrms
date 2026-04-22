const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { prepareManagedBrowserTrackingExtensionDir } = require('../browser-tracking-install-guide.cjs');

test('prepareManagedBrowserTrackingExtensionDir copies into a managed folder without mutating an existing user folder', () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-tracking-guide-'));
  const sourceDir = path.join(sandboxRoot, 'source', 'chromium');
  const userDataPath = path.join(sandboxRoot, 'userdata');
  const existingUserDir = path.join(userDataPath, 'browser-extension', 'chromium');

  fs.mkdirSync(sourceDir, { recursive: true });
  fs.mkdirSync(existingUserDir, { recursive: true });
  fs.writeFileSync(path.join(sourceDir, 'manifest.json'), JSON.stringify({ version: '1.2.3' }), 'utf8');
  fs.writeFileSync(path.join(sourceDir, 'service-worker.js'), 'console.log("tracked");', 'utf8');
  fs.writeFileSync(path.join(existingUserDir, 'custom.txt'), 'keep me', 'utf8');

  const managedDir = prepareManagedBrowserTrackingExtensionDir({
    sourceDir,
    userDataPath,
    browserName: 'chrome',
    appVersion: '1.0.12',
  });

  assert.ok(managedDir.includes(path.join('browser-extension', 'managed')));
  assert.equal(fs.readFileSync(path.join(existingUserDir, 'custom.txt'), 'utf8'), 'keep me');
  assert.equal(
    fs.readFileSync(path.join(managedDir, 'service-worker.js'), 'utf8'),
    'console.log("tracked");'
  );
});
