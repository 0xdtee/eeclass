import { useState, useRef, useCallback } from 'react';
import Modal from '@/components/base/Modal';
import type { ScheduleCourse } from '@/hooks/useRecords';
import { useT } from '@/lib/i18n';

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Document (docx/pdf) import: create a session */
  onConfirm: (data: { title: string; date: string; time: string; duration: string; tags: string[]; description: string }) => void;
  /** Timetable screenshot -> recognize courses */
  onImportImage: (dataUrl: string) => Promise<{ courses: ScheduleCourse[]; anchor_monday?: string; error?: string }>;
  /** Timetable PDF -> server renders + recognizes courses (pass raw base64, no data: prefix) */
  onImportPdf: (pdfBase64: string) => Promise<{ courses: ScheduleCourse[]; anchor_monday?: string; error?: string }>;
  /** Confirm adding the recognized courses to the calendar. firstMonday = the semester's first-week Monday
   * (yyyy-mm-dd); each course carries the week range it recurs over. */
  onConfirmCourses: (courses: ConfirmCourse[], firstMonday: string) => void;
}

type Stage = 'upload' | 'parsing' | 'courses' | 'review' | 'error';
const DAY = ['一', '二', '三', '四', '五', '六', '日'];
const DEFAULT_WEEKS = 16;
const pad2 = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** The Monday (>= this week) of a given yyyy-mm-dd, or this week's Monday if the string is empty/invalid */
const mondayOf = (s: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
  base.setHours(0, 0, 0, 0);
  base.setDate(base.getDate() - ((base.getDay() + 6) % 7));   // back up to Monday
  return iso(base);
};

/** A recognized course plus the explicit teaching weeks it should recur over (1-based week numbers). */
export type ConfirmCourse = ScheduleCourse & { weeks: number[] };

/** Compress a week list to a compact string: [1..16]→"1-16", [1,5,9,13]→"1,5,9,13", [1..8,10..16]→"1-8,10-16". */
const compressWeeks = (ws: number[]): string => {
  const s = [...new Set(ws)].filter((n) => n >= 1).sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < s.length;) {
    let j = i;
    while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++;
    parts.push(i === j ? `${s[i]}` : `${s[i]}-${s[j]}`);
    i = j + 1;
  }
  return parts.join(',');
};
/** Parse a compact weeks string ("1-16", "1,5,9,13", "2-16") into a sorted unique week list. */
const parseWeeks = (str: string, max = 30): number[] => {
  const out = new Set<number>();
  for (const tok of (str || '').split(/[,，、\s]+/).filter(Boolean)) {
    const m = /^(\d+)\s*[-~到]\s*(\d+)$/.exec(tok);
    if (m) {
      let a = +m[1], b = +m[2];
      if (a > b) [a, b] = [b, a];
      for (let w = a; w <= b; w++) if (w >= 1 && w <= max) out.add(w);
    } else {
      const n = +tok;
      if (Number.isInteger(n) && n >= 1 && n <= max) out.add(n);
    }
  }
  return [...out].sort((a, b) => a - b);
};

