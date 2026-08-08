import { useMemo } from 'react';
import katex from 'katex';

/**
 * Renders text that may contain LaTeX math formulas:
 * - Inline formulas wrapped in $...$, display formulas in $$...$$, rendered via KaTeX;
 * - Everything else is treated as plain text (HTML escaped, line breaks preserved).
 * The AI (exam points/mock papers/summaries) writes math as LaTeX per its prompt; old data without $ is shown as-is as plain text, without errors.
 */
export default function MathText({ text, className }: { text?: string; className?: string }) {
  const html = useMemo(() => renderMath(text || ''), [text]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderMath(s: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === '$') {
      const block = s[i + 1] === '$';
      const delim = block ? '$$' : '$';
      const end = s.indexOf(delim, i + delim.length);
      if (end !== -1) {
        const tex = s.slice(i + delim.length, end);
        try {
          out.push(katex.renderToString(tex, { throwOnError: false, displayMode: block }));
        } catch {
          out.push(esc(delim + tex + delim));
        }
        i = end + delim.length;
        continue;
      }
      // Unclosed $: treat as a normal character, advance one position to avoid an infinite loop
      out.push('$');
      i += 1;
      continue;
    }
    const next = s.indexOf('$', i);
    const chunk = next === -1 ? s.slice(i) : s.slice(i, next);
    out.push(esc(chunk).replace(/\n/g, '<br/>'));
    i = next === -1 ? s.length : next;
  }
  return out.join('');
}
