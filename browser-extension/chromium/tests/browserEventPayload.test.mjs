import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const loadRuntimeModule = async (relativePath) => {
  const filePath = path.resolve(process.cwd(), relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  const encodedSource = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encodedSource}`);
};

const serviceWorker = await loadRuntimeModule(
  'browser-extension/chromium/service-worker.js'
);
const optionsPage = await loadRuntimeModule('browser-extension/chromium/options.js');

test('service worker buildBrowserTrackingEvent emits an exact website payload for a focused https tab', () => {
  const event = serviceWorker.buildBrowserTrackingEvent({
    kind: 'tab-focused',
    browserName: 'chrome',
    profileKey: 'profile-a',
    recordedAt: '2026-04-21T11:28:54.000Z',
    tab: {
      id: 91,
      windowId: 5,
      url: 'https://gemini.google.com/app',
      title: 'Gemini',
    },
  });

  assert.deepEqual(event, {
    kind: 'tab-focused',
    browser_name: 'chrome',
    profile_key: 'profile-a',
    tab_id: 91,
    window_id: 5,
    url: 'https://gemini.google.com/app',
    title: 'Gemini',
    recorded_at: '2026-04-21T11:28:54.000Z',
  });
});

test('service worker internal browser surfaces never claim an exact website identity', () => {
  assert.equal(serviceWorker.isTrackableBrowserUrl('chrome://newtab/'), false);
  assert.equal(serviceWorker.isTrackableBrowserUrl('edge://settings/'), false);
  assert.equal(
    serviceWorker.buildBrowserTrackingEvent({
      kind: 'tab-focused',
      browserName: 'chrome',
      profileKey: 'profile-a',
      recordedAt: '2026-04-21T11:29:02.000Z',
      tab: {
        id: 92,
        windowId: 5,
        url: 'chrome://newtab/',
        title: 'New Tab',
      },
    }),
    null
  );
});

test('service worker preserves tab close events even when the browser already dropped the url', () => {
  const event = serviceWorker.buildBrowserTrackingEvent({
    kind: 'tab-closed',
    browserName: 'chrome',
    profileKey: 'profile-a',
    recordedAt: '2026-04-21T11:31:20.000Z',
    tab: {
      id: 91,
      windowId: 5,
      url: '',
      title: 'Gemini',
    },
  });

  assert.deepEqual(event, {
    kind: 'tab-closed',
    browser_name: 'chrome',
    profile_key: 'profile-a',
    tab_id: 91,
    window_id: 5,
    url: null,
    title: 'Gemini',
    recorded_at: '2026-04-21T11:31:20.000Z',
  });
});

test('options buildBrowserBridgeCredential stores a pairing record per browser profile', () => {
  assert.deepEqual(
    optionsPage.buildBrowserBridgeCredential({
      browserProfileId: 'browser-profile-a',
      pairingCode: 'PAIR-1234',
      pairedAt: '2026-04-21T11:30:00.000Z',
      localUrl: 'http://127.0.0.1:38947',
      bearerToken: 'token-123',
      extensionOrigin: 'chrome-extension://abc123',
      browserName: 'chrome',
      extensionVersion: '0.1.0',
    }),
    {
      browser_profile_id: 'browser-profile-a',
      pairing_code: 'PAIR-1234',
      paired_at: '2026-04-21T11:30:00.000Z',
      local_url: 'http://127.0.0.1:38947',
      extension_origin: 'chrome-extension://abc123',
      browser_name: 'chrome',
      extension_version: '0.1.0',
      bridge_status: 'paired',
    }
  );
});

test('service worker postBrowserTrackingEvent sends an authenticated event to the paired local bridge', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return { ok: true, status: 202 };
  };

  await serviceWorker.postBrowserTrackingEvent(
    {
      kind: 'tab-focused',
      browser_name: 'chrome',
      profile_key: 'profile-a',
      url: 'https://gemini.google.com/app',
      title: 'Gemini',
      recorded_at: '2026-04-21T11:28:54.000Z',
    },
    {
      local_url: 'http://127.0.0.1:38947',
      bearer_token: 'token-123',
    }
  );

  assert.deepEqual(calls, [
    {
      url: 'http://127.0.0.1:38947/events',
      options: {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer token-123',
        },
        body: JSON.stringify({
          kind: 'tab-focused',
          browser_name: 'chrome',
          profile_key: 'profile-a',
          url: 'https://gemini.google.com/app',
          title: 'Gemini',
          recorded_at: '2026-04-21T11:28:54.000Z',
        }),
      },
    },
  ]);
});

test('manifest grants loopback bridge access', () => {
  const manifestPath = path.resolve(
    process.cwd(),
    'browser-extension/chromium/manifest.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  assert.deepEqual(manifest.host_permissions, ['http://127.0.0.1/*']);
  assert.ok(Array.isArray(manifest.permissions));
  assert.equal(manifest.permissions.includes('alarms'), true);
});
