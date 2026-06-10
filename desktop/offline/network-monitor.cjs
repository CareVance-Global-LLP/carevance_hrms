const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { URL } = require('node:url');

const DEFAULT_PING_URL = 'https://clients3.google.com/generate_204';
const DEFAULT_PING_INTERVAL_MS = 5000;
const DEFAULT_PING_TIMEOUT_MS = 3000;

function NetworkMonitor(options = {}) {
  EventEmitter.call(this);

  this.pingUrl = options.pingUrl || DEFAULT_PING_URL;
  this.intervalMs = options.intervalMs || DEFAULT_PING_INTERVAL_MS;
  this.pingTimeoutMs = options.pingTimeoutMs || DEFAULT_PING_TIMEOUT_MS;
  this.customCheck = typeof options.customCheck === 'function' ? options.customCheck : null;

  this.isOnline = true;
  this.wasOnline = true;
  this.lastCheckAt = null;
  this.consecutiveFailures = 0;
  this.timer = null;
  this.running = false;
  this.checkInProgress = false;
}

NetworkMonitor.prototype = Object.create(EventEmitter.prototype);
NetworkMonitor.prototype.constructor = NetworkMonitor;

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
    const online = await this._ping();
    this.consecutiveFailures = online ? 0 : this.consecutiveFailures + 1;
    this.lastCheckAt = new Date().toISOString();

    if (online) {
      this._setOnline();
    } else {
      this._setOffline(`Ping failed (${this.consecutiveFailures} consecutive failures)`);
    }
  } catch (err) {
    this.consecutiveFailures++;
    this.lastCheckAt = new Date().toISOString();
    this._setOffline(err.message || 'Ping error');
  } finally {
    this.checkInProgress = false;
  }
};

NetworkMonitor.prototype._ping = async function () {
  if (typeof this.customCheck === 'function') {
    try {
      const result = await this.customCheck();
      if (result !== undefined) return Boolean(result);
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    const url = new URL(this.pingUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.pingTimeoutMs);

    const req = lib.get(this.pingUrl, {
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
    lastCheckAt: this.lastCheckAt,
    consecutiveFailures: this.consecutiveFailures,
    running: this.running,
  };
};

module.exports = { NetworkMonitor };
