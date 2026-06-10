const { EventEmitter } = require('node:events');
const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

const SYNC_BATCH_SIZE = 10;
const SYNC_INTERVAL_MS = 5000;
const MAX_RETRY_COUNT = 10;
const RATE_LIMIT_BACKOFF_MS = 60000;

function SyncEngine(options = {}) {
  EventEmitter.call(this);

  this.db = options.offlineDb;
  this.queueManager = options.queueManager;
  this.networkMonitor = options.networkMonitor;
  this.apiBaseUrl = options.apiBaseUrl || '';
  this.authToken = options.authToken || '';
  this.deviceId = options.deviceId || '';
  this.userId = options.userId || null;

  this.running = false;
  this.syncing = false;
  this.timer = null;
  this.lastSyncAt = null;
  this.lastError = null;
  this.syncProgress = { current: 0, total: 0, itemType: '' };
  this.rateLimitedUntil = 0;

  this._boundHandleOnline = this._handleOnline.bind(this);
  this._boundDoSync = this._doSync.bind(this);
}

SyncEngine.prototype = Object.create(EventEmitter.prototype);
SyncEngine.prototype.constructor = SyncEngine;

SyncEngine.prototype.setCredentials = function (authToken, userId, deviceId, apiUrl) {
  this.authToken = authToken;
  this.userId = userId;
  this.deviceId = deviceId;
  if (apiUrl) this.apiBaseUrl = apiUrl;
};

SyncEngine.prototype.start = function () {
  if (this.running) return;
  this.running = true;

  this.networkMonitor.on('online', this._boundHandleOnline);

  // Periodic sync check (every 5 seconds when online)
  this.timer = setInterval(() => {
    if (this.networkMonitor.isOnline && !this.syncing) {
      this._doSync().catch(() => {});
    }
  }, SYNC_INTERVAL_MS);

  // Immediate sync attempt if online
  if (this.networkMonitor.isOnline) {
    this._doSync().catch(() => {});
  }

  console.log('[sync-engine] Started');
};

SyncEngine.prototype.stop = function () {
  this.running = false;
  this.syncing = false;
  if (this.timer) {
    clearInterval(this.timer);
    this.timer = null;
  }
  this.networkMonitor.off('online', this._boundHandleOnline);
};

SyncEngine.prototype._handleOnline = function () {
  console.log('[sync-engine] Network reconnected, starting sync...');
  this._doSync().catch(() => {});
};

SyncEngine.prototype.triggerSync = function () {
  if (!this.running || this.syncing) return;
  this._doSync().catch(() => {});
};

SyncEngine.prototype._doSync = async function () {
  if (this.syncing || !this.db.isReady()) return;
  if (!this.authToken) return;

  if (this.rateLimitedUntil > Date.now()) {
    this.syncing = false;
    return;
  }

  this.syncing = true;

  try {
    const queueSize = this.queueManager.getQueueSize();
    if (queueSize === 0) {
      this.lastSyncAt = new Date().toISOString();
      this.lastError = null;
      this.syncing = false;
      return;
    }

    this.emit('sync-start', { total: queueSize });

    const batch = this.queueManager.getNextBatch(SYNC_BATCH_SIZE);
    if (!batch || batch.length === 0) {
      this.syncing = false;
      return;
    }

    this.syncProgress = { current: 0, total: batch.length, itemType: batch[0].record_type };

    for (const item of batch) {
      if (!this.running) break;
      if (!this.networkMonitor.isOnline) {
        console.log('[sync-engine] Network lost during sync, pausing');
        break;
      }

      try {
        await this._syncItem(item);
      } catch (err) {
        console.error(`[sync-engine] Failed to sync ${item.record_type}:${item.local_id}:`, err.message);
      }

      this.syncProgress.current++;
      this.emit('sync-progress', {
        current: this.syncProgress.current,
        total: this.syncProgress.total,
        itemType: this.syncProgress.itemType,
      });
    }

    this.lastSyncAt = new Date().toISOString();
    this.lastError = null;
    this.emit('sync-complete', {
      syncedCount: this.syncProgress.current,
      totalCount: this.syncProgress.total,
      lastSyncAt: this.lastSyncAt,
    });

    // If there are more items, schedule next batch
    const remaining = this.queueManager.getQueueSize();
    if (remaining > 0 && this.networkMonitor.isOnline && this.running) {
      setImmediate(() => {
        this._doSync().catch(() => {});
      });
    }
  } catch (err) {
    this.lastError = err.message;
    this.emit('sync-error', { error: err.message });
  } finally {
    this.syncing = false;
  }
};

