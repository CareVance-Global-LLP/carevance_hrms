const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeCapturedUrl } = require('../browser-url/normalize-captured-url.cjs');

/*
 * Two capture sources, deliberately trusted differently.
 *
 * 'document' is Chrome's Document element: the real page URL, scheme included,
 * and provably immune to a half-typed address bar — measured on 13 Aug 2026,
 * the bar read "how to avoid being monit" while the document read the actual
 * URL.
 *
 * 'address_bar' is all Edge and Brave expose. It holds whatever is in the box,
 * including text somebody typed and never submitted, which persists after
 * Escape AND after focus leaves the bar. So it is reduced to a host and
 * anything not clearly a host is dropped.
 */

test('document source keeps the whole path, minus the query string', () => {
  /*
   * The query string goes even when it looks harmless.
   *
   * There is no reliable way to tell `?hl=en` from `?code=<authorization>`:
   * a deny-list of known-secret parameter names is only ever as current as the
   * last identity provider to invent one, and the cost of being wrong is a
   * live credential sitting in a report. The path still names the page, which
   * is the whole of what a productivity report needs.
   *
   * The fragment survives here because it carries no `=` — it is a document
   * anchor, not a parameter set.
   */
  const result = normalizeCapturedUrl({
    source: 'document',
    value: 'https://developer.chrome.com/docs/extensions/reference/api/tabs?hl=en#method-query',
  });

  assert.equal(result.url, 'https://developer.chrome.com/docs/extensions/reference/api/tabs#method-query');
  assert.equal(result.confidence, 100);
});

test('document source is trusted even when the address bar would be junk', () => {
  // Still document-level confidence; the query is dropped for the reason above,
  // and a search term is among the most sensitive things this could store.
  const result = normalizeCapturedUrl({ source: 'document', value: 'https://example.com/incognito-probe?q=1' });

  assert.equal(result.url, 'https://example.com/incognito-probe');
  assert.equal(result.confidence, 100);
});

test('address bar is reduced to the host, dropping the path', () => {
  // Edge and Brave cannot prove the path was ever visited, so the product
  // records only what it can stand behind. This is Time Doctor's Basic level.
  const result = normalizeCapturedUrl({
    source: 'address_bar',
    value: 'developer.chrome.com/docs/extensions/reference/api/tabs?hl=en#method-query',
  });

  assert.equal(result.url, 'https://developer.chrome.com');
  assert.equal(result.confidence, 60);
});

test('address bar keeps a scheme it was given', () => {
  // Edge includes https://, Chrome and Brave elide it. Measured.
  const result = normalizeCapturedUrl({ source: 'address_bar', value: 'https://example.org/edge-probe?e=1' });

  assert.equal(result.url, 'https://example.org');
});

test('address bar drops half-typed search text', () => {
  // The exact value captured from a real Chrome address bar mid-typing.
  const result = normalizeCapturedUrl({ source: 'address_bar', value: 'how to avoid being monit' });

  assert.equal(result.url, null);
  assert.equal(result.reason, 'not-host-shaped');
});

test('address bar drops anything containing whitespace', () => {
  // Leading/trailing space is trimmed, not rejected; only internal whitespace
  // means the value is not a URL.
  for (const value of ['foo bar', 'example.com and more', 'a b.com', 'see example.com now']) {
    assert.equal(normalizeCapturedUrl({ source: 'address_bar', value }).url, null, `should drop: ${value}`);
  }
});

test('address bar drops a bare word with no dot', () => {
  for (const value of ['localhost', 'settings', 'chrome', 'newtab']) {
    assert.equal(normalizeCapturedUrl({ source: 'address_bar', value }).url, null, `should drop: ${value}`);
  }
});

test('address bar drops a trailing-dot fragment being typed', () => {
  // Someone one keystroke into "github.com" has typed "github." — a dot alone
  // is not evidence of a visit.
  assert.equal(normalizeCapturedUrl({ source: 'address_bar', value: 'github.' }).url, null);
});