export default function ImportModal({ isOpen, onClose, onConfirm, onImportImage, onImportPdf, onConfirmCourses }: ImportModalProps) {
  const t = useT();
  const [stage, setStage] = useState<Stage>('upload');
  const [errorMsg, setErrorMsg] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedContent, setParsedContent] = useState('');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [courses, setCourses] = useState<ScheduleCourse[]>([]);
  const [picked, setPicked] = useState<boolean[]>([]);
  const [firstMonday, setFirstMonday] = useState('');       // semester's first-week Monday (yyyy-mm-dd)
  const [weeks, setWeeks] = useState(DEFAULT_WEEKS);         // total teaching weeks (default for courses with unknown weeks)
  const [weekTexts, setWeekTexts] = useState<string[]>([]);   // per-course editable weeks expression
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const reset = () => {
    setStage('upload'); setErrorMsg(''); setFileName(''); setParsedContent('');
    setTitle(''); setDate(''); setCourses([]); setPicked([]); setDragOver(false);
    setFirstMonday(''); setWeeks(DEFAULT_WEEKS); setWeekTexts([]);
  };
  const handleClose = () => { reset(); onClose(); };

  const parseDocx = async (buffer: ArrayBuffer) =>
    (await (await import('mammoth')).default.extractRawText({ arrayBuffer: buffer })).value.trim();

  const loadPdf = async (buffer: ArrayBuffer) => {
    const pdfjsLib = await import('pdfjs-dist');
    // Bundle the worker locally, don't use a CDN
    pdfjsLib.GlobalWorkerOptions.workerSrc = (
      await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    ).default;
    // getDocument consumes the buffer; pass a copy so the caller can reuse `buffer` afterwards
    return pdfjsLib.getDocument({ data: buffer.slice(0) }).promise;
  };

  const parsePdf = async (buffer: ArrayBuffer) => {
    const pdf = await loadPdf(buffer);
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const content = await (await pdf.getPage(i)).getTextContent();
      pages.push(content.items.map((it) => ('str' in it ? it.str : '')).join(' '));
    }
    return pages.join('\n\n').trim();
  };

  const readFileDataUrl = (file: File): Promise<string> => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(new Error(t('文件读取失败')));
    r.readAsDataURL(file);
  });

  /** Apply a recognized-courses result and move to the course-confirmation stage. */
  const applyCourseResult = useCallback((out: { courses?: ScheduleCourse[]; anchor_monday?: string; error?: string }): boolean => {
    if (out.error) { setErrorMsg(out.error); setStage('error'); return false; }
    const cs = out.courses ?? [];
    if (cs.length === 0) { setErrorMsg(t('未能识别到课程,请更换更清晰的课表(截图或 PDF)重试')); setStage('error'); return false; }
    setCourses(cs);
    setPicked(cs.map(() => true));
    setFirstMonday(mondayOf(out.anchor_monday || ''));
    // Total weeks defaults to the largest recognized week (fallback 16); each course shows its recognized weeks,
    // so the user usually doesn't need to touch anything.
    const totalWk = Math.max(DEFAULT_WEEKS, ...cs.flatMap((c) => c.weeks ?? []));
    setWeeks(totalWk);
    setWeekTexts(cs.map((c) => (c.weeks && c.weeks.length ? compressWeeks(c.weeks) : `1-${totalWk}`)));
    setStage('courses');
    return true;
  }, []);

  const handleImage = useCallback(async (file: File) => {
    setFileName(file.name);
    setStage('parsing');
    setErrorMsg('');
    try {
      applyCourseResult(await onImportImage(await readFileDataUrl(file)));
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : t('识别失败'));
      setStage('error');
    }
  }, [onImportImage, applyCourseResult]);

  // Does the extracted text look like a class timetable (vs a lecture document)?
  const looksLikeTimetable = (s: string) =>
    /星期[一二三四五六日]|周[一二三四五六日]|第\s*[0-9一二两三四五六七八九十]+\s*节|[0-9]+\s*[-~]\s*[0-9]+\s*周|周次|课表/.test(s);

  const handleDoc = useCallback(async (file: File, ext: string) => {
    setFileName(file.name);
    setStage('parsing');
    setErrorMsg('');
    try {
      const buffer = await file.arrayBuffer();
      let text = '';
      try {
        text = ext === 'docx' ? await parseDocx(buffer) : await parsePdf(buffer);
      } catch {
        text = '';   // e.g. an image-only/scanned PDF has no text layer -> fall through to image recognition
      }
      // A PDF course-table (timetable-like text, or no text at all) -> let the SERVER render + recognize it
      // (robust for image-only/scanned PDFs; avoids fragile in-browser PDF rendering).
      if (ext === 'pdf' && (looksLikeTimetable(text) || !text.trim())) {
        const dataUrl = await readFileDataUrl(file);
        const b64 = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
        applyCourseResult(await onImportPdf(b64));
        return;
      }
      if (!text.trim()) { setErrorMsg(t('未能从文件中提取到文字')); setStage('error'); return; }
      setParsedContent(text);
      setTitle(file.name.replace(/\.(docx|pdf)$/i, ''));
      const now = new Date();
      setDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);
      setStage('review');
    } catch (e) {
      setErrorMsg(e instanceof Error ? `${t('文件解析失败')}：${e.message}` : t('文件解析失败'));
      setStage('error');
    }
  }, [onImportPdf, applyCourseResult]);

  const handleFile = useCallback((file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (file.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
      void handleImage(file);
    } else if (ext === 'docx' || ext === 'pdf') {
      void handleDoc(file, ext);
    } else {
      setErrorMsg(t('支持课表截图(png/jpg)、或 .docx / .pdf 文档')); setStage('error');
    }
  }, [handleImage, handleDoc]);

  const submitDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date) return;
    onConfirm({ title: title.trim(), date, time: '08:30', duration: '1小时30分', tags: [], description: parsedContent.substring(0, 200) });
    handleClose();
  };

  // Changing the global "total weeks" retargets every course still on the default full range "1-<old>"
  // (so bulk-changing works), while a course whose weeks you edited keeps its own value.
  const changeWeeks = (nw: number) => {
    const w = Math.max(1, Math.min(30, Math.round(nw) || 1));
    setWeekTexts((prev) => prev.map((txt) => (txt.trim() === `1-${weeks}` ? `1-${w}` : txt)));
    setWeeks(w);
  };

  const confirmCourses = () => {
    const chosen: ConfirmCourse[] = courses
      .map((c, i) => {
        const ws = parseWeeks(weekTexts[i] ?? '');
        return { ...c, weeks: ws.length ? ws : parseWeeks(`1-${weeks}`) };
      })
      .filter((_, i) => picked[i]);
    if (chosen.length === 0) return;
    onConfirmCourses(chosen, firstMonday);
    handleClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title={t('导入课表 / 文档')} width="max-w-xl">
      {stage === 'upload' && (
        <div
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            dragOver ? 'border-accent-400 bg-accent-50' : 'border-background-200 hover:border-accent-300 hover:bg-background-100'
          }`}
        >
          <input ref={fileInputRef} type="file" accept="image/*,.docx,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} className="hidden" />
          <div className="w-16 h-16 mx-auto flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
            <i className="ri-calendar-schedule-line text-accent-600 text-2xl"></i>
          </div>
          <p className="text-sm font-semibold text-foreground-700 mb-1">{dragOver ? t('松开以上传') : t('上传课表截图,自动识别课程加进日历')}</p>
          <p className="text-xs text-foreground-400">{t('课表支持截图(png/jpg)或 PDF;讲义文档支持 .docx / .pdf')}</p>
        </div>
      )}

      {stage === 'parsing' && (
        <div className="py-12 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center bg-accent-100 rounded-2xl mb-4">
            <div className="w-7 h-7 border-2 border-accent-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
          <p className="text-sm font-medium text-foreground-700 mb-1">{t('正在识别…(截图识别需十几秒)')}</p>
          <p className="text-xs text-foreground-400 truncate max-w-[220px] mx-auto">{fileName}</p>
        </div>
      )}

      {stage === 'error' && (
        <div className="py-8 text-center">
          <div className="w-14 h-14 mx-auto flex items-center justify-center bg-red-100 rounded-2xl mb-4">
            <i className="ri-error-warning-line text-red-500 text-2xl"></i>
          </div>
          <p className="text-sm font-medium text-red-600 mb-3">{errorMsg}</p>
          <div className="flex items-center gap-3 justify-center">
            <button onClick={() => { setStage('upload'); setErrorMsg(''); }} className="px-4 py-2 bg-background-100 text-foreground-600 rounded-lg text-xs font-medium hover:bg-background-200 cursor-pointer">{t('重新上传')}</button>
            <button onClick={handleClose} className="px-4 py-2 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 cursor-pointer">{t('取消')}</button>
          </div>
        </div>
      )}

      {stage === 'courses' && (
        <div className="space-y-3">
          <p className="text-xs text-foreground-500">{t('识别到')} <b className="text-accent-600">{courses.length}</b> {t('门课。设置学期起始与周数后加入日历,课程会每周重复。')}</p>

          {/* Semester span: applies to ALL courses */}
          <div className="flex flex-wrap items-end gap-3 p-3 bg-background-100 rounded-lg">
            <div className="flex-1 min-w-[150px]">
              <label className="block text-[11px] font-medium text-foreground-500 mb-1">{t('第 1 周的周一')}</label>
              <input
                type="date"
                value={firstMonday}
                onChange={(e) => setFirstMonday(mondayOf(e.target.value))}
                className="w-full px-2.5 py-2 bg-background-50 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400"
              />
            </div>
            <div className="w-24">
              <label className="block text-[11px] font-medium text-foreground-500 mb-1">{t('共几周')}</label>
              <input
                type="number" min={1} max={30} value={weeks}
                onChange={(e) => changeWeeks(Number(e.target.value))}
                className="w-full px-2.5 py-2 bg-background-50 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400"
              />
            </div>
          </div>
          <p className="text-[11px] text-foreground-400 -mt-1">{t('已自动读出每门课的上课周次,如有出入可逐门修改。支持「1-16」「1,5,9,13」「1-8,10-16」这类写法。')}</p>

          <div className="max-h-[40vh] overflow-y-auto space-y-1.5 -mx-1 px-1">
            {courses.map((c, i) => (
              <div key={i} className={`flex items-center gap-2 p-2.5 rounded-lg border transition-colors ${picked[i] ? 'bg-accent-50 border-accent-200' : 'bg-background-100 border-background-200 opacity-60'}`}>
                <input type="checkbox" checked={picked[i]} onChange={() => setPicked((p) => p.map((v, j) => (j === i ? !v : v)))} className="accent-accent-500 w-4 h-4 flex-shrink-0 cursor-pointer" />
                <span className="text-xs font-mono text-accent-600 flex-shrink-0 w-8 text-center">{t('周' + (DAY[c.day - 1] ?? c.day))}</span>
                <span className="text-xs font-mono text-foreground-400 flex-shrink-0 w-[86px]">{c.start}-{c.end}</span>
                <span className="text-sm text-foreground-800 font-medium truncate flex-1 min-w-0">{c.name}</span>
                <span className="flex items-center gap-1 flex-shrink-0 text-[11px] text-foreground-400">
                  {t('第')}
                  <input type="text" value={weekTexts[i] ?? ''}
                    onChange={(e) => setWeekTexts((p) => p.map((v, j) => (j === i ? e.target.value : v)))}
                    placeholder="1-16"
                    className="w-24 px-1.5 py-1 bg-background-50 border border-background-200 rounded text-center text-xs font-mono focus:outline-none focus:border-accent-400" />
                  {t('周')}
                </span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button onClick={handleClose} className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 cursor-pointer">{t('取消')}</button>
            <button onClick={confirmCourses} className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 cursor-pointer">
              {t('加入日历（{n}）', { n: picked.filter(Boolean).length })}
            </button>
          </div>
        </div>
      )}

      {stage === 'review' && (
        <form onSubmit={submitDoc} className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-accent-50 rounded-lg">
            <i className="ri-file-text-line text-accent-600 text-sm"></i>
            <span className="text-xs font-medium text-accent-700 truncate">{fileName}</span>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('课时标题')}</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400" required autoFocus />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground-600 mb-1.5">{t('日期')}</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full px-3 py-2.5 bg-background-100 border border-background-200 rounded-lg text-sm focus:outline-none focus:border-accent-400" required />
          </div>
          <div className="flex items-center gap-3 pt-2">
            <button type="button" onClick={handleClose} className="flex-1 py-2.5 bg-background-100 text-foreground-600 rounded-lg text-sm font-medium hover:bg-background-200 cursor-pointer">{t('取消')}</button>
            <button type="submit" className="flex-1 py-2.5 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 cursor-pointer">{t('导入并创建')}</button>
          </div>
        </form>
      )}
    </Modal>
  );
}
