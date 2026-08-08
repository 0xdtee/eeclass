/**
 * Export PDF —— directly generates a .pdf file for download (no print dialog).
 *
 * How: render the content into an offscreen div, capture it as an image with html2canvas, then
 * assemble an A4-paginated PDF with jsPDF and save() to download. Chinese is rendered to an image via
 * system fonts, displays fine, and needs no embedded multi-MB Chinese font.
 * Trade-off: text in the PDF is an image and not selectable; in return you get "one-click download" and cross-platform consistency.
 * (jspdf / html2canvas are dynamically imported and bundled separately, so they don't bloat the main bundle.)
 */

export interface PdfLine {
  ts: string;
  speaker: string;
  text: string;
  kind?: 'key' | 'define' | null;
}

export interface PdfDoc {
  title: string;
  subtitle?: string;
  summary?: string;
  keyPoints?: string[];
  corrections?: string[];
  lines?: PdfLine[];
}

const esc = (s: string) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const parseCorr = (c: string): [string, string] | null => {
  const m = (c || '').match(/听成[\s"'“”「『]*(.+?)[\s"'“”」』]*应为[\s"'“”「『]*(.+?)(?:["'“”」』]|[，,。；;、]|$)/);
  if (!m) return null;
  const clean = (x: string) => x.trim().replace(/^[「『"'“”\s]+|[」』"'“”。，,、；;\s]+$/g, '').trim();
  const a = clean(m[1]), b = clean(m[2]);
  return a && b && a !== b ? [a, b] : null;
};

const PDF_STYLE = `<style>
    /* 极简干净:白底、黑字、细灰分隔线,一点靛蓝做强调。无色块/卡片/横幅。 */
    .pdfroot { font-family:"PingFang SC","Microsoft YaHei","Hiragino Sans GB",sans-serif; color:#1f2937; font-size:14px; line-height:1.9; padding:46px 50px; background:#fff; }
    .pdfroot .cover { padding-bottom:14px; margin-bottom:26px; border-bottom:1px solid #e5e7eb; }
    .pdfroot h1 { font-size:23px; margin:0; color:#111827; font-weight:700; letter-spacing:.3px; }
    .pdfroot .sub { color:#9ca3af; font-size:12px; margin:8px 0 0; }
    .pdfroot h2 { font-size:15px; margin:30px 0 13px; color:#111827; font-weight:700; }
    .pdfroot h2:before { content:""; display:inline-block; width:3px; height:14px; background:#4f46e5; vertical-align:-2px; margin-right:9px; }
    .pdfroot .summary { color:#374151; line-height:2; padding-left:14px; border-left:2px solid #eceef2; }
    .pdfroot .kp { margin:8px 0; line-height:1.85; color:#374151; }
    .pdfroot .kpn { color:#4f46e5; font-weight:700; margin-right:7px; }
    .pdfroot .kpt { color:#374151; }
    .pdfroot .corr { padding:0; }
    .pdfroot .corr h2 { color:#111827; }
    .pdfroot .ci { margin:5px 0; font-size:13px; color:#6b7280; }
    .pdfroot .cx { text-decoration:line-through; color:#9ca3af; }
    .pdfroot .ca { color:#c4c7cc; margin:0 7px; }
    .pdfroot .cy { color:#374151; font-weight:600; }
    .pdfroot .ln { margin:0; padding:6px 0; border-bottom:1px solid #f3f4f6; }
    .pdfroot .meta { color:#9ca3af; font-size:11px; margin-right:8px; font-family:monospace; }
    .pdfroot .spk { color:#4f46e5; font-size:11px; font-weight:700; margin-right:8px; }
    .pdfroot .txt { color:#1f2937; }
    .pdfroot .foot { margin-top:34px; padding-top:11px; border-top:1px solid #e5e7eb; color:#9ca3af; font-size:10px; text-align:center; }
    .pdfroot .divider { border-top:1px solid #e5e7eb; margin:32px 0 8px; }
  </style>`;

/** Body of a single class (without the style / pdfroot wrapper), for single/batch assembly. */
function docBody(doc: PdfDoc): string {
  // html2canvas fills inline backgrounds by line-height, so highlights use inline-block + tight line-height to hug the text.
  const kindStyle: Record<string, string> = {
    key: 'display:inline-block;line-height:1.2;padding:0 2px;border-radius:2px;background:#fef08a;',
    define: 'display:inline-block;line-height:1.2;padding:0 2px;border-radius:2px;background:#bbf7d0;',
  };
  const lines = (doc.lines ?? [])
    .map(
      (l) =>
        `<div class="ln"><span class="meta">${esc(l.ts)}</span>` +
        `<span class="spk">${esc(l.speaker)}</span>` +
        `<span class="txt" style="${kindStyle[l.kind ?? ''] ?? ''}">${esc(l.text)}</span></div>`
    )
    .join('');
  // Deduplicate (the AI sometimes returns repeated points), then number plainly with "N."
  const seenKp = new Set<string>();
  const points = (doc.keyPoints ?? [])
    .map((p) => (p ?? '').trim())
    .filter((p) => p && !seenKp.has(p) && (seenKp.add(p), true))
    .map((p, i) => `<div class="kp"><span class="kpn">${i + 1}.</span><span class="kpt">${esc(p)}</span></div>`)
    .join('');
  const corr = (doc.corrections ?? [])
    .map(parseCorr)
    .filter(Boolean)
    .map((pair) => {
      const [a, b] = pair as [string, string];
      return `<div class="ci"><span class="cx">${esc(a)}</span><span class="ca">&rarr;</span><span class="cy">${esc(b)}</span></div>`;
    })
    .join('');

  return `<div class="cover">
      <h1>${esc(doc.title)}</h1>
      ${doc.subtitle ? `<p class="sub">${esc(doc.subtitle)}</p>` : ''}
    </div>
    ${doc.summary ? `<h2>课堂摘要</h2><div class="summary">${esc(doc.summary)}</div>` : ''}
    ${points ? `<h2>重点知识点</h2>${points}` : ''}
    ${corr ? `<div class="corr"><h2>识别可能听错(仅供参考)</h2>${corr}</div>` : ''}
    ${lines ? `<h2>课堂转写全文</h2>${lines}` : ''}`;
}

function contentHtml(doc: PdfDoc): string {
  return `${PDF_STYLE}<div class="pdfroot">${docBody(doc)}<div class="foot">由「课堂实时字幕」自动生成</div></div>`;
}

/** Batch: one PDF per class, packaged into a zip for download (no longer merged into one). */
export async function exportPdfBatch(docs: PdfDoc[], title = '批量导出'): Promise<void> {
  if (!docs.length) return;
  if (docs.length === 1) return exportPdf(docs[0]);   // Just one class: download the PDF directly, no zip
  const [{ default: JSZip }, { makeSessionPdf }] = await Promise.all([import('jszip'), import('./vectorPdf')]);
  const zip = new JSZip();
  const used = new Set<string>();
  for (const doc of docs) {
    const bytes = await makeSessionPdf(doc);   // Vector PDF
    const base = (doc.title || '课程').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '课程';
    let name = base, k = 2;
    while (used.has(name)) name = `${base}(${k++})`;   // Avoid name collisions
    used.add(name);
    zip.file(`${name}.pdf`, bytes);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(title || '批量导出').replace(/[\\/:*?"<>|]/g, '_')}.zip`;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Delayed revoke: revoking immediately after the click makes some browsers (especially Safari) cancel the download
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** Core: render a piece of (inline-styled) HTML into a jsPDF object inside an isolated iframe (multi-page A4).
 * Short docs render as one image at scale 3; very long docs render page by page at high resolution (each capture is one page tall), all crisp and none clipped. */
async function buildPdf(innerHtml: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  // Isolated iframe: doesn't load the app's Tailwind, avoiding oklch() crashing html2canvas.
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;left:-99999px;top:0;width:794px;height:10px;border:0';
  document.body.appendChild(iframe);
  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw new Error('无法创建导出画布');
    idoc.open();
    idoc.write('<!doctype html><html><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;background:#fff;">' + innerHtml + '</body></html>');
    idoc.close();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));

    const contentH = idoc.body.scrollHeight || 1000;
    // Whole-image render: short docs are crisp at scale 3; the taller the content the lower the scale, clamping the canvas within the browser's limit (avoids blanks/hangs).
    const render = (cap: number) => {
      const scale = Math.min(3, cap / contentH);
      return html2canvas(idoc.body, { scale, backgroundColor: '#ffffff', useCORS: true, width: 794, windowWidth: 794 });
    };
    let canvas = await render(16000);          // Aim for the crispest first
    if (!canvas.height) canvas = await render(8000);   // Over the browser canvas limit: retry at lower quality instead of hanging
    if (!canvas.height) throw new Error('渲染失败,内容可能过大——请少选几节');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const imgW = pageW - margin * 2;
    const usableH = pageH - margin * 2;                 // Content height per page, in mm
    const cw = canvas.width;
    const usedScale = cw / 794;                         // The scale actually used
    const pxPerMmCss = 794 / imgW;                      // CSS px / mm
    const pageMaxCss = usableH * pxPerMmCss;            // Max CSS px height that fits on one page

    // Collect "safe break points" (bottom edge of each block element, CSS px) — only break pages between sentences/blocks, never mid-sentence.
    const bt = idoc.body.getBoundingClientRect().top;
    const pts = new Set<number>([0, contentH]);
    idoc.body.querySelectorAll('.cover, h2, .summary, .kp, .corr, .ci, .ln, .foot, .divider').forEach((el) => {
      pts.add(Math.round((el as HTMLElement).getBoundingClientRect().bottom - bt));
    });
    const breaks = [...pts].filter((v) => v >= 0 && v <= contentH).sort((a, b) => a - b);

    const tmp = document.createElement('canvas');
    const ctx = tmp.getContext('2d');
    let yCss = 0, first = true;
    while (yCss < contentH - 1) {
      const limit = yCss + pageMaxCss;
      // Place this page at the last break point within (yCss, limit]; only hard-cut at limit when a block is taller than a page.
      let end = 0;
      for (const p of breaks) { if (p > yCss + 4 && p <= limit) end = p; }
      if (!end) end = Math.min(limit, contentH);
      const sy = Math.round(yCss * usedScale);
      const sh = Math.max(1, Math.round(end * usedScale) - sy);
      tmp.width = cw;
      tmp.height = sh;
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, cw, sh);
        ctx.drawImage(canvas, 0, sy, cw, sh, 0, 0, cw, sh);
      }
      const img = tmp.toDataURL('image/png');
      const hmm = (end - yCss) / pxPerMmCss;
      if (!first) pdf.addPage();
      pdf.addImage(img, 'PNG', margin, margin, imgW, hmm, undefined, 'FAST');
      first = false;
      yCss = end;
    }
    return pdf;
  } finally {
    if (iframe.parentNode) document.body.removeChild(iframe);
  }
}

/** Render and download the PDF. */
export async function renderPdf(title: string, innerHtml: string): Promise<void> {
  const pdf = await buildPdf(innerHtml);
  pdf.save(`${(title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.pdf`);
}

/** Render to a PDF Blob (for inline in-page preview, no download). */
export async function buildPdfBlob(innerHtml: string): Promise<Blob> {
  const pdf = await buildPdf(innerHtml);
  return pdf.output('blob') as Blob;
}

export async function exportPdf(doc: PdfDoc): Promise<void> {
  const { makeSessionPdf } = await import('./vectorPdf');
  const bytes = await makeSessionPdf(doc);   // Vector PDF (crisp, selectable)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(doc.title || '课程').replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
