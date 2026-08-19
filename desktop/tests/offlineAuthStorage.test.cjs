const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { OfflineDatabase } = require('../offline/offline-db.cjs');
const { createAuthCipher, MACHINE_KEY, SAFE_STORAGE } = require('../offline/auth-cipher.cjs');

/*
 * The offline database holds a live API bearer token so a machine that boots
 * without a network can still punch in. Where that token sits on disk is the
 * whole question.
 *
 * It used to sit in a plain `token TEXT NOT NULL` column, immediately beside an
 * AES-256-GCM copy of itself, with the read path falling back to the plain one.
 * The encryption was real — PBKDF2, 600k iterations, SHA-512 — and bought
 * nothing at all, because anyone who could read the file could read the token
 * out of the next column. Its key was also derived from COMPUTERNAME, USERNAME
 * and the hostname, every one of which the same reader can reproduce.
 *
 * The rule these tests hold: the token never touches the file in a form the
 * file itself can be used to recover.
 */

const TOKEN = 'tok_liveSessionSecret_9f2b7c41';

const makeTempDb = async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'carevance-auth-'));
  const db = new OfflineDatabase(dir);
  assert.equal(await db.open(), true, 'the offline database should open');
  return { db, dir };
};

const cleanup = (db, dir) => {
  try { db.close(); } catch { /* already closed */ }
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
};

/** An OS keyring that works, standing in for Electron's safeStorage. */
const workingSafeStorage = () => ({
  isEncryptionAvailable: () => true,
  encryptString: (plaintext) => Buffer.from(`osbox:${plaintext}`, 'utf8'),
  decryptString: (buffer) => String(buffer).replace(/^osbox:/, ''),
});

/** Linux without a keyring, or a locked login keychain. */
const unavailableSafeStorage = () => ({
  isEncryptionAvailable: () => false,
  encryptString: () => { throw new Error('should not be called'); },
  decryptString: () => { throw new Error('should not be called'); },
});

// Flush first: writes are debounced, and an unflushed database proves nothing
// about what ends up on disk.
const dbFileBytes = (db, dir) => {
  db._persist();
  return fs.readFileSync(path.join(dir, 'offline-data', 'carevance-offline.db'));
};

test('the token never reaches the database file in plaintext', async () => {
  const { db, dir } = await makeTempDb();
  const cipher = createAuthCipher({ safeStorage: workingSafeStorage(), machineSecret: 'device-1' });

  try {
    assert.ok(db.saveAuthSession(7, TOKEN, 'device-1', 1, { name: 'Ayush' }, cipher));

    // The strongest form of this assertion: scan the actual file, not the
    // schema. A column rename or a stray index would still be caught.
    assert.equal(
      dbFileBytes(db, dir).includes(TOKEN),
      false,
      'the raw token was found in the database file',
    );
  } finally {
    cleanup(db, dir);
  }
});

test('a saved session round-trips through the cipher', async () => {
  const { db, dir } = await makeTempDb();
  const cipher = createAuthCipher({ safeStorage: workingSafeStorage(), machineSecret: 'device-1' });

  try {
    db.saveAuthSession(7, TOKEN, 'device-1', 1, { name: 'Ayush' }, cipher);

    const session = db.getDecryptedAuthSession('device-1', cipher);
    assert.equal(session.token, TOKEN);
    assert.equal(session.user_id, 7);
    assert.deepEqual(session.userData, { name: 'Ayush' });
  } finally {
    cleanup(db, dir);
  }
});

test('the OS keyring is preferred, and its absence falls back to the machine key — never to plaintext', async () => {
  const { db, dir } = await makeTempDb();
  const cipher = createAuthCipher({ safeStorage: unavailableSafeStorage(), machineSecret: 'device-1' });

  try {
    assert.equal(cipher.preferredId, MACHINE_KEY, 'no keyring means the machine key, not plaintext');

    db.saveAuthSession(7, TOKEN, 'device-1', 1, null, cipher);

    assert.equal(dbFileBytes(db, dir).includes(TOKEN), false, 'the fallback must still encrypt');
    assert.equal(db.getDecryptedAuthSession('device-1', cipher).token, TOKEN);
  } finally {
    cleanup(db, dir);
  }
});

test('a keyring that is present is actually used', async () => {
  const { db, dir } = await makeTempDb();
  const cipher = createAuthCipher({ safeStorage: workingSafeStorage(), machineSecret: 'device-1' });

  try {
    assert.equal(cipher.preferredId, SAFE_STORAGE);

    db.saveAuthSession(7, TOKEN, 'device-1', 1, null, cipher);
    const row = db.getAuthSession('device-1');
    assert.equal(row.session_cipher, SAFE_STORAGE, 'the row must record which scheme sealed it');
  } finally {
    cleanup(db, dir);
  }
});

