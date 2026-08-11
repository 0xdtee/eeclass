// Recent user-facing updates, shown in the profile page's "更新日志". Newest first.
export interface Release {
  date: string;
  items: string[];
}

export const CHANGELOG: Release[] = [
  {
    date: '2026-08-11',
    items: [
      '新增「多语言」识别:可识别法/德/意/西/俄/日/韩等语言,并实时翻译成中/英等',
      '录音页新增翻译「原文 ⇄ 译文」选择,可一键交换方向',
      '日历支持逐级下钻:年 → 月 → 日,点课程进入课程详情',
    ],
  },
];
