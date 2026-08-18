'use strict';

const fs = require('node:fs');
const path = require('node:path');

/**
 * Disk backing for the renderer's pending activity-session queue.
 *
 * Sessions whose create failed used to live in renderer memory only, so closing
 * the app during an outage lost the app/website timeline for that whole stretch
 * — the one thing offline tracking exists to prevent, and the gap
 * pendingSessionQueue.ts described as "a separate piece of work".
 *
 * Deliberately NOT the offline SQLite store. That rewrites its entire file on
 * every write (offline-db.cjs `_persist`, ~512 KB here), which is far too much
 * per application switch. This file holds one bounded JSON array instead, and
 * writes are debounced so a burst of switches costs a single flush.
 */

const FILE_NAME = 'pending-activity-sessions.json';
const FLUSH_DEBOUNCE_MS = 2000;

/** Matches the renderer queue's own ceiling; a corrupt or huge file cannot grow memory without bound. */
const MAX_SESSIONS = 3000;

function PendingSessionsStore(userDataDir) {
  this.filePath = path.join(userDataDir, 'offline-data', FILE_NAME);
  this.flushTimer = null;
  this.pending = null;
}

PendingSessionsStore.prototype.load = function () {
  try {
    if (!fs.existsSync(this.filePath)) return [];

    const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
    if (!Array.isArray(parsed)) return [];

    // Only sessions the server can de-duplicate are worth replaying: without
    // (local_id, device_id) a retry inserts a second row for the same stretch
    // of time, and this data feeds payroll.
    return parsed
      .filter((item) => item && typeof item === 'object' && item.local_id && item.device_id)
      .slice(-MAX_SESSIONS);
  } catch {
    // A truncated or hand-edited file must not stop the tracker starting.
    return [];
  }
};

/** Queue a write. Repeated calls inside the debounce window collapse into one. */
PendingSessionsStore.prototype.save = function (sessions) {
  this.pending = Array.isArray(sessions) ? sessions.slice(-MAX_SESSIONS) : [];

  if (this.flushTimer) return;

  this.flushTimer = setTimeout(() => {
    this.flushTimer = null;
    this.flush();
  }, FLUSH_DEBOUNCE_MS);

  if (typeof this.flushTimer.unref === 'function') this.flushTimer.unref();
};

/** Write immediately. Called on quit, where a debounce would simply lose the data. */
PendingSessionsStore.prototype.flush = function () {
  if (this.pending === null) return false;

  const sessions = this.pending;
  this.pending = null;

  try {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });

    // Temp file plus rename, for the same reason offline-db does it: a crash
    // partway through a direct write leaves a fragment where the queue should
    // be, and losing the file loses every unsent session in it.
    const tempPath = `${this.filePath}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(sessions), 'utf8');
    fs.renameSync(tempPath, this.filePath);
    return true;
  } catch {
    return false;
  }
};

PendingSessionsStore.prototype.dispose = function () {
  if (this.flushTimer) {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }
  this.flush();
};

module.exports = { PendingSessionsStore, FLUSH_DEBOUNCE_MS, MAX_SESSIONS };
