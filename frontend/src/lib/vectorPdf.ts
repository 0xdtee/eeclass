/**
 * Vector PDF: pdf-lib + an embedded CJK font (HarmonyOS Sans SC Medium).
 * Text is crisp, selectable and searchable at any length; page breaks fall
 * between lines so sentences are never cut in half.
 *
 * We ship the full (un-resubsetted) font and let pdf-lib subset it (subset:true).
 * Two pdf-lib bugs forced this combination:
 *   - subset:true on a font we pre-subset with fontTools/hb-subset renders most
 *     glyphs blank (its fontkit subsetter mishandles re-subsetted glyf tables).
 *   - subset:false emits wrong CID widths for some narrow glyphs (e.g. the colon
 *     renders full-width), which pushed the speaker name on top of the timestamp.
 * Only "pristine font + subset:true" renders both glyphs and widths correctly.
 * pdf-lib embeds just the used glyphs, so each output PDF stays tiny.
 */
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import type { PdfDoc } from './exportPdf';
import { latexToPlain } from './mathText';

const A4 = { w: 595.28, h: 841.89 };   // pt
const M = 54;                           // roomier page margin
const CW = A4.w - M * 2;                // content width
const INDIGO = rgb(0.059, 0.58, 0.518); // teal brand accent (#0f9484), matches the app
const GRAY = rgb(0.55, 0.58, 0.63);
const DARK = rgb(0.10, 0.12, 0.16);     // near-black body text (crisper than a mid gray)
const MID = rgb(0.20, 0.23, 0.28);      // slightly softer, still high-contrast
const AMBER = rgb(0.6, 0.4, 0.05);
const RULE = rgb(0.87, 0.88, 0.90);

let fontBytesCache: ArrayBuffer | null = null;
async function loadFontBytes(): Promise<ArrayBuffer> {
  if (fontBytesCache) return fontBytesCache;
  const base = import.meta.env.BASE_URL.replace(/\/+$/, '');   // strip trailing slash, add our own, so we never build /appcjk.ttf
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

// Drop characters the font likely has no glyph for (emoji / misc symbols / variation
// selectors); convert arrows to "->". Avoids pdf-lib throwing on a missing glyph.
function safe(s: string): string {
  return String(s ?? '')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE00}-\u{FE0F}\u{200D}]/gu, '')
    // the font has → and ← (keep them); map the double arrows; drop the rest of the arrow block
    .replace(/[←-⇿]/g, (m) => (m === '→' || m === '←' ? m : m === '⇒' ? '=>' : m === '⇔' ? '<=>' : ''))
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

// Wrap text to a max width (CJK breaks per character); "\n" is a hard line break.
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

// Draw a paragraph (wraps, may span pages); x is the indent relative to the left margin.
function para(ctx: Ctx, text: string, size: number, color = DARK, indent = 0, gapAfter = 0) {
  const x = M + indent;
  const maxW = CW - indent;
  const lh = size * 1.68;   // airier leading -> easier to read
  for (const ln of wrap(ctx.font, text, size, maxW)) {
    need(ctx, lh);
    ctx.y -= lh;
    ctx.page.drawText(ln, { x, y: ctx.y, size, font: ctx.font, color });
  }
  ctx.y -= gapAfter;
}

function h2(ctx: Ctx, title: string) {
  ctx.y -= 24;                       // generous space above each section
  need(ctx, 40);
  ctx.y -= 17;
  // accent bar + heading
  ctx.page.drawRectangle({ x: M, y: ctx.y - 2, width: 4, height: 17, color: INDIGO });
  ctx.page.drawText(safe(title), { x: M + 12, y: ctx.y, size: 15, font: ctx.font, color: DARK });
  // hairline rule under the heading, full content width
  ctx.y -= 9;
  ctx.page.drawLine({ start: { x: M, y: ctx.y }, end: { x: A4.w - M, y: ctx.y }, thickness: 0.75, color: RULE });
  ctx.y -= 8;
}

// A numbered item with the leading "N." drawn in the accent color, and the body given a hanging indent
// so wrapped lines align under the text (not under the number).
function numItem(ctx: Ctx, n: number, text: string, size = 12.5, color = DARK, gapAfter = 6) {
  const label = `${n}.`;
  const labelW = ctx.font.widthOfTextAtSize(label + ' ', size);
  const lh = size * 1.68;
  const lines = wrap(ctx.font, text, size, CW - labelW);
  lines.forEach((ln, i) => {
    need(ctx, lh);
    ctx.y -= lh;
    if (i === 0) ctx.page.drawText(label, { x: M, y: ctx.y, size, font: ctx.font, color: INDIGO });
    ctx.page.drawText(ln, { x: M + labelW, y: ctx.y, size, font: ctx.font, color });
  });
  ctx.y -= gapAfter;
}

