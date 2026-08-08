const STORAGE_KEY_SERVER = 'eeclass_server_url';

function getStoredServerUrl(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_SERVER) || '';
  } catch {
    return '';
  }
}

// Backend URL:
//  · Web version is deployed same-origin as the backend (https://dtee.os.hi.cn:5901/m) → use the "current page origin", no config, no CORS.
//  · Native app (bundled into Capacitor, origin is capacitor://localhost) / local dev → use a hardcoded backend URL.
const BACKEND = 'https://dtee.os.hi.cn:5901';
function defaultOrigin(): string {
  if (typeof window === 'undefined') return BACKEND;
  const o = window.location.origin;
  if (/^https:\/\//.test(o) && !/localhost|127\.0\.0\.1|:(3000|5173)$/.test(o)) return o;
  return BACKEND;
}

export const SERVICE_ORIGIN = getStoredServerUrl() || defaultOrigin();

export function setServerUrl(url: string) {
  try {
    localStorage.setItem(STORAGE_KEY_SERVER, url);
  } catch {
    // ignore
  }
}

export function getServerUrl(): string {
  return getStoredServerUrl() || SERVICE_ORIGIN;
}

export function hasServerUrl(): boolean {
  // There's always a default backend (web = same-origin, app = hardcoded backend), so don't force the server-config page; the user can still change it manually.
  return true;
}

const STORAGE_KEY_TOKEN = 'eeclass_token';

export function getToken(): string {
  try {
    return localStorage.getItem(STORAGE_KEY_TOKEN) || '';
  } catch {
    return '';
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(STORAGE_KEY_TOKEN, token);
  } catch {
    // ignore
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(STORAGE_KEY_TOKEN);
  } catch {
    // ignore
  }
}

export function getWsUrl(): string {
  const origin = getServerUrl();
  return origin.replace(/^http/, 'ws') + '/ws';
}

interface FetchOptions {
  method?: string;
  body?: string | FormData;
  headers?: Record<string, string>;
}

export async function apiFetch<T = unknown>(path: string, options: FetchOptions = {}): Promise<T> {
  const origin = getServerUrl();
  const url = path.startsWith('http') ? path : `${origin}${path}`;
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers || {}),
  };
  if (token) {
    headers['X-Token'] = token;
  }
  if (!headers['Content-Type'] && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, { ...options, headers });
  } catch (err) {
    if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('Failed') || err.message.includes('NetworkError'))) {
      throw new Error('无法连接到服务器，请检查后端服务是否已启动');
    }
    throw new Error('网络请求失败，请检查网络或后端服务');
  }

  if (res.status === 401 || res.status === 403) {
    clearToken();
    throw new Error('登录已过期，请重新登录');
  }

  if (!res.ok) {
    let errMsg = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) errMsg = body.error;
      if (body.message) errMsg = body.message;
    } catch {
      // keep default
    }
    throw new Error(errMsg);
  }

  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    return res.json() as Promise<T>;
  }
  return res as unknown as T;
}

export async function apiFetchBlob(path: string): Promise<{ blob: Blob; response: Response }> {
  const origin = getServerUrl();
  const url = path.startsWith('http') ? path : `${origin}${path}`;
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) headers['X-Token'] = token;

  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    if (err instanceof TypeError && (err.message.includes('fetch') || err.message.includes('Failed') || err.message.includes('NetworkError'))) {
      throw new Error('无法连接到服务器，请检查后端服务是否已启动');
    }
    throw new Error('网络请求失败，请检查网络或后端服务');
  }

  if (res.status === 401 || res.status === 403) {
    clearToken();
    throw new Error('登录已过期，请重新登录');
  }

  if (!res.ok) {
    let errMsg = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body.error) errMsg = body.error;
    } catch {
      // keep default
    }
    throw new Error(errMsg);
  }

  const blob = await res.blob();
  return { blob, response: res };
}