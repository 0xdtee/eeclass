/**
 * 本地设置项(localStorage)——AI 默认开关 / 拾音灵敏度 / 深浅色主题。
 * 都是纯前端持久化,不走后端。
 */

/* ---------------- AI 处理默认开关 ---------------- */
export const AI_DEFAULT_KEYS = {
  aiCorrect: 'eeclass_default_aiCorrect',
  smartSeg: 'eeclass_default_smartSeg',
  translateEn: 'eeclass_default_translateEn',
} as const;

export type AiDefaultKey = keyof typeof AI_DEFAULT_KEYS;

/** 读取某个 AI 默认开关。未设置时默认开(true)。 */
export function getAiDefault(key: AiDefaultKey): boolean {
  if (typeof window === 'undefined') return true;
  const v = localStorage.getItem(AI_DEFAULT_KEYS[key]);
  if (v == null) return true;
  return v === '1';
}

export function setAiDefault(key: AiDefaultKey, on: boolean): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(AI_DEFAULT_KEYS[key], on ? '1' : '0');
}

/* ---------------- 拾音灵敏度(输入增益)---------------- */
const MIC_GAIN_KEY = 'eeclass_mic_gain';
export const MIC_GAIN_MIN = 0.5;
export const MIC_GAIN_MAX = 3.0;
export const MIC_GAIN_DEFAULT = 1.0;

/** 读取拾音增益,默认 1.0,并夹在 [0.5, 3.0]。 */
export function getMicGain(): number {
  if (typeof window === 'undefined') return MIC_GAIN_DEFAULT;
  const raw = localStorage.getItem(MIC_GAIN_KEY);
  const n = raw == null ? MIC_GAIN_DEFAULT : parseFloat(raw);
  if (!Number.isFinite(n)) return MIC_GAIN_DEFAULT;
  return Math.max(MIC_GAIN_MIN, Math.min(MIC_GAIN_MAX, n));
}

export function setMicGain(n: number): void {
  if (typeof window === 'undefined') return;
  const clamped = Math.max(MIC_GAIN_MIN, Math.min(MIC_GAIN_MAX, n));
  localStorage.setItem(MIC_GAIN_KEY, String(clamped));
}

/* ---------------- 深浅色主题 ---------------- */
const THEME_KEY = 'eeclass_theme';
export type Theme = 'light' | 'dark' | 'auto';

export function getTheme(): Theme {
  if (typeof window === 'undefined') return 'auto';
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' || v === 'auto' ? v : 'auto';
}

function resolveTheme(t: Theme): 'light' | 'dark' {
  if (t === 'auto') {
    return typeof window !== 'undefined' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  }
  return t;
}

/** 把当前(或指定)主题写到 <html data-theme>。 */
export function applyTheme(t: Theme = getTheme()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(t));
}

export function setTheme(t: Theme): void {
  if (typeof window !== 'undefined') localStorage.setItem(THEME_KEY, t);
  applyTheme(t);
}

let mqlBound = false;
/** 启动时调用:应用已存主题,并在「跟随系统」时监听系统深浅色变化。 */
export function initTheme(): void {
  if (typeof window === 'undefined') return;
  applyTheme();
  if (!mqlBound) {
    mqlBound = true;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => { if (getTheme() === 'auto') applyTheme('auto'); };
    if (mql.addEventListener) mql.addEventListener('change', onChange);
    else if (mql.addListener) mql.addListener(onChange);
  }
}
