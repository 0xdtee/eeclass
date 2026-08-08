/**
 * 真账号鉴权，接后端 /api/register /api/login /api/me /api/logout。
 *
 * 登录/注册成功后，后端发的「会话令牌」通过 setToken() 存进
 * live_caption_token —— 于是现有所有 API 请求(X-Token 头)和 /ws(?token=)
 * 自动带上它，登录即鉴权，别人注册登录后就能连服务看实时转写。
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

  // 启动时拿本地令牌跟后端核对一次。
  // 只有后端**明确说令牌失效(401/403)**才登出;网络抖动 / 服务器暂时连不上(重启中、
  // 证书、断网)一律**保留本地登录态**——否则每次导航都重新校验,一抖就被误登出。
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
          // 令牌真的失效了 → 清干净,登出
          setToken('');
          localStorage.removeItem(USER_KEY);
          setUser(null);
        }
        // 其它状态码(5xx/服务重启中):保留本地登录态,什么都不做
      })
      .catch(() => {
        // 网络错误(断网/证书/连不上):保留本地登录态,绝不因此登出
      })
      .finally(() => setLoading(false));
  }, []);

  const accept = useCallback((j: AuthResp) => {
    setToken(j.token);
    localStorage.setItem(USER_KEY, JSON.stringify(j.user));
    setUser(j.user);
    // 登录/注册成功后,立刻按这个账号从服务器拉标签和设置(先清掉上一个账号的本地缓存)
    void hydrateTagsFromServer();
    void hydrateSettingsFromServer();
    return j.user;
  }, []);

  const login = useCallback(
    async (email: string, password: string) =>
      accept(await post<AuthResp>('/api/login', { email, password })),
    [accept]
  );

  // 注册第一步:给邮箱发验证码
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
      /* 网络不通也要本地登出 */
    }
    setToken('');
    localStorage.removeItem(USER_KEY);
    setUser(null);
    clearTagsForLogout();       // 清掉本地标签缓存,下个账号不会看到这个账号的
    clearSettingsForLogout();
  }, []);

  return { user, loading, login, register, sendRegisterCode, logout, isAuthenticated: !!user };
}
