import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState } from 'react-native';
import { authStorage } from '../api/client';
import { authApi } from '../api/endpoints';
import { decideSessionStart, isSessionRejected } from '../lib/session';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

/**
 * Waiting longer than this for /auth/me on a cold start is worse than showing
 * the login screen. It only applies to the one path that has nothing cached to
 * render — see bootstrap().
 */
const BOOTSTRAP_TIMEOUT_MS = 12000;

/** Don't re-check the session on every glance at the phone. */
const REVALIDATE_INTERVAL_MS = 60000;

function extractUser(obj: Record<string, any>): User | null {
  // Login response: { user: { id, name, ... }, token, organization }
  if (obj.user && obj.user.name) return obj.user;
  // /auth/me response: { success, id, name, email, ... }
  const { success, message, token, organization, ...rest } = obj;
  if (rest.id && rest.name) return rest as unknown as User;
  return null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Read by the foreground listener, which must not resubscribe on every
  // change of user or it would tear down and rebuild on each revalidation.
  const hasUser = useRef(false);
  const lastRevalidatedAt = useRef(0);

  useEffect(() => {
    hasUser.current = user !== null;
  }, [user]);

  /**
   * Confirm the cached session against the server, and correct it if wrong.
   *
   * Deliberately silent: it runs behind a screen the user is already using, so
   * it must never surface a spinner and never disturb anything unless the
   * server actively rejects the token.
   */
  const revalidate = useCallback(async (timeoutMs?: number) => {
    lastRevalidatedAt.current = Date.now();

    try {
      const res = await authApi.me(timeoutMs ? { timeout: timeoutMs } : undefined);
      const parsed = extractUser(res.data);
      if (parsed) {
        setUser(parsed);
        await authStorage.setUser(parsed);
      }
    } catch (error) {
      if (isSessionRejected(error)) {
        await authStorage.clear().catch(() => {});
        setUser(null);
      }
      // Offline, timed out, 5xx — keep the cached session. Being wrong here
      // costs one stale name on a screen; signing someone out costs them the
      // punch they opened the app to make.
    }
  }, []);

  /**
   * Decide who the user is without blocking the first frame on a question we
   * already have an answer to.
   *
   * The token and the user profile both live in SecureStore, so a returning
   * user can be rendered from cache immediately and confirmed afterwards.
   * Awaiting /auth/me before the first render meant every single launch sat on
   * a spinner for the length of a round trip — up to the 30s client timeout on
   * a bad connection, on a screen showing nothing at all.
   */
  const bootstrap = useCallback(async () => {
    try {
      const [token, cached] = await Promise.all([
        authStorage.getToken(),
        authStorage.getUser(),
      ]);

      const start = decideSessionStart(token, cached);

      if (start.kind === 'anonymous') return;

      if (start.kind === 'restored') {
        setUser(start.user);
        void revalidate();
        return;
      }

      await revalidate(BOOTSTRAP_TIMEOUT_MS);
    } finally {
      setIsLoading(false);
    }
  }, [revalidate]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  /**
   * Re-check on resume. A token that expired overnight is then found when the
   * app is opened, rather than in the middle of the morning punch.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' || !hasUser.current) return;
      if (Date.now() - lastRevalidatedAt.current < REVALIDATE_INTERVAL_MS) return;
      void revalidate();
    });

    return () => sub.remove();
  }, [revalidate]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const parsed = extractUser(res.data);
    if (!res.data.token) throw new Error('No token in login response');
    await authStorage.setToken(res.data.token);
    if (parsed) {
      await authStorage.setUser(parsed);
      setUser(parsed);
    }
    lastRevalidatedAt.current = Date.now();
  }, []);

  const logout = useCallback(async () => {
    // Clear locally first so UI responds immediately
    setUser(null);
    await authStorage.clear().catch(() => {});
    // Fire-and-forget the server-side logout
    authApi.logout().catch(() => {});
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isAuthenticated: !!user, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
