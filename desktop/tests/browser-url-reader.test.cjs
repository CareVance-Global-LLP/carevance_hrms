const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserUrlReader } = require('../browser-url/browser-url-reader.cjs');

/**
 * Stand in for the PowerShell helper so these tests exercise the reader's own
 * logic rather than UI Automation. The real child is never spawned.
 */
const primeReader = () => {
  const written = [];
  const reader = new BrowserUrlReader({});
  reader.child = { stdin: { write: (line) => written.push(line) } };
  reader.ready = true;
  return { reader, written };
};

test('two callers reading at once both get the answer', async () => {
  /*
   * The defect this pins. main.cjs reads from two places on the same 1s
   * cadence — the foreground watcher and the get-active-window-context IPC
   * the renderer's tick calls — so their reads constantly overlap. The reader
   * used to return null to whichever arrived second, which put a row with no
   * URL into the timeline for a page whose URL had just been read
   * successfully. Observed live as alternating url/NULL rows for one page.
   */
  const { reader, written } = primeReader();

  const first = reader.read();
  const second = reader.read();

  reader.consume(JSON.stringify({ ok: true, source: 'document', value: 'https://example.com/page' }) + '\n');

  assert.deepEqual(await first, { url: 'https://example.com/page', confidence: 100, source: 'document' });
  assert.deepEqual(await second, { url: 'https://example.com/page', confidence: 100, source: 'document' });

  // One question asked, not two: the second caller joins the in-flight read.
  assert.equal(written.length, 1);
});

test('a third caller joining late still gets the answer', async () => {
  const { reader, written } = primeReader();

  const a = reader.read();
  const b = reader.read();
  const c = reader.read();

  reader.consume(JSON.stringify({ ok: true, source: 'address_bar', value: 'example.org/x' }) + '\n');

  const results = await Promise.all([a, b, c]);
  for (const result of results) {
    assert.equal(result.url, 'https://example.org');
    assert.equal(result.confidence, 60);
  }
  assert.equal(written.length, 1);
});

test('a later read asks again rather than reusing the previous answer', async () => {
  // Coalescing must not turn into caching: the foreground moves.
  const { reader, written } = primeReader();

  const first = reader.read();
  reader.consume(JSON.stringify({ ok: true, source: 'document', value: 'https://one.example/' }) + '\n');
  assert.equal((await first).url, 'https://one.example/');

  const second = reader.read();
  reader.consume(JSON.stringify({ ok: true, source: 'document', value: 'https://two.example/' }) + '\n');
  assert.equal((await second).url, 'https://two.example/');

  assert.equal(written.length, 2);
});

test('every joined caller sees null when the helper has nothing', async () => {
  const { reader } = primeReader();

  const first = reader.read();
  const second = reader.read();

  reader.consume(JSON.stringify({ ok: true, source: null, value: null }) + '\n');

  assert.equal(await first, null);
  assert.equal(await second, null);
});

test('a read before the helper is ready resolves null without asking', async () => {
  const { reader, written } = primeReader();
  reader.ready = false;

  assert.equal(await reader.read(), null);
  assert.equal(written.length, 0);
});
