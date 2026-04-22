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
  const bridge = await createBrowserTrackingBridge({
    onBrowserEvent: async (event) => {
      receivedEvents.push(event);
    },
    now: () => new Date('2026-04-21T11:28:54.000Z'),
  });

  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const pairResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
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
    'chrome-extension://abc123'
  );

  const eventResponse = await bridge.injectJsonRequest('/events', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
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
  const bridge = await createBrowserTrackingBridge({ onBrowserEvent: async () => {} });

  const response = await bridge.injectJsonRequest('/events', {
    method: 'OPTIONS',
    origin: 'chrome-extension://abc123',
  });

  assert.equal(response.statusCode, 204);
  assert.equal(
    response.headers['access-control-allow-origin'],
    'chrome-extension://abc123'
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
  const bridge = await createBrowserTrackingBridge({ onBrowserEvent: async () => {} });
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
  assert.deepEqual(response.body, { error: 'invalid_origin' });
});

test('issuing a new pairing code revokes earlier unredeemed codes', async () => {
  const bridge = await createBrowserTrackingBridge({ onBrowserEvent: async () => {} });
  const firstPairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const secondPairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });

  const firstResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
    body: {
      pairing_code: firstPairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  const secondResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
    body: {
      pairing_code: secondPairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  assert.equal(firstResponse.statusCode, 403);
  assert.deepEqual(firstResponse.body, { error: 'invalid_pairing' });
  assert.equal(secondResponse.statusCode, 200);
  assert.ok(secondResponse.body.token);
});

test('the loopback bridge does not expose renderer state over HTTP', async () => {
  const bridge = await createBrowserTrackingBridge({ onBrowserEvent: async () => {} });

  const response = await bridge.injectJsonRequest('/state', {
    method: 'GET',
    origin: 'chrome-extension://abc123',
  });

  assert.equal(response.statusCode, 404);
  assert.deepEqual(response.body, { error: 'not_found' });
});

test('expired pairing codes disappear from renderer state', async () => {
  let nowValue = new Date('2026-04-21T11:28:54.000Z').getTime();
  const bridge = await createBrowserTrackingBridge({
    onBrowserEvent: async () => {},
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
  const bridge = await createBrowserTrackingBridge({
    onBrowserEvent: async () => {},
    now: () => new Date(nowValue),
  });

  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const pairResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
    body: {
      pairing_code: pairing.value,
      browser_name: 'chrome',
      profile_key: 'profile-a',
      extension_version: '0.1.0',
    },
  });

  await bridge.injectJsonRequest('/events', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
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

  const firstBridge = await createBrowserTrackingBridge({
    stateFilePath,
    onBrowserEvent: async () => {},
    now: () => new Date('2026-04-21T11:28:54.000Z'),
  });

  const pairing = firstBridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const pairResponse = await firstBridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
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
  const secondBridge = await createBrowserTrackingBridge({
    stateFilePath,
    onBrowserEvent: async (event) => {
      receivedEvents.push(event);
    },
    now: () => new Date('2026-04-21T11:30:10.000Z'),
  });

  assert.equal(secondBridge.getRendererState().connections.length, 1);

  const eventResponse = await secondBridge.injectJsonRequest('/events', {
    method: 'POST',
    origin: 'chrome-extension://abc123',
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
  const bridge = await createBrowserTrackingBridge({ onBrowserEvent: async () => {} });
  const pairing = bridge.issuePairingCode({ browserName: 'chrome', userId: 55 });
  const pairResponse = await bridge.injectJsonRequest('/pair', {
    method: 'POST',
    origin: 'chrome-extension://trusted',
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
