import { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react';
import { User, Organization, OwnerSignupRequest } from '@/types';
import { authApi, invitationApi, timeEntryApi } from '@/services/api';
import {
  clearAuthStorage,
  getStoredAuthValue,
  migrateStoredAuth,
  removeStoredAuthValue,
  setStoredAuthValue,
} from '@/lib/authStorage';
import { ACTIVE_TIMER_KEY, armAutoStart, canUseDesktopAutoStart, clearDesktopTimerSession } from '@/lib/desktopTimerSession';
import { apiUrl } from '@/lib/runtimeConfig';
import { isTrackedTimerUser } from '@/lib/permissions';

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string, options?: { remember?: boolean }) => Promise<void>;
  signupOwner: (payload: OwnerSignupRequest) => Promise<{ requiresVerification: boolean; email: string }>;
  acceptInvitation: (token: string, payload: { name: string; password: string; password_confirmation: string }) => Promise<{ requiresVerification: boolean; email: string }>;
  register: (name: string, email: string, password: string, options?: { role?: 'admin' | 'employee'; organizationName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
  updateOrganization: (organization: Organization | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const COOKIE_AUTH_STATE_TOKEN = '__cookie_authenticated__';

// Demo mode - only enabled in development when explicitly set
const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';
const API_URL = apiUrl;

const getResponseStatus = (error: unknown): number | null => {
  if (!error || typeof error !== 'object' || !('response' in error)) {
    return null;
  }

  const response = (error as { response?: { status?: number } }).response;
  return typeof response?.status === 'number' ? response.status : null;
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [organization, setOrganization] = useState<Organization | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isActiveRef = useRef(true);

  const clearStoredAuthState = () => {
    clearAuthStorage();
    clearDesktopTimerSession();
  };

  const clearAuthState = () => {
    setUser(null);
    setToken(null);
    setOrganization(null);
    clearStoredAuthState();
  };

  const storeAuthState = (nextToken: string, nextUser: User, nextOrganization?: Organization | null) => {
    clearDesktopTimerSession();
    if (isTrackedTimerUser(nextUser) && canUseDesktopAutoStart()) {
      armAutoStart(nextUser.id);
    }
    setToken(nextToken);
    setUser(nextUser);
    setOrganization(nextOrganization ?? null);

    setStoredAuthValue('token', nextToken);
    setStoredAuthValue('user', JSON.stringify(nextUser));

    if (nextOrganization) {
      setStoredAuthValue('organization', JSON.stringify(nextOrganization));
      return;
    }

    removeStoredAuthValue('organization');
  };

  const extractUserFromMeResponse = (payload: unknown): User | null => {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if ('data' in payload && payload.data && typeof payload.data === 'object') {
      return payload.data as User;
    }

    if ('id' in payload && 'email' in payload) {
      return payload as User;
    }

    const userPayload = { ...(payload as Record<string, unknown>) };
    delete userPayload.success;
    delete userPayload.message;
    if ('id' in userPayload && 'email' in userPayload) {
      return userPayload as unknown as User;
    }

    return null;
  };

  useEffect(() => {
    isActiveRef.current = true;

    const cleanDesktopTokenFromUrl = () => {
      const params = new URLSearchParams(window.location.search);
      if (!params.has('desktop_token')) return;
      params.delete('desktop_token');
      const cleanSearch = params.toString();
      const cleanUrl = `${window.location.pathname}${cleanSearch ? `?${cleanSearch}` : ''}${window.location.hash}`;
      window.history.replaceState({}, '', cleanUrl);
    };

    const bootstrapAuth = async () => {
      migrateStoredAuth();

      const params = new URLSearchParams(window.location.search);
      const desktopToken = params.get('desktop_token');

      if (desktopToken && !DEMO_MODE) {
        try {
          const response = await fetch(`${API_URL}/auth/handoff`, {
            method: 'POST',
            credentials: 'include',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${desktopToken}`,
            },
          });

          if (response.ok) {
            const payload = await response.json();
            const nextToken = payload?.token;
            const nextUser = payload?.user;
            const nextOrg = payload?.organization;

            if (nextToken && nextUser) {
              if (isActiveRef.current) {
                storeAuthState(nextToken, nextUser, nextOrg);
              } else {
                setStoredAuthValue('token', nextToken);
                setStoredAuthValue('user', JSON.stringify(nextUser));
                if (nextOrg) {
                  setStoredAuthValue('organization', JSON.stringify(nextOrg));
                } else {
                  removeStoredAuthValue('organization');
                }
              }
            }
          }
        } catch (error) {
          console.error('Desktop handoff failed:', error);
        } finally {
          cleanDesktopTokenFromUrl();
        }
      } else if (desktopToken) {
        cleanDesktopTokenFromUrl();
      }

      const storedToken = getStoredAuthValue('token');
      const storedUser = getStoredAuthValue('user');
      const storedOrg = getStoredAuthValue('organization');

      if (storedToken && isActiveRef.current) {
        setToken(storedToken);
      }

      if (storedUser) {
        try {
          if (isActiveRef.current) {
            setUser(JSON.parse(storedUser));
          }
        } catch {
          removeStoredAuthValue('user');
        }
      }

      if (storedOrg) {
        try {
          if (isActiveRef.current) {
            setOrganization(JSON.parse(storedOrg));
          }
        } catch {
          removeStoredAuthValue('organization');
        }
      }

      if (!DEMO_MODE && (storedToken || storedUser || storedOrg)) {
        await fetchUser();
      }

      if (isActiveRef.current) {
        setIsLoading(false);
      }
    };

    bootstrapAuth();

    const handleAuthCleared = () => {
      if (isActiveRef.current) {
        clearAuthState();
        setIsLoading(false);
      }
    };

    window.addEventListener('app:auth-cleared', handleAuthCleared);

    return () => {
      isActiveRef.current = false;
      window.removeEventListener('app:auth-cleared', handleAuthCleared);
    };
  }, []);

  useEffect(() => {
    if (!window.desktopTracker?.onPrepareForClose || !window.desktopTracker?.confirmCloseReady) {
      return;
    }

    window.desktopTracker.onPrepareForClose(async () => {
      try {
        if (!DEMO_MODE && isTrackedTimerUser(user) && token) {
          const trackerFlushDetail: { promise?: Promise<void> } = {};
          window.dispatchEvent(new CustomEvent('desktop-tracker:flush', {
            detail: trackerFlushDetail,
          }));

          try {
            await trackerFlushDetail.promise;
          } catch (error) {
            console.error('Activity flush on desktop close error:', error);
          }

          try {
            await timeEntryApi.stop({ timer_slot: 'primary' });
          } catch (error) {
            const status = getResponseStatus(error);
            if (status !== 404 && status !== 401 && status !== 403) {
              console.error('Timer stop on desktop close error:', error);
            }
          }
        }

        localStorage.removeItem(ACTIVE_TIMER_KEY);
      } finally {
        try {
          await window.desktopTracker?.confirmCloseReady?.();
        } catch (error) {
          console.error('Desktop close confirmation error:', error);
        }
      }
    });

    return () => {
      window.desktopTracker?.clearPrepareForCloseListeners?.();
    };
  }, [token, user?.role]);

  const fetchUser = async () => {
    try {
      const response = await authApi.me();
      const nextUser = extractUserFromMeResponse(response.data);
      const nextOrganization = (response.data as any)?.organization
        || (response.data as any)?.data?.organization
        || (nextUser as any)?.organization
        || null;

      if (!nextUser) {
        throw new Error('Invalid auth payload');
      }

      if (!isActiveRef.current) {
        return;
      }

      setToken((currentToken) => currentToken || COOKIE_AUTH_STATE_TOKEN);
      setUser(nextUser);
      setStoredAuthValue('user', JSON.stringify(nextUser));
      if (nextOrganization) {
        setOrganization(nextOrganization);
        setStoredAuthValue('organization', JSON.stringify(nextOrganization));
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
      if (isActiveRef.current) {
        clearAuthState();
      }
    }
  };

  const login = async (email: string, password: string, options?: { remember?: boolean }) => {
    const normalizedEmail = email.trim().toLowerCase();

    if (DEMO_MODE) {
      const demoUser: User = {
        id: 1,
        name: normalizedEmail.split('@')[0],
        email: normalizedEmail,
        role: 'admin',
        organization_id: 1,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const demoOrg: Organization = {
        id: 1,
        name: 'Demo Company',
        slug: 'demo-company',
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      storeAuthState('demo-token-12345', demoUser, demoOrg);
      return;
    }

    const response = await authApi.login({
      email: normalizedEmail,
      password,
      remember: Boolean(options?.remember),
    });
    const { user: userData, token: authToken, organization: org } = response.data;

    storeAuthState(authToken, userData, org);
  };

  const signupOwner = async (payload: OwnerSignupRequest) => {
    if (DEMO_MODE) {
      const demoUser: User = {
        id: 1,
        name: payload.name,
        email: payload.email,
        role: 'admin',
        organization_id: 1,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const demoOrg: Organization = {
        id: 1,
        name: payload.company_name,
        slug: payload.company_name.toLowerCase().replace(/\s+/g, '-'),
        owner_user_id: 1,
        plan_code: payload.plan_code,
        billing_cycle: payload.billing_cycle || 'monthly',
        subscription_status: payload.signup_mode === 'paid' ? 'inactive' : 'trial',
        subscription_intent: payload.signup_mode,
        settings: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      storeAuthState('demo-token-12345', demoUser, demoOrg);
      return { requiresVerification: false, email: demoUser.email };
    }

    const response = await authApi.signupOwner(payload);
    return {
      requiresVerification: Boolean(response.data.requires_verification),
      email: response.data.email || response.data.user.email,
    };
  };

  const acceptInvitation = async (
    tokenValue: string,
    payload: { name: string; password: string; password_confirmation: string }
  ) => {
    if (DEMO_MODE) {
      return { requiresVerification: false, email: payload.name };
    }

    const response = await invitationApi.accept(tokenValue, payload);
    return {
      requiresVerification: Boolean(response.data.requires_verification),
      email: response.data.email || response.data.user.email,
    };
  };

  const register = async (name: string, email: string, password: string, options?: { role?: 'admin' | 'employee'; organizationName?: string }) => {
    await signupOwner({
      company_name: options?.organizationName || 'My Company',
      name,
      email,
      password,
      password_confirmation: password,
      plan_code: 'starter',
      signup_mode: 'trial',
      billing_cycle: 'monthly',
      terms_accepted: true,
    });
  };

  const logout = async () => {
    if (!DEMO_MODE) {
      try {
        const trackerFlushDetail: { promise?: Promise<void> } = {};
        window.dispatchEvent(new CustomEvent('desktop-tracker:flush', { detail: trackerFlushDetail }));
        await trackerFlushDetail.promise;
      } catch (error) {
        console.error('Desktop tracker flush on logout error:', error);
      }
    }

    if (!DEMO_MODE) {
      try {
        await authApi.logout();
      } catch (error) {
        const status = getResponseStatus(error);
        if (status !== 401 && status !== 403) {
          console.error('Logout error:', error);
        }
      }
    }
    clearAuthState();
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
    setStoredAuthValue('user', JSON.stringify(updatedUser));
  };

  const updateOrganization = (updatedOrganization: Organization | null) => {
    setOrganization(updatedOrganization);
    if (updatedOrganization) {
      setStoredAuthValue('organization', JSON.stringify(updatedOrganization));
    } else {
      removeStoredAuthValue('organization');
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        organization,
        token,
        isLoading,
        isAuthenticated: !!user && !!token,
        login,
        signupOwner,
        acceptInvitation,
        register,
        logout,
        updateUser,
        updateOrganization,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
