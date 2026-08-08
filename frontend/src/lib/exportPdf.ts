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
  // 去重(有时 AI 会给出重复的知识点),再用朴素「N.」编号
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

/** 批量:每节课各出一个 PDF,打包成 zip 下载(不再拼成一个)。 */
export async function exportPdfBatch(docs: PdfDoc[], title = '批量导出'): Promise<void> {
  if (!docs.length) return;
  if (docs.length === 1) return exportPdf(docs[0]);   // 只有一节就直接下 PDF,不打包
  const [{ default: JSZip }, { makeSessionPdf }] = await Promise.all([import('jszip'), import('./vectorPdf')]);
  const zip = new JSZip();
  const used = new Set<string>();
  for (const doc of docs) {
    const bytes = await makeSessionPdf(doc);   // 矢量 PDF
    const base = (doc.title || '课程').replace(/[\\/:*?"<>|]/g, '_').slice(0, 80) || '课程';
    let name = base, k = 2;
    while (used.has(name)) name = `${base}(${k++})`;   // 防重名
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
  // 延迟撤销:点击后马上撤销会让部分浏览器(尤其 Safari)取消下载
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 核心:把一段(含内联样式的)HTML 在隔离 iframe 里渲染成 jsPDF 对象(多页 A4)。
 * 短文档整张 scale 3 高清;超长文档逐页高清渲染(每页只截一页高的内容),都清晰、都不越界。 */
async function buildPdf(innerHtml: string) {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ]);
  // 隔离 iframe:里面不加载应用的 Tailwind,避免 oklch() 让 html2canvas 崩。
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
    // 整张渲染:短文档 scale 3 清晰;内容越高 scale 越低,把 canvas 钳在浏览器上限内(避免空白/卡死)。
    const render = (cap: number) => {
      const scale = Math.min(3, cap / contentH);
      return html2canvas(idoc.body, { scale, backgroundColor: '#ffffff', useCORS: true, width: 794, windowWidth: 794 });
    };
    let canvas = await render(16000);          // 先尽量清晰
    if (!canvas.height) canvas = await render(8000);   // 超浏览器画布上限就降级重试,别卡死
    if (!canvas.height) throw new Error('渲染失败,内容可能过大——请少选几节');
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const margin = 10;
    const imgW = pageW - margin * 2;
    const usableH = pageH - margin * 2;                 // 每页内容毫米高
    const cw = canvas.width;
    const usedScale = cw / 794;                         // 实际用的缩放
    const pxPerMmCss = 794 / imgW;                      // CSS px / mm
    const pageMaxCss = usableH * pxPerMmCss;            // 一页最多放多少 CSS px 高

    // 收集"安全断点"(各块元素底边,CSS px)——只在句子/块之间断页,不切断句子。
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
      // 这一页放到 (yCss, limit] 内最靠后的断点;某个块比一页还高时才硬切在 limit。
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
  const { makeSessionPdf } = await import('./vectorPdf');
  const bytes = await makeSessionPdf(doc);   // 矢量 PDF(清晰、可选中)
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(doc.title || '课程').replace(/[\\/:*?"<>|]/g, '_')}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
