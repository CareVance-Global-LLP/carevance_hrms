const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createLogger, scrubSecrets } = require('../diagnostics/logger.cjs');

/*
 * A packaged build had no diagnostics at all: 34 console calls writing to a
 * console nobody can open, no file, no crash trail. When the shift countdown
 * misbehaved on 19 Aug 2026 the only evidence available was a photograph of a
 * laptop screen, and the investigation had to run against source.
 *
 * Two properties matter more than the logging itself:
 *
 *   - the log must never contain a credential, because it is a file we are
 *     going to ask people to send us; and
 *   - logging must never be able to take the app down. A tracker that crashes
 *     because it could not write a log line is worse than one that logs nothing.
 */

const makeTempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'carevance-log-'));
const cleanup = (dir) => {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
};

test('a line reaches the log file', () => {
  const dir = makeTempDir();

  try {
    const log = createLogger({ dir, mirrorToConsole: false });
    log.info('timer started', { entryId: 2135 });
    log.flush();

    const contents = fs.readFileSync(log.filePath, 'utf8');
    assert.match(contents, /timer started/);
    assert.match(contents, /2135/);
    assert.match(contents, /INFO/);
  } finally {
    cleanup(dir);
  }
});

test('a bearer token never reaches the file', () => {
  const dir = makeTempDir();

  try {
    const log = createLogger({ dir, mirrorToConsole: false });
    log.info('auth restored', { token: 'tok_liveSecret_9f2b7c41', user: 7 });
    log.warn('request failed: Authorization: Bearer tok_liveSecret_9f2b7c41');
    log.flush();

    const contents = fs.readFileSync(log.filePath, 'utf8');
    assert.equal(contents.includes('tok_liveSecret_9f2b7c41'), false, 'the log leaked a token');
    assert.match(contents, /\[redacted\]/);
    // The surrounding context must survive — a redaction that eats the whole
    // line tells you nothing about what happened.
    assert.match(contents, /auth restored/);
    assert.match(contents, /request failed/);
  } finally {
    cleanup(dir);
  }
});

test('secret-shaped fields are redacted wherever they are nested', () => {
  const scrubbed = scrubSecrets({
    ok: 'visible',
    token: 'secret-a',
    nested: { api_key: 'secret-b', password: 'secret-c', deep: { authorization: 'secret-d' } },
    list: [{ refresh_token: 'secret-e' }],
  });

  const asText = JSON.stringify(scrubbed);
  for (const secret of ['secret-a', 'secret-b', 'secret-c', 'secret-d', 'secret-e']) {
    assert.equal(asText.includes(secret), false, `${secret} survived scrubbing`);
  }
  assert.match(asText, /visible/);
});

test('scrubbing survives a circular object rather than throwing', () => {
  // Electron event payloads and error objects are routinely self-referential.
  // Logging one must not take the process down.
  const circular = { name: 'window', token: 'secret-a' };
  circular.self = circular;

  const scrubbed = scrubSecrets(circular);
  assert.equal(JSON.stringify(scrubbed).includes('secret-a'), false);
  assert.equal(scrubbed.name, 'window');
});

test('the log rotates instead of growing without bound', () => {
  const dir = makeTempDir();

  try {
    const log = createLogger({ dir, mirrorToConsole: false, maxBytes: 2_000, maxFiles: 3 });

    for (let i = 0; i < 400; i++) {
      log.info(`filling the log with line ${i} of predictable width`);
    }
    log.flush();

    const files = fs.readdirSync(dir).filter((name) => name.startsWith('tracker'));
    assert.ok(files.length > 1, 'expected the log to have rotated');
    assert.ok(files.length <= 3, `expected at most 3 files, found ${files.length}`);

    for (const name of files) {
      const { size } = fs.statSync(path.join(dir, name));
      // One oversized line can exceed the cap; several times over means
      // rotation is not firing.
      assert.ok(size < 2_000 * 3, `${name} grew to ${size} bytes`);
    }
  } finally {
    cleanup(dir);
  }
});

test('an unwritable log directory is survivable', () => {
  // The point of the whole feature is diagnosing failures. It must not become
  // one: a read-only profile, a full disk or a locked file cannot be allowed to
  // throw out of a log call.
  const log = createLogger({ dir: path.join(os.tmpdir(), 'carevance-log-nope', '\0invalid'), mirrorToConsole: false });

  assert.doesNotThrow(() => {
    log.info('this has nowhere to go');
    log.error('neither does this');
    log.flush();
  });
});

test('console output is captured without being silenced', () => {
  const dir = makeTempDir();
  const seen = [];
  const fakeConsole = {
    log: (...args) => seen.push(['log', ...args]),
    warn: (...args) => seen.push(['warn', ...args]),
    error: (...args) => seen.push(['error', ...args]),
  };

  try {
    const log = createLogger({ dir, mirrorToConsole: false });
    const detach = log.captureConsole(fakeConsole);

    fakeConsole.log('[desktop] timer started');
    fakeConsole.error('[desktop] sync failed', { token: 'tok_secret_1' });
    log.flush();

    const contents = fs.readFileSync(log.filePath, 'utf8');
    assert.match(contents, /timer started/);
    assert.match(contents, /sync failed/);
    assert.equal(contents.includes('tok_secret_1'), false, 'console capture must scrub too');

    // The original console still received everything — capturing is additive.
    assert.equal(seen.length, 2);
    assert.equal(seen[0][1], '[desktop] timer started');

    detach();
    fakeConsole.log('[desktop] after detach');
    log.flush();
    assert.equal(fs.readFileSync(log.filePath, 'utf8').includes('after detach'), false);
  } finally {
    cleanup(dir);
  }
});
