/**
 * 矢量 PDF:pdf-lib + 内嵌中文字体(HarmonyOS Sans SC Medium,已裁到 GB2312 ≈1.8MB)。
 * 文字锐利、可选中/搜索,任意长度都清晰,分页在行之间(不切断句子)。
 *
 * 注意:这里用 subset:false 整份嵌入字体,不用 pdf-lib 的 subset:true。
 * 因为 pdf-lib(@pdf-lib/fontkit)的子集器对本字体有 bug,会把大部分字形嵌成空白,
 * 只嵌完整字体才能正确出字。字体本身已裁到 GB2312,pdf-lib 会再做 Flate 压缩(≈1.27MB/份)。
 */
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PdfDoc } from './exportPdf';

const A4 = { w: 595.28, h: 841.89 };   // pt
const M = 42;                           // 页边距
const CW = A4.w - M * 2;                // 内容宽
const INDIGO = rgb(0.31, 0.27, 0.9);
const GRAY = rgb(0.6, 0.62, 0.66);
const DARK = rgb(0.11, 0.13, 0.16);
const MID = rgb(0.27, 0.3, 0.34);
const AMBER = rgb(0.6, 0.4, 0.05);
const RULE = rgb(0.9, 0.9, 0.92);

let fontBytesCache: ArrayBuffer | null = null;
async function loadFontBytes(): Promise<ArrayBuffer> {
  if (fontBytesCache) return fontBytesCache;
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');   // 去掉结尾斜杠,自己补一个,避免 /appcjk.ttf
  const r = await fetch(`${base}/cjk.ttf`);
  if (!r.ok) throw new Error('字体加载失败');
  fontBytesCache = await r.arrayBuffer();
  return fontBytesCache;
}

const parseCorr = (c: string): [string, string] | null => {
  const m = (c || '').match(/听成[\s"'“”「『]*(.+?)[\s"'“”」』]*应为[\s"'“”「『]*(.+?)(?:["'“”」』]|[，,。；;、]|$)/);
  if (!m) return null;
  const clean = (x: string) => x.trim().replace(/^[「『"'“”\s]+|[」』"'“”。，,、；;\s]+$/g, '').trim();
  const a = clean(m[1]), b = clean(m[2]);
  return a && b && a !== b ? [a, b] : null;
};

// 去掉字体里多半没有字形的字符(emoji/杂符/变体选择符),箭头转成 ->,避免 pdf-lib 报缺字形。
function safe(s: string): string {
  return String(s ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}\u{2190}-\u{21FF}]/gu, (m) => (m === '→' ? '->' : ''))
    .replace(/�/g, '');
}

interface Ctx { pdf: PDFDocument; page: PDFPage; y: number; font: PDFFont; }

function addPage(ctx: Ctx) {
  ctx.page = ctx.pdf.addPage([A4.w, A4.h]);
  ctx.y = A4.h - M;
}
function need(ctx: Ctx, h: number) {
  if (ctx.y - h < M) addPage(ctx);
}

// 按宽度把文本折行(中文按字符断行);\n 作为强制换行
function wrap(font: PDFFont, text: string, size: number, maxW: number): string[] {
  const out: string[] = [];
  for (const para of safe(text).split('\n')) {
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (line && font.widthOfTextAtSize(test, size) > maxW) {
        out.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

// 画一段(可折行、可跨页)文字;x 是相对左边距的缩进
function para(ctx: Ctx, text: string, size: number, color = DARK, indent = 0, gapAfter = 0) {
  const x = M + indent;
  const maxW = CW - indent;
  const lh = size * 1.55;
  for (const ln of wrap(ctx.font, text, size, maxW)) {
    need(ctx, lh);
    ctx.y -= lh;
    ctx.page.drawText(ln, { x, y: ctx.y, size, font: ctx.font, color });
  }
  ctx.y -= gapAfter;
}

function h2(ctx: Ctx, title: string) {
  ctx.y -= 14;
  need(ctx, 26);
  ctx.y -= 15;
  // 小色条
  ctx.page.drawRectangle({ x: M, y: ctx.y - 1, width: 3, height: 13, color: INDIGO });
  ctx.page.drawText(safe(title), { x: M + 9, y: ctx.y, size: 12.5, font: ctx.font, color: INDIGO });
  ctx.y -= 6;
}

function renderDoc(ctx: Ctx, doc: PdfDoc) {
  // 封面
  need(ctx, 40);
  ctx.y -= 22;
  ctx.page.drawText(safe(doc.title || '课程'), { x: M, y: ctx.y, size: 19, font: ctx.font, color: rgb(0.07, 0.09, 0.15) });
  if (doc.subtitle) { ctx.y -= 15; ctx.page.drawText(safe(doc.subtitle), { x: M, y: ctx.y, size: 9, font: ctx.font, color: GRAY }); }
  ctx.y -= 10;
  ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: A4.w - M, y: ctx.y }, thickness: 1, color: RULE });

  if (doc.summary && doc.summary.trim()) { h2(ctx, '课堂摘要'); para(ctx, doc.summary, 11, MID, 0, 4); }

  const kps = (doc.keyPoints ?? []).map((s) => (s ?? '').trim()).filter((s, i, a) => s && a.indexOf(s) === i);
  if (kps.length) { h2(ctx, '重点知识点'); kps.forEach((p, i) => para(ctx, `${i + 1}. ${p}`, 11, MID, 0, 3)); }

  const corr = (doc.corrections ?? []).map(parseCorr).filter(Boolean) as [string, string][];
  if (corr.length) { h2(ctx, '识别可能听错(仅供参考)'); corr.forEach(([a, b]) => para(ctx, `${a}  →  ${b}`, 10.5, AMBER, 0, 2)); }

  const lines = doc.lines ?? [];
  if (lines.length) {
    h2(ctx, '课堂转写全文');
    for (const l of lines) {
      // 元行:时间戳(灰)+ 说话人(靛蓝)
      need(ctx, 12);
      ctx.y -= 12;
      const ts = safe(l.ts || '');
      ctx.page.drawText(ts, { x: M, y: ctx.y, size: 8.5, font: ctx.font, color: GRAY });
      const tsW = ctx.font.widthOfTextAtSize(ts + '  ', 8.5);
      if (l.speaker) ctx.page.drawText(safe(l.speaker), { x: M + tsW, y: ctx.y, size: 8.5, font: ctx.font, color: INDIGO });
      ctx.y -= 2;
      // 正文(缩进折行)
      para(ctx, l.text || '', 10.5, DARK, 12, 4);
    }
  }

  // 页脚(当前页底部)
  ctx.page.drawText('由「课堂实时字幕」生成', { x: M, y: M - 18, size: 8, font: ctx.font, color: GRAY });
}

/** 生成一节课的矢量 PDF 字节。 */
export async function makeSessionPdf(doc: PdfDoc): Promise<Uint8Array> {
  const bytes = await loadFontBytes();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes, { subset: false });  // 整份嵌入:pdf-lib 子集器对本字体会出空字
  const ctx: Ctx = { pdf, page: pdf.addPage([A4.w, A4.h]), y: A4.h - M, font };
  renderDoc(ctx, doc);
  return pdf.save();
}
