const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

/*
 * Local shell: the app's own UI, served from disk over loopback.
 *
 * Until now the desktop was a window onto a remote origin, so a machine that
 * booted with no network could not reach the SPA at all — it got the static
 * offline notice and nothing else. That is the case auto-start makes routine:
 * the app launches at login, often before wifi has associated. Everything the
 * offline queue is built for (punch in, start a timer, capture activity) was
 * unreachable exactly when it was needed.
 *
 * Two decisions worth stating:
 *
 * - HTTP on loopback rather than file:// or a custom protocol. The bundle is
 *   built with an absolute base ("/assets/..."), and a real origin keeps
 *   localStorage, service-worker-free routing and history navigation behaving
 *   the way they do against the deployed app.
 *
 * - /api is PROXIED to the deployed backend rather than called cross-origin.
 *   That mirrors what Vite already does in development, so the renderer's
 *   relative "/api" resolves with no CORS involved. While the network is down
 *   the proxy simply fails, which is what the offline-aware wrappers already
 *   expect; the moment it recovers, the same shell is fully functional.
 */

const PREFERRED_PORT = 43117;
const PORT_ATTEMPTS = 12;
const PROXY_PREFIXES = ['/api/', '/sanctum/'];
const PROXY_TIMEOUT_MS = 20000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

const contentTypeFor = (filePath) => MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';

/**
 * Resolve a request path to a file inside the bundle.
 *
 * Returns null for anything that escapes the root. The server is bound to
 * loopback, but any process on the machine can still reach it, so `..` and
 * absolute paths are rejected rather than trusted.
 */
const resolveStaticPath = (rendererDir, requestPath) => {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath.split('?')[0]);
  } catch {
    return null;
  }

  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const candidate = path.resolve(rendererDir, normalized);
  const root = path.resolve(rendererDir);

  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }

  return candidate;
};

function LocalShellServer(options = {}) {
  this.rendererDir = options.rendererDir || '';
  this.apiTarget = String(options.apiTarget || '').replace(/\/+$/, '');
  this.server = null;
  this.origin = null;
}

LocalShellServer.prototype.isAvailable = function () {
  try {
    return Boolean(this.rendererDir) && fs.existsSync(path.join(this.rendererDir, 'index.html'));
  } catch {
    return false;
  }
};

LocalShellServer.prototype.start = function () {
  if (this.origin) return Promise.resolve(this.origin);
  if (!this.isAvailable()) return Promise.resolve(null);

  return new Promise((resolve) => {
    let attempt = 0;

    const tryListen = () => {
      // A fresh server per attempt. Reusing one and calling listen() again
      // after EADDRINUSE leaves the previous attempt's 'listening' callback
      // registered, so when a later port finally binds the stale callback
      // fires first and reports the port that failed.
      const server = http.createServer((req, res) => {
        this._handle(req, res);
      });

      const port = PREFERRED_PORT + attempt;

      server.once('error', (err) => {
        server.removeAllListeners('listening');
        if (err && err.code === 'EADDRINUSE' && attempt < PORT_ATTEMPTS - 1) {
          attempt++;
          tryListen();
          return;
        }
        console.error('[local-shell] failed to bind:', err?.message || err);
        resolve(null);
      });

      // 127.0.0.1, never 0.0.0.0: this serves an authenticated session and must
      // not be reachable from the network.
      server.listen(port, '127.0.0.1', () => {
        server.removeAllListeners('error');
        this.server = server;
        // Read the bound port back rather than trusting the requested one.
        const bound = server.address();
        this.origin = `http://127.0.0.1:${bound && bound.port ? bound.port : port}`;
        console.log('[local-shell] serving offline UI at', this.origin);
        resolve(this.origin);
      });
    };

    tryListen();
  });
};

LocalShellServer.prototype.stop = function () {
  if (!this.server) return;
  try {
    this.server.close();
  } catch {
    // Shutting down anyway.
  }
  this.server = null;
  this.origin = null;
};

LocalShellServer.prototype._handle = function (req, res) {
  const requestPath = String(req.url || '/');

  if (PROXY_PREFIXES.some((prefix) => requestPath.startsWith(prefix))) {
    this._proxy(req, res, requestPath);
    return;
  }

  if (requestPath.split('?')[0] === '/env-config.js') {
    this._serveEnvConfig(res);
    return;
  }

  this._serveStatic(req, res, requestPath);
};

