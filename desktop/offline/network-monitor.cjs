const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { URL } = require('node:url');

const DEFAULT_PING_URL = 'https://clients3.google.com/generate_204';
const DEFAULT_PING_INTERVAL_MS = 5000;
const DEFAULT_PING_TIMEOUT_MS = 3000;

/**
 * Whether a probe target lives on this machine.
 *
 * Loopback answers whether or not the machine has a network, so reaching it
 * proves the API is up — never that we are connected. The probe list is led by
 * the configured app URL, which in development IS loopback, so pulling the
 * cable left every check succeeding and the app cheerfully reporting "Online"
 * with no network at all.
 */
const isLoopbackTarget = (targetUrl) => {
  let hostname;
  try {
    hostname = new URL(targetUrl).hostname.toLowerCase();
  } catch {
    return false;
  }

  return hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
    || hostname.endsWith('.localhost')
    || hostname.startsWith('127.');
};

function NetworkMonitor(options = {}) {
  EventEmitter.call(this);

  this.pingUrl = options.pingUrl || DEFAULT_PING_URL;
  // Ordered list of URLs to probe. We probe the real API/app endpoints first
  // and only fall back to a public endpoint as a last resort. Previously this
  // only pinged a hardcoded Google URL, so networks that block Google (but can
  // still reach the CareVance API) were wrongly reported as offline.
  this.pingCandidates = Array.isArray(options.pingCandidates) && options.pingCandidates.length
    ? options.pingCandidates.filter((url) => typeof url === 'string' && url.trim().length > 0)
    : [this.pingUrl];
  this.intervalMs = options.intervalMs || DEFAULT_PING_INTERVAL_MS;
  this.pingTimeoutMs = options.pingTimeoutMs || DEFAULT_PING_TIMEOUT_MS;
  this.customCheck = typeof options.customCheck === 'function' ? options.customCheck : null;

  this.isOnline = true;
  this.wasOnline = true;
  this.lastCheckAt = null;
  this.consecutiveFailures = 0;
  this.consecutiveSuccesses = 0;
  // OS-level connectivity signal (e.g. Electron's net.isOnline()). This is used
  // as a *hint* for a fast, instant "offline" flip on a physical disconnect
  // (wifi off, cable unplugged, laptop sleep). It is intentionally NOT treated
  // as authoritative: on Windows it is frequently wrong behind VPNs/proxies/
  // captive portals, so the real online state is always decided by whether the
  // actual API endpoints are reachable (see _check).
  this.osOnlineCheck = typeof options.osOnlineCheck === 'function' ? options.osOnlineCheck : null;
  this.osOnline = this.osOnlineCheck ? Boolean(this.osOnlineCheck()) : true;
  // Require several consecutive failures before declaring "offline" so a single
  // transient blip (dropped ping, momentary DNS hiccup) doesn't falsely flip
  // the app to offline and spam the user with notifications. Symmetrically,
  // require a few consecutive successes before declaring "online" again to
  // avoid flapping on an unstable connection. The OS signal bypasses this
  // hysteresis because it is already authoritative.
  this.offlineThreshold = options.offlineThreshold && options.offlineThreshold > 0
    ? options.offlineThreshold
    : 2;
  this.onlineThreshold = options.onlineThreshold && options.onlineThreshold > 0
    ? options.onlineThreshold
    : 2;
  this.timer = null;
  this.running = false;
  this.checkInProgress = false;
}

NetworkMonitor.prototype = Object.create(EventEmitter.prototype);
NetworkMonitor.prototype.constructor = NetworkMonitor;

// Called when the OS connectivity state changes (e.g. from Electron's
// net.isOnline() sampled in the main process). A physical disconnect flips us
// offline immediately (a hint for snappy UX); coming back online triggers an
// immediate re-probe so we don't wait a full interval to flip. The actual
// online state is still confirmed by a successful API ping in _check, so a
// false OS "disconnected" report self-corrects.
NetworkMonitor.prototype.setOsOnline = function (osOnline) {
  const next = Boolean(osOnline);
  if (next === this.osOnline) return;
  const wasOnline = this.osOnline;
  this.osOnline = next;

  if (wasOnline && !this.osOnline) {
    // Physical disconnect — go offline immediately and authoritatively, without
    // waiting for the ping hysteresis. We still run a background re-probe so the
    // internal counters stay consistent.
    this.consecutiveFailures = this.offlineThreshold;
    this.consecutiveSuccesses = 0;
    if (this.isOnline) {
      this._setOffline('OS network disconnected');
    }
    this._check().catch(() => {});
  } else if (!wasOnline && this.osOnline) {
    // Physical reconnect — reset counters and probe right away.
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses = 0;
    this._check().catch(() => {});
  }
};

NetworkMonitor.prototype.start = function () {
  if (this.running) return;
  this.running = true;

  // Immediate first check
  this._check().catch(() => {});

  this.timer = setInterval(() => {
    this._check().catch(() => {});
  }, this.intervalMs);

  console.log('[network-monitor] Started, checking every', this.intervalMs, 'ms');
};

NetworkMonitor.prototype.stop = function () {
  this.running = false;
  if (this.timer) {
    clearInterval(this.timer);
    this.timer = null;
  }
};

