/**
 * 导入课程自动打标签用的小工具:课程名归一化 + 找相似的已有标签。
 * 归一化思路和 dashboard 的 baseName 一致(去掉「第N讲/课/节」「括号编号」),
 * 再多去掉括号内容、结尾的 A/B/C、甲/乙、罗马/中文数字等分班/分册标记。
 */
import type { Tag } from '@/hooks/useTagsStore';

export function normalizeCourse(name: string): string {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/\s*第\s*\d+\s*[讲课节]\s*$/g, '')       // 结尾「第N讲/课/节」
    .replace(/[（(][^）)]*[）)]/g, '')                 // 括号及其内容(全/半角)
    .replace(/\s*[（(]\s*\d+\s*[）)]\s*$/g, '')        // 结尾括号编号(兜底)
    .replace(/\s*[abcⅰⅱⅲⅳⅴ甲乙一二三四五]\s*$/g, '')   // 结尾分班/分册标记
    .replace(/\s+/g, '')                              // 去掉所有空格
    .trim();
}

/**
 * 返回与课程名相似的已有标签:归一化后完全相等,
 * 或一方包含另一方且被包含串长度 ≥ 2(不区分大小写)。找不到返回 null。
 */
export function findSimilarTag(courseName: string, tags: Tag[]): Tag | null {
  const c = normalizeCourse(courseName);
  if (!c) return null;
  for (const t of tags) {
    const l = normalizeCourse(t.label);
    if (!l) continue;
    if (l === c) return t;
    if (l.includes(c) && c.length >= 2) return t;
    if (c.includes(l) && l.length >= 2) return t;
  }
  return null;
}
