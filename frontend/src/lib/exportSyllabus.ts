import { renderPdf, buildPdfBlob } from './exportPdf';

export interface Syllabus {
  course: string;
  source?: string;   // 'official' 官方 | 'standard' 通用
  overview?: string;
  credits_hint?: string;
  textbooks?: string[];
  chapters?: { title: string; topics?: string[]; exam_points?: string[] }[];
  key_formulas?: string[];
}

const esc = (s: string) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

function syllabusHtml(s: Syllabus): string {
  const chapters = (s.chapters ?? [])
    .map((ch, i) => {
      const topics = (ch.topics ?? []).map((t) => `<span class="tag">${esc(t)}</span>`).join('');
      const exams = (ch.exam_points ?? []).map((e) => `<li>${esc(e)}</li>`).join('');
      return `<div class="ch">
        <div class="cht"><span class="chn">${i + 1}</span>${esc(ch.title)}</div>
        ${topics ? `<div class="tags">${topics}</div>` : ''}
        ${exams ? `<div class="ex"><div class="exl">常见考点</div><ul>${exams}</ul></div>` : ''}
      </div>`;
    })
    .join('');
  const books = (s.textbooks ?? []).map((b) => `<li>${esc(b)}</li>`).join('');
  const formulas = (s.key_formulas ?? []).map((f) => `<li>${esc(f)}</li>`).join('');

  return `<style>
    .r { font-family:"PingFang SC","Microsoft YaHei",sans-serif; color:#374151; font-size:14px; line-height:1.7; padding:34px 36px; background:#fff; }
    .r .cover { border-bottom:3px solid #4f46e5; padding-bottom:12px; margin-bottom:4px; }
    .r h1 { font-size:24px; margin:0; color:#111827; font-weight:700; }
    .r .sub { color:#6b7280; font-size:12px; margin:8px 0 0; }
    .r h2 { font-size:16px; margin:22px 0 10px; padding-left:11px; border-left:4px solid #4f46e5; color:#1f2937; font-weight:700; }
    .r .box { background:#f5f6ff; border:1px solid #e0e2f5; border-radius:8px; padding:12px 16px; }
    .r ul { margin:4px 0; padding-left:20px; }
    .r li { margin:3px 0; }
    .r .ch { border:1px solid #e5e7eb; border-radius:8px; padding:12px 14px; margin:10px 0; }
    .r .cht { font-size:14px; font-weight:700; color:#1f2937; margin-bottom:7px; }
    .r .chn { display:inline-block; width:20px; height:20px; border-radius:50%; background:#4f46e5; color:#fff; font-size:11px; font-weight:700; text-align:center; line-height:20px; vertical-align:-4px; margin-right:8px; }
    .r .tags { }
    .r .tag { display:inline-block; background:#eef2ff; color:#4338ca; font-size:11.5px; padding:2px 9px; border-radius:10px; margin:0 5px 5px 0; }
    .r .ex { margin-top:8px; background:#fffbeb; border-radius:6px; padding:7px 12px; }
    .r .exl { font-size:11px; color:#b45309; font-weight:700; margin-bottom:2px; }
    .r .ex li { color:#92400e; font-size:12.5px; }
    .r .foot { margin-top:28px; padding-top:10px; border-top:1px solid #e5e7eb; color:#9ca3af; font-size:10px; text-align:center; }
  </style>
  <div class="r">
    <div class="cover">
      <h1>${esc(s.course)} · 教学大纲</h1>
      <p class="sub">${esc(s.credits_hint || '')}${s.credits_hint ? ' · ' : ''}标准教学大纲(综合国内主流高校通用要求,仅供参考)</p>
    </div>
    ${s.overview ? `<h2>课程简介</h2><div class="box">${esc(s.overview)}</div>` : ''}
    ${books ? `<h2>常用教材</h2><ul>${books}</ul>` : ''}
    ${formulas ? `<h2>核心公式 / 定理</h2><ul>${formulas}</ul>` : ''}
    ${chapters ? `<h2>章节与考点</h2>${chapters}` : ''}
    <div class="foot">由「课堂实时字幕」整理生成</div>
  </div>`;
}

export function exportSyllabusPdf(s: Syllabus): Promise<void> {
  return renderPdf(`${s.course}-教学大纲`, syllabusHtml(s));
}

/** 生成大纲 PDF 的 Blob,用于页面内嵌预览。 */
export function syllabusPdfBlob(s: Syllabus): Promise<Blob> {
  return buildPdfBlob(syllabusHtml(s));
}
