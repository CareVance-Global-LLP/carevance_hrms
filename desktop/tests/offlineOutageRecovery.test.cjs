const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OfflineDatabase } = require('../offline/offline-db.cjs');
const { QueueManager } = require('../offline/queue-manager.cjs');
const { SyncEngine } = require('../offline/sync-engine.cjs');

const makeTempDb = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carevance-outage-'));
  const db = new OfflineDatabase(dir);
  const opened = await db.open();
  assert.equal(opened, true, 'the offline database should open');
  return { db, dir };
};

const cleanup = (db, dir) => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
};

const makeEngine = (db, queueManager) => {
  // Port 1 is never listening, so every request fails with ECONNREFUSED —
  // exactly the shape of an API that is down while the machine is online.
  const engine = new SyncEngine({
    offlineDb: db,
    queueManager,
    networkMonitor: { isOnline: true, on() {}, off() {} },
    apiBaseUrl: 'http://127.0.0.1:1',
    deviceId: 'device-1',
  });
  engine.setCredentials('token', 1, 'device-1', 'http://127.0.0.1:1');
  engine.running = true;
  return engine;
};

test('an unreachable API does not spend the retry budget', async () => {
  /*
   * The defect this pins, measured on this install 14 Aug 2026. Retries fired
   * every 5 seconds against a refused connection, so all ten were spent inside
   * a minute, the record was dropped from sync_queue and marked 'failed', and
   * nothing ever picked it up again — a time entry created at 06:40 was still
   * stranded hours after the API came back. The tracked work it represented
   * was gone, which is the one thing offline tracking exists to prevent.
   */
  const { db, dir } = await makeTempDb();

  try {
    const localId = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    const queueManager = new QueueManager(db);
    const engine = makeEngine(db, queueManager);

    for (let attempt = 0; attempt < 12; attempt += 1) {
      engine.unreachableUntil = 0;   // skip the wait; the budget is what matters
      await engine._syncItem({ record_type: 'attendance', local_id: localId });
    }

    const record = db._all('SELECT sync_status, retry_count FROM offline_attendance WHERE local_id = ?', [localId])[0];

    assert.equal(record.retry_count, 0, 'a refused connection must not count against the record');
    assert.notEqual(record.sync_status, 'failed', 'the record must not be given up on while the API is merely down');
    assert.equal(db.getQueueSize(), 1, 'it must stay queued, waiting for the server to come back');
  } finally {
    cleanup(db, dir);
  }
});

test('repeated unreachable attempts back off instead of hammering every 5 seconds', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const localId = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    const queueManager = new QueueManager(db);
    const engine = makeEngine(db, queueManager);

    const delays = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const before = Date.now();
      engine.unreachableUntil = 0;
      await engine._syncItem({ record_type: 'attendance', local_id: localId });
      delays.push(engine.unreachableUntil - before);
    }

    for (let i = 1; i < delays.length; i += 1) {
      assert.ok(
        delays[i] >= delays[i - 1],
        `backoff should not shrink between attempts (got ${delays.join(', ')})`
      );
    }
    assert.ok(delays[delays.length - 1] > delays[0], 'backoff should grow with a sustained outage');
  } finally {
    cleanup(db, dir);
  }
});

test('a record answered with a real rejection still exhausts its retries', async () => {
  // The budget must keep working for records the server genuinely refuses,
  // otherwise a poisoned row wedges the queue forever.
  const { db, dir } = await makeTempDb();

  try {
    const localId = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    const queueManager = new QueueManager(db);

    for (let i = 0; i < 10; i += 1) {
      db.markAttendanceFailed(localId, 'Validation error: {"message":"nope"}');
    }

    const engine = makeEngine(db, queueManager);
    const permanentFailures = [];
    engine.on('item-permanent-failure', (payload) => permanentFailures.push(payload));

    await engine._syncItem({ record_type: 'attendance', local_id: localId });

    assert.equal(permanentFailures.length, 1, 'a genuinely bad record is still retired');
    assert.equal(db.getQueueSize(), 0, 'and leaves the queue so it cannot block others');
  } finally {
    cleanup(db, dir);
  }
});

