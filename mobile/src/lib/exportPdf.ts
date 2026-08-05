export function exportTranscriptionAsPdf(sessionTitle: string, lines: { ts: string; speaker: string; text: string }[], summary?: string) {
  const printWindow = window.open('', '_blank');
  if (!printWindow) return;

  const now = new Date().toLocaleString('zh-CN');
  const linesHtml = lines.map((l) =>
    `<div class="line"><span class="ts">${l.ts}</span><span class="speaker">${l.speaker}</span><span class="text">${l.text}</span></div>`
  ).join('\n');

  const summaryHtml = summary
    ? `<div class="summary"><h2>AI 摘要</h2><p>${summary}</p></div>`
    : '';

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${sessionTitle}</title>
      <style>
        @page { margin: 2cm; size: A4; }
        body { font-family: -apple-system, "Noto Sans SC", sans-serif; font-size: 12px; line-height: 1.8; color: #333; }
        h1 { font-size: 18px; margin-bottom: 4px; }
        .meta { color: #888; font-size: 11px; margin-bottom: 24px; }
        .line { margin-bottom: 4px; display: flex; gap: 8px; }
        .ts { color: #999; font-family: monospace; min-width: 70px; }
        .speaker { color: #555; font-weight: 600; min-width: 50px; }
        .text { flex: 1; }
        .summary { margin-top: 32px; padding-top: 16px; border-top: 2px solid #eee; }
        .summary h2 { font-size: 14px; margin-bottom: 8px; }
      </style>
    </head>
    <body>
      <h1>${sessionTitle}</h1>
      <p class="meta">导出时间：${now}</p>
      ${summaryHtml}
      <div class="lines">${linesHtml}</div>
    </body>
    </html>
  `);
  printWindow.document.close();
  printWindow.focus();
  setTimeout(() => printWindow.print(), 500);
}