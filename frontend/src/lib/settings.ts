/**
 * 应用设置。现在跟账号走、存服务器(/api/settings);localStorage 只作本地缓存,
 * 保证同步读取(loadSettings)不变。录音控制栏用这里的默认值初始化。
 */
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';

export interface AppSettings {
  aiCorrect: boolean;                                  // 默认开 AI 实时纠错
  smartSeg: boolean;                                   // 默认开 AI 智能分句
  translateEn: boolean;                                // 默认开 英文自动翻中文字幕
  model: 'sensevoice' | 'paraformer' | 'stream' | 'shanghainese' | 'aliyun' | 'aliyun_wu';   // 默认识别模型
  sensitivity: 'std' | 'high' | 'max';                 // 默认拾音灵敏度
  device: 'auto' | 'browser' | 'browser-system';       // 默认音源
  toWord: boolean;                                     // 录制时同步写入 Word
  autoSummary: boolean;                                // 结束录制后自动生成概要
  importTagSimilar: boolean;                           // 导入课程时:相似的归到已有标签
  importTagNew: boolean;                               // 导入课程时:没有相似的就新建标签
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiCorrect: false,
  smartSeg: true,
  translateEn: true,
  model: 'sensevoice',
  sensitivity: 'high',
  device: 'auto',
  toWord: false,
  autoSummary: true,
  importTagSimilar: true,
  importTagNew: true,
};

const KEY = 'lc_settings_v1';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...s };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  const next = { ...loadSettings(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* localStorage 满/禁用就算了 */
  }
  pushSettings();   // 同步到服务器(按账号)
  return next;
}

// ── 服务器同步(按账号)──────────────────────────────────────────
let lastToken = '';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function pushSettings() {
  const t = getToken();
  if (!t) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fetch(SERVICE_ORIGIN + '/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Token': t },
      body: JSON.stringify({ settings: loadSettings() }),
    }).catch(() => {});
  }, 400);
}

/** 登录/切账号时:先复位成默认,再从服务器拉这个账号的设置。 */
export async function hydrateSettingsFromServer() {
  const t = getToken();
  if (!t || t === lastToken) return;
  lastToken = t;
  localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS }));   // 先清掉上一个账号的
  try {
    const r = await fetch(SERVICE_ORIGIN + '/api/settings', { headers: { 'X-Token': t } });
    if (!r.ok) return;
    const j = await r.json();
    if (j.settings && typeof j.settings === 'object') {
      localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...j.settings }));
    } else {
      pushSettings();   // 该账号还没有 → 用默认并存下基线
    }
  } catch {
    // 网络问题:保持默认
  }
}

/** 登出:清空本地设置缓存并复位。 */
export function clearSettingsForLogout() {
  lastToken = '';
  localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS }));
}
