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
import { apiBaseUrl } from '@/lib/runtimeConfig';
import { isTrackedTimerUser } from '@/lib/permissions';
import {
  saveAuthOffline,
  getAuthOffline,
  clearAuthOffline,
  setOfflineCredentials,
  isDesktopApp,
} from '@/services/offlineService';

interface GoogleAuthResponse {
  token: string;
  user: User;
  organization?: Organization;
  has_workspace: boolean;
  google_data?: { name: string; email: string };
}

interface AuthContextType {
  user: User | null;
  organization: Organization | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  wasOfflineRestored: boolean;
  login: (email: string, password: string, options?: { remember?: boolean }) => Promise<void>;
  signupOwner: (payload: OwnerSignupRequest) => Promise<{ requiresVerification: boolean; email: string }>;
  acceptInvitation: (token: string, payload: { name: string; password: string; password_confirmation: string; timezone?: string }) => Promise<{ requiresVerification: boolean; email: string }>;
  register: (name: string, email: string, password: string, options?: { role?: 'admin' | 'employee'; organizationName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  googleLogin: (credential: string) => Promise<GoogleAuthResponse>;
  completeGoogleRegistration: (data: {
    name: string;
    company_name: string;
    company_description?: string;
    plan_code?: string;
    billing_cycle?: string;
    seats?: number;
    signup_mode?: string;
    timezone?: string;
    description?: string;
    website?: string;
    industry?: string;
    size?: string;
    phone?: string;
    org_email?: string;
    address_line?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  }) => Promise<GoogleAuthResponse>;
  updateUser: (user: User) => void;
  updateOrganization: (organization: Organization | null) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const COOKIE_AUTH_STATE_TOKEN = '__cookie_authenticated__';

// Demo mode - only enabled in development when explicitly set
const DEMO_MODE = import.meta.env.DEV && import.meta.env.VITE_ENABLE_DEMO_MODE === 'true';
const API_URL = apiBaseUrl;

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
  const [wasOfflineRestored, setWasOfflineRestored] = useState(false);
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

  const persistAuthOffline = async (nextToken: string, nextUser: User, nextOrganization?: Organization | null) => {
    if (!isDesktopApp()) return;
    try {
      await saveAuthOffline(
        nextUser.id,
        nextToken,
        { id: nextUser.id, name: nextUser.name, email: nextUser.email, role: nextUser.role, organization_id: nextUser.organization_id },
        nextOrganization?.id,
        nextOrganization ? (nextOrganization as unknown as Record<string, unknown>) : undefined,
      );
      await setOfflineCredentials(nextToken, nextUser.id, apiBaseUrl);
    } catch (err) {
      console.warn('[Auth] Offline auth persistence failed:', err);
    }
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
              void persistAuthOffline(nextToken, nextUser, nextOrg);
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

      // Initialize organization from cached storage before fetchUser.
      // When online, fetchUser will validate and override from the server.
      // When offline, this ensures ProtectedRoute doesn't redirect to workspace creation.
      if (storedOrg) {
        try {
          const parsedOrg = JSON.parse(storedOrg);
          if (parsedOrg?.id) {
            setOrganization(parsedOrg);
          }
        } catch {}
      }

      let fetchUserSucceeded = false;

      if (!DEMO_MODE && (storedToken || storedUser || storedOrg)) {
        try {
          await fetchUser();
          fetchUserSucceeded = true;
          if (isDesktopApp() && storedToken) {
            setOfflineCredentials(storedToken, (JSON.parse(storedUser || '{}') as any).id || 0, apiBaseUrl).catch(() => {});
          }
        } catch {
          // fetchUser failed (likely offline) - try offline auth recovery
          if (window.desktopTracker) {
            try {
              const offlineAuth = await getAuthOffline();
              if (offlineAuth && offlineAuth.token && isActiveRef.current) {
                setStoredAuthValue('token', offlineAuth.token);
                setToken(offlineAuth.token);
                if (offlineAuth.user_data) {
                  const userData = offlineAuth.user_data as any;
                  setStoredAuthValue('user', JSON.stringify(userData));
                  setUser(userData as User);
                  // Restore organization if present in offline data
                  if (userData._organization) {
                    const orgData = userData._organization as Organization;
                    setStoredAuthValue('organization', JSON.stringify(orgData));
                    setOrganization(orgData);
                  }
                }
                console.log('[Auth] Restored session from offline storage');
                setWasOfflineRestored(true);
                setOfflineCredentials(offlineAuth.token, offlineAuth.user_id, apiBaseUrl).catch(() => {});
              }
            } catch (offlineErr) {
              console.warn('[Auth] Offline auth recovery failed:', offlineErr);
            }
          }

          // Fallback: if offline recovery didn't set org but we have one in localStorage,
          // restore it (handles existing DBs created before _organization was added)
          if (!organization && storedOrg) {
            try {
              const parsedOrg = JSON.parse(storedOrg);
              if (parsedOrg?.id) {
                setOrganization(parsedOrg);
                console.log('[Auth] Restored organization from localStorage fallback');
              }
            } catch {}
          }
        }
      }

      // Only clear stored org when we confirmed from the server (not when offline)
      if (fetchUserSucceeded && storedOrg && !organization) {
        removeStoredAuthValue('organization');
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

  // Note: Timer no longer stops on page unload/refresh to allow timer persistence
  // The idle detection (5 minutes) will stop the timer if user is truly inactive

  const fetchUser = async () => {
    try {
      setWasOfflineRestored(false);
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
      
      // Update organization - if null, clear it from storage
      if (nextOrganization) {
        setOrganization(nextOrganization);
        setStoredAuthValue('organization', JSON.stringify(nextOrganization));
      } else {
        // User no longer has an organization - clear it
        setOrganization(null);
        removeStoredAuthValue('organization');
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
      throw error;
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

    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    const response = await authApi.login({
      email: normalizedEmail,
      password,
      remember: Boolean(options?.remember),
      timezone: browserTimezone,
    });

    const responseData = response.data as any;
    if (!responseData.success || !responseData.token || !responseData.user) {
      const error = new Error(responseData.message || 'Login failed') as any;
      error.response = response;
      throw error;
    }

    const { user: userData, token: authToken, organization: org } = responseData;

    storeAuthState(authToken, userData, org);
    void persistAuthOffline(authToken, userData, org);
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
        max_seats: payload.seats || 5,
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
    payload: { name: string; password: string; password_confirmation: string; timezone?: string }
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
      if (window.desktopTracker) {
        try {
          await timeEntryApi.stop({ timer_slot: 'primary' });
        } catch (error) {
          const status = getResponseStatus(error);
          if (status !== 404 && status !== 401 && status !== 403) {
            console.error('Timer stop on desktop logout error:', error);
          }
        }
      }

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
    void clearAuthOffline();
  };

  const googleLogin = async (credential: string): Promise<GoogleAuthResponse> => {
    const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const response = await authApi.googleLogin(credential, browserTimezone);
    const responseData = response.data;

    if (!responseData.success) {
      throw new Error('Google login failed');
    }

    // Store auth state so pending users can call protected completeRegistration
    storeAuthState(responseData.token, responseData.user, responseData.organization);

    return responseData;
  };

  const completeGoogleRegistration = async (data: {
    name: string;
    company_name: string;
    company_description?: string;
    plan_code?: string;
    billing_cycle?: string;
    seats?: number;
    signup_mode?: string;
    timezone?: string;
    description?: string;
    website?: string;
    industry?: string;
    size?: string;
    phone?: string;
    org_email?: string;
    address_line?: string;
    city?: string;
    state?: string;
    postal_code?: string;
    country?: string;
  }): Promise<GoogleAuthResponse> => {
    const response = await authApi.completeGoogleRegistration(data);
    const responseData = response.data;

    if (!responseData.success) {
      throw new Error('Failed to complete registration');
    }

    storeAuthState(responseData.token, responseData.user, responseData.organization);

    return {
      ...responseData,
      has_workspace: true,
    };
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
    setStoredAuthValue('user', JSON.stringify(updatedUser));
    window.dispatchEvent(new CustomEvent('app:user-updated', { detail: updatedUser }));
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'carevance:user',
      newValue: JSON.stringify(updatedUser),
      storageArea: window.sessionStorage,
    }));
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
        wasOfflineRestored,
        login,
        signupOwner,
        acceptInvitation,
        register,
        logout,
        googleLogin,
        completeGoogleRegistration,
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