test('records stranded by an outage are requeued when the app restarts', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const stranded = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');

    // Reproduce the state this install was actually found in: retries spent,
    // marked failed, and gone from sync_queue with nothing to bring it back.
    for (let i = 0; i < 10; i += 1) {
      db.markAttendanceFailed(stranded, 'connect ECONNREFUSED 127.0.0.1:8000');
    }
    db.dropExhaustedFromQueue('attendance', stranded);
    assert.equal(db.getQueueSize(), 0, 'precondition: the record is stranded outside the queue');
    assert.equal(db.getFailedRecordCount(), 1, 'precondition: and is reported as failed');

    const queueManager = new QueueManager(db);
    const engine = makeEngine(db, queueManager);
    engine.running = false;
    engine.start();

    assert.equal(db.getQueueSize(), 1, 'startup must put the stranded record back in the queue');

    const record = db._all('SELECT sync_status, retry_count FROM offline_attendance WHERE local_id = ?', [stranded])[0];
    assert.equal(record.sync_status, 'pending', 'and reopen it for sending');
    assert.equal(record.retry_count, 0, 'with a fresh budget, since the outage was never its fault');

    engine.stop();
  } finally {
    cleanup(db, dir);
  }
});

test('reconnecting requeues stranded records', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const stranded = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    for (let i = 0; i < 10; i += 1) {
      db.markAttendanceFailed(stranded, 'connect ECONNREFUSED 127.0.0.1:8000');
    }
    db.dropExhaustedFromQueue('attendance', stranded);

    const queueManager = new QueueManager(db);
    const engine = makeEngine(db, queueManager);

    engine._handleOnline();

    assert.equal(db.getQueueSize(), 1, 'coming back online must rescue what the outage stranded');
  } finally {
    cleanup(db, dir);
  }
});

test('an abandoned timer start is not replayed on restart', async () => {
  /*
   * The hazard this guards, found on this install 14 Aug 2026. The stranded
   * record was `action: 'start'` with no stop — the process died before one was
   * written. POST /time-entries closes whatever is running and stamps it with
   * the incoming start time, so replaying a start from hours earlier would end
   * the timer the user is running NOW at a moment before it began, then open a
   * duplicate. There is no duration in the record to recover either way.
   */
  const { db, dir } = await makeTempDb();

  try {
    // (localId, userId, action, projectId, taskId, timerSlot, lat, lng, deviceId, startedAt, endedAt)
    const abandoned = db.saveTimeEntry(
      null, 7, 'start', null, null, 'primary', null, null, 'device-1', '2026-08-14T06:40:38Z', null
    );
    assert.ok(abandoned, 'the offline start should be recorded');

    for (let i = 0; i < 10; i += 1) {
      db.markTimeEntryFailed(abandoned, 'connect ECONNREFUSED 127.0.0.1:8000');
    }
    db.dropExhaustedFromQueue('time_entry', abandoned);
    assert.equal(db.getQueueSize(), 0);

    // Restart: the session it belonged to is over.
    assert.equal(db.requeueFailedRecords({ includeOpenTimerStarts: false }), 0);
    assert.equal(db.getQueueSize(), 0, 'an abandoned start must not be replayed against a new session');
    assert.equal(db.getFailedRecordCount(), 1, 'but it stays counted, so it is not invisible');

    // The stored reason must explain THIS, not the outage that stranded it —
    // that is the sentence a person reads when they go looking for their time.
    const [record] = db._all(
      'SELECT error_message FROM offline_time_entries WHERE local_id = ?',
      [abandoned]
    );
    assert.match(record.error_message, /never stopped/i);
    assert.doesNotMatch(record.error_message, /ECONNREFUSED/);

    // Reconnect inside the same process: that start is still the live session.
    assert.equal(db.requeueFailedRecords({ includeOpenTimerStarts: true }), 1);
    assert.equal(db.getQueueSize(), 1, 'a reconnect during the same session should send it');
  } finally {
    cleanup(db, dir);
  }
});

test('status reports unsent work so it is never silently lost', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const localId = db.saveAttendance(null, 1, 'in', new Date().toISOString(), null, null, null, 'device-1');
    for (let i = 0; i < 10; i += 1) {
      db.markAttendanceFailed(localId, 'Validation error');
    }

    const queueManager = new QueueManager(db);
    const engine = makeEngine(db, queueManager);

    const status = engine.getStatus();
    assert.equal(status.failedCount, 1, 'failed records must be visible without opening the SQLite file');
    assert.equal(status.apiReachable, true, 'no outage recorded yet');
  } finally {
    cleanup(db, dir);
  }
});
