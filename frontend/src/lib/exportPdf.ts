/**
 * 导出 PDF —— 直接生成 .pdf 文件下载(不弹打印对话框)。
 *
 * 做法:把内容渲染到一个离屏 div,用 html2canvas 截成图,再用 jsPDF 按 A4 分页拼成
 * PDF 并 save() 下载。中文用系统字体渲染成图,显示正常,无需内嵌几 MB 的中文字体。
 * 代价:PDF 里的文字是图片、不可选中;换来的是"一键下载"、跨平台一致。
 * (jspdf / html2canvas 动态导入,单独打包,不拖累主包体积。)
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
    .pdfroot { font-family:"PingFang SC","Microsoft YaHei",sans-serif; color:#374151; font-size:14px; line-height:1.75; padding:34px 36px; background:#fff; }
    .pdfroot .cover { border-bottom:3px solid #4f46e5; padding-bottom:12px; margin-bottom:6px; }
    .pdfroot h1 { font-size:25px; margin:0; color:#111827; font-weight:700; letter-spacing:.5px; }
    .pdfroot .sub { color:#6b7280; font-size:12px; margin:8px 0 0; }
    .pdfroot h2 { font-size:16px; margin:26px 0 10px; padding-left:11px; border-left:4px solid #4f46e5; color:#1f2937; font-weight:700; }
    .pdfroot .summary { background:#f5f6ff; border:1px solid #e0e2f5; border-radius:8px; padding:14px 16px; line-height:1.9; color:#374151; }
    .pdfroot .kp { margin:9px 0; line-height:1.75; }
    .pdfroot .kpn { display:inline-block; width:21px; height:21px; border-radius:50%; background:#4f46e5; color:#fff; font-size:12px; font-weight:700; text-align:center; line-height:21px; vertical-align:-5px; margin-right:9px; }
    .pdfroot .kpt { }
    .pdfroot .corr { background:#fffbeb; border:1px solid #fde68a; border-radius:8px; padding:12px 16px; }
    .pdfroot .corr h2 { color:#b45309; border:0; margin:0 0 8px; padding:0; }
    .pdfroot .ci { margin:4px 0; font-size:13px; }
    .pdfroot .cx { text-decoration:line-through; color:#a16207; }
    .pdfroot .ca { color:#d97706; margin:0 7px; }
    .pdfroot .cy { color:#92400e; font-weight:700; }
    .pdfroot .ln { margin:0 0 7px; }
    .pdfroot .meta { color:#9ca3af; font-size:11px; margin-right:6px; font-family:monospace; }
    .pdfroot .spk { color:#4f46e5; font-size:11px; font-weight:700; margin-right:6px; }
    .pdfroot .txt { color:#1f2937; }
    .pdfroot .foot { margin-top:30px; padding-top:10px; border-top:1px solid #e5e7eb; color:#9ca3af; font-size:10px; text-align:center; }
    .pdfroot .divider { border-top:2px dashed #cbd5e1; margin:30px 0 6px; }
  </style>`;

/** 一节课的正文(不含 style / pdfroot 外壳),供单个/批量拼装。 */
function docBody(doc: PdfDoc): string {
  // html2canvas 对行内背景按 line-height 铺,所以高亮用 inline-block + 紧凑行高贴住文字。
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
  const points = (doc.keyPoints ?? [])
    .map((p, i) => `<div class="kp"><span class="kpn">${i + 1}</span><span class="kpt">${esc(p)}</span></div>`)
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

/** 批量:把多节课拼成一个 PDF 下载(每节之间加分隔线)。 */
export async function exportPdfBatch(docs: PdfDoc[], title = '批量导出'): Promise<void> {
  if (!docs.length) return;
  const body = docs
    .map((d, i) => `${i > 0 ? '<div class="divider"></div>' : ''}${docBody(d)}`)
    .join('');
  return renderPdf(title, `${PDF_STYLE}<div class="pdfroot">${body}<div class="foot">由「课堂实时字幕」批量导出 · 共 ${docs.length} 节</div></div>`);
}

/** 核心:把一段(含内联样式的)HTML 在隔离 iframe 里渲染成 jsPDF 对象(多页 A4)。 */
async function buildPdf(innerHtml: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  // 隔离 iframe:里面不加载应用的 Tailwind,避免 oklch() 让 html2canvas 崩。
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-99999px';
  iframe.style.top = '0';
  iframe.style.width = '794px';
  iframe.style.height = '10px';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  try {
    const idoc = iframe.contentDocument;
    if (!idoc) throw new Error('无法创建导出画布');
    idoc.open();
    idoc.write('<!doctype html><html><head><meta charset="utf-8"></head>' +
      '<body style="margin:0;background:#fff;">' + innerHtml + '</body></html>');
    idoc.close();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
    const canvas = await html2canvas(idoc.body, { scale: 2, backgroundColor: '#ffffff', useCORS: true, width: 794, windowWidth: 794 });
    const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const imgW = pageW - margin * 2;
    const imgH = (canvas.height * imgW) / canvas.width;
    const imgData = canvas.toDataURL('image/jpeg', 0.92);
    const usableH = pageH - margin * 2;
    let heightLeft = imgH;
    let position = margin;
    pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
    heightLeft -= usableH;
    while (heightLeft > 0) {
      position -= usableH;
      pdf.addPage();
      pdf.addImage(imgData, 'JPEG', margin, position, imgW, imgH);
      heightLeft -= usableH;
    }
    return pdf;
  } finally {
    if (iframe.parentNode) document.body.removeChild(iframe);
  }
}

/** 渲染并下载 PDF。 */
export async function renderPdf(title: string, innerHtml: string): Promise<void> {
  const pdf = await buildPdf(innerHtml);
  pdf.save(`${(title || '文档').replace(/[\\/:*?"<>|]/g, '_')}.pdf`);
}

/** 渲染成 PDF Blob(用于页面内嵌预览,不下载)。 */
export async function buildPdfBlob(innerHtml: string): Promise<Blob> {
  const pdf = await buildPdf(innerHtml);
  return pdf.output('blob') as Blob;
}

export async function exportPdf(doc: PdfDoc): Promise<void> {
  return renderPdf(doc.title, contentHtml(doc));
}
