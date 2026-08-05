import { useState, useCallback, useEffect } from 'react';
import { apiFetch, getToken, setToken, clearToken } from '@/lib/api';

export interface AuthUser {
  email: string;
  name: string;
  role: 'teacher' | 'student' | 'admin';
}

function getOfflineMode(): boolean {
  try {
    return localStorage.getItem('eeclass_offline') === '1';
  } catch {
    return false;
  }
}

function clearOfflineMode() {
  try {
    localStorage.removeItem('eeclass_offline');
  } catch {
    // ignore
  }
}

function getStoredUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem('eeclass_user');
    if (!raw) return null;
    return JSON.parse(raw) as AuthUser;
  } catch {
    return null;
  }
}

function storeUser(user: AuthUser | null) {
  try {
    if (user) {
      localStorage.setItem('eeclass_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('eeclass_user');
    }
  } catch {
    // ignore
  }
}

export function useAuth() {
  const isOffline = getOfflineMode();
  const [user, setUser] = useState<AuthUser | null>(isOffline ? getStoredUser() : getStoredUser);
  const [loading, setLoading] = useState(!isOffline);
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOffline) {
      setLoading(false);
      return;
    }
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    // Try to validate token with /api/me(后端返回 { user: {...} },按嵌套字段取)
    apiFetch<{ user: { email: string; name: string; role: string } }>('/api/me')
      .then((data) => {
        const info = data.user;
        if (!info) throw new Error('no user');
        const u: AuthUser = {
          email: info.email,
          name: info.name,
          role: info.role as AuthUser['role'],
        };
        storeUser(u);
        setUser(u);
      })
      .catch(() => {
        clearToken();
        storeUser(null);
        setUser(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    if (isOffline) return false;
    setError('');
    try {
      const data = await apiFetch<{ token: string; user: { email: string; name: string; role: string } }>('/api/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setToken(data.token);
      const u: AuthUser = {
        email: data.user.email,
        name: data.user.name,
        role: data.user.role as AuthUser['role'],
      };
      storeUser(u);
      setUser(u);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '登录失败');
      return false;
    }
  }, [isOffline]);

  const register = useCallback(async (name: string, email: string, password: string, inviteCode?: string): Promise<boolean> => {
    if (isOffline) return false;
    setError('');
    try {
      const body: Record<string, string> = { name, email, password };
      if (inviteCode) body.invite_code = inviteCode;
      const data = await apiFetch<{ token: string; user: { email: string; name: string; role: string } }>('/api/register', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setToken(data.token);
      const u: AuthUser = {
        email: data.user.email,
        name: data.user.name,
        role: data.user.role as AuthUser['role'],
      };
      storeUser(u);
      setUser(u);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '注册失败');
      return false;
    }
  }, [isOffline]);

  const logout = useCallback(async () => {
    clearOfflineMode();
    try {
      await apiFetch('/api/logout', { method: 'POST' });
    } catch {
      // ignore
    }
    clearToken();
    storeUser(null);
    setUser(null);
  }, []);

  return {
    user,
    loading,
    error,
    login,
    register,
    logout,
    isAuthenticated: !!user,
    isAdmin: user?.role === 'admin',
    isOffline,
  };
}

export function useRequireAuth() {
  const { user, loading, isOffline } = useAuth();
  const isAuthenticated = !!user || isOffline;
  return { user, loading, isAuthenticated };
}