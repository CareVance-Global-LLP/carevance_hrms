const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OfflineDatabase } = require('../offline/offline-db.cjs');
const { QueueManager } = require('../offline/queue-manager.cjs');
const { SyncEngine } = require('../offline/sync-engine.cjs');

const makeTempDb = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carevance-offline-'));
  const db = new OfflineDatabase(dir);
  const opened = await db.open();
  assert.equal(opened, true, 'the offline database should open');
  return { db, dir };
};

const cleanup = (db, dir) => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
};

test('a record that exhausts its retries leaves the queue instead of wedging it', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const poisoned = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    const healthy = db.saveAttendance(null, 1, 'out', new Date().toISOString(), null, null, null, 'device-1');
    assert.ok(poisoned && healthy);
    assert.equal(db.getQueueSize(), 2);

    // Drive the poisoned record past MAX_RETRY_COUNT (10).
    for (let i = 0; i < 10; i++) {
      db.markAttendanceFailed(poisoned, 'server rejected it');
    }

    const queueManager = new QueueManager(db);
    const engine = new SyncEngine({
      offlineDb: db,
      queueManager,
      networkMonitor: { isOnline: true, on() {}, off() {} },
      apiBaseUrl: 'http://127.0.0.1:1',
      deviceId: 'device-1',
    });

    const permanentFailures = [];
    engine.on('item-permanent-failure', (payload) => permanentFailures.push(payload));

    await engine._syncItem({ record_type: 'attendance', local_id: poisoned });

    assert.deepEqual(
      permanentFailures.map((f) => f.localId),
      [poisoned],
      'the engine should report giving up on the record'
    );
    assert.equal(db.getQueueSize(), 1, 'the exhausted record must be removed from sync_queue');

    const remaining = db.getNextSyncBatch(10).map((row) => row.local_id);
    assert.deepEqual(remaining, [healthy], 'the healthy record behind it is no longer blocked');
  } finally {
    cleanup(db, dir);
  }
});

test('_doSync does not reschedule itself when the queue did not shrink', async () => {
  const { db, dir } = await makeTempDb();

  try {
    // Two records already past the retry ceiling. Before the fix these were
    // skipped without being dequeued, which still counted as progress and
    // re-entered _doSync on the identical batch forever.
    const first = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    const second = db.saveAttendance(null, 1, 'out', new Date().toISOString(), null, null, null, 'device-1');
    for (let i = 0; i < 10; i++) {
      db.markAttendanceFailed(first, 'nope');
      db.markAttendanceFailed(second, 'nope');
    }

    const queueManager = new QueueManager(db);
    const engine = new SyncEngine({
      offlineDb: db,
      queueManager,
      networkMonitor: { isOnline: true, on() {}, off() {} },
      apiBaseUrl: 'http://127.0.0.1:1',
      deviceId: 'device-1',
    });
    engine.setCredentials('token', 1, 'device-1', 'http://127.0.0.1:1');
    engine.running = true;

    let passes = 0;
    const realDoSync = engine._doSync.bind(engine);
    engine._doSync = async function counted() {
      passes++;
      assert.ok(passes < 25, 'the sync loop re-entered itself without draining the queue');
      return realDoSync();
    };

    await engine._doSync();
    // Let any setImmediate continuation run.
    await new Promise((resolve) => setTimeout(resolve, 50));

    assert.equal(db.getQueueSize(), 0, 'both exhausted records should have been retired');
    assert.ok(passes <= 2, `expected the loop to settle, ran ${passes} passes`);
  } finally {
    cleanup(db, dir);
  }
});

test('synced records are purged after the retention window, unsynced ones are kept', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const old = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    const recent = db.saveAttendance(null, 1, 'out', new Date().toISOString(), null, null, null, 'device-1');
    const pending = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');

    db.markAttendanceSynced(old);
    db.markAttendanceSynced(recent);

    // Backdate one synced row beyond the 3-day retention window.
    db._run(
      "UPDATE offline_attendance SET synced_at = datetime('now', '-10 days') WHERE local_id = ?",
      [old]
    );

    const removed = db.purgeSyncedOlderThan();
    assert.equal(removed, 1, 'only the aged synced record should be removed');

    const rows = db._all('SELECT local_id FROM offline_attendance ORDER BY local_id');
    const ids = rows.map((r) => r.local_id).sort();
    assert.deepEqual(ids, [recent, pending].sort(), 'recent synced and still-pending records survive');
  } finally {
    cleanup(db, dir);
  }
});

test('purging never touches a record that has not reached the server', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const stuck = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    db.markAttendanceFailed(stuck, 'still retrying');
    db._run(
      "UPDATE offline_attendance SET created_at = datetime('now', '-400 days') WHERE local_id = ?",
      [stuck]
    );

    assert.equal(db.purgeSyncedOlderThan(0), 0, 'age alone must not delete unsynced work');
    assert.equal(db.getQueueSize(), 1, 'it is still queued for sync');
  } finally {
    cleanup(db, dir);
  }
});
