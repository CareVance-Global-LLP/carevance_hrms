const http = require('node:http');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BRIDGE_PORT = 38947;
const LOCAL_HOST = '127.0.0.1';
const LOCAL_URL = `http://${LOCAL_HOST}:${DEFAULT_BRIDGE_PORT}`;
const PAIRING_TTL_MS = 10 * 60 * 1000;
const CONNECTION_STALE_MS = 70 * 1000;
const CONNECTION_PRUNE_INTERVAL_MS = 5 * 1000;
const ALLOWED_EXTENSION_ORIGIN_PREFIXES = [
  'chrome-extension://',
  'moz-extension://',
  'safari-web-extension://',
];
const ACCESS_CONTROL_ALLOW_METHODS = 'GET, POST, OPTIONS';
const ACCESS_CONTROL_ALLOW_HEADERS = 'content-type, authorization';

const jsonResponse = (statusCode, body = {}, headers = {}) => ({
  statusCode,
  body,
  headers,
});

const cloneConnectionState = (session) => ({
  browser_name: session.browserName,
  extension_origin: session.origin,
  profile_key: session.profileKey,
  extension_version: session.extensionVersion,
  user_id: session.userId,
  paired_at: session.pairedAt,
  last_seen_at: session.lastSeenAt,
});

const isAllowedExtensionOrigin = (origin) => {
  const value = String(origin || '').trim().toLowerCase();
  if (!value) {
    return false;
  }

  return ALLOWED_EXTENSION_ORIGIN_PREFIXES.some((prefix) => value.startsWith(prefix));
};

const buildCorsHeaders = (origin) => {
  if (!isAllowedExtensionOrigin(origin)) {
    return {};
  }

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': ACCESS_CONTROL_ALLOW_METHODS,
    'access-control-allow-headers': ACCESS_CONTROL_ALLOW_HEADERS,
    'access-control-max-age': '600',
    vary: 'Origin',
  };
};

const withCors = (response, origin) => ({
  ...response,
  headers: {
    ...(response.headers || {}),
    ...buildCorsHeaders(origin),
  },
});