test('address bar drops browser-internal pages', () => {
  for (const value of ['chrome://newtab', 'edge://settings', 'about:blank', 'brave://rewards']) {
    const result = normalizeCapturedUrl({ source: 'address_bar', value });
    assert.equal(result.url, null, `should drop: ${value}`);
  }
});

test('document source also drops browser-internal pages', () => {
  // A settings page is not a website visit in any report worth reading.
  assert.equal(normalizeCapturedUrl({ source: 'document', value: 'chrome://settings/privacy' }).url, null);
});

test('empty and missing values are dropped without throwing', () => {
  for (const value of ['', '   ', null, undefined]) {
    const result = normalizeCapturedUrl({ source: 'address_bar', value });
    assert.equal(result.url, null);
  }
  assert.equal(normalizeCapturedUrl(null).url, null);
  assert.equal(normalizeCapturedUrl({}).url, null);
});

test('an unknown source is not trusted', () => {
  // Fail closed: a source this module does not understand cannot be graded.
  const result = normalizeCapturedUrl({ source: 'guesswork', value: 'https://example.com/x' });

  assert.equal(result.url, null);
  assert.equal(result.reason, 'unknown-source');
});

test('the host is lowercased and the port preserved', () => {
  const result = normalizeCapturedUrl({ source: 'address_bar', value: 'EXAMPLE.com:8443/path' });

  assert.equal(result.url, 'https://example.com:8443');
});

test('userinfo in the value never survives into the recorded host', () => {
  // https://user:password@evil.example/ must not put credentials in a report.
  const result = normalizeCapturedUrl({ source: 'address_bar', value: 'https://user:hunter2@example.com/path' });

  assert.equal(result.url, 'https://example.com');
  assert.ok(!String(result.url).includes('hunter2'));
});

test('a document URL is stored without the credentials used to reach it', () => {
  /*
   * The defect this pins, found in the live database on 17 Aug 2026: a single
   * captured visit held a complete OAuth callback — `code` (66 characters),
   * `state`, `session_state` and `iss`. A live authorization code, readable by
   * every admin who opens the timeline and included in CSV exports, recorded
   * because the document branch stored whatever the browser reported verbatim.
   */
  const result = normalizeCapturedUrl({
    source: 'document',
    value: 'https://idp.example.com/callback?code=4%2F0AY0e-g7SECRET&state=abc123&session_state=xyz&iss=https%3A%2F%2Fidp',
  });

  assert.equal(result.url, 'https://idp.example.com/callback');
  assert.equal(result.confidence, 100, 'stripping the query must not downgrade a document reading');
  assert.ok(!result.url.includes('code='), 'no authorization code may survive');
});

test('an implicit-flow token in the fragment is stripped too', () => {
  // OAuth implicit returns access_token in the fragment rather than the query,
  // so stripping only the query string would leave the more dangerous half.
  const result = normalizeCapturedUrl({
    source: 'document',
    value: 'https://app.example.com/#access_token=SECRET&token_type=bearer',
  });

  assert.ok(!result.url.includes('access_token'));
  assert.ok(!result.url.includes('SECRET'));
});

test('hash routing keeps the page it names', () => {
  // Single-page apps put the real page in the fragment. Dropping it wholesale
  // would reduce every route in those products to a bare host.
  const result = normalizeCapturedUrl({
    source: 'document',
    value: 'https://technocruitx.keka.com/#/me/attendance',
  });

  assert.equal(result.url, 'https://technocruitx.keka.com/#/me/attendance');
});

test('an ordinary deep path is left alone', () => {
  const result = normalizeCapturedUrl({
    source: 'document',
    value: 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API',
  });

  assert.equal(result.url, 'https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API');
});

test('userinfo never reaches a report', () => {
  const result = normalizeCapturedUrl({
    source: 'document',
    value: 'https://someone:hunter2@intranet.example.com/private',
  });

  assert.ok(!result.url.includes('hunter2'));
  assert.ok(!result.url.includes('someone'));
});
