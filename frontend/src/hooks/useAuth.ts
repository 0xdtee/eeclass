/**
 * Real account authentication, talking to the backend /api/register /api/login /api/me /api/logout.
 *
 * After a successful login/register, the "session token" issued by the backend is stored via setToken() into
 * live_caption_token — so all existing API requests (X-Token header) and /ws (?token=)
 * automatically carry it; logging in authenticates you, and anyone who registers and logs in can connect to the service and see live transcription.
 */
import { useState, useCallback, useEffect } from 'react';
import { SERVICE_ORIGIN, getToken, setToken } from '@/hooks/useLiveCaption';
import { hydrateTagsFromServer, clearTagsForLogout } from '@/hooks/useTagsStore';
import { hydrateSettingsFromServer, clearSettingsForLogout } from '@/lib/settings';

export interface AuthUser {
  email: string;
  name: string;
  role?: string;
}

const USER_KEY = 'auth_user';

function storedUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(SERVICE_ORIGIN + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Token': getToken() },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
  return j as T;
}

interface AuthResp {
  token: string;
  user: AuthUser;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(storedUser);
  const [loading, setLoading] = useState(true);

  // On startup, verify the local token against the backend once.
  // Only log out when the backend **explicitly says the token is invalid (401/403)**; on network jitter / server temporarily unreachable (restarting,
  // certificate, offline) always **keep the local logged-in state** — otherwise every navigation re-validates and a single hiccup wrongly logs you out.
  useEffect(() => {
    const t = getToken();
    if (!t) {
      setUser(null);
      setLoading(false);
      return;
    }
    fetch(SERVICE_ORIGIN + '/api/me', { headers: { 'X-Token': t } })
      .then(async (r) => {
        if (r.ok) {
          const j = (await r.json()) as { user: AuthUser };
          setUser(j.user);
          localStorage.setItem(USER_KEY, JSON.stringify(j.user));
        } else if (r.status === 401 || r.status === 403) {
          // The token really is invalid → clear everything and log out
          setToken('');
          localStorage.removeItem(USER_KEY);
          setUser(null);
        }
        // Other status codes (5xx/service restarting): keep the local logged-in state, do nothing
      })
      .catch(() => {
        // Network error (offline/certificate/unreachable): keep the local logged-in state, never log out because of it
      })
      .finally(() => setLoading(false));
  }, []);

  const accept = useCallback((j: AuthResp) => {
    setToken(j.token);
    localStorage.setItem(USER_KEY, JSON.stringify(j.user));
    setUser(j.user);
    // After a successful login/register, immediately fetch this account's tags and settings from the server (clearing the previous account's local cache first)
    void hydrateTagsFromServer();
    void hydrateSettingsFromServer();
    return j.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) =>
      accept(await post<AuthResp>('/api/login', { email, password })),
    [accept]
  );

  // Registration step one: send a verification code to the email
  const sendRegisterCode = useCallback(
    (email: string) => post<{ ok: boolean }>('/api/register/code', { email }),
    []
  );

  const register = useCallback(
    async (name: string, email: string, password: string, code: string) =>
      accept(await post<AuthResp>('/api/register', { name, email, password, code })),
    [accept]
  );

  const logout = useCallback(async () => {
    try {
      await post('/api/logout', {});
    } catch {
      /* Log out locally even if the network is down */
    }
    setToken('');
    localStorage.removeItem(USER_KEY);
    setUser(null);
    clearTagsForLogout();       // Clear the local tag cache so the next account won't see this account's
    clearSettingsForLogout();
  }, []);

  return { user, loading, login, register, sendRegisterCode, logout, isAuthenticated: !!user };
}
