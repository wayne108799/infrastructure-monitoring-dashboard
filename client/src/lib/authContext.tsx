import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthSession, AuthUser, AuthGroup, getCurrentUser, login as apiLogin, logout as apiLogout } from './api';

interface AuthContextType {
  user: AuthUser | null;
  permissions: string[];
  groups: AuthGroup[];
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await getCurrentUser();
      setSession(data);
    } catch (error) {
      setSession(null);
    }
  }, []);

  useEffect(() => {
    const checkAuth = async () => {
      setIsLoading(true);
      try {
        const data = await getCurrentUser();
        setSession(data);
      } catch (error) {
        setSession(null);
      } finally {
        setIsLoading(false);
      }
    };
    checkAuth();
  }, []);

  const login = async (username: string, password: string) => {
    const data = await apiLogin(username, password);
    setSession(data);
  };

  const logout = async () => {
    await apiLogout();
    setSession(null);
  };

  const hasPermission = (permission: string): boolean => {
    return session?.permissions.includes(permission) ?? false;
  };

  const hasAnyPermission = (permissions: string[]): boolean => {
    return permissions.some(p => session?.permissions.includes(p)) ?? false;
  };

  const value: AuthContextType = {
    user: session?.user ?? null,
    permissions: session?.permissions ?? [],
    groups: session?.groups ?? [],
    isLoading,
    isAuthenticated: !!session?.user,
    login,
    logout,
    hasPermission,
    hasAnyPermission,
    refresh,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
