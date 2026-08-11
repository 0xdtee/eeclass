// Languages available for live translation subtitles (source / target). Off when source === target.
export type TransLang = 'zh' | 'en' | 'fr' | 'de' | 'it' | 'es' | 'ru' | 'ja' | 'ko';

export const TRANS_LANGS: { code: TransLang; label: string }[] = [
  { code: 'zh', label: '中文' },
  { code: 'en', label: '英语' },
  { code: 'fr', label: '法语' },
  { code: 'de', label: '德语' },
  { code: 'it', label: '意大利语' },
  { code: 'es', label: '西班牙语' },
  { code: 'ru', label: '俄语' },
  { code: 'ja', label: '日语' },
  { code: 'ko', label: '韩语' },
];
