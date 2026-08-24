import { decideSessionStart, isSessionRejected } from '../src/lib/session';
import type { User } from '../src/types';

const ava: User = {
  id: 7,
  name: 'Ava Sharma',
  email: 'ava@carevance.test',
} as User;

/**
 * The rule these tests exist for: a network problem is not a logout.
 *
 * bootstrap() used to sit inside a bare `catch` that cleared the token, so a
 * dropped connection during /auth/me silently signed the user out. On a
 * workforce app, where the app is opened to punch in at the door, that meant
 * retyping a password because the lift had no signal.
 */
describe('isSessionRejected — only a 401 ends a session', () => {
  it('treats 401 as a dead token', () => {
    expect(isSessionRejected({ response: { status: 401 } })).toBe(true);
  });

  it('keeps the session when the device is offline', () => {
    // axios network errors carry no `response` at all — the exact shape that
    // used to fall into the blanket catch.
    expect(isSessionRejected({ message: 'Network Error', code: 'ERR_NETWORK' })).toBe(false);
  });

  it('keeps the session when the request times out', () => {
    expect(isSessionRejected({ code: 'ECONNABORTED', message: 'timeout of 30000ms exceeded' })).toBe(false);
  });

  it('keeps the session while the API is restarting', () => {
    expect(isSessionRejected({ response: { status: 500 } })).toBe(false);
    expect(isSessionRejected({ response: { status: 502 } })).toBe(false);
  });

  it('does not treat 403 as expiry', () => {
    // A permission refusal is about what this user may do, not about whether
    // they are still signed in. Clearing here would log somebody out for
    // opening a screen they lack rights to.
    expect(isSessionRejected({ response: { status: 403 } })).toBe(false);
  });

  it('survives junk it was never given a shape for', () => {
    expect(isSessionRejected(undefined)).toBe(false);
    expect(isSessionRejected(null)).toBe(false);
    expect(isSessionRejected('boom')).toBe(false);
    expect(isSessionRejected(new Error('boom'))).toBe(false);
  });
});

describe('decideSessionStart — what the first frame can show', () => {
  it('sends a first-time user straight to login without asking the server', () => {
    expect(decideSessionStart(null, null)).toEqual({ kind: 'anonymous' });
  });

  it('ignores a stale cached profile when the token is gone', () => {
    // Logging out clears both, but a partial wipe must not resurrect a session.
    expect(decideSessionStart(null, ava)).toEqual({ kind: 'anonymous' });
  });

  it('renders a returning user from cache instead of waiting on the network', () => {
    /*
     * The whole point of the change. Awaiting /auth/me before the first render
     * held every launch on a blank screen for a full round trip — up to the
     * client's 30s timeout on a bad connection.
     */
    expect(decideSessionStart('tok_abc', ava)).toEqual({ kind: 'restored', user: ava });
  });

  it('waits for the server when there is a token but nothing to show', () => {
    // Upgrade from a build that stored no profile, or a partial wipe. There is
    // genuinely nothing to paint optimistically here.
    expect(decideSessionStart('tok_abc', null)).toEqual({ kind: 'must-verify' });
  });
});
