/**
 * UI internationalization. Source language is Simplified Chinese, and the Simplified string IS the key:
 *   t('设置')  ->  '设置' | '設定' | 'Settings'
 *
 * - zh-Hans: return the source string.
 * - zh-Hant: convert with OpenCC (phrase-aware Simplified -> Traditional), loaded lazily on first use.
 * - en:      look the source string up in the EN dictionary; fall back to Chinese if not translated yet.
 *
 * Interpolation: t('已有 {n} 节课时', { n: 3 }). Only UI chrome is translated -- user content
 * (transcripts, course names, notes) is passed through as data and never sent through t().
 */
import { useSyncExternalStore } from 'react';
import { EN } from './i18n.en';

export type Lang = 'zh-Hans' | 'zh-Hant' | 'en';
export const LANGS: { value: Lang; label: string }[] = [
  { value: 'zh-Hans', label: '简体中文' },
  { value: 'zh-Hant', label: '繁體中文' },
  { value: 'en', label: 'English' },
];

const LANG_KEY = 'ui_lang';

function initialLang(): Lang {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === 'zh-Hans' || v === 'zh-Hant' || v === 'en') return v;
  } catch { /* ignore */ }
  return 'zh-Hans';
}

let lang: Lang = initialLang();
let s2t: ((s: string) => string) | null = null;   // OpenCC converter, lazily loaded for Traditional
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getLang(): Lang {
  return lang;
}

export function setLang(l: Lang): void {
  if (l === lang) return;
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); } catch { /* ignore */ }
  if (l === 'zh-Hant' && !s2t) void loadS2T();
  emit();
}

async function loadS2T(): Promise<void> {
  try {
    const OpenCC = await import('opencc-js');
    const conv = OpenCC.Converter({ from: 'cn', to: 'tw' });
    s2t = (str: string) => conv(str);
    emit();   // Traditional is ready now -> re-render so text updates from the Simplified fallback
  } catch {
    /* keep the Simplified fallback */
  }
}

// Preload the converter if we're starting in Traditional.
if (lang === 'zh-Hant') void loadS2T();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Subscribe a component to language changes; returns the current language. */
export function useLang(): Lang {
  return useSyncExternalStore(subscribe, getLang, getLang);
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

/**
 * Translate a Simplified-Chinese UI string to the current language.
 * `ctx` disambiguates homographs that share one Simplified source but need different English (e.g. the
 * calendar "日" is "Sun" as a weekday header but "Day" as a view toggle -> t('日', undefined, 'view')).
 * The Chinese output ignores ctx; only the English lookup uses the `zh@@ctx` key (falling back to `zh`).
 */
export function t(zh: string, vars?: Record<string, string | number>, ctx?: string): string {
  if (lang === 'en') {
    const key = ctx ? `${zh}@@${ctx}` : zh;
    return interpolate(EN[key] ?? EN[zh] ?? zh, vars);
  }
  if (lang === 'zh-Hant' && s2t) {
    return interpolate(s2t(zh), vars);
  }
  return interpolate(zh, vars);   // zh-Hans, or zh-Hant before OpenCC finishes loading
}

/**
 * Hook form for components: subscribes to language changes (so the component re-renders when the
 * language switches) and returns the `t` function. Usage: `const t = useT(); ... {t('设置')}`.
 */
export function useT(): typeof t {
  useLang();
  return t;
}
