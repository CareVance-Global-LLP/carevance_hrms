const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const { encrypt, decrypt } = require('./crypto-utils.cjs');

const SCHEMA_VERSION = 2;
const DB_FILENAME = 'carevance-offline.db';

const ensureDirectory = (dirPath) => {
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS offline_auth (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token TEXT NOT NULL,
  encrypted_session TEXT,
  device_id TEXT NOT NULL,
  organization_id INTEGER,
  user_data TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT,
  UNIQUE(user_id, device_id)
);

CREATE TABLE IF NOT EXISTS offline_screenshots (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  image_data TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  device_id TEXT NOT NULL,
  time_entry_id INTEGER,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','syncing','synced','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_screenshots_status ON offline_screenshots(sync_status);
CREATE INDEX IF NOT EXISTS idx_offline_screenshots_user ON offline_screenshots(user_id);

CREATE TABLE IF NOT EXISTS offline_timeline (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  activity_data TEXT,
  device_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','syncing','synced','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_timeline_status ON offline_timeline(sync_status);
CREATE INDEX IF NOT EXISTS idx_offline_timeline_user ON offline_timeline(user_id);

CREATE TABLE IF NOT EXISTS offline_app_usage (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  app_name TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL,
  title TEXT,
  device_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','syncing','synced','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_app_usage_status ON offline_app_usage(sync_status);
CREATE INDEX IF NOT EXISTS idx_offline_app_usage_user ON offline_app_usage(user_id);

CREATE TABLE IF NOT EXISTS offline_website_usage (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  title TEXT,
  duration INTEGER NOT NULL DEFAULT 0,
  timestamp TEXT NOT NULL,
  device_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','syncing','synced','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_website_usage_status ON offline_website_usage(sync_status);
CREATE INDEX IF NOT EXISTS idx_offline_website_usage_user ON offline_website_usage(user_id);

CREATE TABLE IF NOT EXISTS offline_attendance (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  punch_type TEXT NOT NULL CHECK(punch_type IN ('in','out')),
  punch_at TEXT NOT NULL,
  session_id TEXT,
  latitude REAL,
  longitude REAL,
  device_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','syncing','synced','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_attendance_status ON offline_attendance(sync_status);
CREATE INDEX IF NOT EXISTS idx_offline_attendance_user ON offline_attendance(user_id);

CREATE TABLE IF NOT EXISTS offline_time_entries (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('start','stop')),
  project_id INTEGER,
  task_id INTEGER,
  timer_slot TEXT DEFAULT 'primary',
  latitude REAL,
  longitude REAL,
  device_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','syncing','synced','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_time_entries_status ON offline_time_entries(sync_status);
CREATE INDEX IF NOT EXISTS idx_offline_time_entries_user ON offline_time_entries(user_id);

CREATE TABLE IF NOT EXISTS sync_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  record_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 5,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(record_type, local_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_priority ON sync_queue(priority, created_at);

CREATE TABLE IF NOT EXISTS offline_activity_records (
  local_id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  name TEXT,
  title TEXT,
  url TEXT,
  duration INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL,
  metadata TEXT,
  device_id TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'pending' CHECK(sync_status IN ('pending','syncing','synced','failed')),
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  synced_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_offline_activity_status ON offline_activity_records(sync_status);
CREATE INDEX IF NOT EXISTS idx_offline_activity_user ON offline_activity_records(user_id);
`;

const generateLocalId = () => `off_${crypto.randomUUID()}`;

// ── sql.js wrapper ──
let SQL = null; // Will hold the initialized sql.js module

const queryToObjects = (results) => {
  // sql.js exec returns [{ columns: string[], values: any[][] }]
  if (!results || results.length === 0) return [];
  const { columns, values } = results[0];
  if (!values) return [];
  return values.map((row) => {
    const obj = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj;
  });
};

const firstRow = (results) => {
  const rows = queryToObjects(results);
  return rows.length > 0 ? rows[0] : null;
};

function OfflineDatabase(userDataPath) {
  this.available = false;
  this.ready = false;
  this.db = null;
  this.dbPath = null;
  this.saveTimer = null;
  this.dirty = false;

  if (!userDataPath) return this;

  const dbDir = ensureDirectory(path.join(userDataPath, 'offline-data'));
  this.dbPath = path.join(dbDir, DB_FILENAME);
  this.available = true;
}

OfflineDatabase.prototype.open = async function () {
  if (!this.available) return false;
  if (this.db && this.ready) return true;

  if (!SQL) {
    try {
      const initSqlJs = require('sql.js');
      SQL = await initSqlJs();
    } catch (err) {
      console.error('[offline-db] Failed to load sql.js:', err.message);
      this.available = false;
      return false;
    }
  }

  try {
    let buffer = null;
    if (fs.existsSync(this.dbPath)) {
      buffer = fs.readFileSync(this.dbPath);
    }

    this.db = buffer
      ? new SQL.Database(buffer)
      : new SQL.Database();

    this.db.run('PRAGMA journal_mode = WAL');
    this.db.run('PRAGMA busy_timeout = 5000');
    this.db.run('PRAGMA foreign_keys = ON');

    // Run schema
    this.db.run(SCHEMA);

    // Migration check
    const versionRows = this.db.exec('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
    const versionRow = firstRow(versionRows);
    const currentVersion = versionRow ? versionRow.version : 0;

    if (currentVersion < SCHEMA_VERSION) {
      this._migrate(currentVersion);
    }

    // Auto-save every 5 seconds when dirty
    this.saveTimer = setInterval(() => {
      if (this.dirty && this.db) {
        this._persist();
        this.dirty = false;
      }
    }, 5000);

    this.ready = true;
    console.log('[offline-db] SQLite (sql.js) database ready at:', this.dbPath);
    return true;
  } catch (err) {
    console.error('[offline-db] Failed to open database:', err.message);
    this.ready = false;
    return false;
  }
};

OfflineDatabase.prototype._persist = function () {
  if (!this.db || !this.dbPath) return;
  try {
    const data = this.db.export();
    const dir = path.dirname(this.dbPath);
    ensureDirectory(dir);
    fs.writeFileSync(this.dbPath, Buffer.from(data));
  } catch (err) {
    console.error('[offline-db] Failed to persist database:', err.message);
  }
};

OfflineDatabase.prototype._markDirty = function () {
  this.dirty = true;
};

OfflineDatabase.prototype._migrate = function (fromVersion) {
  if (fromVersion < 1) {
    this.db.run('INSERT OR IGNORE INTO schema_version (version) VALUES (?)', [SCHEMA_VERSION]);
  }
  if (fromVersion < 2) {
    try {
      this.db.run("ALTER TABLE offline_screenshots ADD COLUMN time_entry_id INTEGER");
    } catch (err) {
      console.warn('[offline-db] Migration v2 alter table failed (may already exist):', err.message);
    }
    this.db.run('INSERT OR IGNORE INTO schema_version (version) VALUES (?)', [2]);
  }
};

OfflineDatabase.prototype.close = function () {
  if (this.saveTimer) {
    clearInterval(this.saveTimer);
    this.saveTimer = null;
  }
  if (this.db) {
    this._persist();
    try { this.db.close(); } catch {}
    this.db = null;
    this.ready = false;
  }
};

OfflineDatabase.prototype.isReady = function () {
  return this.available && this.ready && this.db !== null;
};

OfflineDatabase.prototype._run = function (sql, params = []) {
  if (!this.isReady()) return null;
  try {
    this.db.run(sql, params);
    this._markDirty();
    return true;
  } catch (err) {
    console.error('[offline-db] SQL error:', (err && (err.message || err.toString())), 'SQL:', sql.slice(0, 120));
    return false;
  }
};

OfflineDatabase.prototype._get = function (sql, params = []) {
  if (!this.isReady()) return null;
  try {
    const stmt = this.db.prepare(sql);
    if (params.length > 0) stmt.bind(params);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  } catch (err) {
    console.error('[offline-db] SQL error:', err.message);
    return null;
  }
};

OfflineDatabase.prototype._all = function (sql, params = []) {
  if (!this.isReady()) return [];
  try {
    const results = this.db.exec(sql, params);
    return queryToObjects(results);
  } catch (err) {
    console.error('[offline-db] SQL error:', err.message);
    return [];
  }
};

OfflineDatabase.prototype._count = function (sql, params = []) {
  const row = this._get(sql, params);
  return row ? row.count : 0;
};

//
// Auth operations
//
OfflineDatabase.prototype.saveAuthSession = function (userId, token, deviceId, organizationId, userData, encryptSecret) {
  if (!this.isReady()) return null;
  const encryptedSession = encrypt(JSON.stringify({ token, userData, userId }), encryptSecret);
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const ok = this._run(
    `INSERT OR REPLACE INTO offline_auth (user_id, token, encrypted_session, device_id, organization_id, user_data, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, token, encryptedSession, deviceId, organizationId || null, userData ? JSON.stringify(userData) : null, expiresAt]
  );
  return ok ? { userId, token, expiresAt } : null;
};

OfflineDatabase.prototype.getAuthSession = function (deviceId) {
  if (!this.isReady()) return null;
  const row = this._get('SELECT * FROM offline_auth WHERE device_id = ? ORDER BY id DESC LIMIT 1', [deviceId]);
  if (!row) return null;
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    this._run('DELETE FROM offline_auth WHERE id = ?', [row.id]);
    return null;
  }
  return row;
};

OfflineDatabase.prototype.getDecryptedAuthSession = function (deviceId, encryptSecret) {
  const row = this.getAuthSession(deviceId);
  if (!row) return null;
  if (row.encrypted_session) {
    try {
      const decrypted = decrypt(row.encrypted_session, encryptSecret);
      if (decrypted) {
        const parsed = JSON.parse(decrypted);
        return { ...row, token: parsed.token || row.token, userData: parsed.userData };
      }
    } catch {}
  }
  return row;
};

OfflineDatabase.prototype.clearAuthSession = function (deviceId) {
  if (!this.isReady()) return false;
  return this._run('DELETE FROM offline_auth WHERE device_id = ?', [deviceId]);
};

OfflineDatabase.prototype.clearAllAuth = function () {
  if (!this.isReady()) return false;
  return this._run('DELETE FROM offline_auth');
};

//
// Screenshot operations
//
OfflineDatabase.prototype.saveScreenshot = function (localId, userId, imageData, capturedAt, deviceId, timeEntryId) {
  if (!this.isReady()) return null;
  const id = localId || generateLocalId();
  const ok = this._run(
    'INSERT OR IGNORE INTO offline_screenshots (local_id, user_id, image_data, captured_at, device_id, time_entry_id) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, imageData, capturedAt, deviceId, timeEntryId || null]
  );
  if (ok) { this._enqueueSync('screenshot', id, 5); return id; }
  return null;
};

OfflineDatabase.prototype.getPendingScreenshots = function (limit = 50) {
  return this._all(
    'SELECT * FROM offline_screenshots WHERE sync_status IN (\'pending\',\'failed\') ORDER BY created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.getUnsyncedCount = function () {
  return this._count('SELECT COUNT(*) as count FROM offline_screenshots WHERE sync_status IN (\'pending\',\'failed\')');
};

OfflineDatabase.prototype.markScreenshotSynced = function (localId) {
  const ok = this._run("UPDATE offline_screenshots SET sync_status = 'synced', synced_at = datetime('now') WHERE local_id = ?", [localId]);
  if (ok) this._dequeueSync('screenshot', localId);
  return ok;
};

OfflineDatabase.prototype.markScreenshotFailed = function (localId, errorMessage) {
  if (!localId) {
    console.warn('[offline-db] markScreenshotFailed skipped: no localId provided');
    return false;
  }
  return this._run(
    "UPDATE offline_screenshots SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ? WHERE local_id = ?",
    [errorMessage || 'Unknown error', localId]
  );
};

OfflineDatabase.prototype.markScreenshotSyncing = function (localId) {
  return this._run("UPDATE offline_screenshots SET sync_status = 'syncing' WHERE local_id = ?", [localId]);
};

//
// Timeline operations
//
OfflineDatabase.prototype.saveTimeline = function (localId, userId, startTime, endTime, activityData, deviceId) {
  if (!this.isReady()) return null;
  const id = localId || generateLocalId();
  const ok = this._run(
    'INSERT OR IGNORE INTO offline_timeline (local_id, user_id, start_time, end_time, activity_data, device_id) VALUES (?, ?, ?, ?, ?, ?)',
    [id, userId, startTime, endTime, activityData ? JSON.stringify(activityData) : null, deviceId]
  );
  if (ok) { this._enqueueSync('timeline', id, 2); return id; }
  return null;
};

OfflineDatabase.prototype.getPendingTimelines = function (limit = 50) {
  return this._all(
    'SELECT * FROM offline_timeline WHERE sync_status IN (\'pending\',\'failed\') ORDER BY created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.getUnsyncedTimelineCount = function () {
  return this._count("SELECT COUNT(*) as count FROM offline_timeline WHERE sync_status IN ('pending','failed')");
};

OfflineDatabase.prototype.markTimelineSynced = function (localId) {
  const ok = this._run("UPDATE offline_timeline SET sync_status = 'synced', synced_at = datetime('now') WHERE local_id = ?", [localId]);
  if (ok) this._dequeueSync('timeline', localId);
  return ok;
};

OfflineDatabase.prototype.markTimelineFailed = function (localId, errorMessage) {
  return this._run(
    "UPDATE offline_timeline SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ? WHERE local_id = ?",
    [errorMessage || 'Unknown error', localId]
  );
};

OfflineDatabase.prototype.markTimelineSyncing = function (localId) {
  return this._run("UPDATE offline_timeline SET sync_status = 'syncing' WHERE local_id = ?", [localId]);
};

//
// App usage operations
//
OfflineDatabase.prototype.saveAppUsage = function (localId, userId, appName, duration, timestamp, title, deviceId) {
  if (!this.isReady()) return null;
  const id = localId || generateLocalId();
  const ok = this._run(
    'INSERT OR IGNORE INTO offline_app_usage (local_id, user_id, app_name, duration, timestamp, title, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, appName, duration, timestamp, title || null, deviceId]
  );
  if (ok) { this._enqueueSync('app_usage', id, 3); return id; }
  return null;
};

OfflineDatabase.prototype.getPendingAppUsage = function (limit = 50) {
  return this._all(
    'SELECT * FROM offline_app_usage WHERE sync_status IN (\'pending\',\'failed\') ORDER BY created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.markAppUsageSynced = function (localId) {
  const ok = this._run("UPDATE offline_app_usage SET sync_status = 'synced', synced_at = datetime('now') WHERE local_id = ?", [localId]);
  if (ok) this._dequeueSync('app_usage', localId);
  return ok;
};

OfflineDatabase.prototype.markAppUsageFailed = function (localId, errorMessage) {
  return this._run(
    "UPDATE offline_app_usage SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ? WHERE local_id = ?",
    [errorMessage || 'Unknown error', localId]
  );
};

OfflineDatabase.prototype.markAppUsageSyncing = function (localId) {
  return this._run("UPDATE offline_app_usage SET sync_status = 'syncing' WHERE local_id = ?", [localId]);
};

//
// Website usage operations
//
OfflineDatabase.prototype.saveWebsiteUsage = function (localId, userId, url, title, duration, timestamp, deviceId) {
  if (!this.isReady()) return null;
  const id = localId || generateLocalId();
  const ok = this._run(
    'INSERT OR IGNORE INTO offline_website_usage (local_id, user_id, url, title, duration, timestamp, device_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, userId, url, title || null, duration, timestamp, deviceId]
  );
  if (ok) { this._enqueueSync('website_usage', id, 4); return id; }
  return null;
};

OfflineDatabase.prototype.getPendingWebsiteUsage = function (limit = 50) {
  return this._all(
    'SELECT * FROM offline_website_usage WHERE sync_status IN (\'pending\',\'failed\') ORDER BY created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.markWebsiteUsageSynced = function (localId) {
  const ok = this._run("UPDATE offline_website_usage SET sync_status = 'synced', synced_at = datetime('now') WHERE local_id = ?", [localId]);
  if (ok) this._dequeueSync('website_usage', localId);
  return ok;
};

OfflineDatabase.prototype.markWebsiteUsageFailed = function (localId, errorMessage) {
  return this._run(
    "UPDATE offline_website_usage SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ? WHERE local_id = ?",
    [errorMessage || 'Unknown error', localId]
  );
};

OfflineDatabase.prototype.markWebsiteUsageSyncing = function (localId) {
  return this._run("UPDATE offline_website_usage SET sync_status = 'syncing' WHERE local_id = ?", [localId]);
};

//
// Attendance operations
//
OfflineDatabase.prototype.saveAttendance = function (localId, userId, punchType, punchAt, sessionId, latitude, longitude, deviceId) {
  if (!this.isReady()) return null;
  const id = localId || generateLocalId();
  const ok = this._run(
    'INSERT OR IGNORE INTO offline_attendance (local_id, user_id, punch_type, punch_at, session_id, latitude, longitude, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, userId, punchType, punchAt, sessionId || null, latitude || null, longitude || null, deviceId]
  );
  if (ok) { this._enqueueSync('attendance', id, 1); return id; }
  return null;
};

OfflineDatabase.prototype.getPendingAttendance = function (limit = 50) {
  return this._all(
    'SELECT * FROM offline_attendance WHERE sync_status IN (\'pending\',\'failed\') ORDER BY created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.getLastAttendanceRecord = function (userId) {
  return this._get(
    'SELECT * FROM offline_attendance WHERE user_id = ? AND sync_status = \'synced\' ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
};

OfflineDatabase.prototype.markAttendanceSynced = function (localId) {
  const ok = this._run("UPDATE offline_attendance SET sync_status = 'synced', synced_at = datetime('now') WHERE local_id = ?", [localId]);
  if (ok) this._dequeueSync('attendance', localId);
  return ok;
};

OfflineDatabase.prototype.markAttendanceFailed = function (localId, errorMessage) {
  return this._run(
    "UPDATE offline_attendance SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ? WHERE local_id = ?",
    [errorMessage || 'Unknown error', localId]
  );
};

OfflineDatabase.prototype.markAttendanceSyncing = function (localId) {
  return this._run("UPDATE offline_attendance SET sync_status = 'syncing' WHERE local_id = ?", [localId]);
};

//
// Time entry operations
//
OfflineDatabase.prototype.saveTimeEntry = function (localId, userId, action, projectId, taskId, timerSlot, latitude, longitude, deviceId) {
  if (!this.isReady()) return null;
  const id = localId || generateLocalId();
  const ok = this._run(
    'INSERT OR IGNORE INTO offline_time_entries (local_id, user_id, action, project_id, task_id, timer_slot, latitude, longitude, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, userId, action, projectId || null, taskId || null, timerSlot || 'primary', latitude || null, longitude || null, deviceId]
  );
  if (ok) { this._enqueueSync('time_entry', id, 1); return id; }
  return null;
};

OfflineDatabase.prototype.getPendingTimeEntries = function (limit = 50) {
  return this._all(
    'SELECT * FROM offline_time_entries WHERE sync_status IN (\'pending\',\'failed\') ORDER BY created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.markTimeEntrySynced = function (localId) {
  const ok = this._run("UPDATE offline_time_entries SET sync_status = 'synced', synced_at = datetime('now') WHERE local_id = ?", [localId]);
  if (ok) this._dequeueSync('time_entry', localId);
  return ok;
};

OfflineDatabase.prototype.markTimeEntryFailed = function (localId, errorMessage) {
  return this._run(
    "UPDATE offline_time_entries SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ? WHERE local_id = ?",
    [errorMessage || 'Unknown error', localId]
  );
};

OfflineDatabase.prototype.markTimeEntrySyncing = function (localId) {
  return this._run("UPDATE offline_time_entries SET sync_status = 'syncing' WHERE local_id = ?", [localId]);
};

//
// Activity record operations
//
OfflineDatabase.prototype.saveActivityRecord = function (localId, userId, type, name, title, url, duration, recordedAt, metadata, deviceId) {
  if (!this.isReady()) return null;
  const id = localId || generateLocalId();
  const ok = this._run(
    'INSERT OR IGNORE INTO offline_activity_records (local_id, user_id, type, name, title, url, duration, recorded_at, metadata, device_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, userId, type, name || null, title || null, url || null, duration, recordedAt, metadata ? JSON.stringify(metadata) : null, deviceId]
  );
  if (ok) { this._enqueueSync('activity', id, 2); return id; }
  return null;
};

OfflineDatabase.prototype.getPendingActivityRecords = function (limit = 50) {
  return this._all(
    'SELECT * FROM offline_activity_records WHERE sync_status IN (\'pending\',\'failed\') ORDER BY created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.markActivitySynced = function (localId) {
  const ok = this._run("UPDATE offline_activity_records SET sync_status = 'synced', synced_at = datetime('now') WHERE local_id = ?", [localId]);
  if (ok) this._dequeueSync('activity', localId);
  return ok;
};

OfflineDatabase.prototype.markActivityFailed = function (localId, errorMessage) {
  return this._run(
    "UPDATE offline_activity_records SET sync_status = 'failed', retry_count = retry_count + 1, error_message = ? WHERE local_id = ?",
    [errorMessage || 'Unknown error', localId]
  );
};

OfflineDatabase.prototype.markActivitySyncing = function (localId) {
  return this._run("UPDATE offline_activity_records SET sync_status = 'syncing' WHERE local_id = ?", [localId]);
};

//
// Sync queue operations
//
OfflineDatabase.prototype._enqueueSync = function (recordType, localId, priority) {
  if (!this.isReady()) return;
  this._run(
    'INSERT OR IGNORE INTO sync_queue (record_type, local_id, priority) VALUES (?, ?, ?)',
    [recordType, localId, priority]
  );
};

OfflineDatabase.prototype._dequeueSync = function (recordType, localId) {
  if (!this.isReady()) return;
  this._run('DELETE FROM sync_queue WHERE record_type = ? AND local_id = ?', [recordType, localId]);
};

OfflineDatabase.prototype.getNextSyncBatch = function (limit = 20) {
  return this._all(
    'SELECT sq.* FROM sync_queue sq ORDER BY sq.priority ASC, sq.created_at ASC LIMIT ?',
    [limit]
  );
};

OfflineDatabase.prototype.getQueueSize = function () {
  return this._count('SELECT COUNT(*) as count FROM sync_queue');
};

OfflineDatabase.prototype.getSyncStatusCounts = function () {
  const tables = ['offline_screenshots', 'offline_timeline', 'offline_app_usage', 'offline_website_usage', 'offline_attendance', 'offline_time_entries', 'offline_activity_records'];
  const counts = { pending: 0, syncing: 0, synced: 0, failed: 0 };

  for (const table of tables) {
    try {
      const rows = this._all(`SELECT sync_status, COUNT(*) as count FROM ${table} GROUP BY sync_status`);
      for (const row of rows) {
        if (counts[row.sync_status] !== undefined) {
          counts[row.sync_status] += row.count;
        }
      }
    } catch {}
  }

  return counts;
};

OfflineDatabase.prototype.getAllPendingCount = function () {
  const counts = this.getSyncStatusCounts();
  return (counts.pending || 0) + (counts.failed || 0);
};

OfflineDatabase.prototype.getLastSyncTime = function () {
  const tables = ['offline_screenshots', 'offline_timeline', 'offline_app_usage', 'offline_website_usage', 'offline_attendance', 'offline_time_entries', 'offline_activity_records'];
  let latest = null;

  for (const table of tables) {
    try {
      const row = this._get(
        `SELECT synced_at FROM ${table} WHERE sync_status = 'synced' AND synced_at IS NOT NULL ORDER BY synced_at DESC LIMIT 1`
      );
      if (row && row.synced_at && (!latest || row.synced_at > latest)) {
        latest = row.synced_at;
      }
    } catch {}
  }

  return latest;
};

OfflineDatabase.prototype.getPendingScreenshotsCount = function () {
  return this._count("SELECT COUNT(*) as count FROM offline_screenshots WHERE sync_status IN ('pending','failed')");
};

OfflineDatabase.prototype.getOfflineSummary = function () {
  return {
    ready: this.isReady(),
    queueSize: this.getQueueSize(),
    syncCounts: this.getSyncStatusCounts(),
    lastSyncTime: this.getLastSyncTime(),
    dbPath: this.dbPath,
  };
};

module.exports = { OfflineDatabase, generateLocalId };