test('a session sealed with the machine key still opens after the keyring appears', async () => {
  // Exactly what an upgrade looks like: rows written by the old build, read by
  // a build that now prefers safeStorage. The row says how it was sealed, so
  // both schemes stay readable.
  const { db, dir } = await makeTempDb();
  const oldCipher = createAuthCipher({ safeStorage: unavailableSafeStorage(), machineSecret: 'device-1' });
  const newCipher = createAuthCipher({ safeStorage: workingSafeStorage(), machineSecret: 'device-1' });

  try {
    db.saveAuthSession(7, TOKEN, 'device-1', 1, null, oldCipher);
    assert.equal(db.getAuthSession('device-1').session_cipher, MACHINE_KEY);

    assert.equal(db.getDecryptedAuthSession('device-1', newCipher).token, TOKEN);
  } finally {
    cleanup(db, dir);
  }
});

test('an unreadable session is refused rather than half-returned', async () => {
  // A row sealed on a different machine, or with a keyring that has since been
  // reset. Returning the row without its token would hand callers a session
  // object with no credential in it, which reads as "signed in" everywhere
  // downstream.
  const { db, dir } = await makeTempDb();
  const cipher = createAuthCipher({ safeStorage: workingSafeStorage(), machineSecret: 'device-1' });
  const foreign = createAuthCipher({
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (p) => Buffer.from(p, 'utf8'),
      decryptString: () => { throw new Error('wrong key'); },
    },
    machineSecret: 'device-1',
  });

  try {
    db.saveAuthSession(7, TOKEN, 'device-1', 1, null, cipher);
    assert.equal(db.getDecryptedAuthSession('device-1', foreign), null);
  } finally {
    cleanup(db, dir);
  }
});

test('the plaintext token column is gone from the schema', async () => {
  const { db, dir } = await makeTempDb();

  try {
    const columns = db.db.exec('PRAGMA table_info(offline_auth)')[0].values.map((row) => row[1]);
    assert.equal(columns.includes('token'), false, 'offline_auth still has a plaintext token column');
    assert.ok(columns.includes('encrypted_session'));
    assert.ok(columns.includes('session_cipher'));
  } finally {
    cleanup(db, dir);
  }
});

test('upgrading an existing install drops the plaintext column and keeps the session', async () => {
  const { db, dir } = await makeTempDb();

  try {
    // Rebuild the pre-v7 shape and put a row in it the old way: token in the
    // clear, alongside a machine-key sealed copy.
    const machineOnly = createAuthCipher({ safeStorage: null, machineSecret: 'device-1' });
    const sealed = machineOnly.encrypt(JSON.stringify({ token: TOKEN, userData: null, userId: 7 }));

    db.db.run('DROP TABLE offline_auth');
    db.db.run(`CREATE TABLE offline_auth (
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
    )`);
    db.db.run(
      'INSERT INTO offline_auth (user_id, token, encrypted_session, device_id, expires_at) VALUES (?, ?, ?, ?, ?)',
      [7, TOKEN, sealed.payload, 'device-1', new Date(Date.now() + 86400000).toISOString()],
    );

    db._migrateAuthStorage();

    const columns = db.db.exec('PRAGMA table_info(offline_auth)')[0].values.map((row) => row[1]);
    assert.equal(columns.includes('token'), false, 'the upgrade must remove the plaintext column');

    // The person stays signed in across the upgrade.
    assert.equal(db.getDecryptedAuthSession('device-1', machineOnly).token, TOKEN);
  } finally {
    cleanup(db, dir);
  }
});

test('an upgrade with nothing but a plaintext token signs the person out', async () => {
  // There is no honest way to carry this row forward: the only copy of the
  // token is the one we are removing. Requiring a fresh sign-in is the correct
  // outcome, and far better than keeping the column "just for these".
  const { db, dir } = await makeTempDb();
  const cipher = createAuthCipher({ safeStorage: workingSafeStorage(), machineSecret: 'device-1' });

  try {
    db.db.run('DROP TABLE offline_auth');
    db.db.run(`CREATE TABLE offline_auth (
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
    )`);
    db.db.run(
      'INSERT INTO offline_auth (user_id, token, encrypted_session, device_id) VALUES (?, ?, NULL, ?)',
      [7, TOKEN, 'device-1'],
    );

    db._migrateAuthStorage();

    assert.equal(db.getDecryptedAuthSession('device-1', cipher), null);
    assert.equal(dbFileBytes(db, dir).includes(TOKEN), false, 'the plaintext token must not survive the upgrade');
  } finally {
    cleanup(db, dir);
  }
});
