/**
 * Local settings (localStorage) — AI default toggles / mic sensitivity / light-dark theme.
 * All pure front-end persistence, no backend involved.
 */

/* ---------------- AI processing default toggles ---------------- */
export const AI_DEFAULT_KEYS = {
  aiCorrect: 'eeclass_default_aiCorrect',
  smartSeg: 'eeclass_default_smartSeg',
  translateEn: 'eeclass_default_translateEn',
} as const;

export type AiDefaultKey = keyof typeof AI_DEFAULT_KEYS;

/** Read a given AI default toggle. Defaults to on (true) when unset. */
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

/* ---------------- Mic sensitivity (input gain) ---------------- */
const MIC_GAIN_KEY = 'eeclass_mic_gain';
export const MIC_GAIN_MIN = 0.5;
export const MIC_GAIN_MAX = 3.0;
export const MIC_GAIN_DEFAULT = 1.0;

/** Read the mic gain, default 1.0, clamped to [0.5, 3.0]. */
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

/* ---------------- Light/dark theme ---------------- */
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

/** Write the current (or specified) theme to <html data-theme>. */
export function applyTheme(t: Theme = getTheme()): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', resolveTheme(t));
}

export function setTheme(t: Theme): void {
  if (typeof window !== 'undefined') localStorage.setItem(THEME_KEY, t);
  applyTheme(t);
}

let mqlBound = false;
/** Call on startup: apply the saved theme and, when set to "follow system", listen for system light/dark changes. */
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
