/**
 * Small utility for auto-tagging courses on import: normalize the course name + find a similar existing tag.
 * The normalization approach matches dashboard's baseName (strip "Lecture/Class/Session N" and "parenthesized numbers"),
 * then additionally strips parenthesized content, trailing A/B/C, 甲/乙, Roman/Chinese numerals, and other section/volume markers.
 */
import type { Tag } from '@/hooks/useTagsStore';

export function normalizeCourse(name: string): string {
  return (name || '')
    .toLowerCase()
    .trim()
    .replace(/\s*第\s*\d+\s*[讲课节]\s*$/g, '')       // Trailing "Lecture/Class/Session N"
    .replace(/[（(][^）)]*[）)]/g, '')                 // Parentheses and their content (full/half-width)
    .replace(/\s*[（(]\s*\d+\s*[）)]\s*$/g, '')        // Trailing parenthesized number (fallback)
    .replace(/\s*[abcⅰⅱⅲⅳⅴ甲乙一二三四五]\s*$/g, '')   // Trailing section/volume markers
    .replace(/\s+/g, '')                              // Remove all whitespace
    .trim();
}

/**
 * Returns an existing tag similar to the course name: exactly equal after normalization,
 * or one contains the other and the contained string's length is ≥ 2 (case-insensitive). Returns null if none found.
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