NetworkMonitor.prototype._check = async function () {
  if (this.checkInProgress) return;
  this.checkInProgress = true;

  try {
    // Always probe the real API/app endpoints. We used to skip the probe when
    // the OS reported "disconnected", but Electron's net.isOnline() is
    // unreliable on Windows (VPNs, corporate proxies, captive portals) and
    // frequently returns false even when the real backend IS reachable. If we
    // trusted it as a hard gate, a false negative would pin the app to
    // "offline" forever because the probe that would disprove it never ran.
    //
    // The OS signal is now only a *hint*: setOsOnline() still flips us offline
    // instantly on a real physical disconnect (good UX), but the actual online
    // state is determined by whether the API is genuinely reachable. A
    // successful ping always overrides a mistaken OS "disconnected" report.
    const { reachable, viaRemote } = await this._probe();

    /*
     * A loopback answer cannot outvote the OS saying there is no network.
     *
     * The OS signal already flips us offline the moment the cable is pulled,
     * but the probe that ran straight afterwards reached the local dev server,
     * counted as a success twice, and put the app back to "Online" within ten
     * seconds — with no network at all. Reported from the desktop app on
     * 14 Aug 2026 and reproduced exactly:
     *
     *   after OS disconnect -> online=false
     *   after probe 1       -> online=true
     *
     * A REMOTE answer still overrides the OS, which is the case that matters:
     * net.isOnline() is unreliable behind VPNs and captive portals, and a
     * server that genuinely replies proves it wrong.
     */
    const online = reachable && (viaRemote || this.osOnline !== false);
    if (online) {
      this.consecutiveSuccesses++;
      this.consecutiveFailures = 0;
    } else {
      this.consecutiveFailures++;
      this.consecutiveSuccesses = 0;
    }
    this.lastCheckAt = new Date().toISOString();

    if (online) {
      // Only transition to online after enough consecutive successful checks.
      if (this.consecutiveSuccesses >= this.onlineThreshold) {
        this._setOnline();
      }
    } else {
      // Only transition to offline after enough consecutive failed checks.
      if (this.consecutiveFailures >= this.offlineThreshold) {
        this._setOffline(`Ping failed (${this.consecutiveFailures} consecutive failures)`);
      }
    }
  } catch (err) {
    this.consecutiveFailures++;
    this.consecutiveSuccesses = 0;
    this.lastCheckAt = new Date().toISOString();
    if (this.consecutiveFailures >= this.offlineThreshold) {
      this._setOffline(err.message || 'Ping error');
    }
  } finally {
    this.checkInProgress = false;
  }
};

/**
 * Probe the candidates, reporting not just whether something answered but
 * whether anything OFF this machine did.
 *
 * @returns {Promise<{reachable: boolean, viaRemote: boolean}>}
 */
NetworkMonitor.prototype._probe = async function () {
  if (typeof this.customCheck === 'function') {
    try {
      const result = await this.customCheck();
      // A custom check speaks for itself; it is not a loopback shortcut.
      if (result !== undefined) return { reachable: Boolean(result), viaRemote: Boolean(result) };
    } catch {
      return { reachable: false, viaRemote: false };
    }
  }

  const candidates = this.pingCandidates && this.pingCandidates.length
    ? this.pingCandidates
    : [this.pingUrl];

  let reachable = false;

  for (const candidate of candidates) {
    // eslint-disable-next-line no-await-in-loop
    const answered = await this._pingOne(candidate);
    if (!answered) continue;

    reachable = true;
    // A remote answer settles it; a loopback one keeps looking for a remote,
    // because only a remote answer can prove the machine is connected.
    if (!isLoopbackTarget(candidate)) {
      return { reachable: true, viaRemote: true };
    }
  }

  return { reachable, viaRemote: false };
};

/** Back-compat boolean form. */
NetworkMonitor.prototype._ping = async function () {
  const { reachable } = await this._probe();
  return reachable;
};

NetworkMonitor.prototype._pingOne = async function (targetUrl) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(targetUrl);
    } catch {
      return resolve(false);
    }

    const lib = parsed.protocol === 'https:' ? https : http;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.pingTimeoutMs);

    const req = lib.get(targetUrl, {
      signal: controller.signal,
      timeout: this.pingTimeoutMs,
      headers: { 'Cache-Control': 'no-cache' },
    }, (res) => {
      clearTimeout(timeout);
      // Any HTTP response (even 404) means the network is reachable
      resolve(true);
    });

    req.on('error', () => {
      clearTimeout(timeout);
      resolve(false);
    });

    req.on('timeout', () => {
      clearTimeout(timeout);
      req.destroy();
      resolve(false);
    });
  });
};

NetworkMonitor.prototype._setOnline = function () {
  this.isOnline = true;
  if (!this.wasOnline) {
    this.wasOnline = true;
    this.emit('online');
    this.emit('change', { online: true, lastCheckAt: this.lastCheckAt });
    console.log('[network-monitor] Connection established');
  }
};

NetworkMonitor.prototype._setOffline = function (reason) {
  this.isOnline = false;
  if (this.wasOnline !== false) {
    this.wasOnline = false;
    this.emit('offline', reason);
    this.emit('change', { online: false, reason, lastCheckAt: this.lastCheckAt });
    console.log('[network-monitor] Connection lost:', reason);
  }
};

NetworkMonitor.prototype.getStatus = function () {
  return {
    online: this.isOnline,
    osOnline: this.osOnline,
    lastCheckAt: this.lastCheckAt,
    consecutiveFailures: this.consecutiveFailures,
    running: this.running,
  };
};

module.exports = { NetworkMonitor };
