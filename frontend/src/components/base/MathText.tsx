import { useMemo } from 'react';
import katex from 'katex';

/**
 * 渲染可能含 LaTeX 数学公式的文本:
 * - 行内公式用 $...$ 包裹,独立公式用 $$...$$ 包裹,交给 KaTeX 渲染;
 * - 其余部分按纯文本处理(转义 HTML、保留换行)。
 * AI(考点/模拟卷/总结)按提示会把数学式写成 LaTeX;老数据没有 $ 就原样当纯文本显示,不会出错。
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
      // 未闭合的 $:当普通字符,前进一位,避免死循环
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