/*
 * env-config.js, with the API URL pinned to this server.
 *
 * The shipped file contains a "if we're on localhost, the API must be the dev
 * server" "" branch, and the shell is on 127.0.0.1 — so it would fire here and
 * point every request at port 8000 of the USER'S OWN machine. Nothing is
 * listening there, and it silently bypasses the proxy that makes the offline
 * shell work at all.
 *
 * The deployment's own file is still served first so per-deployment toggles
 * survive; the override is appended, and runtimeConfig reads the runtime value
 * ahead of the build value, so this is what wins.
 */
LocalShellServer.prototype._serveEnvConfig = function (res) {
  let base = 'window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};\n';

  try {
    const bundled = path.join(this.rendererDir, 'env-config.js');
    if (fs.existsSync(bundled)) {
      base = fs.readFileSync(bundled, 'utf8');
    }
  } catch {
    // Fall through to the minimal stub.
  }

  const override = [
    '',
    '/* Injected by the CareVance desktop offline shell. */',
    'window.__APP_CONFIG__ = window.__APP_CONFIG__ || {};',
    // Relative, so requests go back through this server and are proxied to the
    // deployed backend — same-origin, no CORS, and reachable the moment the
    // network returns.
    "window.__APP_CONFIG__.VITE_API_URL = '/api';",
    `window.__APP_CONFIG__.VITE_WEB_APP_URL = ${JSON.stringify(this.apiTarget || '')};`,
    '',
  ].join('\n');

  const body = `${base}\n${override}`;
  res.writeHead(200, {
    'Content-Type': 'text/javascript; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
};

LocalShellServer.prototype._serveStatic = function (req, res, requestPath) {
  const indexPath = path.join(this.rendererDir, 'index.html');
  const resolved = resolveStaticPath(this.rendererDir, requestPath);

  if (!resolved) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  let target = resolved;
  try {
    if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
      target = path.join(target, 'index.html');
    }
  } catch {
    target = indexPath;
  }

  // Client-side routing: a deep link like /attendance is not a file, so fall
  // back to the SPA entry point the way any static host would. Requests that
  // look like assets 404 instead, so a genuinely missing bundle file is not
  // masked by an HTML response.
  if (!fs.existsSync(target)) {
    if (path.extname(target)) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    target = indexPath;
  }

  fs.readFile(target, (err, body) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Failed to read local shell asset');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentTypeFor(target),
      // The bundle is replaced wholesale by an app update, and a stale cached
      // index.html would point at hashed assets that no longer exist.
      'Cache-Control': 'no-store',
    });
    res.end(body);
  });
};

LocalShellServer.prototype._proxy = function (req, res, requestPath) {
  if (!this.apiTarget) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'No API target configured for the offline shell.' }));
    return;
  }

  let target;
  try {
    target = new URL(requestPath, this.apiTarget);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'Bad proxy target.' }));
    return;
  }

  const lib = target.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  // The upstream must see its own host, and the loopback Origin would fail
  // any origin check on the way through.
  headers.host = target.host;
  delete headers.origin;
  delete headers.referer;
  delete headers['accept-encoding'];

  const upstream = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method,
      headers,
      timeout: PROXY_TIMEOUT_MS,
    },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  let settled = false;
  const failGateway = () => {
    if (settled) return;
    settled = true;

    // Detach the request body first. Left piped into a destroyed upstream, the
    // broken pipe tears down the incoming socket and the client sees
    // ECONNRESET instead of the 502 — which reads as a crash rather than as
    // "server unreachable".
    req.unpipe(upstream);
    req.resume();

    if (res.headersSent) {
      res.destroy();
      return;
    }

    // 502 rather than a hang: the renderer's offline-aware wrappers key off a
    // failed request to divert the write into the local queue.
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ message: 'Offline: the CareVance server is unreachable.' }));
  };

  upstream.on('error', failGateway);
  upstream.on('timeout', () => {
    upstream.destroy();
    failGateway();
  });
  upstream.on('response', () => {
    settled = true;
  });
  // The client can vanish mid-upload; don't let that surface as an unhandled
  // error event on the proxy.
  req.on('error', () => {
    upstream.destroy();
  });

  req.pipe(upstream);
};

module.exports = { LocalShellServer, resolveStaticPath, PREFERRED_PORT };
