// Languages available for live translation subtitles (source / target). Labels are Simplified source
// strings translated at render via t(). Distinct from the UI languages (i18n.ts).
export type TransLang = 'zh' | 'en' | 'fr' | 'de' | 'it' | 'ja' | 'ko';

export const TRANS_LANGS: { code: TransLang; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: '英语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'it', label: '意大利语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
];