function createBrowserTrackingBridge({
  onBrowserEvent,
  onStateChanged = () => {},
  now = () => new Date(),
  localUrl = LOCAL_URL,
  listenHost = LOCAL_HOST,
  listenPort = DEFAULT_BRIDGE_PORT,
  stateFilePath = null,
} = {}) {
  if (typeof onBrowserEvent !== 'function') {
    throw new TypeError('onBrowserEvent is required');
  }

  const pairings = new Map();
  const tokens = new Map();
  let activePairingCode = null;
  let server = null;
  let pruneTimer = null;
  let ready = false;
  let lastError = null;
  let lastEventAt = null;

  const resolveStateFilePath = () => {
    const candidate = String(stateFilePath || '').trim();
    if (!candidate) {
      return null;
    }

    return candidate;
  };

  const persistState = () => {
    const targetPath = resolveStateFilePath();
    if (!targetPath) {
      return;
    }

    const serialized = {
      activePairingCode,
      pairings: Array.from(pairings.entries()).map(([pairingCode, pairing]) => ({
        pairing_code: pairingCode,
        browser_name: pairing.browserName,
        user_id: pairing.userId,
        expires_at: pairing.expiresAt,
      })),
      tokens: Array.from(tokens.entries()).map(([token, session]) => ({
        token,
        origin: session.origin,
        browser_name: session.browserName,
        profile_key: session.profileKey,
        extension_version: session.extensionVersion,
        user_id: session.userId,
        paired_at: session.pairedAt,
        last_seen_at: session.lastSeenAt,
        last_seen_at_ms: session.lastSeenAtMs,
      })),
      last_event_at: lastEventAt,
    };

    try {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, JSON.stringify(serialized, null, 2), 'utf8');
    } catch {
      // Best-effort persistence. Runtime behavior continues even if disk writes fail.
    }
  };

  const restoreState = () => {
    const targetPath = resolveStateFilePath();
    if (!targetPath || !fs.existsSync(targetPath)) {
      return;
    }

    try {
      const parsed = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
      const nextActivePairingCode = String(parsed?.activePairingCode || '').trim() || null;

      pairings.clear();
      tokens.clear();

      for (const pairing of Array.isArray(parsed?.pairings) ? parsed.pairings : []) {
        const pairingCode = String(pairing?.pairing_code || '').trim();
        const expiresAt = Number(pairing?.expires_at);
        if (!pairingCode || !Number.isFinite(expiresAt)) {
          continue;
        }

        pairings.set(pairingCode, {
          browserName: String(pairing?.browser_name || '').trim().toLowerCase() || 'chrome',
          userId: Number.isFinite(Number(pairing?.user_id)) ? Number(pairing.user_id) : null,
          expiresAt,
        });
      }

      for (const tokenSession of Array.isArray(parsed?.tokens) ? parsed.tokens : []) {
        const token = String(tokenSession?.token || '').trim();
        const origin = String(tokenSession?.origin || '').trim();
        const profileKey = String(tokenSession?.profile_key || '').trim();
        if (!token || !origin || !profileKey) {
          continue;
        }

        const lastSeenAt = String(tokenSession?.last_seen_at || tokenSession?.paired_at || '').trim() || null;
        const parsedLastSeenMs = Number(tokenSession?.last_seen_at_ms);
        const derivedLastSeenMs = Date.parse(String(lastSeenAt || ''));
        tokens.set(token, {
          origin,
          browserName: String(tokenSession?.browser_name || '').trim().toLowerCase() || 'chrome',
          profileKey,
          extensionVersion: String(tokenSession?.extension_version || '').trim() || null,
          userId: Number.isFinite(Number(tokenSession?.user_id)) ? Number(tokenSession.user_id) : null,
          pairedAt: String(tokenSession?.paired_at || '').trim() || lastSeenAt || now().toISOString(),
          lastSeenAt,
          lastSeenAtMs: Number.isFinite(parsedLastSeenMs)
            ? parsedLastSeenMs
            : (Number.isFinite(derivedLastSeenMs) ? derivedLastSeenMs : 0),
        });
      }

      activePairingCode = nextActivePairingCode && pairings.has(nextActivePairingCode)
        ? nextActivePairingCode
        : null;
      lastEventAt = String(parsed?.last_event_at || '').trim() || null;
    } catch {
      pairings.clear();
      tokens.clear();
      activePairingCode = null;
      lastEventAt = null;
    }
  };

  const clearPruneTimer = () => {
    if (!pruneTimer) {
      return;
    }

    clearInterval(pruneTimer);
    pruneTimer = null;
  };

  const emitStateChanged = () => {
    persistState();
    onStateChanged(getRendererState());
  };

  const consumeActivePairing = (pairingCode) => {
    const pairing = pairings.get(pairingCode);
    if (!pairing) {
      if (activePairingCode === pairingCode) {
        activePairingCode = null;
      }
      return null;
    }

    if (pairing.expiresAt < now().getTime()) {
      pairings.delete(pairingCode);
      if (activePairingCode === pairingCode) {
        activePairingCode = null;
      }
      return null;
    }

    return pairing;
  };

  const pruneExpiredConnections = () => {
    let didPrunePairing = false;
    const currentTimestamp = now().getTime();

    for (const [pairingCode, pairing] of pairings.entries()) {
      if (pairing.expiresAt >= currentTimestamp) {
        continue;
      }

      pairings.delete(pairingCode);
      if (activePairingCode === pairingCode) {
        activePairingCode = null;
      }
      didPrunePairing = true;
    }

    if (didPrunePairing) {
      emitStateChanged();
    }
  };

  const getRendererState = () => {
    pruneExpiredConnections();
    const activePairing = activePairingCode ? consumeActivePairing(activePairingCode) : null;
    return {
      ready,
      local_url: localUrl,
      last_error: lastError,
      last_event_at: lastEventAt,
      pairing_code: activePairing
        ? {
            value: activePairingCode,
            browser_name: activePairing.browserName,
            expires_at: new Date(activePairing.expiresAt).toISOString(),
            user_id: activePairing.userId,
          }
        : null,
      connections: Array.from(tokens.values()).map(cloneConnectionState),
    };
  };

  const issuePairingCode = ({ browserName, userId }) => {
    pairings.clear();
    activePairingCode = null;

    const value = crypto.randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = now().getTime() + PAIRING_TTL_MS;
    pairings.set(value, {
      browserName: String(browserName || '').trim().toLowerCase() || 'chrome',
      userId: Number.isFinite(userId) ? userId : null,
      expiresAt,
    });
    activePairingCode = value;
    lastError = null;
    emitStateChanged();
    return { value, expires_at: new Date(expiresAt).toISOString() };
  };

  const consumePairing = ({ pairingCode, origin, browserName, profileKey, extensionVersion }) => {
    const pairing = consumeActivePairing(pairingCode);
    const normalizedProfileKey = String(profileKey || '').trim();
    if (!pairing) {
      return null;
    }

    if (pairing.browserName !== String(browserName || '').trim().toLowerCase()) {
      return null;
    }

    if (!isAllowedExtensionOrigin(origin) || !normalizedProfileKey) {
      return null;
    }

    const token = crypto.randomBytes(24).toString('hex');
    const timestamp = now().toISOString();
    const timestampMs = now().getTime();
    tokens.set(token, {
      origin,
      browserName: pairing.browserName,
      profileKey: normalizedProfileKey,
      extensionVersion: String(extensionVersion || '').trim() || null,
      userId: pairing.userId,
      pairedAt: timestamp,
      lastSeenAt: timestamp,
      lastSeenAtMs: timestampMs,
    });
    pairings.delete(pairingCode);
    if (activePairingCode === pairingCode) {
      activePairingCode = null;
    }
    emitStateChanged();
    return token;
  };

  const handleBrowserEvent = async (token, origin, payload) => {
    const session = tokens.get(token);
    if (!session || session.origin !== origin) {
      return jsonResponse(403, { error: 'forbidden' });
    }

    const currentTimestamp = now();
    session.lastSeenAt = currentTimestamp.toISOString();
    session.lastSeenAtMs = currentTimestamp.getTime();
    const payloadRecordedAt = String(payload?.recorded_at || '').trim();
    const parsedPayloadRecordedAtMs = Date.parse(payloadRecordedAt);
    lastEventAt = Number.isFinite(parsedPayloadRecordedAtMs)
      ? new Date(parsedPayloadRecordedAtMs).toISOString()
      : session.lastSeenAt;
    emitStateChanged();
    await onBrowserEvent({
      ...payload,
      user_id: session.userId,
    });
    return jsonResponse(202, { accepted: true });
  };

  const handleJsonRequest = async (pathname, request = {}) => {
    const method = String(request.method || 'GET').toUpperCase();
    const origin = String(request.origin || '').trim();
    const headers = request.headers || {};
    const body = request.body || {};
    const isExtensionOrigin = isAllowedExtensionOrigin(origin);
    const requiresExtensionOrigin = pathname === '/pair' || pathname === '/events';

    if (method === 'OPTIONS') {
      if (!isExtensionOrigin) {
        return jsonResponse(403, { error: 'invalid_origin' });
      }

      return withCors(jsonResponse(204, null), origin);
    }

    if (requiresExtensionOrigin && !isExtensionOrigin) {
      return jsonResponse(403, { error: 'invalid_origin' });
    }

    if (method === 'POST' && pathname === '/pair') {
      const token = consumePairing({
        pairingCode: String(body.pairing_code || '').trim(),
        origin,
        browserName: body.browser_name,
        profileKey: body.profile_key,
        extensionVersion: body.extension_version,
      });

      if (!token) {
        return withCors(jsonResponse(403, { error: 'invalid_pairing' }), origin);
      }

      return withCors(
        jsonResponse(200, {
          token,
          local_url: localUrl,
        }),
        origin
      );
    }

    if (method === 'POST' && pathname === '/events') {
      const authorization = String(headers.authorization || headers.Authorization || '').trim();
      const token = authorization.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length).trim()
        : '';
      return withCors(await handleBrowserEvent(token, origin, body), origin);
    }

    return withCors(jsonResponse(404, { error: 'not_found' }), origin);
  };

  const injectJsonRequest = async (pathname, request) => handleJsonRequest(pathname, request);

  restoreState();

  const start = async () => {
    if (server && ready) {
      return getRendererState();
    }

    const nextServer = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', localUrl);
      const chunks = [];

      req.on('data', (chunk) => {
        chunks.push(chunk);
      });

      req.on('end', async () => {
        const origin = String(req.headers.origin || '').trim();
        const corsHeaders = buildCorsHeaders(origin);
        let body = {};
        if (chunks.length) {
          try {
            body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          } catch {
            res.writeHead(400, {
              ...corsHeaders,
              'content-type': 'application/json',
            });
            res.end(JSON.stringify({ error: 'invalid_json' }));
            return;
          }
        }

        try {
          const response = await handleJsonRequest(url.pathname, {
            method: req.method,
            origin,
            headers: req.headers,
            body,
          });
          const responseHeaders = {
            ...(response.headers || {}),
          };
          if (response.body !== null) {
            responseHeaders['content-type'] = 'application/json';
          }

          res.writeHead(response.statusCode, responseHeaders);

          if (response.body === null) {
            res.end();
            return;
          }

          res.end(JSON.stringify(response.body));
        } catch (error) {
          res.writeHead(500, {
            ...corsHeaders,
            'content-type': 'application/json',
          });
          res.end(JSON.stringify({ error: 'internal_error', message: error?.message || 'Unknown error' }));
        }
      });
    });

    try {
      await new Promise((resolve, reject) => {
        nextServer.once('error', reject);
        nextServer.listen(listenPort, listenHost, () => {
          nextServer.off('error', reject);
          resolve();
        });
      });
    } catch (error) {
      ready = false;
      lastError = error?.message || 'Unable to start browser tracking bridge.';
      emitStateChanged();
      return getRendererState();
    }

    server = nextServer;
    ready = true;
    lastError = null;
    clearPruneTimer();
    pruneTimer = setInterval(() => {
      pruneExpiredConnections();
    }, CONNECTION_PRUNE_INTERVAL_MS);
    emitStateChanged();
    return getRendererState();
  };

  const stop = async () => {
    if (!server) {
      ready = false;
      emitStateChanged();
      return;
    }

    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    server = null;
    ready = false;
    clearPruneTimer();
    emitStateChanged();
  };

  return {
    issuePairingCode,
    getRendererState,
    injectJsonRequest,
    handleBrowserEvent,
    start,
    stop,
  };
}

module.exports = {
  ACCESS_CONTROL_ALLOW_HEADERS,
  ACCESS_CONTROL_ALLOW_METHODS,
  DEFAULT_BRIDGE_PORT,
  LOCAL_HOST,
  LOCAL_URL,
  buildCorsHeaders,
  createBrowserTrackingBridge,
  isAllowedExtensionOrigin,
};
