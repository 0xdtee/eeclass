// Recent user-facing updates, shown in the "更新日志" (changelog) on the home page. Newest first.
// Item strings are Simplified source strings translated at render via t() (add English in i18n.en.ts).
// Bump the top date whenever you add a release — the home button shows an "unseen" dot until it's opened.
export interface Release {
  date: string;      // YYYY-MM-DD
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    date: '2026-08-10',
    items: [
      '新增「多语言」识别:可识别法语、德语、意大利语、西班牙语、俄语、日语、韩语等,并实时翻译成中文/英文等',
      '翻译改为「原文 ⇄ 译文」下拉:左边选说的语言,右边选译成的语言,可一键交换',
      '多语言识别改为持续流式:出字更快、断句更自然、说话人区分更准',
      '修复「系统声音」采集:共享后不再中断,可正常识别(macOS 上采集浏览器标签页声音)',
    ],
  },
  {
    date: '2026-08-06',
    items: [
      '翻译新增法语、德语、意大利语、日语、韩语',
      '「导出 Word」改为生成真正的 .docx 文档',
      'AI 摘要按当前界面语言输出',
      '「上海话」选项改为「方言」,支持粤/吴/闽/客/川等多种方言,并可润色成规范普通话',
    ],
  },
];

/** The newest release date — used to show/clear the "unseen updates" dot. */
export const LATEST_CHANGELOG = CHANGELOG[0]?.date ?? '';
