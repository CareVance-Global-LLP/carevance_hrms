const { EventEmitter } = require('node:events');

const PRIORITY_MAP = {
  attendance: 1,
  time_entry: 1,
  timeline: 2,
  activity: 2,
  app_usage: 3,
  website_usage: 4,
  screenshot: 5,
};

function QueueManager(offlineDb) {
  EventEmitter.call(this);
  this.db = offlineDb;
  this.processing = false;
}

QueueManager.prototype = Object.create(EventEmitter.prototype);
QueueManager.prototype.constructor = QueueManager;

QueueManager.prototype.getNextBatch = function (limit = 20) {
  return this.db.getNextSyncBatch(limit);
};

QueueManager.prototype.getQueueSize = function () {
  return this.db.getQueueSize();
};

QueueManager.prototype.getPendingCounts = function () {
  const counts = { attendance: 0, time_entry: 0, timeline: 0, activity: 0, app_usage: 0, website_usage: 0, screenshot: 0 };

  try {
    const attendanceRow = this.db.db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE record_type = 'attendance'`).get();
    if (attendanceRow) counts.attendance = attendanceRow.c;

    const timeEntryRow = this.db.db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE record_type = 'time_entry'`).get();
    if (timeEntryRow) counts.time_entry = timeEntryRow.c;

    const timelineRow = this.db.db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE record_type = 'timeline'`).get();
    if (timelineRow) counts.timeline = timelineRow.c;

    const activityRow = this.db.db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE record_type = 'activity'`).get();
    if (activityRow) counts.activity = activityRow.c;

    const appUsageRow = this.db.db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE record_type = 'app_usage'`).get();
    if (appUsageRow) counts.app_usage = appUsageRow.c;

    const websiteUsageRow = this.db.db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE record_type = 'website_usage'`).get();
    if (websiteUsageRow) counts.website_usage = websiteUsageRow.c;

    const screenshotRow = this.db.db.prepare(`SELECT COUNT(*) as c FROM sync_queue WHERE record_type = 'screenshot'`).get();
    if (screenshotRow) counts.screenshot = screenshotRow.c;
  } catch {}

  return counts;
};

QueueManager.prototype.getRecordByType = function (recordType, localId) {
  const tableMap = {
    attendance: 'offline_attendance',
    time_entry: 'offline_time_entries',
    timeline: 'offline_timeline',
    activity: 'offline_activity_records',
    app_usage: 'offline_app_usage',
    website_usage: 'offline_website_usage',
    screenshot: 'offline_screenshots',
  };

  const table = tableMap[recordType];
  if (!table || !this.db.isReady()) return null;

  try {
    const stmt = this.db.db.prepare(`SELECT * FROM ${table} WHERE local_id = ?`);
    stmt.bind([localId]);
    if (stmt.step()) {
      const row = stmt.getAsObject();
      stmt.free();
      return row;
    }
    stmt.free();
    return null;
  } catch (e) {
    console.warn('[queue-manager] getRecordByType error:', e.message || e, 'for', recordType, localId);
    return null;
  }
};

QueueManager.prototype.markSynced = function (recordType, localId) {
  const markMap = {
    attendance: (id) => this.db.markAttendanceSynced(id),
    time_entry: (id) => this.db.markTimeEntrySynced(id),
    timeline: (id) => this.db.markTimelineSynced(id),
    activity: (id) => this.db.markActivitySynced(id),
    app_usage: (id) => this.db.markAppUsageSynced(id),
    website_usage: (id) => this.db.markWebsiteUsageSynced(id),
    screenshot: (id) => this.db.markScreenshotSynced(id),
  };

  const markFn = markMap[recordType];
  if (markFn) {
    markFn(localId);
    this.emit('item-synced', { recordType, localId });
  }
};

QueueManager.prototype.markFailed = function (recordType, localId, errorMessage) {
  const markMap = {
    attendance: (id, msg) => this.db.markAttendanceFailed(id, msg),
    time_entry: (id, msg) => this.db.markTimeEntryFailed(id, msg),
    timeline: (id, msg) => this.db.markTimelineFailed(id, msg),
    activity: (id, msg) => this.db.markActivityFailed(id, msg),
    app_usage: (id, msg) => this.db.markAppUsageFailed(id, msg),
    website_usage: (id, msg) => this.db.markWebsiteUsageFailed(id, msg),
    screenshot: (id, msg) => this.db.markScreenshotFailed(id, msg),
  };

  const markFn = markMap[recordType];
  if (markFn) {
    markFn(localId, errorMessage);
    this.emit('item-failed', { recordType, localId, error: errorMessage });
  }
};

module.exports = { QueueManager, PRIORITY_MAP };
