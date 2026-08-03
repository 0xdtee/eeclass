/**
 * 应用设置(存 localStorage,本机记住)。主要是录音的默认项——
 * 录音控制栏每次打开时用这里的默认值初始化。
 */
export interface AppSettings {
  aiCorrect: boolean;                                  // 默认开 AI 实时纠错
  smartSeg: boolean;                                   // 默认开 AI 智能分句
  translateEn: boolean;                                // 默认开 英文自动翻中文字幕
  model: 'sensevoice' | 'paraformer' | 'stream';       // 默认识别模型
  sensitivity: 'std' | 'high' | 'max';                 // 默认拾音灵敏度
  device: 'auto' | 'browser' | 'browser-system';       // 默认音源
  toWord: boolean;                                     // 录制时同步写入 Word
  autoSummary: boolean;                                // 结束录制后自动生成概要
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
  return next;
}
