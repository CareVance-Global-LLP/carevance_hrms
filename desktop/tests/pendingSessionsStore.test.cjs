const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { PendingSessionsStore, MAX_SESSIONS } = require('../offline/pending-sessions-store.cjs');

const makeStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carevance-pending-'));
  return { store: new PendingSessionsStore(dir), dir };
};

const cleanup = (dir) => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
};

const session = (localId) => ({
  time_entry_id: 1,
  source: 'desktop',
  activity_kind: 'desktop_app',
  tool_type: 'software',
  display_name: 'Code',
  started_at: '2026-08-14T10:00:00.000Z',
  local_id: localId,
  device_id: 'device-1',
});

test('unsent sessions survive the app closing', async () => {
  /*
   * The gap this closes. Sessions whose create failed lived in renderer memory
   * alone, so quitting during an outage lost the app and website timeline for
   * that whole stretch — the one thing offline tracking exists to prevent, and
   * the case Time Doctor keeps by writing everything to a local cache until
   * connectivity returns.
   */
  const { store, dir } = makeStore();

  try {
    store.save([session('a'), session('b')]);
    assert.equal(store.flush(), true, 'an explicit flush writes immediately');

    // A brand new store stands in for the next launch of the app.
    const reopened = new PendingSessionsStore(dir);
    const restored = reopened.load();

    assert.deepEqual(restored.map((s) => s.local_id), ['a', 'b'], 'both sessions come back, oldest first');
  } finally {
    cleanup(dir);
  }
});

test('a missing file is an empty queue, not a crash', async () => {
  const { store, dir } = makeStore();
  try {
    assert.deepEqual(store.load(), []);
  } finally {
    cleanup(dir);
  }
});

test('a corrupt file does not stop the tracker starting', async () => {
  // This file is written on a debounce and the machine can lose power midway.
  // Refusing to start because of it would be a worse failure than losing it.
  const { store, dir } = makeStore();

  try {
    fs.mkdirSync(path.dirname(store.filePath), { recursive: true });
    fs.writeFileSync(store.filePath, '[{"local_id":"a", TRUNCATED', 'utf8');

    assert.deepEqual(store.load(), []);
  } finally {
    cleanup(dir);
  }
});

test('sessions the server could not de-duplicate are not replayed', async () => {
  // Without (local_id, device_id) the server cannot recognise a replay, so
  // resending inserts a second row for the same stretch of time — and this
  // data feeds payroll. Losing the segment beats double-counting it.
  const { store, dir } = makeStore();

  try {
    store.save([session('a'), { ...session('b'), device_id: null }, { ...session('c'), local_id: '' }]);
    store.flush();

    assert.deepEqual(store.load().map((s) => s.local_id), ['a']);
  } finally {
    cleanup(dir);
  }
});

test('the stored queue is bounded', async () => {
  // Matches the renderer queue's own ceiling: a long outage must not grow this
  // file, or the memory it is read back into, without limit.
  const { store, dir } = makeStore();

  try {
    store.save(Array.from({ length: MAX_SESSIONS + 250 }, (_, i) => session(`s${i}`)));
    store.flush();

    const restored = store.load();
    assert.equal(restored.length, MAX_SESSIONS);
    // The newest are kept: the oldest are the ones already counted as dropped.
    assert.equal(restored[restored.length - 1].local_id, `s${MAX_SESSIONS + 249}`);
  } finally {
    cleanup(dir);
  }
});

test('writes are debounced, and dispose flushes what is still pending', async () => {
  // A flush per application switch would rewrite the file constantly; the
  // debounce collapses a burst into one write, and quitting must not drop it.
  const { store, dir } = makeStore();

  try {
    store.save([session('a')]);
    store.save([session('a'), session('b')]);
    store.save([session('a'), session('b'), session('c')]);

    assert.equal(fs.existsSync(store.filePath), false, 'nothing written yet — still inside the debounce');

    store.dispose();

    assert.deepEqual(
      store.load().map((s) => s.local_id),
      ['a', 'b', 'c'],
      'dispose writes the latest snapshot rather than losing it'
    );
  } finally {
    cleanup(dir);
  }
});