SyncEngine.prototype._syncItem = async function (queueItem) {
  const record = this.queueManager.getRecordByType(queueItem.record_type, queueItem.local_id);
  if (!record) {
    // Record may have been already synced and cleaned up
    this.queueManager.markSynced(queueItem.record_type, queueItem.local_id);
    return;
  }

  if (record.retry_count >= MAX_RETRY_COUNT) {
    this.emit('item-permanent-failure', {
      recordType: queueItem.record_type,
      localId: queueItem.local_id,
      error: 'Max retry count exceeded',
    });
    return;
  }

  switch (queueItem.record_type) {
    case 'attendance':
      await this._syncAttendance(record);
      break;
    case 'time_entry':
      await this._syncTimeEntry(record);
      break;
    case 'timeline':
      await this._syncTimeline(record);
      break;
    case 'activity':
      await this._syncActivity(record);
      break;
    case 'app_usage':
      await this._syncAppUsage(record);
      break;
    case 'website_usage':
      await this._syncWebsiteUsage(record);
      break;
    case 'screenshot':
      await this._syncScreenshot(record);
      break;
    default:
      this.queueManager.markSynced(queueItem.record_type, queueItem.local_id);
  }
};

SyncEngine.prototype._apiRequest = function (method, path, body = null, isFormData = false) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, this.apiBaseUrl);
    const lib = url.protocol === 'https:' ? https : http;
    const bodyStr = body ? JSON.stringify(body) : null;

    const headers = {
      'Authorization': `Bearer ${this.authToken}`,
      'Idempotency-Key': `offline-${this.deviceId}-${path}-${body?.local_id || ''}`,
    };

    if (bodyStr && !isFormData) {
      headers['Content-Type'] = 'application/json';
    }

    const options = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: method.toUpperCase(),
      headers,
      timeout: 30000,
    };

    const req = lib.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const responseStr = Buffer.concat(chunks).toString('utf8');
        let responseData = null;
        try { responseData = JSON.parse(responseStr); } catch { responseData = responseStr; }

        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ status: res.statusCode, data: responseData });
        } else if (res.statusCode === 409) {
          // Conflict / duplicate - treat as success
          resolve({ status: res.statusCode, data: responseData, duplicate: true });
        } else if (responseData && typeof responseData === 'object' && (responseData.error_code === 'TOO_MANY_REQUESTS' || String(res.statusCode).trim() === '429')) {
          console.log('[sync-engine] Rate limit detected, statusCode:', res.statusCode, 'error_code:', responseData.error_code);
          const retryAfter = parseInt(res.headers['retry-after'] || '30', 10);
          reject(new Error(`Rate limited (retry after ${retryAfter}s)`));
        } else if (res.statusCode === 422) {
          reject(new Error(`Validation error: ${JSON.stringify(responseData)}`));
        } else if (res.statusCode === 401 || res.statusCode === 403) {
          reject(new Error(`Auth error: ${res.statusCode}`));
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(responseData)}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
};

SyncEngine.prototype._syncAttendance = async function (record) {
  try {
    this.queueManager.markSynced('attendance', record.local_id);
    return;

    // When backend endpoints support idempotency, uncomment:
    // const endpoint = record.punch_type === 'in' 
    //   ? '/api/attendance/check-in' 
    //   : '/api/attendance/check-out';
    // await this._apiRequest('POST', endpoint, {
    //   local_id: record.local_id,
    //   device_id: record.device_id,
    //   timestamp: record.punch_at,
    // });
    // this.queueManager.markSynced('attendance', record.local_id);
  } catch (err) {
    const isAuthError = err.message.includes('Auth error');
    if (isAuthError) {
      this.emit('auth-error', { error: err.message });
    }
    this.queueManager.markFailed('attendance', record.local_id, err.message);
    throw err;
  }
};

SyncEngine.prototype._syncTimeEntry = async function (record) {
  try {
    this.queueManager.markSynced('time_entry', record.local_id);
    return;

    // When backend supports idempotency:
    // const endpoint = record.action === 'start'
    //   ? '/api/time-entries/start'
    //   : '/api/time-entries/stop';
    // await this._apiRequest('POST', endpoint, {
    //   local_id: record.local_id,
    //   device_id: record.device_id,
    //   project_id: record.project_id,
    //   task_id: record.task_id,
    //   timer_slot: record.timer_slot,
    // });
    // this.queueManager.markSynced('time_entry', record.local_id);
  } catch (err) {
    this.queueManager.markFailed('time_entry', record.local_id, err.message);
    throw err;
  }
};

