import type { User } from '../types';

/**
 * What to do with a stored session at app start, and when to throw one away.
 *
 * This is policy, not UI, and it is the part that was wrong: bootstrap cleared
 * the token from a bare `catch`, so any failure of /auth/me signed the person
 * out. Keeping it here means the rule can be stated once and tested directly,
 * rather than only being observable by rendering a provider.
 */

/**
 * Only an explicit 401 means the token is dead.
 *
 * Everything else — offline, DNS failure, a request that timed out, a 500 while
 * the API restarts — says nothing about whether the session is valid, so it must
 * not end one. The first thing anybody does with this app is punch in at the
 * office door; being sent back to a password prompt because the lift had no
 * signal is a bug, not an expiry.
 *
 * A genuinely dead token still gets cleared: the response interceptor in
 * api/client.ts wipes storage on any 401, from any request.
 */
export function isSessionRejected(error: unknown): boolean {
  const status = (error as { response?: { status?: number } } | undefined)?.response?.status;
  return status === 401;
}

export type SessionStart =
  /** No token. Go to login; ask the server nothing. */
  | { kind: 'anonymous' }
  /**
   * Token and a cached profile. Render immediately from cache and confirm
   * behind the app — never in front of it.
   */
  | { kind: 'restored'; user: User }
  /**
   * A token with no cached profile: an upgrade from an older build, or a
   * partial wipe. Nothing can be shown optimistically, so this is the only
   * path that has to wait for the network.
   */
  | { kind: 'must-verify' };

export function decideSessionStart(
  token: string | null,
  cachedUser: User | null
): SessionStart {
  if (!token) return { kind: 'anonymous' };
  if (cachedUser) return { kind: 'restored', user: cachedUser };
  return { kind: 'must-verify' };
}
