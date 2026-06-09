const test = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ACCESS_CONTROL_ALLOW_HEADERS,
  ACCESS_CONTROL_ALLOW_METHODS,
  createBrowserTrackingBridge,
} = require('../browser-tracking-bridge.cjs');

const TRUSTED_ORIGIN = 'chrome-extension://abc123';
const SECONDARY_ORIGIN = 'chrome-extension://trusted';
const ALL_TEST_ORIGINS = [TRUSTED_ORIGIN, SECONDARY_ORIGIN];

const buildBridge = (overrides = {}) =>
  createBrowserTrackingBridge({
    onBrowserEvent: async () => {},
    allowedExtensionOrigins: ALL_TEST_ORIGINS,
    ...overrides,
  });

const getAvailablePort = async () => {
  const server = net.createServer();

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve(port);
      });
    });
  });
};

test('pairing code binds the extension origin and returns a bearer token', async () => {
  const receivedEvents = [];
  const bridge = await buildBridge({
    onBrowserEvent: async (event) => {
      receivedEvents.push(event);
    },
    now: () => new Date('2026-04-21T11:28:54.000Z'),
  });

  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const pairResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  assert.equal(pairResponse.statusCode, 200);
  assert.ok(pairResponse.body.token);
  assert.equal(pairResponse.body.local_url, 'http://127.0.0.1:38947');
  assert.equal(
    pairResponse.headers['access-control-allow-origin'],
    TRUSTED_ORIGIN
  );

  const eventResponse = await bridge.injectJsonRequest('/events', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    headers: {
      authorization: `Bearer ${pairResponse.body.token}`,
    },
    body: {
      kind: 'tab-focused',
      browser_name: 'chrome',
      profile_key: 'profile-a',
      url: 'https://gemini.google.com/app',
      title: 'Gemini',
      recorded_at: '2026-04-21T11:28:54.000Z',
    },
  });

  assert.equal(eventResponse.statusCode, 202);
  assert.equal(receivedEvents[0].url, 'https://gemini.google.com/app');
});

test('extension preflight requests receive the required CORS headers', async () => {
  const bridge = await buildBridge();

  const response = await bridge.injectJsonRequest('/events', {
    method: 'OPTIONS',
    origin: TRUSTED_ORIGIN,
  });

  assert.equal(response.statusCode, 204);
  assert.equal(
    response.headers['access-control-allow-origin'],
    TRUSTED_ORIGIN
  );
  assert.equal(
    response.headers['access-control-allow-methods'],
    ACCESS_CONTROL_ALLOW_METHODS
  );
  assert.equal(
    response.headers['access-control-allow-headers'],
    ACCESS_CONTROL_ALLOW_HEADERS
  );
});

test('website origins cannot pair with the loopback bridge', async () => {
  const bridge = await buildBridge();
  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const response = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'https://example.com',
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  assert.equal(response.statusCode, 403);
  assert.equal(response.body.error, 'invalid_origin');
});

test('issuing a new pairing code revokes earlier unredeemed codes', async () => {
  const bridge = await buildBridge();
  const firstPairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const secondPairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const firstResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: firstPairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  const secondResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: secondPairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  assert.equal(firstResponse.statusCode, 403);
  assert.equal(firstResponse.body.error, 'invalid_pairing');
  assert.equal(firstResponse.body.reason, 'unknown_code');
  assert.equal(firstResponse.body.active_pairing_code, secondPairing.value);
  assert.equal(secondResponse.statusCode, 200);
  assert.ok(secondResponse.body.token);
});

test('the loopback bridge does not expose renderer state over HTTP', async () => {
  const bridge = await buildBridge();

  const response = await bridge.injectJsonRequest('/state', {
    method: 'GET',
    origin: TRUSTED_ORIGIN,
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'not_found' });
});

test('expired pairing codes disappear from renderer state', async () => {
  let nowValue = new Date('2026-04-21T11:28:54.000Z').getTime();
  const bridge = await buildBridge({
    now: () => new Date(nowValue),
  });

  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  assert.equal(bridge.getRendererState().pairing_code?.value, pairing.value);

  nowValue += (10 * 60 * 1000) + 1000;

  const expiredState = bridge.getRendererState();
  assert.equal(expiredState.pairing_code, null);
});

test('stale browser connections disappear from renderer state after the heartbeat timeout', async () => {
  let nowValue = new Date('2026-04-21T11:28:54.000Z').getTime();
  const bridge = await buildBridge({
    now: () => new Date(nowValue),
  });

  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const pairResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  await bridge.injectJsonRequest('/events', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    headers: {
      authorization: `Bearer ${pairResponse.body.token}`,
    },
    body: {
      kind: 'heartbeat',
      browser_name: 'chrome',
      profile_key: 'profile-a',
      url: 'https://gemini.google.com/app',
      title: 'Gemini',
      recorded_at: '2026-04-21T11:28:54.000Z',
    },
  });

  assert.equal(bridge.getRendererState().connections.length, 1);

  nowValue += 71_000;

  const staleState = bridge.getRendererState();
  assert.equal(staleState.connections.length, 1);
  assert.equal(staleState.connections[0].profile_key, 'profile-a');
});