function renderDoc(ctx: Ctx, doc: PdfDoc) {
  // ---- cover ----
  need(ctx, 60);
  ctx.y -= 30;
  ctx.page.drawText(safe(doc.title || '课程'), { x: M, y: ctx.y, size: 25, font: ctx.font, color: rgb(0.06, 0.08, 0.12) });
  if (doc.subtitle) { ctx.y -= 19; ctx.page.drawText(safe(doc.subtitle), { x: M, y: ctx.y, size: 11, font: ctx.font, color: GRAY }); }
  ctx.y -= 16;
  ctx.page.drawRectangle({ x: M, y: ctx.y, width: 46, height: 3, color: INDIGO });   // short teal underline
  ctx.y -= 4;

  if (doc.summary && doc.summary.trim()) { h2(ctx, '课堂摘要'); para(ctx, doc.summary, 12.5, MID, 0, 4); }

  const kps = (doc.keyPoints ?? []).map((s) => (s ?? '').trim()).filter((s, i, a) => s && a.indexOf(s) === i);
  if (kps.length) { h2(ctx, '重点知识点'); kps.forEach((p, i) => numItem(ctx, i + 1, p, 12.5, DARK, 6)); }

  const qs = doc.questions ?? [];
  if (qs.length) {
    h2(ctx, '模拟试卷');
    qs.forEach((q, i) => numItem(ctx, i + 1, `${q.type ? `[${q.type}] ` : ''}${latexToPlain(q.question)}`, 12.5, DARK, 15));
    h2(ctx, '参考答案');
    qs.forEach((q, i) => numItem(ctx, i + 1, `${latexToPlain(q.answer)}${q.point ? `  (考点:${latexToPlain(q.point)})` : ''}`, 12, MID, 9));
  }

  const corr = (doc.corrections ?? []).map(parseCorr).filter(Boolean) as [string, string][];
  if (corr.length) { h2(ctx, '识别可能听错(仅供参考)'); corr.forEach(([a, b]) => para(ctx, `${a}   →   ${b}`, 11.5, AMBER, 0, 3)); }

  const lines = doc.lines ?? [];
  if (lines.length) {
    h2(ctx, '课堂转写全文');
    for (const l of lines) {
      // meta row: timestamp (gray) + speaker (accent)
      need(ctx, 16);
      ctx.y -= 15;
      const ts = safe(l.ts || '');
      ctx.page.drawText(ts, { x: M, y: ctx.y, size: 9.5, font: ctx.font, color: GRAY });
      const tsW = ctx.font.widthOfTextAtSize(ts + '  ', 9.5);
      if (l.speaker) ctx.page.drawText(safe(l.speaker), { x: M + tsW, y: ctx.y, size: 9.5, font: ctx.font, color: INDIGO });
      ctx.y -= 3;
      // body (indented, wraps)
      para(ctx, l.text || '', 11.5, DARK, 14, 6);
    }
  }
}

/** Build the vector PDF bytes for one session. */
export async function makeSessionPdf(doc: PdfDoc): Promise<Uint8Array> {
  const bytes = await loadFontBytes();
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes, { subset: true });   // subset:true on the pristine font: correct glyphs + widths, tiny output
  const ctx: Ctx = { pdf, page: pdf.addPage([A4.w, A4.h]), y: A4.h - M, font };
  renderDoc(ctx, doc);
  // footer on every page: a thin rule, the generator credit, and a page number
  const pages = pdf.getPages();
  pages.forEach((page, i) => {
    const fy = M - 24;
    page.drawLine({ start: { x: M, y: fy + 12 }, end: { x: A4.w - M, y: fy + 12 }, thickness: 0.5, color: RULE });
    page.drawText('由「课堂实时字幕」生成', { x: M, y: fy, size: 8.5, font, color: GRAY });
    const pn = `${i + 1} / ${pages.length}`;
    const pnW = font.widthOfTextAtSize(pn, 8.5);
    page.drawText(pn, { x: A4.w - M - pnW, y: fy, size: 8.5, font, color: GRAY });
  });
  return pdf.save();
}
