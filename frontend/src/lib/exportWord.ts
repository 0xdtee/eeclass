/**
 * Export a Word document (.doc) — text is editable, Chinese renders fine, no third-party library needed.
 * Uses inline styles that Word renders correctly + cell tables to build the cover, section headings, numbered cards, and color-block highlights.
 */

export interface WordLine {
  ts: string;
  speaker: string;
  text: string;
  kind?: 'key' | 'define' | null;
}

export interface WordDoc {
  title: string;
  subtitle?: string;
  summary?: string;
  keyPoints?: string[];
  corrections?: string[];
  lines?: WordLine[];
}

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const ACCENT = '#4f46e5';   // Indigo
const parseCorr = (c: string): [string, string] | null => {
  const m = (c || '').match(/听成[\s"'“”「『]*(.+?)[\s"'“”」』]*应为[\s"'“”「『]*(.+?)(?:["'“”」』]|[，,。；;、]|$)/);
  if (!m) return null;
  const clean = (x: string) => x.trim().replace(/^[「『"'“”\s]+|[」』"'“”。，,、；;\s]+$/g, '').trim();
  const a = clean(m[1]), b = clean(m[2]);
  return a && b && a !== b ? [a, b] : null;
};

/** Section heading: left color bar + title */
function section(title: string): string {
  return `<p style="margin:22pt 0 8pt;padding-left:10px;border-left:4px solid ${ACCENT};font-size:14pt;font-weight:bold;color:#1f2937;">${esc(title)}</p>`;
}

function bodyHtml(doc: WordDoc): string {
  let h = '';

  // Cover header: title + subtitle, with an accent divider line at the bottom
  h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
    <tr><td style="border-bottom:2.5px solid ${ACCENT};padding-bottom:8pt;">
      <p style="margin:0;font-size:22pt;font-weight:bold;color:#111827;letter-spacing:0.5px;">${esc(doc.title)}</p>
      ${doc.subtitle ? `<p style="margin:6pt 0 0;font-size:10pt;color:#6b7280;">${esc(doc.subtitle)}</p>` : ''}
    </td></tr></table>`;

  // Class summary: light-gray background block (using a cell table, since only then does Word honor padding+background)
  if (doc.summary) {
    h += section('课堂摘要');
    h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr><td style="background:#f5f6ff;border:1px solid #e0e2f5;padding:12pt 14pt;">
        <p style="margin:0;font-size:11.5pt;line-height:1.9;color:#374151;">${esc(doc.summary)}</p>
      </td></tr></table>`;
  }

  // Key knowledge points: numbered dot + content, one card each
  const pts = doc.keyPoints ?? [];
  if (pts.length) {
    h += section('重点知识点');
    pts.forEach((p, i) => {
      h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-bottom:6pt;">
        <tr>
          <td width="26" valign="top" style="padding:6pt 0;">
            <table cellspacing="0" cellpadding="0"><tr><td align="center" valign="middle"
              style="width:20px;height:20px;background:${ACCENT};color:#ffffff;font-size:10pt;font-weight:bold;border-radius:10px;">${i + 1}</td></tr></table>
          </td>
          <td valign="top" style="padding:6pt 0 6pt 8pt;font-size:11pt;line-height:1.7;color:#374151;">${esc(p)}</td>
        </tr></table>`;
    });
  }

  // Possibly misheard by recognition: amber block, X → Y
  const corr = (doc.corrections ?? []).map(parseCorr).filter(Boolean) as [string, string][];
  if (corr.length) {
    h += section('识别可能听错(仅供参考)');
    h += `<table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">
      <tr><td style="background:#fffbeb;border:1px solid #fde68a;padding:10pt 14pt;">`;
    corr.forEach(([a, b]) => {
      h += `<p style="margin:3pt 0;font-size:10.5pt;color:#92400e;">
        <span style="text-decoration:line-through;color:#b45309;">${esc(a)}</span>
        &nbsp;→&nbsp;<b>${esc(b)}</b></p>`;
    });
    h += `</td></tr></table>`;
  }

  // Full class transcript: timestamp (gray) + speaker (accent) + content, with a background color on key/definition sentences
  const lines = doc.lines ?? [];
  if (lines.length) {
    h += section('课堂转写全文');
    const bg: Record<string, string> = { key: 'background:#fef9c3;', define: 'background:#dcfce7;' };
    lines.forEach((l) => {
      const hl = bg[l.kind ?? ''] ?? '';
      h += `<p style="margin:0 0 5pt;font-size:11pt;line-height:1.75;">
        <span style="color:#9ca3af;font-size:9pt;">${esc(l.ts)}</span>
        <span style="color:${ACCENT};font-weight:bold;font-size:9.5pt;">&nbsp;${esc(l.speaker)}&nbsp;</span>
        <span style="color:#1f2937;${hl}">${esc(l.text)}</span></p>`;
    });
  }

  // Footer
  h += `<p style="margin-top:26pt;padding-top:8pt;border-top:1px solid #e5e7eb;font-size:8.5pt;color:#9ca3af;text-align:center;">
    由「课堂实时字幕」自动生成</p>`;
  return h;
}

export async function exportWord(doc: WordDoc): Promise<void> {
  const html =
    `<html xmlns:o="urn:schemas-microsoft-com:office:office" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">` +
    `<head><meta charset="utf-8"><title>${esc(doc.title)}</title>` +
    `<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View>` +
    `<w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->` +
    `<style>@page WordSection1 { size:21cm 29.7cm; margin:2.2cm 2cm; }
      div.WordSection1 { page:WordSection1; }
      body { font-family:"PingFang SC","Microsoft YaHei",sans-serif; color:#1f2937; }
      p { mso-line-height-rule:exactly; }
    </style></head><body><div class="WordSection1">${bodyHtml(doc)}</div></body></html>`;

  const blob = new Blob(['﻿', html], { type: 'application/msword;charset=utf-8' });
  const name = (doc.title || '课程').replace(/[\\/:*?"<>|]/g, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}