test('paired browser tokens survive desktop bridge restarts without generating a new pairing code', async () => {
  const sandboxRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-tracking-bridge-state-'));
  const stateFilePath = path.join(sandboxRoot, 'browser-tracking-state.json');

  const firstBridge = await buildBridge({
    stateFilePath,
    now: () => new Date('2026-04-21T11:28:54.000Z'),
  });

  const pairing = firstBridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const pairResponse = await firstBridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  assert.equal(pairResponse.statusCode, 200);
  assert.equal(firstBridge.getRendererState().connections.length, 1);

  const receivedEvents = [];
  const secondBridge = await buildBridge({
    stateFilePath,
    onBrowserEvent: async (event) => {
      receivedEvents.push(event);
    },
    now: () => new Date('2026-04-21T11:30:10.000Z'),
  });

  assert.equal(secondBridge.getRendererState().connections.length, 1);

  const eventResponse = await secondBridge.injectJsonRequest('/events', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    headers: {
      authorization: `Bearer ${pairResponse.body.token}`,
    },
    body: {
      kind: 'heartbeat',
      browser_name: 'chrome',
      profile_key: 'profile-a',
      url: 'https://gemini.google.com/app',
      title: 'Gemini',
      recorded_at: '2026-04-21T11:30:10.000Z',
    },
  });

  assert.equal(eventResponse.statusCode, 202);
  assert.equal(receivedEvents.length, 1);
  assert.equal(secondBridge.getRendererState().connections[0].last_seen_at, '2026-04-21T11:30:10.000Z');
});

test('unpaired or mismatched origins are rejected', async () => {
  const bridge = await buildBridge();
  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const pairResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: SECONDARY_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  const eventResponse = await bridge.injectJsonRequest('/events', {
    method: 'POST',
    origin: 'chrome-extension://evil',
    headers: {
      authorization: `Bearer ${pairResponse.body.token}`,
    },
    body: {
      kind: 'tab-focused',
      browser_name: 'chrome',
      profile_key: 'profile-a',
      url: 'https://instagram.com/',
      title: 'Instagram',
      recorded_at: '2026-04-21T11:30:00.000Z',
    },
  });

  assert.equal(eventResponse.statusCode, 403);
});

test('bridge start failure does not block later retry on the same instance', async () => {
  const port = await getAvailablePort();
  const firstBridge = await createBrowserTrackingBridge({
    listenPort: port,
    onBrowserEvent: async () => {},
  });
  const secondBridge = await createBrowserTrackingBridge({
    listenPort: port,
    onBrowserEvent: async () => {},
  });

  await firstBridge.start();
  const failedState = await secondBridge.start();
  assert.equal(failedState.ready, false);
  assert.match(String(failedState.last_error || ''), /listen|address|eaddrinuse/i);

  await firstBridge.stop();

  const recoveredState = await secondBridge.start();
  assert.equal(recoveredState.ready, true);

  await secondBridge.stop();
});

test('diag endpoint reports the current allowed origins and active pairing code', async () => {
  const bridge = await buildBridge({
    allowedExtensionOrigins: [TRUSTED_ORIGIN],
  });
  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const response = await bridge.injectJsonRequest('/diag', {
    method: 'GET',
    origin: TRUSTED_ORIGIN,
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ready, false);
  assert.equal(response.body.local_url, 'http://127.0.0.1:38947');
  assert.deepEqual(response.body.allowed_origins, [TRUSTED_ORIGIN]);
  assert.equal(response.body.allowed_origins_count, 1);
  assert.equal(response.body.active_pairing_code, pairing.value);
  assert.equal(response.body.active_pairing_browser_name, 'chrome');
  assert.equal(response.body.active_pairing_expired, false);
  assert.equal(response.body.active_connections, 0);
  assert.equal(response.body.last_request_origin, TRUSTED_ORIGIN);
  assert.ok(response.body.server_time);
});

test('pair 403 reason distinguishes expired codes from unknown codes', async () => {
  let nowValue = new Date('2026-04-21T11:28:54.000Z').getTime();
  const bridge = await buildBridge({
    now: () => new Date(nowValue),
  });
  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const unknownResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: 'DEADBEEF',
      browser_name: 'chrome',
      profile_key: 'profile-a',
    },
  });
  assert.equal(unknownResponse.statusCode, 403);
  assert.equal(unknownResponse.body.error, 'invalid_pairing');
  assert.equal(unknownResponse.body.reason, 'unknown_code');

  nowValue += (10 * 60 * 1000) + 1000;

  const expiredResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
    },
  });
  assert.equal(expiredResponse.statusCode, 403);
  assert.equal(expiredResponse.body.error, 'invalid_pairing');
  assert.equal(expiredResponse.body.reason, 'expired');
});

test('pair 403 reason distinguishes browser_name_mismatch from missing_profile_key', async () => {
  const bridge = await buildBridge();
  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const browserNameResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'firefox',
      profile_key: 'profile-a',
    },
  });
  assert.equal(browserNameResponse.statusCode, 403);
  assert.equal(browserNameResponse.body.reason, 'browser_name_mismatch');
  assert.equal(bridge.getRendererState().pairing_code?.value, pairing.value);

  const profileKeyResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: '',
    },
  });
  assert.equal(profileKeyResponse.statusCode, 403);
  assert.equal(profileKeyResponse.body.reason, 'missing_profile_key');
  assert.equal(bridge.getRendererState().pairing_code?.value, pairing.value);
});

test('pair failure does not consume the pairing code so the user can retry', async () => {
  const bridge = await buildBridge({
    allowedExtensionOrigins: [TRUSTED_ORIGIN, SECONDARY_ORIGIN],
  });
  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const wrongOriginResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'chrome-extension://attacker',
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
    },
  });
  assert.equal(wrongOriginResponse.statusCode, 403);
  assert.equal(wrongOriginResponse.body.error, 'invalid_origin');
  assert.equal(bridge.getRendererState().pairing_code?.value, pairing.value);

  const correctResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: TRUSTED_ORIGIN,
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
    },
  });
  assert.equal(correctResponse.statusCode, 200);
  assert.ok(correctResponse.body.token);
});
