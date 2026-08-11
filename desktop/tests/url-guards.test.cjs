const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

/**
 * The renderer loads a remote origin while holding a preload API that can read
 * the auth token and capture the screen. Two guards keep that surface from
 * leaking to somebody else's origin:
 *
 *   isGoogleSignInUrl  — which popups may open with the preload attached
 *   isSameOriginAsApp  — where the main window is allowed to navigate
 *
 * Both used to be a substring test (`url.includes('accounts.google.com')`),
 * which any URL merely containing that text satisfied. main.cjs is an Electron
 * entry point and cannot be required in a plain node test, so the two pure
 * helpers are extracted from the source and exercised directly — this keeps
 * them honest without booting Electron.
 */

const SOURCE = fs.readFileSync(path.join(__dirname, '..', 'main.cjs'), 'utf8');

function extractFunction(name) {
  const start = SOURCE.indexOf(`const ${name} = (`);
  assert.notStrictEqual(start, -1, `${name} not found in main.cjs — was it renamed?`);

  // Walk braces from the arrow body to find the end of the declaration.
  const bodyStart = SOURCE.indexOf('{', start);
  let depth = 0;
  let end = bodyStart;
  for (let i = bodyStart; i < SOURCE.length; i += 1) {
    if (SOURCE[i] === '{') depth += 1;
    if (SOURCE[i] === '}') {
      depth -= 1;
      if (depth === 0) { end = i + 1; break; }
    }
  }
  return SOURCE.slice(start, end);
}

const APP_URL = 'https://app.carevance.test';
const LOCAL_SHELL_ORIGIN = 'http://127.0.0.1:43117';

// isSameOriginAsApp also consults `localShellOrigin`, the loopback origin the
// offline shell binds. It must be injected here: left undefined, the reference
// throws inside the guard's own try/catch and every check quietly returns
// false, which would look like a passing "deny" test while actually breaking
// navigation to the real app.
// eslint-disable-next-line no-new-func
const build = new Function(
  'APP_URL',
  'localShellOrigin',
  `${extractFunction('isGoogleSignInUrl')};
   ${extractFunction('isSameOriginAsApp')};
   return { isGoogleSignInUrl, isSameOriginAsApp };`,
);
const { isGoogleSignInUrl, isSameOriginAsApp } = build(APP_URL, LOCAL_SHELL_ORIGIN);

// The same guards with no offline shell running, to prove it fails closed.
const { isSameOriginAsApp: isSameOriginWithoutShell } = build(APP_URL, null);

test('google sign-in allowlist matches the real host', () => {
  assert.strictEqual(isGoogleSignInUrl('https://accounts.google.com/o/oauth2/v2/auth?x=1'), true);
  assert.strictEqual(isGoogleSignInUrl('https://www.google.com/signin/oauth'), true);
});

test('google sign-in allowlist rejects lookalike hosts', () => {
  // Every one of these passed the old url.includes() check.
  const attacks = [
    'https://evil.example/?next=accounts.google.com',
    'https://accounts.google.com.evil.test/steal',
    'https://evilaccounts.google.com.attacker.test/',
    'http://accounts.google.com/o/oauth2',            // plain http
    'https://notgoogle.com/signin',
  ];

  for (const url of attacks) {
    assert.strictEqual(isGoogleSignInUrl(url), false, `should have rejected ${url}`);
  }
});

test('google sign-in allowlist survives malformed input', () => {
  for (const value of ['', null, undefined, 'not a url', 'javascript:alert(1)']) {
    assert.strictEqual(isGoogleSignInUrl(value), false);
  }
});

test('navigation stays on the app origin', () => {
  assert.strictEqual(isSameOriginAsApp(`${APP_URL}/dashboard`), true);
  assert.strictEqual(isSameOriginAsApp(`${APP_URL}/payroll?month=2026-08`), true);
  // The offline fallback page is loaded from disk.
  assert.strictEqual(isSameOriginAsApp('file:///C:/app/offline.html'), true);
});

test('navigation to any other origin is refused', () => {
  const offOrigin = [
    'https://app.carevance.test.evil.test/',
    'https://evil.test/app.carevance.test',
    'http://app.carevance.test/',   // protocol differs, so origin differs
    'https://attacker.test/',
    '',
  ];

  for (const url of offOrigin) {
    assert.strictEqual(isSameOriginAsApp(url), false, `should have refused ${url}`);
  }
});

test('the offline shell origin is navigable while it is running', () => {
  assert.strictEqual(isSameOriginAsApp(`${LOCAL_SHELL_ORIGIN}/attendance`), true);
  assert.strictEqual(isSameOriginAsApp(LOCAL_SHELL_ORIGIN), true);
});

test('loopback is not blanket-trusted — only the port the shell actually bound', () => {
  // Any process on the machine can listen on loopback, so "it is localhost"
  // is not the test; "it is the origin we ourselves bound" is.
  const otherLoopback = [
    'http://127.0.0.1:43118/dashboard',
    'http://127.0.0.1:8080/',
    'http://localhost:43117/',   // different host string, different origin
  ];

  for (const url of otherLoopback) {
    assert.strictEqual(isSameOriginAsApp(url), false, `should have refused ${url}`);
  }
});

test('with no offline shell running, loopback is refused entirely', () => {
  assert.strictEqual(isSameOriginWithoutShell(`${LOCAL_SHELL_ORIGIN}/attendance`), false);
  assert.strictEqual(isSameOriginWithoutShell(`${APP_URL}/dashboard`), true);
});