SyncEngine.prototype._syncTimeline = async function (record) {
  try {
    this.queueManager.markSynced('timeline', record.local_id);
    return;

    // When backend supports idempotency:
    // await this._apiRequest('POST', '/api/activity-sessions', {
    //   local_id: record.local_id,
    //   device_id: record.device_id,
    //   start_time: record.start_time,
    //   end_time: record.end_time,
    //   activity_data: JSON.parse(record.activity_data || '{}'),
    // });
    // this.queueManager.markSynced('timeline', record.local_id);
  } catch (err) {
    this.queueManager.markFailed('timeline', record.local_id, err.message);
    throw err;
  }
};

SyncEngine.prototype._syncActivity = async function (record) {
  try {
    this.queueManager.markSynced('activity', record.local_id);
    return;

    // When backend supports idempotency:
    // await this._apiRequest('POST', '/api/activities', {
    //   local_id: record.local_id,
    //   device_id: record.device_id,
    //   type: record.type,
    //   name: record.name,
    //   title: record.title,
    //   url: record.url,
    //   duration: record.duration,
    //   recorded_at: record.recorded_at,
    // });
    // this.queueManager.markSynced('activity', record.local_id);
  } catch (err) {
    this.queueManager.markFailed('activity', record.local_id, err.message);
    throw err;
  }
};

SyncEngine.prototype._syncAppUsage = async function (record) {
  try {
    this.queueManager.markSynced('app_usage', record.local_id);
    return;

    // When backend supports idempotency:
    // await this._apiRequest('POST', '/api/activities', {
    //   local_id: record.local_id,
    //   device_id: record.device_id,
    //   type: 'app',
    //   name: record.app_name,
    //   duration: record.duration,
    //   recorded_at: record.timestamp,
    // });
    // this.queueManager.markSynced('app_usage', record.local_id);
  } catch (err) {
    this.queueManager.markFailed('app_usage', record.local_id, err.message);
    throw err;
  }
};

SyncEngine.prototype._syncWebsiteUsage = async function (record) {
  try {
    this.queueManager.markSynced('website_usage', record.local_id);
    return;

    // When backend supports idempotency:
    // await this._apiRequest('POST', '/api/activities', {
    //   local_id: record.local_id,
    //   device_id: record.device_id,
    //   type: 'browser',
    //   name: record.title || record.url,
    //   url: record.url,
    //   duration: record.duration,
    //   recorded_at: record.timestamp,
    // });
    // this.queueManager.markSynced('website_usage', record.local_id);
  } catch (err) {
    this.queueManager.markFailed('website_usage', record.local_id, err.message);
    throw err;
  }
};

console.log('[SYNC-ENGINE] Registering _syncScreenshot method, file version v3');
SyncEngine.prototype._syncScreenshot = async function (record) {
  try {
    await this._apiRequest('POST', '/api/screenshots', {
      local_id: record.local_id,
      device_id: record.device_id,
      time_entry_id: record.time_entry_id,
      image_data_url: record.image_data,
      captured_at: record.captured_at,
    });
    this.queueManager.markSynced('screenshot', record.local_id);
  } catch (err) {
    const msg = err.message || '';
    if (msg.includes('Rate limited') || msg.includes('HTTP 429')) {
      console.warn('[sync-engine] Rate limited on screenshot, will retry later');
      this.rateLimitedUntil = Date.now() + RATE_LIMIT_BACKOFF_MS;
      return;
    }
    const isAuthError = msg.includes('Auth error');
    if (isAuthError) {
      this.emit('auth-error', { error: msg });
    }
    this.queueManager.markFailed('screenshot', record.local_id, msg);
    throw err;
  }
};

SyncEngine.prototype.getStatus = function () {
  return {
    running: this.running,
    syncing: this.syncing,
    lastSyncAt: this.lastSyncAt,
    lastError: this.lastError,
    queueSize: this.queueManager ? this.queueManager.getQueueSize() : 0,
    syncProgress: this.syncProgress,
  };
};

module.exports = { SyncEngine };
