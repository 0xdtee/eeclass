/**
 * App settings. Now tied to the account and stored on the server (/api/settings); localStorage is only a local cache,
 * ensuring synchronous reads (loadSettings) stay unchanged. The recording control bar initializes from the defaults here.
 */
import { SERVICE_ORIGIN, getToken } from '@/hooks/useLiveCaption';
import type { TransLang } from '@/lib/translateLangs';

export interface AppSettings {
  aiCorrect: boolean;                                  // AI real-time correction on by default
  smartSeg: boolean;                                   // AI smart sentence segmentation on by default
  translateFrom: TransLang;                            // Live translation: source language (原文). Off when from === to.
  translateTo: TransLang;                              // Live translation: target language (译文). Default follows the UI language.
  model: 'sensevoice' | 'paraformer' | 'stream' | 'shanghainese' | 'aliyun' | 'aliyun_wu' | 'aliyun_multi';   // Default recognition model
  sensitivity: 'std' | 'high' | 'max';                 // Default pickup sensitivity
  device: 'auto' | 'browser' | 'browser-system';       // Default audio source
  toWord: boolean;                                     // Write to Word while recording
  autoSummary: boolean;                                // Auto-generate a summary after recording ends
  /** How class material is folded into the summary: 'manual' asks you to pick files after recording,
   *  'auto' silently matches the hidden knowledge index against the transcript. */
  materialMode: 'manual' | 'auto';
  /** Calendar course colors: 'course' gives each course its own color, 'credits' shades by credit value. */
  calendarColor: 'course' | 'credits';
  importTagSimilar: boolean;                           // On course import: assign similar ones to existing tags
  importTagNew: boolean;                               // On course import: create a new tag when none is similar
}

export const DEFAULT_SETTINGS: AppSettings = {
  aiCorrect: false,
  smartSeg: true,
  // Translation off by default (from === to means off). Most classes are taught in one language, and the
  // extra subtitle line only gets in the way until someone asks for it.
  translateFrom: 'zh',
  translateTo: 'zh',
  model: 'aliyun',   // Default to the cloud Mandarin/English model (regular users only get cloud models)
  sensitivity: 'high',
  device: 'auto',
  toWord: false,
  autoSummary: true,
  materialMode: 'manual',
  calendarColor: 'course',
  importTagSimilar: true,
  importTagNew: true,
};

const KEY = 'lc_settings_v1';

const TRANS_OFF_MIGRATION = 'lc_trans_off_v2';

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const s = JSON.parse(raw) as Partial<AppSettings>;
    // Translation used to default to on (en -> zh). Turn it off once on devices carrying that old default;
    // anything chosen after this migration is kept.
    if (localStorage.getItem(TRANS_OFF_MIGRATION) !== '1') {
      localStorage.setItem(TRANS_OFF_MIGRATION, '1');
      s.translateFrom = 'zh';
      s.translateTo = 'zh';
      try { localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS, ...s })); } catch { /* ignore */ }
    }
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
    /* If localStorage is full/disabled, never mind */
  }
  pushSettings();   // Sync to the server (per account)
  return next;
}

// ── Server sync (per account) ──────────────────────────────────────────
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

/** On login/account switch: first reset to defaults, then fetch this account's settings from the server. */
export async function hydrateSettingsFromServer() {
  const t = getToken();
  if (!t || t === lastToken) return;
  lastToken = t;
  localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS }));   // Clear the previous account's first
  try {
    const r = await fetch(SERVICE_ORIGIN + '/api/settings', { headers: { 'X-Token': t } });
    if (!r.ok) return;
    const j = await r.json();
    if (j.settings && typeof j.settings === 'object') {
      const incoming = { ...DEFAULT_SETTINGS, ...j.settings } as AppSettings;
      // The account may still carry the old "translate by default" pair; turn it off once, per account,
      // and push the correction back so it sticks across devices.
      const doneKey = TRANS_OFF_MIGRATION + ':' + getToken().slice(0, 12);
      if (localStorage.getItem(doneKey) !== '1') {
        localStorage.setItem(doneKey, '1');
        incoming.translateFrom = 'zh';
        incoming.translateTo = 'zh';
        localStorage.setItem(KEY, JSON.stringify(incoming));
        pushSettings();
        return;
      }
      localStorage.setItem(KEY, JSON.stringify(incoming));
    } else {
      pushSettings();   // This account has none yet → use defaults and store a baseline
    }
  } catch {
    // Network issue: keep defaults
  }
}

/** On logout: clear the local settings cache and reset. */
export function clearSettingsForLogout() {
  lastToken = '';
  localStorage.setItem(KEY, JSON.stringify({ ...DEFAULT_SETTINGS }));
}
