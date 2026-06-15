import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authStorage } from '../api/client';
import { authApi } from '../api/endpoints';
import type { User } from '../types';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>(null!);

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

  useEffect(() => {
    bootstrap();
  }, []);

  const bootstrap = async () => {
    try {
      const token = await authStorage.getToken();
      if (!token) { setIsLoading(false); return; }

      const res = await authApi.me();
      const parsed = extractUser(res.data);
      if (parsed) {
        setUser(parsed);
        await authStorage.setUser(parsed);
      }
    } catch {
      await authStorage.clear().catch(() => {});
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    const parsed = extractUser(res.data);
    if (!res.data.token) throw new Error('No token in login response');
    await authStorage.setToken(res.data.token);
    if (parsed) {
      await authStorage.setUser(parsed);
      setUser(parsed);
    }
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
