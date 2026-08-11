const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const { LocalShellServer, resolveStaticPath } = require('../offline/local-shell.cjs');

const makeBundle = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carevance-shell-'));
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>CareVance</title><div id="root"></div>');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log("app");');
  fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.css'), ':root{color:red}');
  return dir;
};

// agent: false — each shell in this file may bind the same preferred port
// after the previous one closed, and a pooled keep-alive socket to the dead
// server would surface as ECONNRESET in an unrelated test.
const get = (origin, requestPath, options = {}) => new Promise((resolve, reject) => {
  const req = http.request(`${origin}${requestPath}`, { method: options.method || 'GET', agent: false }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => resolve({
      status: res.statusCode,
      headers: res.headers,
      body: Buffer.concat(chunks).toString('utf8'),
    }));
  });
  req.on('error', reject);
  if (options.body) req.write(options.body);
  req.end();
});

test('the bundled UI is served over loopback with SPA history fallback', async (t) => {
  const dir = makeBundle();
  const shell = new LocalShellServer({ rendererDir: dir, apiTarget: 'https://app.example.test' });
  const origin = await shell.start();

  t.after(() => {
    shell.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  assert.ok(origin, 'the shell should bind');
  assert.match(origin, /^http:\/\/127\.0\.0\.1:\d+$/, 'it must bind loopback only, never a routable interface');

  const index = await get(origin, '/');
  assert.equal(index.status, 200);
  assert.match(index.body, /CareVance/);

  const asset = await get(origin, '/assets/index-abc123.js');
  assert.equal(asset.status, 200);
  assert.match(String(asset.headers['content-type']), /javascript/);

  // A deep link is not a file on disk; the SPA entry point has to answer it or
  // the app is unusable on anything but "/".
  const deepLink = await get(origin, '/attendance');
  assert.equal(deepLink.status, 200);
  assert.match(deepLink.body, /id="root"/);
});

test('a missing asset 404s instead of silently returning the HTML shell', async (t) => {
  const dir = makeBundle();
  const shell = new LocalShellServer({ rendererDir: dir, apiTarget: 'https://app.example.test' });
  const origin = await shell.start();

  t.after(() => {
    shell.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // Returning index.html for a missing .js would surface as a syntax error in
  // the console rather than a missing-file error, which is far harder to read.
  const missing = await get(origin, '/assets/does-not-exist.js');
  assert.equal(missing.status, 404);
});

test('paths cannot escape the bundle directory', () => {
  const root = path.resolve(os.tmpdir(), 'carevance-bundle-root');

  // The property that matters is containment, not the exact return value: a
  // traversal may either be rejected outright or be normalised back inside the
  // root, but it must never resolve to a path outside it.
  const attempts = [
    '/../../etc/passwd',
    '/..%2f..%2fsecret',
    '/assets/../../../../windows/win.ini',
    '/./../../root/.ssh/id_rsa',
    '/%2e%2e/%2e%2e/secret.txt',
  ];

  for (const attempt of attempts) {
    const resolved = resolveStaticPath(root, attempt);
    if (resolved === null) continue;
    assert.ok(
      resolved === root || resolved.startsWith(root + path.sep),
      `${attempt} escaped the bundle root: ${resolved}`
    );
  }

  // Legitimate paths still resolve normally.
  assert.equal(resolveStaticPath(root, '/assets/app.js'), path.resolve(root, 'assets/app.js'));
  assert.equal(resolveStaticPath(root, '/'), root);
});

test('api requests proxy upstream, so the renderer stays same-origin with its API', async (t) => {
  const dir = makeBundle();

  const seen = [];
  const upstream = http.createServer((req, res) => {
    seen.push({ url: req.url, method: req.method, host: req.headers.host, origin: req.headers.origin });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  const upstreamPort = upstream.address().port;

  const shell = new LocalShellServer({
    rendererDir: dir,
    apiTarget: `http://127.0.0.1:${upstreamPort}`,
  });
  const origin = await shell.start();

  t.after(() => {
    shell.stop();
    upstream.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const response = await get(origin, '/api/auth/me');
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { ok: true });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/auth/me');
  assert.equal(seen[0].host, `127.0.0.1:${upstreamPort}`, 'the upstream must see its own Host');
  assert.equal(seen[0].origin, undefined, 'the loopback Origin must not leak upstream');
});

test('an unreachable server fails the proxy fast so writes divert to the offline queue', async (t) => {
  const dir = makeBundle();

  // Port 1 on loopback refuses immediately — the offline case without the wait.
  const shell = new LocalShellServer({ rendererDir: dir, apiTarget: 'http://127.0.0.1:1' });
  const origin = await shell.start();

  t.after(() => {
    shell.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const response = await get(origin, '/api/attendance/check-in', { method: 'POST' });
  assert.equal(response.status, 502, 'a failed request is what the offline-aware wrappers key off');

  // The UI itself must still load while the API is down — that is the entire
  // point of the local shell.
  const index = await get(origin, '/');
  assert.equal(index.status, 200);
});

test('env-config.js pins the API at the shell, not at the user\'s own machine', async (t) => {
  const dir = makeBundle();

  // The shipped env-config has a "localhost means the dev server" branch. The
  // shell is on 127.0.0.1, so without an override it fires here and points the
  // whole app at port 8000 of the user's own machine — bypassing the proxy and
  // silently breaking every request.
  fs.writeFileSync(path.join(dir, 'env-config.js'), [
    'window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};',
    '(function (config) {',
    "  var isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';",
    '  if (!isLocalHost) return;',
    "  if (!config.VITE_API_URL) config.VITE_API_URL = 'http://127.0.0.1:8000/api';",
    '}(window.__APP_CONFIG__));',
    "window.__APP_CONFIG__.VITE_PAYROLL_ENABLED = 'false';",
  ].join('\n'));

  const shell = new LocalShellServer({ rendererDir: dir, apiTarget: 'https://app.example.test' });
  const origin = await shell.start();

  t.after(() => {
    shell.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const served = await get(origin, '/env-config.js');
  assert.equal(served.status, 200);

  // Evaluate it the way the browser would, on the loopback origin.
  const fakeWindow = { location: { hostname: '127.0.0.1', origin } };
  // eslint-disable-next-line no-new-func
  new Function('window', served.body)(fakeWindow);

  assert.equal(
    fakeWindow.__APP_CONFIG__.VITE_API_URL,
    '/api',
    'the API must resolve back through this server so it can be proxied'
  );
  assert.equal(
    fakeWindow.__APP_CONFIG__.VITE_PAYROLL_ENABLED,
    'false',
    'per-deployment toggles from the bundled file must survive the override'
  );
});

test('the shell reports itself unavailable when no bundle was packaged', async () => {
  const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'carevance-shell-empty-'));

  try {
    const shell = new LocalShellServer({ rendererDir: emptyDir, apiTarget: 'https://app.example.test' });
    assert.equal(shell.isAvailable(), false);
    assert.equal(await shell.start(), null, 'start() resolves null so main.cjs falls back to the static notice');
  } finally {
    fs.rmSync(emptyDir, { recursive: true, force: true });
  }
});

test('two shells can run side by side without fighting over the port', async (t) => {
  const dirA = makeBundle();
  const dirB = makeBundle();
  const shellA = new LocalShellServer({ rendererDir: dirA, apiTarget: 'https://app.example.test' });
  const shellB = new LocalShellServer({ rendererDir: dirB, apiTarget: 'https://app.example.test' });

  const originA = await shellA.start();
  const originB = await shellB.start();

  t.after(() => {
    shellA.stop();
    shellB.stop();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  });

  assert.ok(originA && originB);
  assert.notEqual(originA, originB, 'the second instance should step to the next free port');
});
