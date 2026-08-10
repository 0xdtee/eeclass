/**
 * Export a real .docx (Office Open XML) via the `docx` library — opens correctly in Word, Pages,
 * Google Docs, WPS, etc. (The old approach saved HTML as .doc, which non-Word apps show as raw markup.)
 * The library is lazy-loaded so it stays out of the main bundle.
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

const ACCENT = '4F46E5';   // indigo (hex, no '#')

const parseCorr = (c: string): [string, string] | null => {
  const m = (c || '').match(/听成[\s"'“”「『]*(.+?)[\s"'“”」』]*应为[\s"'“”「『]*(.+?)(?:["'“”」』]|[，,。；;、]|$)/);
  if (!m) return null;
  const clean = (x: string) => x.trim().replace(/^[「『"'“”\s]+|[」』"'“”。，,、；;\s]+$/g, '').trim();
  const a = clean(m[1]), b = clean(m[2]);
  return a && b && a !== b ? [a, b] : null;
};

export async function exportWord(doc: WordDoc): Promise<void> {
  const { Document, Packer, Paragraph, TextRun, BorderStyle, AlignmentType } = await import('docx');

  const heading = (title: string) =>
    new Paragraph({
      spacing: { before: 340, after: 120 },
      border: { left: { style: BorderStyle.SINGLE, size: 24, space: 8, color: ACCENT } },
      children: [new TextRun({ text: title, bold: true, size: 26, color: '1F2937' })],
    });

  const children = [] as InstanceType<typeof Paragraph>[];

  // cover: title + subtitle with an accent underline
  children.push(new Paragraph({
    spacing: { after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 18, space: 6, color: ACCENT } },
    children: [new TextRun({ text: doc.title || '课程', bold: true, size: 40, color: '111827' })],
  }));
  if (doc.subtitle) {
    children.push(new Paragraph({ spacing: { after: 120 }, children: [new TextRun({ text: doc.subtitle, size: 18, color: '6B7280' })] }));
  }

  if (doc.summary && doc.summary.trim()) {
    children.push(heading('课堂摘要'));
    children.push(new Paragraph({
      spacing: { after: 120, line: 340, lineRule: 'auto' },
      shading: { type: 'clear', fill: 'F5F6FF', color: 'auto' },
      children: [new TextRun({ text: doc.summary, size: 23, color: '374151' })],
    }));
  }

  const pts = (doc.keyPoints ?? []).map((s) => (s ?? '').trim()).filter((s, i, a) => s && a.indexOf(s) === i);
  if (pts.length) {
    children.push(heading('重点知识点'));
    pts.forEach((p, i) => children.push(new Paragraph({
      spacing: { after: 70, line: 300, lineRule: 'auto' },
      children: [
        new TextRun({ text: `${i + 1}.  `, bold: true, size: 22, color: ACCENT }),
        new TextRun({ text: p, size: 22, color: '374151' }),
      ],
    })));
  }

  const corr = (doc.corrections ?? []).map(parseCorr).filter(Boolean) as [string, string][];
  if (corr.length) {
    children.push(heading('识别可能听错(仅供参考)'));
    corr.forEach(([a, b]) => children.push(new Paragraph({
      spacing: { after: 40 },
      children: [
        new TextRun({ text: a, strike: true, size: 21, color: 'B45309' }),
        new TextRun({ text: '  →  ', size: 21, color: '92400E' }),
        new TextRun({ text: b, bold: true, size: 21, color: '92400E' }),
      ],
    })));
  }

  const lines = doc.lines ?? [];
  if (lines.length) {
    children.push(heading('课堂转写全文'));
    lines.forEach((l) => {
      const runs = [
        new TextRun({ text: `${l.ts} `, size: 17, color: '9CA3AF' }),
        new TextRun({ text: `${l.speaker}  `, bold: true, size: 18, color: ACCENT }),
        new TextRun({
          text: l.text,
          size: 21,
          color: '1F2937',
          highlight: l.kind === 'key' ? 'yellow' : l.kind === 'define' ? 'green' : undefined,
        }),
      ];
      children.push(new Paragraph({ spacing: { after: 80, line: 300, lineRule: 'auto' }, children: runs }));
    });
  }

  children.push(new Paragraph({
    spacing: { before: 280 },
    alignment: AlignmentType.CENTER,
    border: { top: { style: BorderStyle.SINGLE, size: 6, space: 6, color: 'E5E7EB' } },
    children: [new TextRun({ text: '由「课堂实时字幕」自动生成', size: 16, color: '9CA3AF' })],
  }));

  const file = new Document({
    sections: [{
      properties: { page: { margin: { top: 1247, bottom: 1247, left: 1134, right: 1134 } } },
      children,
    }],
  });

  const blob = await Packer.toBlob(file);
  const name = (doc.title || '课程').replace(/[\\/:*?"<>|]/g, '_');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
