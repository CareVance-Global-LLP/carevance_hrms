const test = require('node:test');
const assert = require('node:assert/strict');
const { NetworkMonitor } = require('../offline/network-monitor.cjs');

// Helper: build a monitor whose OS connectivity and API reachability are fully
// mocked via closures, so tests are deterministic and offline-only (no real
// network). `customCheck` drives the simulated API ping result.
function makeMonitor({ osOnline = true, apiReachable = true, offlineThreshold = 2, onlineThreshold = 2 } = {}) {
  let os = osOnline;
  let api = apiReachable;
  const monitor = new NetworkMonitor({
    osOnlineCheck: () => os,
    customCheck: () => api,
    offlineThreshold,
    onlineThreshold,
  });
  return {
    monitor,
    setOs: (v) => monitor.setOsOnline(v),
    setApi: (v) => { api = v; },
  };
}

test('a single failed API ping does NOT flip to offline (hysteresis)', async () => {
  const { monitor, setApi } = makeMonitor({ apiReachable: true });
  setApi(false);
  await monitor._check();
  assert.equal(monitor.isOnline, true, 'one failure should be tolerated');
});

test('consecutive API failures flip to offline only after the threshold', async () => {
  const { monitor, setApi } = makeMonitor({ apiReachable: true });
  const changes = [];
  monitor.on('change', (s) => changes.push(s.online));

  setApi(false);
  await monitor._check(); // 1st failure -> still online
  assert.equal(monitor.isOnline, true);

  await monitor._check(); // 2nd failure -> offline
  assert.equal(monitor.isOnline, false);
  assert.deepEqual(changes, [false]);
});

test('recovering API reachability flips back online after the online threshold', async () => {
  const { monitor, setApi } = makeMonitor({ apiReachable: false });
  const changes = [];
  monitor.on('change', (s) => changes.push(s.online));

  // Drive it offline first.
  await monitor._check();
  await monitor._check();
  assert.equal(monitor.isOnline, false);

  setApi(true);
  await monitor._check(); // 1st success -> not yet online
  assert.equal(monitor.isOnline, false);
  await monitor._check(); // 2nd success -> online
  assert.equal(monitor.isOnline, true);
  assert.deepEqual(changes, [false, true]);
});

test('OS reporting offline flips offline immediately (hint, not a hard gate)', async () => {
  const { monitor, setOs, setApi } = makeMonitor({ osOnline: true, apiReachable: true });
  const changes = [];
  monitor.on('change', (s) => changes.push(s.online));

  // An OS-level disconnect marks the app offline immediately (snappy UX) even
  // though the API would appear reachable. This is a *hint*: a real API ping
  // later corrects it (see next test), so a false OS "disconnected" report on
  // VPN/proxy networks does not strand the app permanently offline.
  setApi(true);
  setOs(false);
  assert.equal(monitor.isOnline, false);
  assert.deepEqual(changes, [false]);
});

test('a reachable API overrides a false OS disconnect after the online threshold', async () => {
  const { monitor, setOs, setApi } = makeMonitor({ osOnline: true, apiReachable: true });
  // OS falsely reports disconnected, but the real backend is reachable.
  setOs(false);
  assert.equal(monitor.isOnline, false, 'immediate offline hint on OS disconnect');
  setApi(true);
  // The background re-probe from setOsOnline plus our own checks must confirm
  // reachability enough times (online threshold) to override the OS hint.
  let cameOnline = false;
  for (let i = 0; i < 6 && !cameOnline; i++) {
    // eslint-disable-next-line no-await-in-loop
    await monitor._check();
    cameOnline = monitor.isOnline;
  }
  assert.equal(monitor.isOnline, true, 'API reachability overrides a false OS disconnect');
});

test('OS reconnect re-probes and eventually returns online', async () => {
  const { monitor, setOs, setApi } = makeMonitor({ osOnline: false, apiReachable: false });
  const changes = [];
  monitor.on('change', (s) => changes.push(s.online));

  // Start offline.
  setApi(false);
  await monitor._check();
  await monitor._check();
  assert.equal(monitor.isOnline, false);

  // Make the API reachable BEFORE reporting the OS reconnect so the monitor's
  // automatic re-probe reads the fresh value (avoids a mock microtask race).
  setApi(true);
  setOs(true);
  // Drive checks until online (the monitor's own background re-probe also
  // counts toward the success threshold).
  for (let i = 0; i < 5 && !monitor.isOnline; i++) {
    // eslint-disable-next-line no-await-in-loop
    await monitor._check();
  }
  assert.equal(monitor.isOnline, true);
  assert.deepEqual(changes, [false, true]);
});

test('getStatus exposes the OS connectivity signal', async () => {
  const { monitor, setOs } = makeMonitor({ osOnline: true });
  assert.equal(monitor.getStatus().osOnline, true);
  setOs(false);
  assert.equal(monitor.getStatus().osOnline, false);
});
